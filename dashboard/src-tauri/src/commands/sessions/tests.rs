use crate::commands::sql_fragments::{
    ensure_session_project_cache_all, SESSION_PROJECT_CTE_ALL_TIME,
};
use crate::commands::types::SplitPart;

use super::split::{
    analyze_session_projects_sync, execute_session_split, load_split_source_session,
    parse_iso_datetime,
};

fn setup_conn() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
    conn.execute_batch(
        "CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT DEFAULT '#38bdf8',
                excluded_at TEXT,
                frozen_at TEXT
            );
            CREATE TABLE applications (
                id INTEGER PRIMARY KEY,
                display_name TEXT,
                executable_name TEXT
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                split_source_session_id INTEGER,
                project_id INTEGER,
                rate_multiplier REAL,
                comment TEXT,
                is_hidden INTEGER
            );
            CREATE TABLE file_activities (
                id INTEGER PRIMARY KEY,
                app_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_path TEXT DEFAULT '',
                total_seconds INTEGER NOT NULL,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                project_id INTEGER,
                detected_path TEXT,
                window_title TEXT,
                title_history TEXT,
                activity_spans TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE assignment_model_app (
                app_id INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                cnt INTEGER NOT NULL DEFAULT 0,
                last_seen TEXT NOT NULL,
                PRIMARY KEY (app_id, project_id)
            );
            CREATE TABLE assignment_model_token (
                token TEXT NOT NULL,
                project_id INTEGER NOT NULL,
                cnt INTEGER NOT NULL DEFAULT 0,
                last_seen TEXT NOT NULL,
                PRIMARY KEY (token, project_id)
            );
            CREATE TABLE assignment_model_time (
                app_id INTEGER NOT NULL,
                hour_bucket INTEGER NOT NULL,
                weekday INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                cnt INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (app_id, hour_bucket, weekday, project_id)
            );
            CREATE TABLE project_folder_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                token TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 1,
                scanned_at TEXT NOT NULL,
                UNIQUE(project_id, token)
            );
            CREATE TABLE assignment_feedback (
                id INTEGER PRIMARY KEY,
                session_id INTEGER,
                app_id INTEGER,
                from_project_id INTEGER,
                to_project_id INTEGER,
                source TEXT NOT NULL,
                weight REAL NOT NULL DEFAULT 1.0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE assignment_model_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE session_manual_overrides (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                executable_name TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                project_name TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(executable_name, start_time, end_time)
            );
            CREATE TABLE session_project_cache (
                session_id INTEGER PRIMARY KEY,
                session_date TEXT NOT NULL,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                project_id INTEGER,
                multiplier REAL NOT NULL,
                duration_seconds REAL NOT NULL,
                comment TEXT,
                built_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE session_project_cache_dirty (
                date TEXT PRIMARY KEY,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
    )
    .expect("schema");
    conn.execute(
        "INSERT INTO applications (id, display_name, executable_name) VALUES (?1, ?2, ?3)",
        rusqlite::params![1_i64, "Editor", "editor.exe"],
    )
    .expect("insert app");
    conn.execute_batch(
        "INSERT INTO projects (id, name, color) VALUES
                (10, 'Alpha', '#1d4ed8'),
                (20, 'Beta', '#16a34a'),
                (30, 'Gamma', '#d97706');",
    )
    .expect("insert projects");
    conn
}

#[test]
fn session_project_cte_does_not_assign_non_overlapping_activity() {
    let conn = setup_conn();
    conn.execute(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
            rusqlite::params![
                1_i64,
                1_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T11:00:00Z",
                3600_i64,
                "2026-01-01",
            ],
        )
        .expect("insert session");
    conn.execute(
            "INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                1_i64,
                1_i64,
                "2026-01-01",
                "main.rs",
                1800_i64,
                "2026-01-01T12:00:00Z",
                "2026-01-01T12:30:00Z",
                10_i64
            ],
        )
        .expect("insert file activity");
    ensure_session_project_cache_all(&conn).expect("build cache");

    let sql = format!(
        "{SESSION_PROJECT_CTE_ALL_TIME}
             SELECT project_id FROM session_projects WHERE id = ?1"
    );
    let project_id: Option<i64> = conn
        .query_row(&sql, [1_i64], |row| row.get(0))
        .expect("query cte project id");
    assert_eq!(project_id, None);
}

#[test]
fn session_project_cte_assigns_single_project_with_major_overlap() {
    let conn = setup_conn();
    conn.execute(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
            rusqlite::params![
                1_i64,
                1_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T11:00:00Z",
                3600_i64,
                "2026-01-01",
            ],
        )
        .expect("insert session");
    conn.execute(
            "INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                1_i64,
                1_i64,
                "2026-01-01",
                "main.rs",
                1800_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T10:30:00Z",
                10_i64
            ],
        )
        .expect("insert file activity");
    ensure_session_project_cache_all(&conn).expect("build cache");

    let sql = format!(
        "{SESSION_PROJECT_CTE_ALL_TIME}
             SELECT project_id FROM session_projects WHERE id = ?1"
    );
    let project_id: Option<i64> = conn
        .query_row(&sql, [1_i64], |row| row.get(0))
        .expect("query cte project id");
    assert_eq!(project_id, Some(10));
}

#[test]
fn project_count_query_matches_overlap_and_hidden_rules() {
    let conn = setup_conn();
    conn.execute_batch(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden) VALUES
                (1, 1, '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z', 3600, '2026-01-01', NULL, 1.0, NULL, 0),
                (2, 1, '2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z', 3600, '2026-01-01', 10,   1.0, NULL, 0),
                (3, 1, '2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z', 3600, '2026-01-01', NULL, 1.0, NULL, 0),
                (4, 1, '2026-01-01T13:00:00Z', '2026-01-01T14:00:00Z', 3600, '2026-01-01', 10,   1.0, NULL, 1);
             INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id) VALUES
                (1, 1, '2026-01-01', 'a.txt', 1800, '2026-01-01T08:00:00Z', '2026-01-01T08:30:00Z', 10),
                (2, 1, '2026-01-01', 'b.txt', 2400, '2026-01-01T12:10:00Z', '2026-01-01T12:50:00Z', 10);",
        )
        .expect("seed data");
    ensure_session_project_cache_all(&conn).expect("build cache");

    let sql = format!(
        "{SESSION_PROJECT_CTE_ALL_TIME}
             SELECT COUNT(*) FROM session_projects sp
             JOIN sessions s ON s.id = sp.id
             JOIN applications a ON a.id = s.app_id
             WHERE sp.project_id = ?1"
    );
    let count: i64 = conn
        .query_row(&sql, [10_i64], |row| row.get(0))
        .expect("query count");

    // Session 2 counts (explicit project), Session 3 counts (overlap with project 10),
    // Session 1 does not count (same day but no overlap), Session 4 is hidden.
    assert_eq!(count, 2);
}

#[test]
fn analyze_session_projects_fallback_uses_overlap_not_full_day_activity() {
    let conn = setup_conn();
    conn.execute(
        "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
        rusqlite::params![
            91_i64,
            1_i64,
            "2026-01-01T10:00:00Z",
            "2026-01-01T11:00:00Z",
            3600_i64,
            "2026-01-01",
        ],
    )
    .expect("insert session");
    conn.execute_batch(
        "INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id) VALUES
            (1, 1, '2026-01-01', 'alpha.rs', 600, '2026-01-01T10:10:00Z', '2026-01-01T10:20:00Z', 10),
            (2, 1, '2026-01-01', 'beta.rs', 10800, '2026-01-01T13:00:00Z', '2026-01-01T16:00:00Z', 20);",
    )
    .expect("insert file activities");

    let analysis =
        analyze_session_projects_sync(&conn, 91_i64, 0.2, 5).expect("analyze session projects");
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.candidates[0].project_id, 10);
    assert!(!analysis
        .candidates
        .iter()
        .any(|candidate| candidate.project_id == 20));
}

#[test]
fn split_single_updates_feedback_files_and_duration_consistently() {
    let mut conn = setup_conn();
    conn.execute(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, ?7, 0)",
            rusqlite::params![
                1_i64,
                1_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T11:00:00Z",
                3600_i64,
                "2026-01-01",
                "Work block",
            ],
        )
        .expect("insert source session");
    conn.execute_batch(
            "INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id) VALUES
                (1, 1, '2026-01-01', 'a.rs', 600, '2026-01-01T10:05:00Z', '2026-01-01T10:20:00Z', NULL),
                (2, 1, '2026-01-01', 'b.rs', 600, '2026-01-01T10:40:00Z', '2026-01-01T10:55:00Z', NULL);",
        )
        .expect("insert file activities");

    let source = load_split_source_session(&conn, 1_i64, false).expect("load split source");
    let splits = vec![
        SplitPart {
            project_id: Some(10),
            ratio: 0.5,
        },
        SplitPart {
            project_id: Some(20),
            ratio: 0.5,
        },
    ];
    execute_session_split(&mut conn, 1_i64, &source, splits.as_slice()).expect("run split");

    let (session_count, total_duration): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) FROM sessions",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read session totals");
    assert_eq!(session_count, 2);
    assert_eq!(total_duration, 3600);

    let first_end: String = conn
        .query_row("SELECT end_time FROM sessions WHERE id = 1", [], |row| {
            row.get(0)
        })
        .expect("read first end");
    let first_end_ms = parse_iso_datetime(&first_end)
        .expect("parse first end")
        .timestamp_millis();
    let expected_split_ms = parse_iso_datetime("2026-01-01T10:30:00Z")
        .expect("parse expected split")
        .timestamp_millis();
    assert_eq!(first_end_ms, expected_split_ms);

    let second_id: i64 = conn
        .query_row("SELECT id FROM sessions WHERE id <> 1 LIMIT 1", [], |row| {
            row.get(0)
        })
        .expect("read second id");
    let (second_start, second_end, second_project): (String, String, Option<i64>) = conn
        .query_row(
            "SELECT start_time, end_time, project_id FROM sessions WHERE id = ?1",
            [second_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("read second session");
    assert_eq!(
        parse_iso_datetime(&second_start)
            .expect("parse second start")
            .timestamp_millis(),
        expected_split_ms
    );
    assert_eq!(
        parse_iso_datetime(&second_end)
            .expect("parse second end")
            .timestamp_millis(),
        parse_iso_datetime("2026-01-01T11:00:00Z")
            .expect("parse expected end")
            .timestamp_millis()
    );
    assert_eq!(second_project, Some(20));

    let mut stmt = conn
        .prepare(
            "SELECT to_project_id, weight FROM assignment_feedback
                 WHERE session_id IN (?1, ?2)
                 ORDER BY session_id ASC, to_project_id ASC",
        )
        .expect("prepare feedback query");
    let rows = stmt
        .query_map(rusqlite::params![1_i64, second_id], |row| {
            Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, f64>(1)?))
        })
        .expect("query feedback rows");
    let feedback_rows: Vec<(Option<i64>, f64)> = rows
        .collect::<Result<Vec<_>, _>>()
        .expect("collect feedback rows");
    assert_eq!(
        feedback_rows,
        vec![(Some(10), 0.5_f64), (Some(20), 0.5_f64)]
    );

    let activities: Vec<Option<i64>> = conn
        .prepare("SELECT project_id FROM file_activities ORDER BY id ASC")
        .expect("prepare file activity query")
        .query_map([], |row| row.get::<_, Option<i64>>(0))
        .expect("query file activity projects")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect activity projects");
    assert_eq!(activities, vec![Some(10), Some(20)]);

    let feedback_since_train: String = conn
        .query_row(
            "SELECT value FROM assignment_model_state WHERE key = 'feedback_since_train'",
            [],
            |row| row.get(0),
        )
        .expect("read feedback_since_train");
    assert_eq!(feedback_since_train, "2");
}

#[test]
fn split_multi_preserves_total_duration_and_writes_feedback_per_part() {
    let mut conn = setup_conn();
    conn.execute(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, ?7, 0)",
            rusqlite::params![
                5_i64,
                1_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T12:00:00Z",
                7200_i64,
                "2026-01-01",
                "Long block",
            ],
        )
        .expect("insert source session");
    conn.execute_batch(
            "INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id) VALUES
                (1, 1, '2026-01-01', 'a.rs', 900, '2026-01-01T10:05:00Z', '2026-01-01T10:20:00Z', NULL),
                (2, 1, '2026-01-01', 'b.rs', 1200, '2026-01-01T10:40:00Z', '2026-01-01T11:00:00Z', NULL),
                (3, 1, '2026-01-01', 'c.rs', 1200, '2026-01-01T11:20:00Z', '2026-01-01T11:40:00Z', NULL);",
        )
        .expect("insert file activities");

    let source = load_split_source_session(&conn, 5_i64, true).expect("load split source");
    let splits = vec![
        SplitPart {
            project_id: Some(10),
            ratio: 0.25,
        },
        SplitPart {
            project_id: Some(20),
            ratio: 0.25,
        },
        SplitPart {
            project_id: Some(30),
            ratio: 0.5,
        },
    ];
    execute_session_split(&mut conn, 5_i64, &source, splits.as_slice()).expect("run split");

    let (session_count, total_duration): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) FROM sessions",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read session totals");
    assert_eq!(session_count, 3);
    assert_eq!(total_duration, 7200);

    let max_end: String = conn
        .query_row(
            "SELECT end_time FROM sessions ORDER BY end_time DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("read last end");
    assert_eq!(
        parse_iso_datetime(&max_end)
            .expect("parse max end")
            .timestamp_millis(),
        parse_iso_datetime("2026-01-01T12:00:00Z")
            .expect("parse expected end")
            .timestamp_millis()
    );

    let feedback_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assignment_feedback WHERE session_id IN (SELECT id FROM sessions)",
            [],
            |row| row.get(0),
        )
        .expect("read feedback count");
    assert_eq!(feedback_count, 3);

    let feedback_weights: Vec<f64> = conn
        .prepare("SELECT weight FROM assignment_feedback ORDER BY session_id ASC")
        .expect("prepare feedback weight query")
        .query_map([], |row| row.get::<_, f64>(0))
        .expect("query feedback weights")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect feedback weights");
    assert_eq!(feedback_weights, vec![0.25_f64, 0.25_f64, 0.5_f64]);

    let feedback_since_train: String = conn
        .query_row(
            "SELECT value FROM assignment_model_state WHERE key = 'feedback_since_train'",
            [],
            |row| row.get(0),
        )
        .expect("read feedback_since_train");
    assert_eq!(feedback_since_train, "3");

    let activities: Vec<Option<i64>> = conn
        .prepare("SELECT project_id FROM file_activities ORDER BY id ASC")
        .expect("prepare file activity query")
        .query_map([], |row| row.get::<_, Option<i64>>(0))
        .expect("query file activity projects")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect activity projects");
    assert_eq!(activities, vec![Some(10), Some(20), Some(30)]);
}

mod rebuild_tests {
    use super::super::rebuild::rebuild_sessions_conn;
    use super::setup_conn;

    fn insert_session(
        conn: &rusqlite::Connection,
        app_id: i64,
        project_id: Option<i64>,
        start: &str,
        end: &str,
        duration: i64,
    ) -> i64 {
        conn.execute(
            "INSERT INTO sessions (app_id, project_id, start_time, end_time, duration_seconds, date, rate_multiplier)
             VALUES (?1, ?2, ?3, ?4, ?5, '2026-01-05', 1.0)",
            rusqlite::params![app_id, project_id, start, end, duration],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn session_row(conn: &rusqlite::Connection, id: i64) -> (String, i64, i64) {
        conn.query_row(
            "SELECT end_time, duration_seconds, COALESCE(is_hidden, 0) FROM sessions WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap()
    }

    #[test]
    fn merging_overlapping_sessions_does_not_inflate_duration() {
        let mut conn = setup_conn();
        // A 10:00-11:00 (3600s) and B 10:30-11:30 (3600s) — union span = 5400s.
        let a = insert_session(
            &conn,
            1,
            Some(1),
            "2026-01-05T10:00:00+00:00",
            "2026-01-05T11:00:00+00:00",
            3600,
        );
        let b = insert_session(
            &conn,
            1,
            Some(1),
            "2026-01-05T10:30:00+00:00",
            "2026-01-05T11:30:00+00:00",
            3600,
        );

        rebuild_sessions_conn(&mut conn, 5).expect("rebuild");

        let (_end_a, dur_a, hidden_a) = session_row(&conn, a);
        let (_end_b, _dur_b, hidden_b) = session_row(&conn, b);
        assert_eq!(hidden_a, 0);
        assert_eq!(hidden_b, 1, "merged session must be hidden");
        assert_eq!(
            dur_a, 5400,
            "merged duration = union, not sum (7200 = old bug)"
        );
    }

    #[test]
    fn fully_contained_session_adds_zero_duration() {
        let mut conn = setup_conn();
        let a = insert_session(
            &conn,
            1,
            Some(1),
            "2026-01-05T10:00:00+00:00",
            "2026-01-05T12:00:00+00:00",
            7200,
        );
        let b = insert_session(
            &conn,
            1,
            Some(1),
            "2026-01-05T10:30:00+00:00",
            "2026-01-05T11:00:00+00:00",
            1800,
        );

        rebuild_sessions_conn(&mut conn, 5).expect("rebuild");

        let (_e, dur_a, _h) = session_row(&conn, a);
        let (_e2, _d2, hidden_b) = session_row(&conn, b);
        assert_eq!(hidden_b, 1);
        assert_eq!(dur_a, 7200, "fully contained session adds zero duration");
    }

    #[test]
    fn sessions_sorted_chronologically_not_lexicographically() {
        let mut conn = setup_conn();
        // Lexicographically "02:30+01:00" < "03:00+02:00", but chronologically
        // 03:00+02:00 (=01:00Z) is EARLIER than 02:30+01:00 (=01:30Z).
        let later = insert_session(
            &conn,
            1,
            Some(1),
            "2026-01-05T02:30:00+01:00",
            "2026-01-05T03:00:00+01:00",
            1800,
        );
        let earlier = insert_session(
            &conn,
            1,
            Some(1),
            "2026-01-05T03:00:00+02:00",
            "2026-01-05T03:30:00+02:00",
            1800,
        );

        rebuild_sessions_conn(&mut conn, 5).expect("rebuild");

        // Chronologically first (earlier, 01:00Z-01:30Z) must be the merge base:
        let (_e, dur, hidden) = session_row(&conn, earlier);
        let (_e2, _d2, hidden_later) = session_row(&conn, later);
        assert_eq!(hidden, 0, "chronologically first session survives merge");
        assert_eq!(hidden_later, 1);
        assert_eq!(dur, 3600, "01:00Z-02:00Z = 3600s");
    }

    #[test]
    fn short_sessions_are_not_deleted() {
        let mut conn = setup_conn();
        let short = insert_session(
            &conn,
            1,
            Some(1),
            "2026-01-05T10:00:00+00:00",
            "2026-01-05T10:00:10+00:00",
            10,
        );

        rebuild_sessions_conn(&mut conn, 5).expect("rebuild");

        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE id = ?1",
                [short],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "rebuild must not physically delete short sessions — min-duration filter works at read time");
    }
}

#[test]
fn apply_manual_overrides_skips_frozen_project() {
    let conn = setup_conn();

    conn.execute(
        "UPDATE projects SET frozen_at = '2026-04-13T10:00:00+02:00' WHERE id = 20",
        [],
    )
    .expect("freeze Beta");

    conn.execute(
        "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
        rusqlite::params![
            100_i64,
            1_i64,
            "2026-04-12T09:00:00+02:00",
            "2026-04-12T10:00:00+02:00",
            3600_i64,
            "2026-04-12",
        ],
    )
    .expect("insert session");

    conn.execute(
        "INSERT INTO session_manual_overrides (session_id, executable_name, start_time, end_time, project_name, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        rusqlite::params![
            100_i64,
            "editor.exe",
            "2026-04-12T09:00:00+02:00",
            "2026-04-12T10:00:00+02:00",
            "Beta",
        ],
    )
    .expect("insert override");

    let reapplied =
        super::manual_overrides::apply_manual_session_overrides(&conn).expect("apply overrides ok");

    assert_eq!(
        reapplied, 0,
        "frozen project must not be reapplied; got {}",
        reapplied
    );

    let project_id: Option<i64> = conn
        .query_row(
            "SELECT project_id FROM sessions WHERE id = 100",
            [],
            |row| row.get(0),
        )
        .expect("read session");
    assert_eq!(
        project_id, None,
        "sessions.project_id must stay NULL, got {:?}",
        project_id
    );
}

#[test]
fn apply_manual_overrides_still_works_for_active_project() {
    let conn = setup_conn();

    conn.execute(
        "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
        rusqlite::params![
            101_i64,
            1_i64,
            "2026-04-12T11:00:00+02:00",
            "2026-04-12T12:00:00+02:00",
            3600_i64,
            "2026-04-12",
        ],
    )
    .expect("insert session");

    conn.execute(
        "INSERT INTO session_manual_overrides (session_id, executable_name, start_time, end_time, project_name, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        rusqlite::params![
            101_i64,
            "editor.exe",
            "2026-04-12T11:00:00+02:00",
            "2026-04-12T12:00:00+02:00",
            "Alpha",
        ],
    )
    .expect("insert override");

    let reapplied =
        super::manual_overrides::apply_manual_session_overrides(&conn).expect("apply overrides ok");

    assert_eq!(reapplied, 1, "active project should be reapplied");

    let project_id: Option<i64> = conn
        .query_row(
            "SELECT project_id FROM sessions WHERE id = 101",
            [],
            |row| row.get(0),
        )
        .expect("read session");
    assert_eq!(
        project_id,
        Some(10),
        "session should be assigned to Alpha (id=10)"
    );
}
