use std::collections::HashMap;

use tauri::AppHandle;

use crate::commands::error::CommandError;

use super::helpers::run_db_blocking;
use super::types::{CostRow, DateRange};

const MAX_COST_AMOUNT: f64 = 100_000_000.0;

/// Agregat kosztów jednego projektu w okresie — wejście dla estymacji i raportu.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct CostsTotal {
    pub value: f64,
    pub count: i64,
}

/// 16 bajtów entropii OS w hex. `uid` jest kluczem synchronizacji, więc musi być
/// nieodgadywalny i unikalny między maszynami. Świadomie NIE dodajemy crate'a
/// `uuid` — `getrandom` jest już zależnością (patrz `webui/auth.rs`).
pub(crate) fn new_uid() -> String {
    let mut buf = [0u8; 16];
    if getrandom::getrandom(&mut buf).is_err() {
        // Skrajnie mało prawdopodobne. Fallback na zegar — nadal unikalny lokalnie.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        return format!("{nanos:032x}");
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn validate_amount(amount: f64) -> Result<(), String> {
    if !amount.is_finite() {
        return Err("Amount must be a finite number".to_string());
    }
    if amount < 0.0 {
        return Err("Amount must be >= 0".to_string());
    }
    if amount > MAX_COST_AMOUNT {
        return Err(format!("Amount must be <= {MAX_COST_AMOUNT}"));
    }
    Ok(())
}

/// Wymuszamy `YYYY-MM-DD` — ten sam format co `sessions.date`, dzięki czemu
/// porównanie leksykograficzne w filtrze okresu jest poprawne.
pub(crate) fn validate_cost_date(date: &str) -> Result<(), String> {
    let ok = date.len() == 10
        && date
            .char_indices()
            .all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    if !ok {
        return Err(format!("Cost date must be YYYY-MM-DD, got '{date}'"));
    }
    Ok(())
}

/// Koszty jednego projektu w okresie. Obie granice WŁĄCZNIE — identycznie jak
/// filtr sesji po `session_date`. Preset „all time" to szeroki zakres
/// (2020-01-01 .. 2100-01-01), więc nie wymaga osobnej gałęzi.
pub(crate) fn list_costs(
    conn: &rusqlite::Connection,
    project_name: &str,
    date_range: &DateRange,
) -> Result<Vec<CostRow>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT uid, project_name, cost_date, amount, comment, created_at, updated_at \
             FROM project_costs \
             WHERE project_name = ?1 AND cost_date >= ?2 AND cost_date <= ?3 \
             ORDER BY cost_date ASC, uid ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            rusqlite::params![project_name, date_range.start, date_range.end],
            |row| {
                Ok(CostRow {
                    uid: row.get(0)?,
                    project_name: row.get(1)?,
                    cost_date: row.get(2)?,
                    amount: row.get(3)?,
                    comment: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Suma i licznik kosztów per NAZWA projektu w okresie. Jedno zapytanie dla
/// wszystkich projektów — estymacje budują dziesiątki wierszy naraz.
pub(crate) fn costs_totals_by_project(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
) -> Result<HashMap<String, CostsTotal>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT project_name, COALESCE(SUM(amount), 0.0), COUNT(*) \
             FROM project_costs \
             WHERE cost_date >= ?1 AND cost_date <= ?2 \
             GROUP BY project_name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![date_range.start, date_range.end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                CostsTotal {
                    value: row.get(1)?,
                    count: row.get(2)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows {
        let (name, total) = row.map_err(|e| e.to_string())?;
        out.insert(name, total);
    }
    Ok(out)
}

fn load_cost(conn: &rusqlite::Connection, uid: &str) -> Result<CostRow, String> {
    conn.query_row(
        "SELECT uid, project_name, cost_date, amount, comment, created_at, updated_at \
         FROM project_costs WHERE uid = ?1",
        [uid],
        |row| {
            Ok(CostRow {
                uid: row.get(0)?,
                project_name: row.get(1)?,
                cost_date: row.get(2)?,
                amount: row.get(3)?,
                comment: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn normalize_comment(comment: Option<String>) -> Option<String> {
    comment
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
}

#[tauri::command]
pub async fn costs_list(
    app: AppHandle,
    project_name: String,
    date_range: DateRange,
) -> Result<Vec<CostRow>, CommandError> {
    run_db_blocking(app, move |conn| {
        list_costs(conn, &project_name, &date_range)
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn costs_create(
    app: AppHandle,
    project_name: String,
    cost_date: String,
    amount: f64,
    comment: Option<String>,
) -> Result<CostRow, CommandError> {
    run_db_blocking(app, move |conn| {
        let project_name = project_name.trim().to_string();
        if project_name.is_empty() {
            return Err("Project name is required".to_string());
        }
        validate_cost_date(&cost_date)?;
        validate_amount(amount)?;

        let uid = new_uid();
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, comment, \
             created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'))",
            rusqlite::params![
                uid,
                project_name,
                cost_date,
                amount,
                normalize_comment(comment)
            ],
        )
        .map_err(|e| e.to_string())?;
        load_cost(conn, &uid)
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn costs_update(
    app: AppHandle,
    uid: String,
    cost_date: String,
    amount: f64,
    comment: Option<String>,
) -> Result<CostRow, CommandError> {
    run_db_blocking(app, move |conn| {
        validate_cost_date(&cost_date)?;
        validate_amount(amount)?;

        // `updated_at` MUSI się odświeżyć — to on rozstrzyga LWW przy synchronizacji.
        let changed = conn
            .execute(
                "UPDATE project_costs SET cost_date = ?1, amount = ?2, comment = ?3, \
                 updated_at = datetime('now') WHERE uid = ?4",
                rusqlite::params![cost_date, amount, normalize_comment(comment), uid],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err(format!("Cost '{uid}' not found"));
        }
        load_cost(conn, &uid)
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn costs_delete(app: AppHandle, uid: String) -> Result<(), CommandError> {
    run_db_blocking(app, move |conn| {
        // DELETE, nie soft-delete — trigger `trg_project_costs_tombstone` zapisze
        // tombstone, dzięki czemu usunięcie rozejdzie się na pozostałe maszyny.
        conn.execute("DELETE FROM project_costs WHERE uid = ?1", [&uid])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(CommandError::Other)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        conn.execute_batch(
            "CREATE TABLE project_costs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL UNIQUE,
                project_name TEXT NOT NULL,
                cost_date TEXT NOT NULL,
                amount REAL NOT NULL,
                comment TEXT,
                created_at TEXT,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );",
        )
        .expect("schema");
        conn
    }

    fn insert(conn: &rusqlite::Connection, uid: &str, date: &str, amount: f64) {
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES (?1, 'Acme', ?2, ?3, '2026-05-10 10:00:00')",
            rusqlite::params![uid, date, amount],
        )
        .expect("insert");
    }

    /// Filtr okresu obejmuje OBIE granice — tak samo jak filtr sesji po `session_date`.
    #[test]
    fn list_filters_by_period_inclusive() {
        let conn = setup();
        insert(&conn, "before", "2026-04-30", 1.0);
        insert(&conn, "start", "2026-05-01", 2.0);
        insert(&conn, "middle", "2026-05-15", 3.0);
        insert(&conn, "end", "2026-05-31", 4.0);
        insert(&conn, "after", "2026-06-01", 5.0);

        let range = DateRange {
            start: "2026-05-01".into(),
            end: "2026-05-31".into(),
        };
        let rows = list_costs(&conn, "Acme", &range).expect("list");

        let uids: Vec<&str> = rows.iter().map(|r| r.uid.as_str()).collect();
        assert_eq!(uids, vec!["start", "middle", "end"]);
    }

    /// Koszty innego projektu nie mogą przeciekać do listy.
    #[test]
    fn list_is_scoped_to_project() {
        let conn = setup();
        insert(&conn, "acme", "2026-05-10", 10.0);
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('other', 'Globex', '2026-05-10', 99.0, '2026-05-10 10:00:00')",
            [],
        )
        .expect("insert");

        let range = DateRange {
            start: "2026-05-01".into(),
            end: "2026-05-31".into(),
        };
        let rows = list_costs(&conn, "Acme", &range).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].uid, "acme");
    }

    /// Suma per projekt w okresie — wejście dla estymacji i raportu.
    #[test]
    fn totals_sums_amounts_per_project() {
        let conn = setup();
        insert(&conn, "a", "2026-05-10", 100.0);
        insert(&conn, "b", "2026-05-20", 50.5);
        insert(&conn, "outside", "2026-07-01", 999.0);

        let range = DateRange {
            start: "2026-05-01".into(),
            end: "2026-05-31".into(),
        };
        let totals = costs_totals_by_project(&conn, &range).expect("totals");

        let entry = totals.get("Acme").expect("Acme musi byc w mapie");
        assert_eq!(entry.value, 150.5);
        assert_eq!(entry.count, 2);
    }

    #[test]
    fn validate_rejects_negative_amount() {
        assert!(validate_amount(-1.0).is_err());
        assert!(validate_amount(f64::NAN).is_err());
        assert!(validate_amount(0.0).is_ok(), "koszt 0 jest legalny");
        assert!(validate_amount(12.5).is_ok());
    }

    #[test]
    fn validate_rejects_malformed_date() {
        assert!(validate_cost_date("2026-05-10").is_ok());
        assert!(validate_cost_date("10.05.2026").is_err());
        assert!(validate_cost_date("").is_err());
        assert!(validate_cost_date("2026-5-10").is_err());
    }

    /// `uid` musi być losowy i unikalny — jest kluczem synchronizacji.
    #[test]
    fn new_uid_is_unique_hex() {
        let a = new_uid();
        let b = new_uid();
        assert_ne!(a, b);
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// Pusty komentarz nie ma trafiać do bazy jako pusty string — `None` odróżnia
    /// „brak komentarza" od „komentarz o zerowej długości" w UI i w sync.
    #[test]
    fn normalize_comment_maps_blank_to_none() {
        assert_eq!(normalize_comment(None), None);
        assert_eq!(normalize_comment(Some("   ".into())), None);
        assert_eq!(
            normalize_comment(Some("  licencja  ".into())),
            Some("licencja".into())
        );
    }
}
