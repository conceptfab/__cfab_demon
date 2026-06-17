use std::collections::{BTreeMap, HashMap};
use tauri::AppHandle;

use super::helpers::run_db_blocking;
// Re-export the algorithm entry points so existing callers keep importing them
// from `super::analysis::…`; the implementation lives in `time_algorithm`.
pub(crate) use super::time_algorithm::{
    compute_project_activity_unique, compute_project_clock_totals_by_id, daily_seconds_by_series,
    grand_daily_seconds, ProjectSeriesMetaMap,
};
use super::types::{DateRange, StackedBarData, StackedSeriesMeta};

pub(crate) const OTHER_PROJECT_SERIES_KEY: &str = "__other__";
pub(crate) const UNASSIGNED_PROJECT_SERIES_KEY: &str = "__unassigned__";
const DEFAULT_OTHER_PROJECT_COLOR: &str = "#6b7280";

pub(crate) fn project_series_key(project_id: Option<i64>) -> String {
    match project_id {
        Some(project_id) => format!("project:{project_id}"),
        None => UNASSIGNED_PROJECT_SERIES_KEY.to_string(),
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
        ) = compute_project_activity_unique(
            conn,
            &date_range,
            hourly,
            true,
            id,
            Some(super::daemon::load_persisted_session_min_duration()),
            true,
        )?;

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
    use super::{other_project_series_meta, project_series_key, UNASSIGNED_PROJECT_SERIES_KEY};
    use crate::commands::datetime::parse_datetime_local;

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
}
