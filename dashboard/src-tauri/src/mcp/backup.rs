use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use tauri::AppHandle;

pub const MAX_MCP_BACKUPS: usize = 20;
const BACKUP_PREFIX: &str = "timeflow_mcp_backup_";
const PART_EXT: &str = ".part";

/// Kopia młodsza niż to okno jest reużywana, o ile baza nie zmieniła się od jej
/// powstania. Claude Desktop uruchamia ten sam wpis MCP w kilku kopiach naraz —
/// bez tego każda sesja robiłaby identyczny snapshot i wypychała z rotacji
/// starsze, realnie przydatne kopie.
const BACKUP_REUSE_WINDOW: Duration = Duration::from_secs(120);
/// Plik częściowy starszy niż godzina to pozostałość po przerwanym backupie.
const ORPHAN_PART_MAX_AGE: Duration = Duration::from_secs(60 * 60);

/// Serializuje tworzenie kopii w obrębie procesu. Bez tego dwie sesje MCP
/// potrafią wybrać tę samą nazwę pliku, a `VACUUM INTO` odmawia zapisu do
/// istniejącego pliku ("output file already exists").
static BACKUP_LOCK: Mutex<()> = Mutex::new(());

fn mcp_backup_dir() -> Result<PathBuf, String> {
    let dir = crate::commands::helpers::timeflow_data_dir()?.join("mcp_backups");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create mcp backup dir {}: {e}", dir.display()))?;
    Ok(dir)
}

fn part_path(target: &Path) -> PathBuf {
    PathBuf::from(format!("{}{PART_EXT}", target.to_string_lossy()))
}

/// Nazwa musi być unikalna także przy równoległym starcie kilku sesji:
/// milisekundy + PID + licznik kolizji. Sam timestamp sekundowy jest zbyt
/// zgrubny — to on powodował `backup_failed: output file already exists`.
fn unique_backup_path(dir: &Path, now: chrono::DateTime<chrono::Local>) -> PathBuf {
    let base = format!(
        "{BACKUP_PREFIX}{}_{}",
        now.format("%Y-%m-%d_%H-%M-%S-%3f"),
        std::process::id()
    );
    let mut candidate = dir.join(format!("{base}.db"));
    let mut counter = 1u32;
    while candidate.exists() || part_path(&candidate).exists() {
        candidate = dir.join(format!("{base}_{counter}.db"));
        counter += 1;
    }
    candidate
}

fn is_backup_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with(BACKUP_PREFIX) && n.ends_with(".db"))
        .unwrap_or(false)
}

fn file_mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

fn backups_newest_first(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut backups: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| is_backup_file(p))
        .collect();
    // mtime, a nie nazwa: format nazwy zmieniał się w czasie, mtime nie kłamie.
    backups.sort_by_key(|p| {
        (
            std::cmp::Reverse(file_mtime(p).unwrap_or(SystemTime::UNIX_EPOCH)),
            p.clone(),
        )
    });
    backups
}

/// W trybie WAL zapisy lądują najpierw w pliku `-wal`, więc sam mtime bazy
/// potrafi nie drgnąć mimo zmian.
fn db_last_change(db_path: &Path) -> Option<SystemTime> {
    let wal = PathBuf::from(format!("{}-wal", db_path.to_string_lossy()));
    match (file_mtime(db_path), file_mtime(&wal)) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, b) => b,
    }
}

/// Zwraca świeży backup do reużycia albo `None`, gdy trzeba zrobić nowy.
fn reusable_backup(dir: &Path, db_path: &Path, now: SystemTime) -> Option<PathBuf> {
    let newest = backups_newest_first(dir).into_iter().next()?;
    let backup_mtime = file_mtime(&newest)?;
    if now.duration_since(backup_mtime).ok()? > BACKUP_REUSE_WINDOW {
        return None;
    }
    if db_last_change(db_path)? > backup_mtime {
        return None;
    }
    Some(newest)
}

fn describe_failure(target: &Path, dir: &Path, reason: &str) -> String {
    let existing = backups_newest_first(dir).len();
    format!(
        "Backup failed: {reason} (target={}, backup_dir={}, pid={}, existing_backups={existing})",
        target.display(),
        dir.display(),
        std::process::id()
    )
}

/// Windows potrafi przez chwilę trzymać uchwyt do świeżo utworzonego pliku
/// (antywirus, indeksowanie) — `rename` zwraca wtedy błąd 32. Ponawiamy przez
/// pół sekundy zamiast wywracać gotowy backup.
fn publish_backup(part: &Path, target: &Path) -> std::io::Result<()> {
    let mut last = match std::fs::rename(part, target) {
        Ok(()) => return Ok(()),
        Err(e) => e,
    };
    for _ in 0..10 {
        std::thread::sleep(Duration::from_millis(50));
        match std::fs::rename(part, target) {
            Ok(()) => return Ok(()),
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn vacuum_into(conn: &rusqlite::Connection, part: &Path) -> Result<(), String> {
    let part_string = part.to_string_lossy().to_string();
    let quoted_path: String = conn
        .query_row("SELECT quote(?1)", [&part_string], |row| row.get(0))
        .map_err(|e| format!("cannot escape path: {e}"))?;
    conn.execute_batch(&format!("VACUUM INTO {quoted_path}"))
        .map_err(|e| e.to_string())
}

/// Zapis idzie do `.part` i dopiero po sukcesie dostaje docelową nazwę —
/// przerwany backup nigdy nie zostawia pliku, który przy następnym starcie
/// wyglądałby jak gotowa kopia (to właśnie dawało „output file already exists").
///
/// Kolizja nazwy jest ponawiana, a nie zgłaszana: `BACKUP_LOCK` serializuje
/// tylko ten proces, a druga instancja TIMEFLOW pisze do tego samego katalogu.
fn create_backup(conn: &rusqlite::Connection, dir: &Path) -> Result<PathBuf, String> {
    const ATTEMPTS: usize = 4;

    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create mcp backup dir {}: {e}", dir.display()))?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| describe_failure(dir, dir, &format!("WAL checkpoint failed: {e}")))?;

    let mut last: Option<(PathBuf, String)> = None;
    for _ in 0..ATTEMPTS {
        let target = unique_backup_path(dir, chrono::Local::now());
        let part = part_path(&target);
        match vacuum_into(conn, &part) {
            Ok(()) => {
                publish_backup(&part, &target).map_err(|e| {
                    describe_failure(&target, dir, &format!("cannot publish backup: {e}"))
                })?;
                rotate_backups(dir, MAX_MCP_BACKUPS);
                cleanup_orphan_parts(dir, ORPHAN_PART_MAX_AGE);
                return Ok(target);
            }
            Err(e) => {
                let collision = e.contains("already exists");
                if !collision {
                    // Plik częściowy jest nasz — nie zostawiamy śmiecia.
                    let _ = std::fs::remove_file(&part);
                }
                last = Some((target, e));
                if !collision {
                    break;
                }
            }
        }
    }

    let (target, reason) = last.unwrap_or_else(|| (dir.to_path_buf(), "unknown error".to_string()));
    Err(describe_failure(&target, dir, &reason))
}

fn ensure_backup(
    conn: &rusqlite::Connection,
    dir: &Path,
    db_path: &Path,
) -> Result<PathBuf, String> {
    // Sprawdzenie i zapis pod jednym lockiem — inaczej okno wyścigu wraca.
    let _guard = BACKUP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = reusable_backup(dir, db_path, SystemTime::now()) {
        log::info!("[mcp] reusing recent backup {}", existing.display());
        return Ok(existing);
    }
    create_backup(conn, dir)
}

/// Kopia bazy przed pierwszym zapisem sesji MCP: WAL checkpoint + `VACUUM INTO`
/// (spójna kopia, jak `backup_before_sync` w `commands/sync_markers.rs`).
/// Świeża kopia z ostatnich 2 minut jest reużywana. Zwraca ścieżkę pliku.
pub async fn ensure_recent_backup(app: AppHandle) -> Result<String, String> {
    let backup_dir = mcp_backup_dir()?;
    let db_path = PathBuf::from(crate::db::active_db_path(&app)?);

    crate::commands::helpers::run_db_blocking(app, move |conn| {
        ensure_backup(conn, &backup_dir, &db_path).map(|p| p.to_string_lossy().to_string())
    })
    .await
}

/// Czas ostatniej kopii MCP w ISO-8601 — dla `/healthz`. `None`, gdy brak kopii.
pub fn last_backup_at() -> Option<String> {
    let dir = crate::commands::helpers::timeflow_data_dir()
        .ok()?
        .join("mcp_backups");
    let newest = backups_newest_first(&dir).into_iter().next()?;
    let mtime = file_mtime(&newest)?;
    Some(chrono::DateTime::<chrono::Local>::from(mtime).to_rfc3339())
}

/// Sprzątanie, nie operacja krytyczna: żaden błąd nie może wywrócić backupu.
fn rotate_backups(dir: &Path, keep: usize) {
    for old in backups_newest_first(dir).into_iter().skip(keep) {
        if let Err(e) = std::fs::remove_file(&old) {
            log::warn!("[mcp] failed to remove old backup {}: {e}", old.display());
        }
    }
}

/// Osierocone `.part` po przerwanym backupie (crash, kill) — usuwamy dopiero po
/// `max_age`, żeby nie skasować pliku, który właśnie powstaje.
fn cleanup_orphan_parts(dir: &Path, max_age: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for path in entries.filter_map(|e| e.ok().map(|e| e.path())) {
        let is_part = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with(BACKUP_PREFIX) && n.ends_with(PART_EXT))
            .unwrap_or(false);
        if !is_part {
            continue;
        }
        let stale = file_mtime(&path)
            .and_then(|m| now.duration_since(m).ok())
            .map(|age| age > max_age)
            .unwrap_or(false);
        if stale {
            if let Err(e) = std::fs::remove_file(&path) {
                log::warn!(
                    "[mcp] failed to remove orphaned backup part {}: {e}",
                    path.display()
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::UNIX_EPOCH;

    fn temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time moves forward")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "timeflow-mcp-backup-test-{}-{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn seed_db(dir: &Path) -> PathBuf {
        let db = dir.join("source.db");
        let conn = rusqlite::Connection::open(&db).expect("open db");
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t(v) VALUES ('a');",
        )
        .expect("seed");
        db
    }

    #[test]
    fn unique_path_never_collides_within_the_same_millisecond() {
        let dir = temp_dir();
        let now = chrono::Local::now();
        let first = unique_backup_path(&dir, now);
        std::fs::write(&first, b"x").expect("write");
        let second = unique_backup_path(&dir, now);
        assert_ne!(first, second);
        // Nazwa niesie PID — dwa procesy nie wybiorą tego samego pliku.
        assert!(first
            .file_name()
            .and_then(|n| n.to_str())
            .expect("name")
            .contains(&std::process::id().to_string()));
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn unique_path_skips_names_taken_by_a_part_file() {
        let dir = temp_dir();
        let now = chrono::Local::now();
        let first = unique_backup_path(&dir, now);
        std::fs::write(part_path(&first), b"junk").expect("write");
        assert_ne!(unique_backup_path(&dir, now), first);
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    /// Osiem sesji MCP startujących równocześnie (Claude Desktop uruchamia ten
    /// sam wpis kilka razy) — żadna nie może dostać błędu backupu.
    #[test]
    fn concurrent_backups_all_succeed() {
        let dir = temp_dir();
        let db = Arc::new(seed_db(&dir));
        let backup_dir = Arc::new(dir.join("mcp_backups"));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let db = Arc::clone(&db);
                let backup_dir = Arc::clone(&backup_dir);
                std::thread::spawn(move || {
                    let conn = rusqlite::Connection::open(db.as_path()).expect("open");
                    ensure_backup(&conn, backup_dir.as_path(), db.as_path()).expect("backup")
                })
            })
            .collect();
        let results: Vec<PathBuf> = handles.into_iter().map(|h| h.join().expect("join")).collect();

        assert_eq!(results.len(), 8);
        assert!(results.iter().all(|p| p.exists()));
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }

    #[test]
    fn orphaned_part_file_does_not_block_a_new_backup() {
        let dir = temp_dir();
        let db = seed_db(&dir);
        let backup_dir = dir.join("mcp_backups");
        std::fs::create_dir_all(&backup_dir).expect("mkdir");
        std::fs::write(
            backup_dir.join("timeflow_mcp_backup_2026-08-20_10-12-26-000_5048.db.part"),
            b"junk",
        )
        .expect("write");

        let conn = rusqlite::Connection::open(&db).expect("open");
        assert!(create_backup(&conn, &backup_dir)
            .expect("backup")
            .exists());
        drop(conn); // Windows nie usunie katalogu z otwartym plikiem bazy.
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn cleanup_removes_only_stale_parts() {
        let dir = temp_dir();
        let fresh = dir.join("timeflow_mcp_backup_2026-08-20_10-12-26-000_1.db.part");
        std::fs::write(&fresh, b"x").expect("write");
        cleanup_orphan_parts(&dir, Duration::from_secs(3600));
        assert!(fresh.exists(), "świeży .part to trwający backup");
        cleanup_orphan_parts(&dir, Duration::from_secs(0));
        assert!(!fresh.exists());
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn backup_is_reused_within_the_window_and_dropped_after_a_write() {
        let dir = temp_dir();
        let db = seed_db(&dir);
        let backup_dir = dir.join("mcp_backups");
        let conn = rusqlite::Connection::open(&db).expect("open");

        let first = ensure_backup(&conn, &backup_dir, &db).expect("first backup");
        let second = ensure_backup(&conn, &backup_dir, &db).expect("second backup");
        assert_eq!(first, second, "niezmieniona baza → ta sama kopia");

        // Zapis do bazy unieważnia kopię (mtime pliku ma rozdzielczość ~1 s).
        std::thread::sleep(Duration::from_millis(1100));
        conn.execute_batch("INSERT INTO t(v) VALUES ('c');")
            .expect("write");
        assert_ne!(
            ensure_backup(&conn, &backup_dir, &db).expect("third backup"),
            second
        );
        drop(conn); // Windows nie usunie katalogu z otwartym plikiem bazy.
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn rotate_keeps_only_newest_files() {
        let dir = temp_dir();
        for i in 0..25 {
            let name = format!("timeflow_mcp_backup_2026-01-{:02}_00-00-00.db", i + 1);
            std::fs::write(dir.join(name), b"x").expect("write");
            // mtime rośnie z indeksem — rotacja sortuje po mtime.
            std::thread::sleep(Duration::from_millis(5));
        }
        rotate_backups(&dir, 20);
        assert_eq!(std::fs::read_dir(&dir).expect("read dir").count(), 20);
        assert!(!dir
            .join("timeflow_mcp_backup_2026-01-01_00-00-00.db")
            .exists());
        assert!(dir
            .join("timeflow_mcp_backup_2026-01-25_00-00-00.db")
            .exists());
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn rotate_ignores_foreign_files_and_missing_dir() {
        let dir = temp_dir();
        std::fs::write(dir.join("unrelated.txt"), b"keep me").expect("write");
        for i in 0..21 {
            let name = format!("timeflow_mcp_backup_2026-02-{:02}_00-00-00.db", i + 1);
            std::fs::write(dir.join(name), b"x").expect("write");
            std::thread::sleep(Duration::from_millis(5));
        }
        rotate_backups(&dir, 20);
        assert!(dir.join("unrelated.txt").exists());
        // Nieistniejący katalog nie może panikować — to tylko sprzątanie.
        rotate_backups(&dir.join("missing"), 20);
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn failure_message_names_the_file_and_directory() {
        let dir = temp_dir();
        let msg = describe_failure(&dir.join("target.db"), &dir, "output file already exists");
        assert!(msg.contains("target.db"));
        assert!(msg.contains("backup_dir="));
        assert!(msg.contains(&format!("pid={}", std::process::id())));
        std::fs::remove_dir_all(dir).expect("cleanup");
    }
}
