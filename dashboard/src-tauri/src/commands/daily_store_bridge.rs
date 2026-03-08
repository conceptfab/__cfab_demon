use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::Local;

use super::helpers::timeflow_data_dir;
use super::types::{AppDailyData, DailyData, JsonFileEntry, JsonSession};

pub(crate) fn store_path() -> Result<PathBuf, String> {
    let base_dir = timeflow_data_dir()?;
    Ok(super::daily_store::store_db_path(&base_dir))
}

fn open_store() -> Result<rusqlite::Connection, String> {
    let base_dir = timeflow_data_dir()?;
    super::daily_store::open_store(&base_dir)
}

fn to_command_daily(stored: super::daily_store::StoredDailyData) -> DailyData {
    DailyData {
        date: stored.date,
        apps: stored
            .apps
            .into_iter()
            .map(|(exe_name, app)| {
                (
                    exe_name,
                    AppDailyData {
                        display_name: app.display_name,
                        total_seconds: app.total_seconds,
                        sessions: app
                            .sessions
                            .into_iter()
                            .map(|session| JsonSession {
                                start: session.start,
                                end: session.end,
                                duration_seconds: session.duration_seconds,
                            })
                            .collect(),
                        files: app
                            .files
                            .into_iter()
                            .map(|file| JsonFileEntry {
                                name: file.name,
                                total_seconds: file.total_seconds,
                                first_seen: file.first_seen,
                                last_seen: file.last_seen,
                                window_title: file.window_title,
                                detected_path: file.detected_path,
                                title_history: file.title_history,
                                activity_type: file.activity_type,
                            })
                            .collect(),
                    },
                )
            })
            .collect(),
    }
}

fn to_stored_daily(daily: &DailyData) -> super::daily_store::StoredDailyData {
    super::daily_store::StoredDailyData {
        date: daily.date.clone(),
        generated_at: Local::now().to_rfc3339(),
        apps: daily
            .apps
            .iter()
            .map(|(exe_name, app)| {
                (
                    exe_name.clone(),
                    super::daily_store::StoredAppDailyData {
                        display_name: app.display_name.clone(),
                        total_seconds: app.total_seconds,
                        sessions: app
                            .sessions
                            .iter()
                            .map(|session| super::daily_store::StoredSession {
                                start: session.start.clone(),
                                end: session.end.clone(),
                                duration_seconds: session.duration_seconds,
                            })
                            .collect(),
                        files: app
                            .files
                            .iter()
                            .map(|file| super::daily_store::StoredFileEntry {
                                name: file.name.clone(),
                                total_seconds: file.total_seconds,
                                first_seen: file.first_seen.clone(),
                                last_seen: file.last_seen.clone(),
                                window_title: file.window_title.clone(),
                                detected_path: file.detected_path.clone(),
                                title_history: file.title_history.clone(),
                                activity_type: file.activity_type.clone(),
                            })
                            .collect(),
                    },
                )
            })
            .collect(),
    }
}

pub(crate) fn migrate_legacy_daily_json_to_store() -> Result<usize, String> {
    let base_dir = timeflow_data_dir()?;
    super::daily_store::migrate_legacy_json_files(&base_dir)
}

pub(crate) fn load_day(date: &str) -> Result<Option<DailyData>, String> {
    let conn = open_store()?;
    super::daily_store::load_day_snapshot(&conn, date).map(|snapshot| snapshot.map(to_command_daily))
}

pub(crate) fn save_day(daily: &DailyData) -> Result<super::daily_store::DaySignature, String> {
    let mut conn = open_store()?;
    super::daily_store::replace_day_snapshot(&mut conn, &to_stored_daily(daily))
}

pub(crate) fn get_day_signature(
    date: &str,
) -> Result<Option<super::daily_store::DaySignature>, String> {
    let conn = open_store()?;
    super::daily_store::get_day_signature(&conn, date)
}

pub(crate) fn load_range(start: &str, end: &str) -> Result<BTreeMap<String, DailyData>, String> {
    let conn = open_store()?;
    super::daily_store::load_range_snapshots(&conn, start, end).map(|days| {
        days.into_iter()
            .map(|(date, snapshot)| (date, to_command_daily(snapshot)))
            .collect()
    })
}
