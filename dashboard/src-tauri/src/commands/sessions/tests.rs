use crate::commands::sql_fragments::{
    ensure_session_project_cache_all, SESSION_PROJECT_CTE_ALL_TIME,
};
use crate::commands::types::SplitPart;

use super::split::{
    analyze_session_projects_sync, execute_session_split, load_split_source_session,
    parse_iso_datetime, suggest_session_split_sync,
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
                title_history TEXT
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
fn split_suggestion_fallback_reads_latest_to_project_id() {
    let conn = setup_conn();
    conn.execute(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1.0, NULL, 0)",
            rusqlite::params![
                99_i64,
                1_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T11:00:00Z",
                3600_i64,
                "2026-01-01",
                10_i64,
            ],
        )
        .expect("insert session");
    conn.execute(
            "INSERT INTO assignment_feedback (id, session_id, app_id, from_project_id, to_project_id, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                1_i64,
                99_i64,
                1_i64,
                10_i64,
                20_i64,
                "manual_session_assign",
                "2026-01-01T10:00:00Z",
            ],
        )
        .expect("insert feedback");
    conn.execute(
            "INSERT INTO assignment_feedback (id, session_id, app_id, from_project_id, to_project_id, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                2_i64,
                99_i64,
                1_i64,
                20_i64,
                30_i64,
                "manual_session_assign",
                "2026-01-01T11:00:00Z",
            ],
        )
        .expect("insert newer feedback");

    let suggested_project_id: Option<i64> = conn
        .query_row(
            "SELECT (SELECT af.to_project_id
                         FROM assignment_feedback af
                         WHERE af.session_id = sessions.id
                         ORDER BY af.created_at DESC
                         LIMIT 1)
                 FROM sessions
                 WHERE id = ?1",
            [99_i64],
            |row| row.get(0),
        )
        .expect("query suggested project");
    assert_eq!(suggested_project_id, Some(30));
}

#[test]
fn split_suggestion_uses_session_overlap_instead_of_full_day_totals() {
    let conn = setup_conn();
    conn.execute(
        "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
        rusqlite::params![
            77_i64,
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
            (1, 1, '2026-01-01', 'alpha.rs', 900, '2026-01-01T10:05:00Z', '2026-01-01T10:20:00Z', 10),
            (2, 1, '2026-01-01', 'beta.rs', 900, '2026-01-01T10:40:00Z', '2026-01-01T10:55:00Z', 20),
            (3, 1, '2026-01-01', 'gamma.rs', 21600, '2026-01-01T12:00:00Z', '2026-01-01T18:00:00Z', 30);",
    )
    .expect("insert file activities");

    let suggestion = suggest_session_split_sync(&conn, 77_i64).expect("split suggestion");
    assert_eq!(suggestion.project_a_id, Some(10));
    assert_eq!(suggestion.project_b_id, Some(20));
    assert!((suggestion.suggested_ratio - 0.5).abs() < 0.001);
}

#[test]
fn split_suggestion_uses_ai_scores_when_overlap_is_missing() {
    let conn = setup_conn();
    conn.execute(
        "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
        rusqlite::params![
            88_i64,
            1_i64,
            "2026-01-01T10:00:00Z",
            "2026-01-01T11:00:00Z",
            3600_i64,
            "2026-01-01",
        ],
    )
    .expect("insert session");
    conn.execute_batch(
        "INSERT INTO assignment_model_app (app_id, project_id, cnt, last_seen) VALUES
            (1, 10, 12, '2026-01-01T09:00:00Z'),
            (1, 20, 3, '2026-01-01T09:00:00Z');",
    )
    .expect("seed assignment model app");

    let suggestion = suggest_session_split_sync(&conn, 88_i64).expect("split suggestion");
    assert_eq!(suggestion.project_a_id, Some(10));
    assert_eq!(suggestion.project_b_id, Some(20));
    assert!(suggestion.suggested_ratio > 0.6);
    assert!(suggestion.confidence > 0.0);
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
