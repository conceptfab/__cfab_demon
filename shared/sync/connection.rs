//! Otwarcie połączenia w stanie wymaganym przez merge: foreign_keys=OFF
//! (merge ręcznie zarządza FK; ON → CASCADE kasuje manual_sessions, finding #5).

/// Ustawia PRAGMA wymagane przez ścieżkę merge. Wołać PRZED otwarciem transakcji.
pub fn set_merge_pragmas(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys=OFF; PRAGMA synchronous=NORMAL;")
        .map_err(|e| format!("Failed to set merge pragmas: {e}"))
}

/// Debug-assert, że FK są wyłączone (wołać na wejściu rdzenia merge).
/// No-op w release; w debug panikuje, jeśli ktoś uruchomi merge pod FK=ON
/// (klasa błędu utraty danych z findingu #5).
pub fn assert_fk_off(conn: &rusqlite::Connection) {
    if cfg!(debug_assertions) {
        let fk_on: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap_or(0);
        debug_assert_eq!(fk_on, 0, "merge wymaga foreign_keys=OFF (finding #5)");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[should_panic(expected = "foreign_keys=OFF")]
    fn assert_fk_off_panics_when_fk_on() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        assert_fk_off(&conn);
    }
    #[test]
    fn set_merge_pragmas_disables_fk() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        set_merge_pragmas(&conn).unwrap();
        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 0);
        assert_fk_off(&conn); // should not panic
    }
}
