macro_rules! session_project_cte {
    ($session_where:expr) => {
        concat!(
            "
WITH session_project_overlap AS (
    SELECT s.id as session_id,
           fa.project_id as project_id,
           SUM(
               MAX(
                   0,
                   MIN(strftime('%s', s.end_time), strftime('%s', fa.last_seen)) -
                   MAX(strftime('%s', s.start_time), strftime('%s', fa.first_seen))
               )
           ) as overlap_seconds,
           (strftime('%s', s.end_time) - strftime('%s', s.start_time)) as span_seconds
    FROM sessions s
    JOIN file_activities fa
      ON fa.app_id = s.app_id
     AND fa.date = s.date
     AND fa.project_id IS NOT NULL
     AND fa.last_seen > s.start_time
     AND fa.first_seen < s.end_time
    WHERE ",
            $session_where,
            "
    GROUP BY s.id, fa.project_id
),
ranked_overlap AS (
    SELECT session_id, project_id, overlap_seconds, span_seconds,
           ROW_NUMBER() OVER (
               PARTITION BY session_id
               ORDER BY overlap_seconds DESC, project_id ASC
           ) as rn,
           COUNT(*) OVER (PARTITION BY session_id) as project_count
    FROM session_project_overlap
),
session_projects AS (
    SELECT s.id,
           s.app_id as app_id,
           s.start_time,
           s.end_time,
           CASE
               WHEN s.project_id IS NOT NULL THEN s.project_id
               WHEN ro.project_count = 1
                AND ro.overlap_seconds * 2 >= ro.span_seconds
               THEN ro.project_id
               ELSE NULL
           END as project_id,
           COALESCE(s.rate_multiplier, 1.0) as multiplier,
           CAST(s.duration_seconds AS REAL) as duration_seconds,
           CASE
               WHEN s.rate_multiplier IS NULL OR s.rate_multiplier <= 0 THEN 1.0
               ELSE s.rate_multiplier
           END as safe_rate_multiplier,
           s.comment
    FROM sessions s
    LEFT JOIN ranked_overlap ro
      ON ro.session_id = s.id
     AND ro.rn = 1
    WHERE ",
            $session_where,
            "
)
"
        )
    };
}

pub const SESSION_PROJECT_CTE: &str = session_project_cte!(
    "s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)"
);

pub const SESSION_PROJECT_CTE_ALL_TIME: &str = session_project_cte!(
    "s.date >= COALESCE((SELECT MIN(date) FROM sessions), '0001-01-01')
     AND s.date <= COALESCE((SELECT MAX(date) FROM sessions), '9999-12-31')
     AND (s.is_hidden IS NULL OR s.is_hidden = 0)"
);
