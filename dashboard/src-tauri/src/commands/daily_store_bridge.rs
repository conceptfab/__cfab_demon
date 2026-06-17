use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::Local;

use super::helpers::timeflow_data_dir;
use super::types::DailyData;

pub(crate) fn store_path() -> Result<PathBuf, String> {
    let base_dir = timeflow_data_dir()?;
    Ok(super::daily_store::store_db_path(&base_dir))
}

fn open_store() -> Result<rusqlite::Connection, String> {
    let base_dir = timeflow_data_dir()?;
    super::daily_store::open_store(&base_dir)
}

pub(crate) fn migrate_legacy_daily_json_to_store() -> Result<usize, String> {
    let base_dir = timeflow_data_dir()?;
    super::daily_store::migrate_legacy_json_files(&base_dir)
}

pub(crate) fn load_day(date: &str) -> Result<Option<DailyData>, String> {
    let conn = open_store()?;
    super::daily_store::load_day_snapshot(&conn, date)
}

pub(crate) fn save_day(daily: &DailyData) -> Result<super::daily_store::DaySignature, String> {
    let mut conn = open_store()?;
    let mut snapshot = daily.clone();
    snapshot.generated_at = Local::now().to_rfc3339();
    super::daily_store::replace_day_snapshot(&mut conn, &snapshot)
}

pub(crate) fn get_day_signature(
    date: &str,
) -> Result<Option<super::daily_store::DaySignature>, String> {
    let conn = open_store()?;
    super::daily_store::get_day_signature(&conn, date)
}

pub(crate) fn load_range(start: &str, end: &str) -> Result<BTreeMap<String, DailyData>, String> {
    let conn = open_store()?;
    super::daily_store::load_range_snapshots(&conn, start, end)
}
