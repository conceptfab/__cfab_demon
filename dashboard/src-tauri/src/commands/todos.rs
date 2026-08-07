use tauri::AppHandle;

use crate::commands::error::CommandError;

use super::costs::new_uid;
use super::helpers::run_db_blocking;
use super::types::TodoRow;

const SCOPE_GLOBAL: &str = "global";
const SCOPE_CLIENT: &str = "client";
const SCOPE_PROJECT: &str = "project";

const STATUS_OPEN: &str = "open";
const STATUS_DONE: &str = "done";

const TODO_COLUMNS: &str = "uid, scope, project_name, client_name, title, notes, due_date, \
     end_date, due_time, priority, status, completed_at, sort_order, created_at, updated_at";

/// `scope` rozstrzyga, które pole linku jest wymagane. Walidujemy tutaj, bo SQLite
/// nie wyrazi tej zależności constraintem, a rekord z `scope='project'` bez
/// `project_name` byłby sierotą niewidoczną w żadnym filtrze.
fn validate_scope(
    scope: &str,
    project_name: Option<&str>,
    client_name: Option<&str>,
) -> Result<(), String> {
    match scope {
        SCOPE_GLOBAL => {
            if project_name.is_some() || client_name.is_some() {
                return Err("Global todo must not carry a project or client".to_string());
            }
            Ok(())
        }
        SCOPE_PROJECT => {
            if project_name.map(|p| p.trim().is_empty()).unwrap_or(true) {
                return Err("Project todo requires a project name".to_string());
            }
            Ok(())
        }
        SCOPE_CLIENT => {
            if client_name.map(|c| c.trim().is_empty()).unwrap_or(true) {
                return Err("Client todo requires a client name".to_string());
            }
            Ok(())
        }
        other => Err(format!(
            "Unknown scope '{other}' (expected global, client or project)"
        )),
    }
}

fn validate_priority(priority: i64) -> Result<(), String> {
    if !(0..=2).contains(&priority) {
        return Err(format!("Priority must be 0, 1 or 2, got {priority}"));
    }
    Ok(())
}

/// Wymuszamy `YYYY-MM-DD`; `None` jest legalne (zadanie bez terminu).
fn validate_due_date(due_date: Option<&str>) -> Result<(), String> {
    let Some(date) = due_date else { return Ok(()) };
    if date.is_empty() {
        return Ok(());
    }
    let ok = date.len() == 10
        && date
            .char_indices()
            .all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    if !ok {
        return Err(format!("Due date must be YYYY-MM-DD, got '{date}'"));
    }
    Ok(())
}

/// Koniec zakresu nie może wypaść przed początkiem, a bez początku sam koniec
/// nie ma sensu — zadanie „do 5 maja" bez daty od nie da się narysować.
fn validate_range(due_date: Option<&str>, end_date: Option<&str>) -> Result<(), String> {
    let Some(end) = end_date else { return Ok(()) };
    let Some(start) = due_date else {
        return Err("End date requires a start date".to_string());
    };
    if end < start {
        return Err(format!("End date '{end}' is before start date '{start}'"));
    }
    Ok(())
}

fn normalize_opt(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TodoRow> {
    Ok(TodoRow {
        uid: row.get(0)?,
        scope: row.get(1)?,
        project_name: row.get(2)?,
        client_name: row.get(3)?,
        title: row.get(4)?,
        notes: row.get(5)?,
        due_date: row.get(6)?,
        end_date: row.get(7)?,
        due_time: row.get(8)?,
        priority: row.get(9)?,
        status: row.get(10)?,
        completed_at: row.get(11)?,
        sort_order: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn load_todo(conn: &rusqlite::Connection, uid: &str) -> Result<TodoRow, String> {
    conn.query_row(
        &format!("SELECT {TODO_COLUMNS} FROM todos WHERE uid = ?1"),
        [uid],
        map_row,
    )
    .map_err(|e| e.to_string())
}

/// Kolejna pozycja na końcu listy. Skok o 1000 zostawia miejsce na ręczne
/// wstawianie między sąsiadów bez przenumerowania całej listy.
fn next_sort_order(conn: &rusqlite::Connection) -> f64 {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order), 0.0) + 1000.0 FROM todos",
        [],
        |row| row.get(0),
    )
    .unwrap_or(1000.0)
}

pub(crate) fn list_todos(conn: &rusqlite::Connection) -> Result<Vec<TodoRow>, String> {
    let mut stmt = conn
        .prepare_cached(&format!(
            "SELECT {TODO_COLUMNS} FROM todos \
             ORDER BY (due_date IS NULL), due_date ASC, priority DESC, \
                      COALESCE(sort_order, 0) ASC, uid ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub async fn todos_list(app: AppHandle) -> Result<Vec<TodoRow>, CommandError> {
    run_db_blocking(app, move |conn| list_todos(conn))
        .await
        .map_err(CommandError::Other)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn todos_create(
    app: AppHandle,
    scope: String,
    project_name: Option<String>,
    client_name: Option<String>,
    title: String,
    notes: Option<String>,
    due_date: Option<String>,
    end_date: Option<String>,
    due_time: Option<String>,
    priority: i64,
) -> Result<TodoRow, CommandError> {
    run_db_blocking(app, move |conn| {
        let title = title.trim().to_string();
        if title.is_empty() {
            return Err("Title is required".to_string());
        }
        let project_name = normalize_opt(project_name);
        let client_name = normalize_opt(client_name);
        let due_date = normalize_opt(due_date);
        let end_date = normalize_opt(end_date);
        validate_scope(&scope, project_name.as_deref(), client_name.as_deref())?;
        validate_priority(priority)?;
        validate_due_date(due_date.as_deref())?;
        validate_due_date(end_date.as_deref())?;
        validate_range(due_date.as_deref(), end_date.as_deref())?;

        let uid = new_uid();
        let sort_order = next_sort_order(conn);
        conn.execute(
            "INSERT INTO todos (uid, scope, project_name, client_name, title, notes, due_date, \
             end_date, due_time, priority, status, sort_order, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open', ?11, datetime('now'), datetime('now'))",
            rusqlite::params![
                uid,
                scope,
                project_name,
                client_name,
                title,
                normalize_opt(notes),
                due_date,
                end_date,
                normalize_opt(due_time),
                priority,
                sort_order
            ],
        )
        .map_err(|e| e.to_string())?;
        load_todo(conn, &uid)
    })
    .await
    .map_err(CommandError::Other)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn todos_update(
    app: AppHandle,
    uid: String,
    scope: String,
    project_name: Option<String>,
    client_name: Option<String>,
    title: String,
    notes: Option<String>,
    due_date: Option<String>,
    end_date: Option<String>,
    due_time: Option<String>,
    priority: i64,
) -> Result<TodoRow, CommandError> {
    run_db_blocking(app, move |conn| {
        let title = title.trim().to_string();
        if title.is_empty() {
            return Err("Title is required".to_string());
        }
        let project_name = normalize_opt(project_name);
        let client_name = normalize_opt(client_name);
        let due_date = normalize_opt(due_date);
        let end_date = normalize_opt(end_date);
        validate_scope(&scope, project_name.as_deref(), client_name.as_deref())?;
        validate_priority(priority)?;
        validate_due_date(due_date.as_deref())?;
        validate_due_date(end_date.as_deref())?;
        validate_range(due_date.as_deref(), end_date.as_deref())?;

        // `updated_at` MUSI się odświeżyć — to on rozstrzyga LWW przy synchronizacji.
        let changed = conn
            .execute(
                "UPDATE todos SET scope = ?1, project_name = ?2, client_name = ?3, title = ?4, \
                 notes = ?5, due_date = ?6, end_date = ?7, due_time = ?8, priority = ?9, \
                 updated_at = datetime('now') WHERE uid = ?10",
                rusqlite::params![
                    scope,
                    project_name,
                    client_name,
                    title,
                    normalize_opt(notes),
                    due_date,
                    end_date,
                    normalize_opt(due_time),
                    priority,
                    uid
                ],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err(format!("Todo '{uid}' not found"));
        }
        load_todo(conn, &uid)
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn todos_set_status(
    app: AppHandle,
    uid: String,
    status: String,
) -> Result<TodoRow, CommandError> {
    run_db_blocking(app, move |conn| {
        if status != STATUS_OPEN && status != STATUS_DONE {
            return Err(format!("Unknown status '{status}' (expected open or done)"));
        }
        // `completed_at` ustawiamy przy przejściu na 'done' i zerujemy przy powrocie
        // do 'open' — inaczej odznaczone zadanie zostałoby z datą ukończenia.
        let changed = conn
            .execute(
                "UPDATE todos SET status = ?1, \
                 completed_at = CASE WHEN ?1 = 'done' THEN datetime('now') ELSE NULL END, \
                 updated_at = datetime('now') WHERE uid = ?2",
                rusqlite::params![status, uid],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err(format!("Todo '{uid}' not found"));
        }
        load_todo(conn, &uid)
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn todos_delete(app: AppHandle, uid: String) -> Result<(), CommandError> {
    run_db_blocking(app, move |conn| {
        // DELETE, nie soft-delete — trigger `trg_todos_tombstone` zapisze tombstone,
        // dzięki czemu usunięcie rozejdzie się na pozostałe maszyny.
        conn.execute("DELETE FROM todos WHERE uid = ?1", [&uid])
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
            "CREATE TABLE todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL UNIQUE, scope TEXT NOT NULL,
                project_name TEXT, client_name TEXT, title TEXT NOT NULL, notes TEXT,
                due_date TEXT, end_date TEXT, due_time TEXT, priority INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'open', completed_at TEXT, sort_order REAL,
                gcal_event_id TEXT, gcal_synced_at TEXT, created_at TEXT,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );",
        )
        .expect("schema");
        conn
    }

    #[test]
    fn scope_global_rejects_links() {
        assert!(validate_scope("global", None, None).is_ok());
        assert!(validate_scope("global", Some("Acme"), None).is_err());
        assert!(validate_scope("global", None, Some("Globex")).is_err());
    }

    #[test]
    fn scope_project_requires_project_name() {
        assert!(validate_scope("project", Some("Acme"), None).is_ok());
        assert!(validate_scope("project", None, None).is_err());
        assert!(validate_scope("project", Some("  "), None).is_err());
    }

    #[test]
    fn scope_client_requires_client_name() {
        assert!(validate_scope("client", None, Some("Globex")).is_ok());
        assert!(validate_scope("client", None, None).is_err());
    }

    #[test]
    fn unknown_scope_is_rejected() {
        assert!(validate_scope("kosmos", None, None).is_err());
    }

    #[test]
    fn priority_outside_range_is_rejected() {
        assert!(validate_priority(0).is_ok());
        assert!(validate_priority(1).is_ok());
        assert!(validate_priority(2).is_ok());
        assert!(validate_priority(-1).is_err());
        assert!(validate_priority(3).is_err());
    }

    #[test]
    fn end_date_must_not_precede_start() {
        assert!(validate_range(None, None).is_ok());
        assert!(validate_range(Some("2026-06-01"), None).is_ok(), "jednodniowe");
        assert!(validate_range(Some("2026-06-01"), Some("2026-06-05")).is_ok());
        assert!(validate_range(Some("2026-06-01"), Some("2026-06-01")).is_ok());
        assert!(validate_range(Some("2026-06-05"), Some("2026-06-01")).is_err());
        assert!(
            validate_range(None, Some("2026-06-05")).is_err(),
            "sam koniec bez poczatku nie da sie narysowac"
        );
    }

    #[test]
    fn due_date_is_optional_but_must_be_iso() {
        assert!(validate_due_date(None).is_ok());
        assert!(validate_due_date(Some("")).is_ok());
        assert!(validate_due_date(Some("2026-06-01")).is_ok());
        assert!(validate_due_date(Some("01.06.2026")).is_err());
        assert!(validate_due_date(Some("2026-6-1")).is_err());
    }

    /// Zadania bez terminu lądują NA KOŃCU, nie na początku — inaczej zaśmiecałyby
    /// górę listy, gdzie użytkownik szuka rzeczy pilnych.
    #[test]
    fn list_orders_by_due_date_then_priority_with_undated_last() {
        let conn = setup();
        for (uid, due, prio) in [
            ("bez-terminu", None, 1),
            ("pozniej", Some("2026-07-01"), 1),
            ("dzis-niski", Some("2026-06-01"), 0),
            ("dzis-wysoki", Some("2026-06-01"), 2),
        ] {
            conn.execute(
                "INSERT INTO todos (uid, scope, title, due_date, priority, sort_order, updated_at)
                 VALUES (?1, 'global', 'zadanie', ?2, ?3, 1000.0, '2026-05-10 10:00:00')",
                rusqlite::params![uid, due, prio],
            )
            .expect("insert");
        }

        let rows = list_todos(&conn).expect("list");
        let uids: Vec<&str> = rows.iter().map(|r| r.uid.as_str()).collect();
        assert_eq!(
            uids,
            vec!["dzis-wysoki", "dzis-niski", "pozniej", "bez-terminu"]
        );
    }

    /// Nowe zadanie ma trafić na koniec listy, z odstępem na ręczne wstawianie.
    #[test]
    fn next_sort_order_leaves_gap() {
        let conn = setup();
        assert_eq!(next_sort_order(&conn), 1000.0);
        conn.execute(
            "INSERT INTO todos (uid, scope, title, sort_order, updated_at)
             VALUES ('a', 'global', 'x', 1000.0, '2026-05-10 10:00:00')",
            [],
        )
        .unwrap();
        assert_eq!(next_sort_order(&conn), 2000.0);
    }
}
