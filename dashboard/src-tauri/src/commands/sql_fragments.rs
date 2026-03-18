use std::collections::BTreeSet;

macro_rules! session_project_cte {
    ($session_where:expr) => {
        concat!(
            "
WITH session_projects AS (
    SELECT spc.session_id as id,
           spc.app_id as app_id,
           spc.start_time,
           spc.end_time,
           spc.project_id,
           spc.multiplier,
           spc.duration_seconds,
           CASE
               WHEN spc.multiplier <= 0 THEN 1.0
               ELSE spc.multiplier
           END as safe_rate_multiplier,
           spc.comment
    FROM session_project_cache spc
    WHERE ",
            $session_where,
            "
)
"
        )
    };
}

macro_rules! active_session_filter {
    () => {
        "(is_hidden IS NULL OR is_hidden = 0)"
    };
    ($alias:literal) => {
        concat!(
            "(",
            $alias,
            ".is_hidden IS NULL OR ",
            $alias,
            ".is_hidden = 0)"
        )
    };
}

pub const ACTIVE_SESSION_FILTER: &str = active_session_filter!();
pub const ACTIVE_SESSION_FILTER_S: &str = active_session_filter!("s");

pub const SESSION_PROJECT_CTE: &str = session_project_cte!(concat!(
    "spc.session_date >= ?1 AND spc.session_date <= ?2"
));

pub const SESSION_PROJECT_CTE_ALL_TIME: &str = session_project_cte!(concat!(
    "1=1"
));

fn mark_cache_day_missing_sql(all_time: bool) -> String {
    let where_clause = if all_time {
        format!(
            "WHERE {ACTIVE_SESSION_FILTER_S}
             AND NOT EXISTS (
                 SELECT 1
                 FROM session_project_cache spc
                 WHERE spc.session_date = s.date
                 LIMIT 1
             )"
        )
    } else {
        format!(
            "WHERE s.date >= ?1
               AND s.date <= ?2
               AND {ACTIVE_SESSION_FILTER_S}
               AND NOT EXISTS (
                   SELECT 1
                   FROM session_project_cache spc
                   WHERE spc.session_date = s.date
                   LIMIT 1
               )"
        )
    };

    format!(
        "SELECT DISTINCT s.date
         FROM sessions s
         {where_clause}
         ORDER BY s.date"
    )
}

fn rebuild_session_project_cache_day(
    conn: &rusqlite::Connection,
    date: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM session_project_cache WHERE session_date = ?1",
        [date],
    )
    .map_err(|e| format!("Failed to clear session_project_cache for {}: {}", date, e))?;

    let sql = format!(
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
    WHERE s.date = ?1 AND {ACTIVE_SESSION_FILTER_S}
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
resolved_sessions AS (
    SELECT s.id as session_id,
           s.date as session_date,
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
           s.comment
    FROM sessions s
    LEFT JOIN ranked_overlap ro
      ON ro.session_id = s.id
     AND ro.rn = 1
    WHERE s.date = ?1 AND {ACTIVE_SESSION_FILTER_S}
)
INSERT INTO session_project_cache (
    session_id,
    session_date,
    app_id,
    start_time,
    end_time,
    project_id,
    multiplier,
    duration_seconds,
    comment,
    built_at
)
SELECT session_id,
       session_date,
       app_id,
       start_time,
       end_time,
       project_id,
       multiplier,
       duration_seconds,
       comment,
       datetime('now')
FROM resolved_sessions"
    );
    conn.execute(&sql, [date]).map_err(|e| {
        format!(
            "Failed to rebuild session_project_cache for {}: {}",
            date, e
        )
    })?;

    conn.execute("DELETE FROM session_project_cache_dirty WHERE date = ?1", [date])
        .map_err(|e| format!("Failed to clear dirty flag for {}: {}", date, e))?;

    Ok(())
}

fn collect_cache_dates(
    conn: &rusqlite::Connection,
    start: Option<&str>,
    end: Option<&str>,
) -> Result<BTreeSet<String>, String> {
    let mut dates = BTreeSet::new();

    let dirty_sql = if start.is_some() && end.is_some() {
        "SELECT date
         FROM session_project_cache_dirty
         WHERE date >= ?1 AND date <= ?2
         ORDER BY date"
    } else {
        "SELECT date
         FROM session_project_cache_dirty
         ORDER BY date"
    };
    let mut dirty_stmt = conn.prepare_cached(dirty_sql).map_err(|e| e.to_string())?;
    if let (Some(start), Some(end)) = (start, end) {
        let dirty_rows = dirty_stmt
            .query_map([start, end], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query dirty cache dates: {}", e))?;
        for row in dirty_rows {
            dates.insert(row.map_err(|e| format!("Failed to read dirty cache date row: {}", e))?);
        }
    } else {
        let dirty_rows = dirty_stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query dirty cache dates: {}", e))?;
        for row in dirty_rows {
            dates.insert(row.map_err(|e| format!("Failed to read dirty cache date row: {}", e))?);
        }
    }

    let missing_sql = mark_cache_day_missing_sql(start.is_none() || end.is_none());
    let mut missing_stmt = conn
        .prepare_cached(&missing_sql)
        .map_err(|e| format!("Failed to prepare missing cache dates query: {}", e))?;
    if let (Some(start), Some(end)) = (start, end) {
        let missing_rows = missing_stmt
            .query_map([start, end], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query missing cache dates: {}", e))?;
        for row in missing_rows {
            dates.insert(
                row.map_err(|e| format!("Failed to read missing cache date row: {}", e))?,
            );
        }
    } else {
        let missing_rows = missing_stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query missing cache dates: {}", e))?;
        for row in missing_rows {
            dates.insert(
                row.map_err(|e| format!("Failed to read missing cache date row: {}", e))?,
            );
        }
    }

    Ok(dates)
}

pub(crate) fn ensure_session_project_cache(
    conn: &rusqlite::Connection,
    start: &str,
    end: &str,
) -> Result<(), String> {
    let dates = collect_cache_dates(conn, Some(start), Some(end))?;
    if dates.is_empty() {
        return Ok(());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start session_project_cache transaction: {}", e))?;
    for date in dates {
        rebuild_session_project_cache_day(&tx, &date)?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit session_project_cache transaction: {}", e))?;
    Ok(())
}

pub(crate) fn ensure_session_project_cache_all(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let dates = collect_cache_dates(conn, None, None)?;
    if dates.is_empty() {
        return Ok(());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start full session_project_cache transaction: {}", e))?;
    for date in dates {
        rebuild_session_project_cache_day(&tx, &date)?;
    }
    tx.commit().map_err(|e| {
        format!(
            "Failed to commit full session_project_cache transaction: {}",
            e
        )
    })?;
    Ok(())
}
