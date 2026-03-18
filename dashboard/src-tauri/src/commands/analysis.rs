use chrono::{
    DateTime, Duration as ChronoDuration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone,
    Timelike,
};
use std::collections::{BTreeMap, HashMap};
use tauri::AppHandle;

use super::datetime::parse_datetime_local;
use super::helpers::{disambiguate_name, duplicate_name_counts, run_db_blocking};
use super::sql_fragments::{ACTIVE_SESSION_FILTER, ACTIVE_SESSION_FILTER_S, SESSION_PROJECT_CTE};
use super::types::{DateRange, HeatmapCell, StackedBarData, StackedSeriesMeta};

pub(crate) const OTHER_PROJECT_SERIES_KEY: &str = "__other__";
pub(crate) const UNASSIGNED_PROJECT_SERIES_KEY: &str = "__unassigned__";
const DEFAULT_UNASSIGNED_PROJECT_COLOR: &str = "#64748b";
const DEFAULT_OTHER_PROJECT_COLOR: &str = "#6b7280";

#[derive(Clone, Copy)]
enum BucketKind {
    Day,
    Hour,
}

struct IntervalRow {
    start: DateTime<Local>,
    end: DateTime<Local>,
    project_key: String,
    multiplier: f64,
    is_manual: bool,
    comment: Option<String>,
}

struct BucketPiece {
    start_ms: i64,
    end_ms: i64,
    project_key: String,
    multiplier: f64,
    is_manual: bool,
    comment: Option<String>,
}

type BucketDurations = BTreeMap<String, HashMap<String, f64>>;
type ProjectTotals = HashMap<String, f64>;
type ProjectSeriesMetaMap = HashMap<String, StackedSeriesMeta>;
type BucketFlags = HashMap<String, (bool, bool)>;
type BucketComments = HashMap<String, Vec<String>>;
type ProjectActivityUniqueResult = (
    BucketDurations,
    ProjectTotals,
    ProjectSeriesMetaMap,
    BucketFlags,
    BucketComments,
);

pub(crate) fn project_series_key(project_id: Option<i64>) -> String {
    match project_id {
        Some(project_id) => format!("project:{project_id}"),
        None => UNASSIGNED_PROJECT_SERIES_KEY.to_string(),
    }
}

fn project_display_label(project_id: Option<i64>, project_name: Option<String>) -> String {
    match project_id {
        None => UNASSIGNED_PROJECT_SERIES_KEY.to_string(),
        Some(project_id) => match project_name {
            Some(project_name) if !project_name.trim().is_empty() => project_name,
            _ => format!("#{project_id}"),
        },
    }
}

fn project_display_color(project_id: Option<i64>, project_color: Option<String>) -> String {
    if project_id.is_none() {
        return DEFAULT_UNASSIGNED_PROJECT_COLOR.to_string();
    }

    match project_color {
        Some(project_color) if !project_color.trim().is_empty() => project_color,
        _ => DEFAULT_UNASSIGNED_PROJECT_COLOR.to_string(),
    }
}

fn build_project_series_meta(
    project_id: Option<i64>,
    project_name: Option<String>,
    project_color: Option<String>,
) -> StackedSeriesMeta {
    StackedSeriesMeta {
        key: project_series_key(project_id),
        label: project_display_label(project_id, project_name),
        color: project_display_color(project_id, project_color),
        project_id,
    }
}

fn finalize_project_series_labels(series_meta_by_key: &mut ProjectSeriesMetaMap) {
    let duplicate_counts = duplicate_name_counts(
        series_meta_by_key
            .values()
            .filter(|series| series.project_id.is_some())
            .map(|series| series.label.as_str()),
    );

    for series in series_meta_by_key.values_mut() {
        let Some(project_id) = series.project_id else {
            continue;
        };
        series.label = disambiguate_name(&series.label, project_id, &duplicate_counts);
    }
}

pub(crate) fn other_project_series_meta() -> StackedSeriesMeta {
    StackedSeriesMeta {
        key: OTHER_PROJECT_SERIES_KEY.to_string(),
        label: OTHER_PROJECT_SERIES_KEY.to_string(),
        color: DEFAULT_OTHER_PROJECT_COLOR.to_string(),
        project_id: None,
    }
}

pub(crate) fn series_meta_for_row(
    data: &HashMap<String, i64>,
    series_meta_by_key: &ProjectSeriesMetaMap,
) -> Vec<StackedSeriesMeta> {
    let mut meta = Vec::new();
    let mut keys: Vec<&String> = data.keys().collect();
    keys.sort();

    for key in keys {
        if key == OTHER_PROJECT_SERIES_KEY {
            meta.push(other_project_series_meta());
            continue;
        }
        if let Some(series) = series_meta_by_key.get(key) {
            meta.push(series.clone());
        }
    }

    meta
}

fn local_from_naive(naive: NaiveDateTime) -> Option<DateTime<Local>> {
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(v) => Some(v),
        LocalResult::Ambiguous(v, _) => Some(v),
        LocalResult::None => None,
    }
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

pub(crate) fn build_stacked_bar_output(
    bucket_project_seconds: BTreeMap<String, HashMap<String, f64>>,
    total_by_project: &HashMap<String, f64>,
    series_meta_by_key: &HashMap<String, StackedSeriesMeta>,
    bucket_flags: &HashMap<String, (bool, bool)>,
    bucket_comments: &HashMap<String, Vec<String>>,
    limit: usize,
) -> Vec<StackedBarData> {
    if bucket_project_seconds.is_empty() {
        return Vec::new();
    }

    let mut ranked_projects: Vec<(&String, &f64)> = total_by_project.iter().collect();
    ranked_projects.sort_by(|a, b| {
        b.1.total_cmp(a.1).then_with(|| {
            let label_a = series_meta_by_key
                .get(a.0)
                .map(|series| series.label.as_str())
                .unwrap_or(a.0.as_str());
            let label_b = series_meta_by_key
                .get(b.0)
                .map(|series| series.label.as_str())
                .unwrap_or(b.0.as_str());
            label_a.cmp(label_b)
        })
    });
    let selected_keys: Vec<String> = ranked_projects
        .into_iter()
        .take(limit)
        .map(|(key, _)| key.clone())
        .collect();
    let selected_set: std::collections::HashSet<&str> =
        selected_keys.iter().map(|key| key.as_str()).collect();

    let mut output = Vec::with_capacity(bucket_project_seconds.len());
    for (bucket, sec_map) in bucket_project_seconds {
        let mut data: HashMap<String, i64> = HashMap::new();
        let mut other_seconds = 0i64;

        for series_key in &selected_keys {
            if let Some(seconds) = sec_map.get(series_key) {
                let rounded = seconds.round() as i64;
                if rounded > 0 {
                    data.insert(series_key.clone(), rounded);
                }
            }
        }

        for (series_key, seconds) in &sec_map {
            if selected_set.contains(series_key.as_str()) {
                continue;
            }
            let rounded = seconds.round() as i64;
            if rounded > 0 {
                other_seconds += rounded;
            }
        }

        if other_seconds > 0 {
            data.insert(OTHER_PROJECT_SERIES_KEY.to_string(), other_seconds);
        }

        let (has_boost, has_manual) = bucket_flags.get(&bucket).cloned().unwrap_or((false, false));
        let comments = bucket_comments.get(&bucket).cloned().unwrap_or_default();
        let series_meta = series_meta_for_row(&data, series_meta_by_key);
        output.push(StackedBarData {
            date: bucket,
            data,
            has_boost,
            has_manual,
            comments,
            series_meta,
        });
    }

    output
}

pub(crate) fn query_activity_date_range(
    conn: &rusqlite::Connection,
) -> Result<Option<DateRange>, String> {
    let (min_date, max_date): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT MIN(d), MAX(d)
             FROM (
                 SELECT date as d FROM sessions
                 UNION ALL
                 SELECT date as d FROM manual_sessions
             )",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    Ok(min_date
        .zip(max_date)
        .map(|(start, end)| DateRange { start, end }))
}

pub(crate) fn compute_project_clock_totals_by_id(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
    active_only: bool,
) -> Result<HashMap<i64, f64>, String> {
    let (_, totals, series_meta_by_key, _, _) =
        compute_project_activity_unique(conn, date_range, false, active_only, None)?;

    Ok(totals
        .into_iter()
        .filter_map(|(series_key, seconds)| {
            series_meta_by_key
                .get(&series_key)
                .and_then(|series| series.project_id.map(|project_id| (project_id, seconds)))
        })
        .collect())
}

pub(crate) fn compute_project_activity_unique(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
    hourly: bool,
    active_only: bool,
    project_id_filter: Option<i64>,
) -> Result<ProjectActivityUniqueResult, String> {
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

    let sql = format!(
        "{SESSION_PROJECT_CTE}
         SELECT sp.start_time,
                sp.end_time,
                sp.project_id,
                p.name as project_name,
                p.color as project_color,
                sp.multiplier,
                0 as is_manual,
                sp.comment
         FROM session_projects sp
         LEFT JOIN projects p ON p.id = sp.project_id AND (?3 = 0 OR p.excluded_at IS NULL)
         WHERE ?4 IS NULL OR sp.project_id = ?4
         UNION ALL
         SELECT ms.start_time,
                ms.end_time,
                ms.project_id,
                p.name as project_name,
                p.color as project_color,
                1.0 as multiplier,
                1 as is_manual,
                ms.title as comment
         FROM manual_sessions ms
         JOIN projects p ON p.id = ms.project_id
         WHERE ms.date >= ?1 AND ms.date <= ?2 AND (?3 = 0 OR p.excluded_at IS NULL)
           AND (?4 IS NULL OR ms.project_id = ?4)"
    );
    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            rusqlite::params![
                date_range.start,
                date_range.end,
                active_only as i32,
                project_id_filter
            ],
            |row| {
                Ok((
                    row.get::<_, String>("start_time")?,
                    row.get::<_, String>("end_time")?,
                    row.get::<_, Option<i64>>("project_id")?,
                    row.get::<_, Option<String>>("project_name")?,
                    row.get::<_, Option<String>>("project_color")?,
                    row.get::<_, f64>("multiplier")?,
                    row.get::<_, i32>("is_manual")?,
                    row.get::<_, Option<String>>("comment")?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut intervals: Vec<IntervalRow> = Vec::new();
    let mut series_meta_by_key: ProjectSeriesMetaMap = HashMap::new();
    for row in rows {
        let row = row.map_err(|e| format!("Failed to read project activity row: {}", e))?;
        let Some(start) = parse_datetime_local(&row.0) else {
            continue;
        };
        let Some(end) = parse_datetime_local(&row.1) else {
            continue;
        };
        if end <= start {
            continue;
        }
        let series = build_project_series_meta(row.2, row.3, row.4);
        series_meta_by_key
            .entry(series.key.clone())
            .or_insert(series.clone());
        intervals.push(IntervalRow {
            start,
            end,
            project_key: series.key,
            multiplier: row.5,
            is_manual: row.6 != 0,
            comment: row.7,
        });
    }
    finalize_project_series_labels(&mut series_meta_by_key);

    if intervals.is_empty() {
        return Ok((
            BTreeMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
        ));
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
                    project_key: interval.project_key.clone(),
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
            if s.multiplier > 1.000_001 {
                has_boost = true;
            }
            if s.is_manual {
                has_manual = true;
            }
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

        let mut events: Vec<(i64, i32, String)> = Vec::with_capacity(slices.len() * 2);
        for slice in slices {
            if slice.end_ms <= slice.start_ms {
                continue;
            }
            events.push((slice.start_ms, 1, slice.project_key.clone()));
            events.push((slice.end_ms, -1, slice.project_key));
        }
        if events.is_empty() {
            continue;
        }
        events.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));

        let mut active: HashMap<String, i32> = HashMap::new();
        let mut i = 0usize;
        let mut prev_ms = events[0].0;
        let mut seconds_for_bucket: HashMap<String, f64> = HashMap::new();

        while i < events.len() {
            let current_ms = events[i].0;
            if current_ms > prev_ms && !active.is_empty() {
                let delta_seconds = (current_ms - prev_ms) as f64 / 1000.0;
                let active_items: Vec<String> = active
                    .iter()
                    .filter_map(
                        |(name, count)| {
                            if *count > 0 {
                                Some(name.clone())
                            } else {
                                None
                            }
                        },
                    )
                    .collect();

                if !active_items.is_empty() {
                    let share = delta_seconds / active_items.len() as f64;
                    for name in active_items {
                        *seconds_for_bucket.entry(name.clone()).or_insert(0.0) += share;
                        *total_by_project.entry(name).or_insert(0.0) += share;
                    }
                }
            }

            while i < events.len() && events[i].0 == current_ms {
                let delta = events[i].1;
                let name = events[i].2.clone();
                let entry = active.entry(name.clone()).or_insert(0);
                *entry += delta;
                if *entry <= 0 {
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
        series_meta_by_key,
        bucket_flags,
        bucket_comments,
    ))
}

#[tauri::command]
pub async fn get_heatmap(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<HeatmapCell>, String> {
    run_db_blocking(app, move |conn| {
        let sql = format!(
            "SELECT CAST(strftime('%w', date) AS INTEGER) as day_of_week,
                    CAST(SUBSTR(start_time, 12, 2) AS INTEGER) as hour,
                    SUM(val)
             FROM (
                 SELECT date, start_time, duration_seconds * COALESCE(rate_multiplier, 1.0) as val FROM sessions
                 WHERE date >= ?1 AND date <= ?2 AND {ACTIVE_SESSION_FILTER}
                 UNION ALL
                 SELECT date, start_time, duration_seconds as val FROM manual_sessions
                 WHERE date >= ?1 AND date <= ?2
             )
             GROUP BY day_of_week, hour
             ORDER BY day_of_week, hour"
        );
        let mut stmt = conn
            .prepare_cached(&sql)
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

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read heatmap row: {}", e))
    })
    .await
}

#[tauri::command]
pub async fn get_stacked_timeline(
    app: AppHandle,
    date_range: DateRange,
    limit: i64,
) -> Result<Vec<StackedBarData>, String> {
    run_db_blocking(app, move |conn| {
        let sql = format!(
            "SELECT s.date, a.display_name, SUM(s.duration_seconds * COALESCE(s.rate_multiplier, 1.0))
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             WHERE s.date >= ?1 AND s.date <= ?2 AND {ACTIVE_SESSION_FILTER_S}
             AND a.id IN (
                SELECT app_id FROM sessions
                WHERE date >= ?1 AND date <= ?2 AND {ACTIVE_SESSION_FILTER}
                GROUP BY app_id
                ORDER BY SUM(duration_seconds) DESC
                LIMIT ?3
             )
             GROUP BY s.date, a.display_name
             ORDER BY s.date"
        );
        let mut stmt = conn
            .prepare_cached(&sql)
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

        for row in rows {
            let row = row.map_err(|e| format!("Failed to read stacked timeline row: {}", e))?;
            date_map
                .entry(row.0)
                .or_default()
                .insert(row.1, row.2.round() as i64);
        }

        Ok(date_map
            .into_iter()
            .map(|(date, data)| StackedBarData {
                date,
                data,
                has_boost: false,
                has_manual: false,
                comments: Vec::new(),
                series_meta: Vec::new(),
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn get_project_timeline(
    app: AppHandle,
    date_range: DateRange,
    limit: Option<i64>,
    granularity: Option<String>,
    id: Option<i64>,
) -> Result<Vec<StackedBarData>, String> {
    run_db_blocking(app, move |conn| {
        let limit = limit.unwrap_or(8).clamp(1, 200) as usize;
        let hourly = matches!(granularity.as_deref(), Some("hour"));
        let (
            bucket_project_seconds,
            total_by_project,
            series_meta_by_key,
            bucket_flags,
            bucket_comments,
        ) = compute_project_activity_unique(conn, &date_range, hourly, true, id)?;

        if bucket_project_seconds.is_empty() {
            return Ok(Vec::new());
        }

        Ok(build_stacked_bar_output(
            bucket_project_seconds,
            &total_by_project,
            &series_meta_by_key,
            &bucket_flags,
            &bucket_comments,
            limit,
        ))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        compute_project_activity_unique, finalize_project_series_labels, other_project_series_meta,
        project_series_key, ProjectSeriesMetaMap, UNASSIGNED_PROJECT_SERIES_KEY,
    };
    use crate::commands::datetime::parse_datetime_local;
    use crate::commands::types::DateRange;
    use crate::commands::types::StackedSeriesMeta;
    use std::collections::HashMap;

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                excluded_at TEXT
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                project_id INTEGER,
                is_hidden INTEGER DEFAULT 0,
                rate_multiplier REAL NOT NULL DEFAULT 1.0,
                comment TEXT
            );
            CREATE TABLE file_activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                file_name TEXT NOT NULL DEFAULT '',
                total_seconds INTEGER NOT NULL DEFAULT 0,
                first_seen TEXT NOT NULL DEFAULT '',
                last_seen TEXT NOT NULL DEFAULT '',
                project_id INTEGER
            );
            CREATE TABLE manual_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '',
                project_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL
            );",
        )
        .expect("schema");
        conn
    }

    #[test]
    fn parse_datetime_local_accepts_legacy_and_fractional_formats() {
        assert!(parse_datetime_local("2026-02-28T10:15:30").is_some());
        assert!(parse_datetime_local("2026-02-28 10:15:30").is_some());
        assert!(parse_datetime_local("2026-02-28 10:15:30.123456").is_some());
        assert!(parse_datetime_local("2026-02-28T10:15:30.123456789+01:00").is_some());
        assert!(parse_datetime_local("2026-02-28T10:15").is_some());
    }

    #[test]
    fn special_series_meta_uses_technical_sentinels() {
        assert_eq!(project_series_key(None), UNASSIGNED_PROJECT_SERIES_KEY);
        let other = other_project_series_meta();
        assert_eq!(other.key, "__other__");
        assert_eq!(other.label, "__other__");
    }

    #[test]
    fn finalize_project_series_labels_disambiguates_duplicate_project_names() {
        let mut series_meta_by_key: ProjectSeriesMetaMap = HashMap::from([
            (
                "project:1".to_string(),
                StackedSeriesMeta {
                    key: "project:1".to_string(),
                    label: "Client".to_string(),
                    color: "#111111".to_string(),
                    project_id: Some(1),
                },
            ),
            (
                "project:2".to_string(),
                StackedSeriesMeta {
                    key: "project:2".to_string(),
                    label: "Client".to_string(),
                    color: "#222222".to_string(),
                    project_id: Some(2),
                },
            ),
        ]);

        finalize_project_series_labels(&mut series_meta_by_key);

        let mut labels = series_meta_by_key
            .values()
            .map(|series| series.label.clone())
            .collect::<Vec<_>>();
        labels.sort();
        assert_eq!(
            labels,
            vec!["Client · #1".to_string(), "Client · #2".to_string()]
        );
    }

    #[test]
    fn compute_project_activity_unique_keeps_clock_time_separate_from_boost() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO projects (id, name, color) VALUES (?1, ?2, ?3)",
            rusqlite::params![1i64, "Project A", "#111111"],
        )
        .expect("insert project");
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id, is_hidden, rate_multiplier)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
            rusqlite::params![
                10i64,
                "2026-03-01T09:00:00",
                "2026-03-01T10:00:00",
                3600i64,
                "2026-03-01",
                1i64,
                2.0f64
            ],
        )
        .expect("insert session");

        let (bucket_seconds, totals, _, flags, _) = compute_project_activity_unique(
            &conn,
            &DateRange {
                start: "2026-03-01".to_string(),
                end: "2026-03-01".to_string(),
            },
            false,
            false,
            None,
        )
        .expect("compute activity");

        assert_eq!(
            totals.get("project:1").copied().unwrap_or_default().round() as i64,
            3600
        );
        assert_eq!(
            bucket_seconds
                .get("2026-03-01")
                .and_then(|bucket| bucket.get("project:1"))
                .copied()
                .unwrap_or_default()
                .round() as i64,
            3600
        );
        assert_eq!(flags.get("2026-03-01"), Some(&(true, false)));
    }
}
