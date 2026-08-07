use rusqlite::Connection;

/// m27: `todos.end_date` — zadanie może trwać od–do, nie tylko jednego dnia.
///
/// `due_date` pozostaje datą POCZĄTKOWĄ (bez zmiany znaczenia dla istniejących
/// rekordów), `end_date` jest opcjonalne: `NULL` = zadanie jednodniowe. Dzięki temu
/// archiwa i peery sprzed m27 pozostają poprawne — brak kolumny czyta się jak
/// zadanie jednodniowe, a nie jak uszkodzony rekord.
///
/// ALTER jest strzeżony `pragma_table_info` (idempotentny), bo `schema.sql`
/// niesie już tę kolumnę przy świeżej instalacji.
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    let has_end_date: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('todos') WHERE name='end_date'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_end_date {
        tx.execute_batch("ALTER TABLE todos ADD COLUMN end_date TEXT;")?;
    }
    Ok(())
}
