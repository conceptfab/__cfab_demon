//! Single physical home for the time-computation algorithm.
//!
//! Architecture (plugin-ready):
//!   * HOST  — `load_project_intervals` reads raw sessions from the DB and
//!     produces pure [`IntervalInput`]s (no algorithm logic here).
//!   * STRATEGY — a [`TimeStrategy`] turns intervals into per-project seconds.
//!     This is a pure function (no DB, no I/O) and is the exact contract a
//!     future external/WASM plugin would implement.
//!   * REGISTRY — [`registry`] lists the available strategies; the active one
//!     is chosen by the user (Preferences → "Time algorithm", stored globally
//!     in `estimate_settings`). Switching is purely computational.
//!
//! To add a strategy (built-in for now): implement [`TimeStrategy`] in its own
//! item and add one line to [`registry`]. The Preferences tab lists strategies
//! dynamically via `list_time_algorithms`, so no UI change is needed.

use chrono::{
    DateTime, Duration as ChronoDuration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone,
    Timelike,
};
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use tauri::AppHandle;

use crate::commands::error::CommandError;

use super::analysis::{project_series_key, UNASSIGNED_PROJECT_SERIES_KEY};
use super::datetime::parse_datetime_local;
use super::helpers::{disambiguate_name, duplicate_name_counts, run_db_blocking};
use super::sql_fragments::{ensure_session_project_cache, SESSION_PROJECT_CTE};
use super::types::{DateRange, StackedSeriesMeta, TopApp};

const DEFAULT_UNASSIGNED_PROJECT_COLOR: &str = "#64748b";
const TIME_ALGORITHM_SETTING_KEY: &str = "time_algorithm";
const DEFAULT_ALGORITHM_ID: &str = "wall_clock";

// ---------------------------------------------------------------------------
// Strategy registry (the place to add/manage algorithms)
// ---------------------------------------------------------------------------

/// Available time strategies. Adding a strategy = one new line here.
fn registry() -> Vec<Box<dyn TimeStrategy>> {
    vec![Box::new(WallClockStrategy)]
}

/// The active strategy id from settings, validated against the registry
/// (falls back to the default when unset/unknown/unavailable — fresh DB/tests).
pub(crate) fn active_algorithm_id(conn: &rusqlite::Connection) -> String {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM estimate_settings WHERE key = ?1 LIMIT 1",
            [TIME_ALGORITHM_SETTING_KEY],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    match raw {
        Some(id) if registry().iter().any(|s| s.id() == id) => id,
        _ => DEFAULT_ALGORITHM_ID.to_string(),
    }
}

fn active_strategy(conn: &rusqlite::Connection) -> Box<dyn TimeStrategy> {
    let id = active_algorithm_id(conn);
    registry()
        .into_iter()
        .find(|s| s.id() == id)
        .unwrap_or_else(|| Box::new(WallClockStrategy))
}

/// Metadata for the Preferences selector. `name`/`description` are i18n keys
/// for built-in strategies (the frontend resolves them; an unknown key falls
/// back to itself, which also covers future literal-text plugins).
#[derive(Serialize)]
pub struct TimeAlgorithmInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub active: bool,
}

// ---------------------------------------------------------------------------
// Pure strategy contract (what a plugin implements)
// ---------------------------------------------------------------------------

/// One raw activity interval, free of any DB/I/O concern.
pub(crate) struct IntervalInput {
    pub start: DateTime<Local>,
    pub end: DateTime<Local>,
    pub project_key: String,
    pub multiplier: f64,
    pub is_manual: bool,
    pub comment: Option<String>,
}

/// Bucketing window + granularity handed to a strategy.
pub(crate) struct ComputeRange {
    start: DateTime<Local>,
    end_exclusive: DateTime<Local>,
    bucket_kind: BucketKind,
}

/// Pure result of a strategy (series metadata is assembled by the host).
struct ActivityOutput {
    bucket_project_seconds: BucketDurations,
    total_by_project: ProjectTotals,
    bucket_flags: BucketFlags,
    bucket_comments: BucketComments,
}

/// A time-computation strategy: intervals in, per-project seconds out. Pure.
trait TimeStrategy {
    fn id(&self) -> &'static str;
    /// i18n key for the human name shown in Preferences.
    fn name_key(&self) -> &'static str;
    /// i18n key for the description shown in Preferences.
    fn description_key(&self) -> &'static str;
    fn compute(&self, intervals: &[IntervalInput], range: &ComputeRange) -> ActivityOutput;
}

// ---------------------------------------------------------------------------
// Per-app distribution (single home for per-app time math)
// ---------------------------------------------------------------------------

/// Scales a project's raw per-app seconds down to its deduplicated clock total,
/// so the per-app breakdown sums to the SAME total used everywhere else.
///
/// Per-app seconds are raw sums of `duration_seconds`; apps that ran
/// concurrently overlap and add up to more than the project's clock total.
/// This scales by `clock_total / raw_sum_all` (only ever down — never invents
/// time). `raw_sum_all` must be the raw sum over ALL apps so hidden apps keep
/// their share.
pub(crate) fn distribute_app_seconds(apps: &mut [TopApp], clock_total: f64, raw_sum_all: f64) {
    if raw_sum_all <= 0.0 || clock_total <= 0.0 || clock_total >= raw_sum_all {
        return;
    }
    let factor = clock_total / raw_sum_all;
    for app in apps.iter_mut() {
        app.seconds = ((app.seconds as f64) * factor).round() as i64;
    }
}

// ---------------------------------------------------------------------------
// Tauri commands: list strategies, read/write the active one
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_time_algorithms(app: AppHandle) -> Result<Vec<TimeAlgorithmInfo>, CommandError> {
    run_db_blocking(app, |conn| {
        let active = active_algorithm_id(conn);
        Ok(registry()
            .iter()
            .map(|s| TimeAlgorithmInfo {
                id: s.id().to_string(),
                name: s.name_key().to_string(),
                description: s.description_key().to_string(),
                active: s.id() == active,
            })
            .collect())
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn get_time_algorithm(app: AppHandle) -> Result<String, CommandError> {
    run_db_blocking(app, |conn| Ok(active_algorithm_id(conn)))
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn set_time_algorithm(app: AppHandle, algorithm: String) -> Result<(), CommandError> {
    if !registry().iter().any(|s| s.id() == algorithm) {
        return Err(CommandError::Validation(format!(
            "Unknown time algorithm: {algorithm}"
        )));
    }
    run_db_blocking(app, move |conn| {
        conn.execute(
            "INSERT INTO estimate_settings (key, value, updated_at)
             VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = datetime('now')",
            rusqlite::params![TIME_ALGORITHM_SETTING_KEY, algorithm],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(CommandError::Other)
}

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
enum BucketKind {
    Day,
    Hour,
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

/// Dzienne sekundy (zaokrąglone do i64) per seria, z mapy per-bucket. Gdy `hourly=false`
/// bucket = data, więc to jest rozbicie dzienne per projekt — zgodne z `total_by_project`.
/// Używane do zaokrąglania `per_day` po stronie frontu (każdy dzień → pełna godzina → suma).
pub(crate) fn daily_seconds_by_series(
    bucket_project_seconds: &BucketDurations,
) -> HashMap<String, Vec<i64>> {
    let mut out: HashMap<String, Vec<i64>> = HashMap::new();
    for day_map in bucket_project_seconds.values() {
        for (series_key, secs) in day_map {
            let s = secs.round() as i64;
            if s > 0 {
                out.entry(series_key.clone()).or_default().push(s);
            }
        }
    }
    out
}

/// Jak `daily_seconds_by_series`, ale zachowuje ETYKIETY DAT (YYYY-MM-DD). Do raportu
/// estymacji w wariancie „plus" (projekt → dni z godzinami). Wektor jest chronologiczny,
/// bo `BucketDurations` (BTreeMap) iteruje klucze dat rosnąco. Pomija dni z 0 s.
pub(crate) fn daily_buckets_by_series(
    bucket_project_seconds: &BucketDurations,
) -> HashMap<String, Vec<(String, i64)>> {
    let mut out: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for (date_key, day_map) in bucket_project_seconds {
        for (series_key, secs) in day_map {
            let s = secs.round() as i64;
            if s > 0 {
                out.entry(series_key.clone())
                    .or_default()
                    .push((date_key.clone(), s));
            }
        }
    }
    out
}

/// Łączny czas per dzień (suma wszystkich serii w obrębie jednego bucketu/dnia).
/// Dla totali-sum (dashboard, klient), gdzie `per_day` zaokrągla dzień ŁĄCZNIE.
pub(crate) fn grand_daily_seconds(bucket_project_seconds: &BucketDurations) -> Vec<i64> {
    bucket_project_seconds
        .values()
        .filter_map(|day_map| {
            let s = day_map.values().sum::<f64>().round() as i64;
            (s > 0).then_some(s)
        })
        .collect()
}
type ProjectTotals = HashMap<String, f64>;
pub(crate) type ProjectSeriesMetaMap = HashMap<String, StackedSeriesMeta>;
type BucketFlags = HashMap<String, (bool, bool)>;
type BucketComments = HashMap<String, Vec<String>>;
pub(crate) type ProjectActivityUniqueResult = (
    BucketDurations,
    ProjectTotals,
    ProjectSeriesMetaMap,
    BucketFlags,
    BucketComments,
);

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

pub(crate) fn finalize_project_series_labels(series_meta_by_key: &mut ProjectSeriesMetaMap) {
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

// ---------------------------------------------------------------------------
// Public entry points (host orchestration: load → strategy → assemble)
// ---------------------------------------------------------------------------

pub(crate) fn compute_project_clock_totals_by_id(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
    active_only: bool,
    rollup_merged: bool,
) -> Result<HashMap<i64, f64>, String> {
    let (_, totals, series_meta_by_key, _, _) = compute_project_activity_unique(
        conn,
        date_range,
        false,
        active_only,
        None,
        None,
        rollup_merged,
    )?;

    Ok(totals
        .into_iter()
        .filter_map(|(series_key, seconds)| {
            series_meta_by_key
                .get(&series_key)
                .and_then(|series| series.project_id.map(|project_id| (project_id, seconds)))
        })
        .collect())
}

/// Host orchestration: load intervals from the DB, run the active strategy on
/// them, then attach series metadata. The single dispatch point for the time
/// algorithm — the strategy itself is pure and lives behind [`TimeStrategy`].
///
/// `rollup_merged`: when true, merged-child series are folded into their
/// parent series at the source (totals, buckets and metadata), so consumers
/// see one parent series with rolled-up time and no child rows. Pass false
/// only where raw own-time is explicitly needed (Merged/Excluded lists).
pub(crate) fn compute_project_activity_unique(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
    hourly: bool,
    active_only: bool,
    project_id_filter: Option<i64>,
    min_session_duration: Option<i64>,
    rollup_merged: bool,
) -> Result<ProjectActivityUniqueResult, String> {
    let (intervals, mut series_meta_by_key, range) = load_project_intervals(
        conn,
        date_range,
        hourly,
        active_only,
        project_id_filter,
        min_session_duration,
        rollup_merged,
    )?;

    if intervals.is_empty() {
        return Ok((
            BTreeMap::new(),
            HashMap::new(),
            series_meta_by_key,
            HashMap::new(),
            HashMap::new(),
        ));
    }

    let output = active_strategy(conn).compute(&intervals, &range);
    let mut bucket_project_seconds = output.bucket_project_seconds;
    let mut total_by_project = output.total_by_project;
    if rollup_merged {
        fold_merged_series(
            conn,
            &mut bucket_project_seconds,
            &mut total_by_project,
            &mut series_meta_by_key,
        )?;
    }
    Ok((
        bucket_project_seconds,
        total_by_project,
        series_meta_by_key,
        output.bucket_flags,
        output.bucket_comments,
    ))
}

/// Folds merged-child series into their parent series. Single-level only —
/// merging flattens chains, so a parent is never itself merged. If the parent
/// had no own activity in the range, its series metadata is synthesized so
/// consumers can still render the parent series.
fn fold_merged_series(
    conn: &rusqlite::Connection,
    bucket_project_seconds: &mut BucketDurations,
    total_by_project: &mut ProjectTotals,
    series_meta_by_key: &mut ProjectSeriesMetaMap,
) -> Result<(), String> {
    let pairs: Vec<(i64, i64, String, String)> = {
        let mut stmt = conn
            .prepare_cached(
                "SELECT p.id, parent.id, parent.name, parent.color
                 FROM projects p
                 JOIN projects parent ON parent.name = p.merged_into
                 WHERE p.merged_into IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };

    for (child_id, parent_id, parent_name, parent_color) in pairs {
        let child_key = project_series_key(Some(child_id));
        let parent_key = project_series_key(Some(parent_id));

        if let Some(child_seconds) = total_by_project.remove(&child_key) {
            *total_by_project.entry(parent_key.clone()).or_insert(0.0) += child_seconds;
        }
        for bucket in bucket_project_seconds.values_mut() {
            if let Some(child_seconds) = bucket.remove(&child_key) {
                *bucket.entry(parent_key.clone()).or_insert(0.0) += child_seconds;
            }
        }
        if series_meta_by_key.remove(&child_key).is_some() {
            series_meta_by_key
                .entry(parent_key.clone())
                .or_insert_with(|| StackedSeriesMeta {
                    key: parent_key.clone(),
                    label: parent_name,
                    color: parent_color,
                    project_id: Some(parent_id),
                });
        }
    }
    Ok(())
}

/// HOST: reads raw sessions/manual sessions from the DB into pure intervals
/// plus the per-project series metadata. No algorithm logic lives here.
fn load_project_intervals(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
    hourly: bool,
    active_only: bool,
    project_id_filter: Option<i64>,
    min_session_duration: Option<i64>,
    rollup_merged: bool,
) -> Result<(Vec<IntervalInput>, ProjectSeriesMetaMap, ComputeRange), String> {
    ensure_session_project_cache(conn, &date_range.start, &date_range.end)?;

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

    let min_dur = min_session_duration.unwrap_or(0);
    // ?6 = rollup_merged: a merged child's activity must keep feeding the
    // parent's aggregates, so when rolling up we (a) widen a parent-id filter
    // to also load its merged children, and (b) keep manual sessions of a
    // merged (auto-excluded) child whose parent is still active. The fold in
    // `fold_merged_series` then moves these child series into the parent.
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
         WHERE (?4 IS NULL OR sp.project_id = ?4
                OR (?6 = 1 AND sp.project_id IN (
                    SELECT id FROM projects
                    WHERE merged_into = (SELECT name FROM projects WHERE id = ?4))))
           AND sp.duration_seconds >= ?5
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
         WHERE ms.date >= ?1 AND ms.date <= ?2
           AND (?3 = 0 OR p.excluded_at IS NULL
                OR (?6 = 1 AND EXISTS (
                    SELECT 1 FROM projects parent
                    WHERE parent.name = p.merged_into AND parent.excluded_at IS NULL)))
           AND (?4 IS NULL OR ms.project_id = ?4
                OR (?6 = 1 AND ms.project_id IN (
                    SELECT id FROM projects
                    WHERE merged_into = (SELECT name FROM projects WHERE id = ?4))))"
    );
    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            rusqlite::params![
                date_range.start,
                date_range.end,
                active_only as i32,
                project_id_filter,
                min_dur,
                rollup_merged as i32
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

    let mut intervals: Vec<IntervalInput> = Vec::new();
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
        intervals.push(IntervalInput {
            start,
            end,
            project_key: series.key,
            multiplier: row.5,
            is_manual: row.6 != 0,
            comment: row.7,
        });
    }
    finalize_project_series_labels(&mut series_meta_by_key);

    Ok((
        intervals,
        series_meta_by_key,
        ComputeRange {
            start: range_start,
            end_exclusive: range_end_exclusive,
            bucket_kind,
        },
    ))
}

// ---------------------------------------------------------------------------
// Built-in strategy: wall-clock with overlap deduplication
// ---------------------------------------------------------------------------

struct WallClockStrategy;

impl TimeStrategy for WallClockStrategy {
    fn id(&self) -> &'static str {
        "wall_clock"
    }

    fn name_key(&self) -> &'static str {
        "settings_page.time_algorithm_wall_clock_name"
    }

    fn description_key(&self) -> &'static str {
        "settings_page.time_algorithm_wall_clock_description"
    }

    fn compute(&self, intervals: &[IntervalInput], range: &ComputeRange) -> ActivityOutput {
        let mut bucket_pieces: BTreeMap<String, Vec<BucketPiece>> = BTreeMap::new();
        for interval in intervals {
            if interval.end <= range.start || interval.start >= range.end_exclusive {
                continue;
            }
            let mut piece_start = if interval.start < range.start {
                range.start
            } else {
                interval.start
            };
            let piece_end_limit = if interval.end > range.end_exclusive {
                range.end_exclusive
            } else {
                interval.end
            };

            while piece_start < piece_end_limit {
                let Some(bucket_start) = bucket_floor(piece_start, range.bucket_kind) else {
                    break;
                };
                let bucket_end = next_bucket(bucket_start, range.bucket_kind);
                let piece_end = if bucket_end < piece_end_limit {
                    bucket_end
                } else {
                    piece_end_limit
                };
                if piece_end <= piece_start {
                    break;
                }
                bucket_pieces
                    .entry(bucket_key(bucket_start, range.bucket_kind))
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

        let mut bucket_project_seconds: BucketDurations = BTreeMap::new();
        let mut total_by_project: ProjectTotals = HashMap::new();
        let mut bucket_flags: BucketFlags = HashMap::new();
        let mut bucket_comments: BucketComments = HashMap::new();

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

        ActivityOutput {
            bucket_project_seconds,
            total_by_project,
            bucket_flags,
            bucket_comments,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        active_algorithm_id, compute_project_activity_unique, distribute_app_seconds,
        finalize_project_series_labels, registry, ProjectSeriesMetaMap,
    };
    use crate::commands::types::{DateRange, StackedSeriesMeta, TopApp};
    use std::collections::HashMap;

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                excluded_at TEXT,
                merged_into TEXT
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
            );
            CREATE TABLE session_project_cache (
                session_id INTEGER PRIMARY KEY,
                session_date TEXT NOT NULL,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                project_id INTEGER,
                multiplier REAL NOT NULL,
                duration_seconds REAL NOT NULL,
                comment TEXT,
                built_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE session_project_cache_dirty (
                date TEXT PRIMARY KEY,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .expect("schema");
        conn
    }

    #[test]
    fn registry_has_wall_clock_and_active_defaults() {
        assert!(registry().iter().any(|s| s.id() == "wall_clock"));
        let conn = setup_conn();
        // No estimate_settings table -> default
        assert_eq!(active_algorithm_id(&conn), "wall_clock");
    }

    #[test]
    fn distribute_app_seconds_scales_down_to_clock_total() {
        let mut apps = vec![
            TopApp {
                name: "Codex".to_string(),
                seconds: 4620,
                color: None,
                daily_seconds: Vec::new(),
            },
            TopApp {
                name: "Claude".to_string(),
                seconds: 3146,
                color: None,
                daily_seconds: Vec::new(),
            },
        ];
        distribute_app_seconds(&mut apps, 6660.0, 7766.0);
        let sum: i64 = apps.iter().map(|a| a.seconds).sum();
        assert!((sum - 6660).abs() <= 1);
        assert!(apps[0].seconds < 4620);
    }

    #[test]
    fn distribute_app_seconds_never_scales_up() {
        let mut apps = vec![TopApp {
            name: "Solo".to_string(),
            seconds: 1000,
            color: None,
            daily_seconds: Vec::new(),
        }];
        distribute_app_seconds(&mut apps, 1000.0, 1000.0);
        assert_eq!(apps[0].seconds, 1000);
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
    fn wall_clock_strategy_keeps_clock_time_separate_from_boost() {
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
            None,
            false,
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
