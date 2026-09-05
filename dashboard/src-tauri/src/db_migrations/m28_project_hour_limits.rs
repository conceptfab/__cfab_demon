use rusqlite::Connection;

/// m28: limit godzin projektu na okres rozliczeniowy.
///
/// - `monthly_hours_limit` — budżet godzin na okres; `NULL` = limit wyłączony
///   (i tak czyta się każdy projekt sprzed m28: brak limitu, zero zmian w zachowaniu).
/// - `limit_cycle_start_day` — dzień startu okresu rozliczeniowego 1..28;
///   `NULL` czytamy jak `1`, czyli miesiąc kalendarzowy. Górna granica 28, żeby okres
///   istniał w każdym miesiącu (luty).
/// - `over_limit_multiplier` — mnożnik dla sesji w całości ponad limitem; `NULL` ⇒ 1.5.
/// - `over_limit_comment` — szablon komentarza nadawanego przy booście; `NULL` ⇒ tekst
///   domyślny z locale.
///
/// ALTER-y strzeżone `pragma_table_info` (idempotentne) — dokładnie jak w m27.
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    for (column, ddl) in [
        (
            "monthly_hours_limit",
            "ALTER TABLE projects ADD COLUMN monthly_hours_limit REAL;",
        ),
        (
            "limit_cycle_start_day",
            "ALTER TABLE projects ADD COLUMN limit_cycle_start_day INTEGER;",
        ),
        (
            "over_limit_multiplier",
            "ALTER TABLE projects ADD COLUMN over_limit_multiplier REAL;",
        ),
        (
            "over_limit_comment",
            "ALTER TABLE projects ADD COLUMN over_limit_comment TEXT;",
        ),
    ] {
        let exists: bool = tx
            .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name = ?1")?
            .query_row([column], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if !exists {
            log::info!("Migrating projects: adding {column}");
            tx.execute_batch(ddl)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pre_m28_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE projects (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL,
                 color TEXT
             );
             INSERT INTO projects VALUES (1, 'notch', '#38bdf8');",
        )
        .expect("setup");
        conn
    }

    #[test]
    fn adds_limit_columns_and_keeps_rows() {
        let conn = pre_m28_db();
        run(&conn).expect("migration ok");

        let (limit, day, mult, comment): (
            Option<f64>,
            Option<i64>,
            Option<f64>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT monthly_hours_limit, limit_cycle_start_day, over_limit_multiplier, \
                 over_limit_comment FROM projects WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("query new columns");

        assert_eq!(limit, None, "istniejący projekt nie dostaje limitu");
        assert_eq!(day, None);
        assert_eq!(mult, None);
        assert_eq!(comment, None);
    }

    #[test]
    fn is_idempotent() {
        let conn = pre_m28_db();
        run(&conn).expect("first run");
        run(&conn).expect("second run must not fail");
    }
}
