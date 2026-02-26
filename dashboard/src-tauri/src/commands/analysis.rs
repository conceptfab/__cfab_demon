use chrono::{
    DateTime, Duration as ChronoDuration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone,
    Timelike,
};
use std::collections::{BTreeMap, HashMap};
use tauri::AppHandle;

use super::types::{DateRange, HeatmapCell, StackedBarData};
use crate::db;

#[derive(Clone, Copy)]
enum BucketKind {
    Day,
    Hour,
}

struct IntervalRow {
    start: DateTime<Local>,
    end: DateTime<Local>,
    project_name: String,
    multiplier: f64,
    is_manual: bool,
    comment: Option<String>,
}

struct BucketPiece {
    start_ms: i64,
    end_ms: i64,
    project_name: String,
    multiplier: f64,
    is_manual: bool,
    comment: Option<String>,
}

fn local_from_naive(naive: NaiveDateTime) -> Option<DateTime<Local>> {
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(v) => Some(v),
        LocalResult::Ambiguous(v, _) => Some(v),
        LocalResult::None => None,
    }
}

fn parse_local_timestamp(raw: &str) -> Option<DateTime<Local>> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        return Some(dt.with_timezone(&Local));
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S") {
        return local_from_naive(naive);
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M") {
        return local_from_naive(naive);
    }
    None
}

fn bucket_floor(ts: DateTime<Local>, kind: BucketKind) -> Option<DateTime<Local>> {
    match kind {
        BucketKind::Hour => ts
            .with_minute(0)
            .and_then(|v| v.with_second(0))
            .and_then(|v| v.with_nanosecond(0)),
        BucketKind::Day => {
            let naive = ts.date_naive().and_hms_opt(0, 0, 0)?;
            local_from_naive(naive)
        }
    }
}

fn next_bucket(start: DateTime<Local>, kind: BucketKind) -> DateTime<Local> {
    match kind {
        BucketKind::Hour => start + ChronoDuration::hours(1),
        BucketKind::Day => start + ChronoDuration::days(1),
    }
}

fn bucket_key(start: DateTime<Local>, kind: BucketKind) -> String {
    match kind {
        BucketKind::Hour => start.format("%Y-%m-%dT%H:00:00").to_string(),
        BucketKind::Day => start.format("%Y-%m-%d").to_string(),
    }
}

pub(crate) fn compute_project_activity_unique(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
    hourly: bool,
    active_only: bool,
    project_id_filter: Option<i64>,
) -> Result<(
    BTreeMap<String, HashMap<String, f64>>,
    HashMap<String, f64>,
    HashMap<String, (bool, bool)>,
    HashMap<String, Vec<String>>,
), String> {
    let bucket_kind = if hourly {
        BucketKind::Hour
    } else {
        BucketKind::Day
    };

    let start_date =
        NaiveDate::parse_from_str(&date_range.start, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let end_date =
        NaiveDate::parse_from_str(&date_range.end, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let range_start = local_from_naive(
        start_date
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| "Invalid start date".to_string())?,
    )
    .ok_or_else(|| "Invalid start date in local timezone".to_string())?;
    let end_exclusive_date = end_date
        .succ_opt()
        .ok_or_else(|| "Invalid end date".to_string())?;
    let range_end_exclusive = local_from_naive(
        end_exclusive_date
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| "Invalid end date".to_string())?,
    )
    .ok_or_else(|| "Invalid end date in local timezone".to_string())?;

    let mut stmt = conn
        .prepare_cached(
            "WITH session_project_overlap AS (
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
                 WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)
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
                 SELECT s.id, s.start_time, s.end_time,
                        CASE
                            WHEN s.project_id IS NOT NULL THEN s.project_id
                            WHEN ro.project_count = 1
                             AND ro.overlap_seconds * 2 >= ro.span_seconds
                            THEN ro.project_id
                            ELSE NULL
                        END as project_id,
                         COALESCE(s.rate_multiplier, 1.0) as multiplier,
                         s.comment
                  FROM sessions s
                  LEFT JOIN ranked_overlap ro
                    ON ro.session_id = s.id
                   AND ro.rn = 1
                  WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)
              )
              SELECT sp.start_time, sp.end_time, COALESCE(p.name, 'Unassigned') as project_name, sp.multiplier, 0 as is_manual, sp.project_id, sp.comment
              FROM session_projects sp
              LEFT JOIN projects p ON p.id = sp.project_id AND (?3 = 0 OR p.excluded_at IS NULL)
              WHERE ?4 IS NULL OR sp.project_id = ?4
              UNION ALL
              SELECT ms.start_time, ms.end_time, p.name as project_name, 1.0 as multiplier, 1 as is_manual, ms.project_id, ms.title as comment
              FROM manual_sessions ms
              JOIN projects p ON p.id = ms.project_id
              WHERE ms.date >= ?1 AND ms.date <= ?2 AND (?3 = 0 OR p.excluded_at IS NULL)
                AND (?4 IS NULL OR ms.project_id = ?4)",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![date_range.start, date_range.end, active_only as i32, project_id_filter], |row| {
            Ok((
                row.get::<_, String>(0)?, // start_time
                row.get::<_, String>(1)?, // end_time
                row.get::<_, String>(2)?, // project_name
                row.get::<_, f64>(3)?,    // multiplier
                row.get::<_, i32>(4)?,    // is_manual
                row.get::<_, Option<String>>(6)?, // comment
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut intervals: Vec<IntervalRow> = Vec::new();
    for row in rows.filter_map(|r| r.ok()) {
        let Some(start) = parse_local_timestamp(&row.0) else {
            continue;
        };
        let Some(end) = parse_local_timestamp(&row.1) else {
            continue;
        };
        if end <= start {
            continue;
        }
        let project_name = if row.2.trim().is_empty() {
            "Unassigned".to_string()
        } else {
            row.2
        };
        intervals.push(IntervalRow {
            start,
            end,
            project_name,
            multiplier: row.3,
            is_manual: row.4 != 0,
            comment: row.5,
        });
    }

    if intervals.is_empty() {
        return Ok((BTreeMap::new(), HashMap::new(), HashMap::new(), HashMap::new()));
    }

    let mut bucket_pieces: BTreeMap<String, Vec<BucketPiece>> = BTreeMap::new();
    for interval in intervals {
        if interval.end <= range_start || interval.start >= range_end_exclusive {
            continue;
        }
        let mut piece_start = if interval.start < range_start {
            range_start
        } else {
            interval.start
        };
        let piece_end_limit = if interval.end > range_end_exclusive {
            range_end_exclusive
        } else {
            interval.end
        };

        while piece_start < piece_end_limit {
            let Some(bucket_start) = bucket_floor(piece_start, bucket_kind) else {
                break;
            };
            let bucket_end = next_bucket(bucket_start, bucket_kind);
            let piece_end = if bucket_end < piece_end_limit {
                bucket_end
            } else {
                piece_end_limit
            };
            if piece_end <= piece_start {
                break;
            }
            bucket_pieces
                .entry(bucket_key(bucket_start, bucket_kind))
                .or_default()
                .push(BucketPiece {
                    start_ms: piece_start.timestamp_millis(),
                    end_ms: piece_end.timestamp_millis(),
                    project_name: interval.project_name.clone(),
                    multiplier: interval.multiplier,
                    is_manual: interval.is_manual,
                    comment: interval.comment.clone(),
                });
            piece_start = piece_end;
        }
    }

    let mut bucket_project_seconds: BTreeMap<String, HashMap<String, f64>> = BTreeMap::new();
    let mut total_by_project: HashMap<String, f64> = HashMap::new();
    let mut bucket_flags: HashMap<String, (bool, bool)> = HashMap::new();
    let mut bucket_comments: HashMap<String, Vec<String>> = HashMap::new();

    for (bucket, slices) in bucket_pieces {
        if slices.is_empty() {
            continue;
        }

        let mut has_boost = false;
        let mut has_manual = false;
        let mut comments = Vec::new();
        for s in &slices {
            if s.multiplier > 1.000_001 { has_boost = true; }
            if s.is_manual { has_manual = true; }
            if let Some(c) = &s.comment {
                if !c.trim().is_empty() {
                    comments.push(c.clone());
                }
            }
        }
        bucket_flags.insert(bucket.clone(), (has_boost, has_manual));
        if !comments.is_empty() {
            comments.sort();
            comments.dedup();
            bucket_comments.insert(bucket.clone(), comments);
        }

        let mut events: Vec<(i64, i32, String, f64)> = Vec::with_capacity(slices.len() * 2);
        for slice in slices {
            if slice.end_ms <= slice.start_ms {
                continue;
            }
            events.push((slice.start_ms, 1, slice.project_name.clone(), slice.multiplier));
            events.push((slice.end_ms, -1, slice.project_name, slice.multiplier));
        }
        if events.is_empty() {
            continue;
        }
        events.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));

        let mut active: HashMap<String, (i32, f64)> = HashMap::new();
        let mut i = 0usize;
        let mut prev_ms = events[0].0;
        let mut seconds_for_bucket: HashMap<String, f64> = HashMap::new();

        while i < events.len() {
            let current_ms = events[i].0;
            if current_ms > prev_ms && !active.is_empty() {
                let delta_seconds = (current_ms - prev_ms) as f64 / 1000.0;
                let active_items: Vec<(String, f64)> = active
                    .iter()
                    .filter_map(|(name, (count, mult))| if *count > 0 { Some((name.clone(), *mult)) } else { None })
                    .collect();
                
                if !active_items.is_empty() {
                    let share = delta_seconds / active_items.len() as f64;
                    for (name, mult) in active_items {
                        let weighted_share = share * mult;
                        *seconds_for_bucket.entry(name.clone()).or_insert(0.0) += weighted_share;
                        *total_by_project.entry(name).or_insert(0.0) += weighted_share;
                    }
                }
            }

            while i < events.len() && events[i].0 == current_ms {
                let delta = events[i].1;
                let name = events[i].2.clone();
                let mult = events[i].3;
                let entry = active.entry(name.clone()).or_insert((0, 1.0));
                entry.0 += delta;
                entry.1 = mult; // Simplified: last mult wins if multiple sessions of same project overlap
                if entry.0 <= 0 {
                    active.remove(&name);
                }
                i += 1;
            }
            prev_ms = current_ms;
        }

        if !seconds_for_bucket.is_empty() {
            bucket_project_seconds.insert(bucket, seconds_for_bucket);
        }
    }

    Ok((
        bucket_project_seconds,
        total_by_project,
        bucket_flags,
        bucket_comments,
    ))
}

#[tauri::command]
pub async fn get_heatmap(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<HeatmapCell>, String> {
    let conn = db::get_connection(&app)?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT CAST(strftime('%w', date) AS INTEGER) as day_of_week,
                    CAST(SUBSTR(start_time, 12, 2) AS INTEGER) as hour,
                    SUM(val)
             FROM (
                 SELECT date, start_time, duration_seconds * COALESCE(rate_multiplier, 1.0) as val FROM sessions
                 WHERE date >= ?1 AND date <= ?2 AND (is_hidden IS NULL OR is_hidden = 0)
                 UNION ALL
                 SELECT date, start_time, duration_seconds as val FROM manual_sessions
                 WHERE date >= ?1 AND date <= ?2
             )
             GROUP BY day_of_week, hour
             ORDER BY day_of_week, hour",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![date_range.start, date_range.end], |row| {
            Ok(HeatmapCell {
                day: row.get(0)?,
                hour: row.get(1)?,
                seconds: (row.get::<_, f64>(2)?).round() as i64,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows
        .filter_map(|r| r.map_err(|e| log::warn!("Row error: {}", e)).ok())
        .collect())
}

#[tauri::command]
pub async fn get_stacked_timeline(
    app: AppHandle,
    date_range: DateRange,
    limit: i64,
) -> Result<Vec<StackedBarData>, String> {
    let conn = db::get_connection(&app)?;
    let mut stmt = conn
        .prepare_cached(
            "SELECT s.date, a.display_name, SUM(s.duration_seconds * COALESCE(s.rate_multiplier, 1.0))
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)
             AND a.id IN (
                SELECT app_id FROM sessions
                WHERE date >= ?1 AND date <= ?2 AND (is_hidden IS NULL OR iS_hidden = 0)
                GROUP BY app_id
                ORDER BY SUM(duration_seconds) DESC
                LIMIT ?3
             )
             GROUP BY s.date, a.display_name
             ORDER BY s.date",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            rusqlite::params![date_range.start, date_range.end, limit],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, f64>(2)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut date_map: std::collections::BTreeMap<String, HashMap<String, i64>> =
        std::collections::BTreeMap::new();

    for row in rows.filter_map(|r| r.ok()) {
        date_map.entry(row.0).or_default().insert(row.1, row.2.round() as i64);
    }

    Ok(date_map
        .into_iter()
        .map(|(date, data)| StackedBarData { date, data, has_boost: false, has_manual: false, comments: Vec::new() })
        .collect())
}

#[tauri::command]
pub async fn get_project_timeline(
    app: AppHandle,
    date_range: DateRange,
    limit: Option<i64>,
    granularity: Option<String>,
    id: Option<i64>,
) -> Result<Vec<StackedBarData>, String> {
    let conn = db::get_connection(&app)?;
    let limit = limit.unwrap_or(8).clamp(1, 200) as usize;
    let hourly = matches!(granularity.as_deref(), Some("hour"));
    let (bucket_project_seconds, total_by_project, bucket_flags, bucket_comments) =
        compute_project_activity_unique(&conn, &date_range, hourly, true, id)?;

    if bucket_project_seconds.is_empty() {
        return Ok(Vec::new());
    }

    let mut ranked_projects: Vec<(String, f64)> = total_by_project.into_iter().collect();
    ranked_projects.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let selected_projects: Vec<String> = ranked_projects
        .into_iter()
        .take(limit)
        .map(|(name, _)| name)
        .collect();
    let selected_set: std::collections::HashSet<&str> =
        selected_projects.iter().map(|s| s.as_str()).collect();

    let mut output = Vec::with_capacity(bucket_project_seconds.len());
    for (bucket, sec_map) in bucket_project_seconds {
        let mut data: HashMap<String, i64> = HashMap::new();
        let mut other_seconds = 0i64;
        for project_name in &selected_projects {
            if let Some(seconds) = sec_map.get(project_name) {
                let rounded = seconds.round() as i64;
                if rounded > 0 {
                    data.insert(project_name.clone(), rounded);
                }
            }
        }
        for (project_name, seconds) in &sec_map {
            if selected_set.contains(project_name.as_str()) {
                continue;
            }
            let rounded = seconds.round() as i64;
            if rounded > 0 {
                other_seconds += rounded;
            }
        }
        if other_seconds > 0 {
            data.insert("Other".to_string(), other_seconds);
        }
        let (has_boost, has_manual) = bucket_flags.get(&bucket).cloned().unwrap_or((false, false));
        let comments = bucket_comments.get(&bucket).cloned().unwrap_or_default();
        output.push(StackedBarData { date: bucket, data, has_boost, has_manual, comments });
    }

    Ok(output)
}
