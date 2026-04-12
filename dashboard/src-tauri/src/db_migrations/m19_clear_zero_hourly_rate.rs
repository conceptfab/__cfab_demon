pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    let has_projects_hourly_rate: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='hourly_rate'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_hourly_rate {
        return Ok(());
    }

    let cleared = db.execute(
        "UPDATE projects SET hourly_rate = NULL WHERE hourly_rate IS NOT NULL AND hourly_rate <= 0.0",
        [],
    )?;
    if cleared > 0 {
        log::info!(
            "Cleared zero/negative hourly_rate on {} project rows (treated as 'use global rate')",
            cleared
        );
    }

    Ok(())
}
