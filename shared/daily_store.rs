mod legacy;
mod read;
mod schema;
mod types;
mod write;

pub(crate) use types::{dedupe_files_preserving_last, detected_path_key};
pub use legacy::{load_legacy_json_file, migrate_legacy_json_files};
pub use read::{get_day_signature, load_day_snapshot, load_range_snapshots};
pub use schema::{ensure_schema, open_store, store_db_path};
pub use types::{DaySignature, StoredAppDailyData, StoredDailyData, StoredFileEntry, StoredSession};
pub use write::replace_day_snapshot;
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use rusqlite::Connection;
    use std::collections::{BTreeMap, BTreeSet};

    #[test]
    fn replace_and_load_day_snapshot_roundtrip() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let snapshot = StoredDailyData {
            date: "2026-03-08".to_string(),
            generated_at: "2026-03-08T12:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 123,
                    sessions: vec![StoredSession {
                        start: "2026-03-08T10:00:00+00:00".to_string(),
                        end: "2026-03-08T10:02:03+00:00".to_string(),
                        duration_seconds: 123,
                    }],
                    files: vec![StoredFileEntry {
                        name: "project-a".to_string(),
                        total_seconds: 123,
                        first_seen: "2026-03-08T10:00:00+00:00".to_string(),
                        last_seen: "2026-03-08T10:02:03+00:00".to_string(),
                        window_title: "project-a".to_string(),
                        detected_path: Some("C:/repo/project-a".to_string()),
                        title_history: vec!["project-a".to_string()],
                        activity_type: Some("coding".to_string()),
                    }],
                },
            )]),
        };

        let signature = replace_day_snapshot(&mut conn, &snapshot).expect("save");
        assert_eq!(signature.revision, 1);

        let loaded = load_day_snapshot(&conn, "2026-03-08")
            .expect("load")
            .expect("snapshot should exist");
        assert_eq!(loaded, snapshot);

        let signature_again = get_day_signature(&conn, "2026-03-08")
            .expect("signature")
            .expect("signature should exist");
        assert_eq!(signature_again.revision, 1);
        assert!(signature_again.updated_unix_ms > 0);
    }

    #[test]
    fn range_query_returns_snapshots_in_date_order() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let day_one = StoredDailyData {
            date: "2026-03-07".to_string(),
            generated_at: "2026-03-07T08:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 120,
                    sessions: vec![StoredSession {
                        start: "2026-03-07T08:00:00+00:00".to_string(),
                        end: "2026-03-07T08:02:00+00:00".to_string(),
                        duration_seconds: 120,
                    }],
                    files: vec![StoredFileEntry {
                        name: "client".to_string(),
                        total_seconds: 120,
                        first_seen: "2026-03-07T08:00:00+00:00".to_string(),
                        last_seen: "2026-03-07T08:02:00+00:00".to_string(),
                        window_title: "TIMEFLOW".to_string(),
                        detected_path: Some("C:/repo/client".to_string()),
                        title_history: vec!["TIMEFLOW".to_string()],
                        activity_type: Some("coding".to_string()),
                    }],
                },
            )]),
        };
        let day_two = StoredDailyData {
            date: "2026-03-08".to_string(),
            generated_at: "2026-03-08T09:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "figma.exe".to_string(),
                StoredAppDailyData {
                    display_name: "Figma".to_string(),
                    total_seconds: 300,
                    sessions: vec![StoredSession {
                        start: "2026-03-08T09:00:00+00:00".to_string(),
                        end: "2026-03-08T09:05:00+00:00".to_string(),
                        duration_seconds: 300,
                    }],
                    files: vec![StoredFileEntry {
                        name: "design.fig".to_string(),
                        total_seconds: 300,
                        first_seen: "2026-03-08T09:00:00+00:00".to_string(),
                        last_seen: "2026-03-08T09:05:00+00:00".to_string(),
                        window_title: "Design".to_string(),
                        detected_path: Some("C:/repo/design.fig".to_string()),
                        title_history: vec!["Design".to_string()],
                        activity_type: Some("design".to_string()),
                    }],
                },
            )]),
        };

        for snapshot in [day_one.clone(), day_two.clone()] {
            replace_day_snapshot(&mut conn, &snapshot).expect("save");
        }

        let snapshots =
            load_range_snapshots(&conn, "2026-03-07", "2026-03-08").expect("range load");
        assert_eq!(
            snapshots.keys().cloned().collect::<Vec<_>>(),
            vec!["2026-03-07".to_string(), "2026-03-08".to_string()]
        );
        assert_eq!(snapshots.get("2026-03-07"), Some(&day_one));
        assert_eq!(snapshots.get("2026-03-08"), Some(&day_two));
    }

    #[test]
    fn replace_day_snapshot_updates_existing_rows_without_recreating_whole_day() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let initial = StoredDailyData {
            date: "2026-03-09".to_string(),
            generated_at: "2026-03-09T10:00:00+00:00".to_string(),
            apps: BTreeMap::from([
                (
                    "code.exe".to_string(),
                    StoredAppDailyData {
                        display_name: "VS Code".to_string(),
                        total_seconds: 300,
                        sessions: vec![
                            StoredSession {
                                start: "2026-03-09T10:00:00+00:00".to_string(),
                                end: "2026-03-09T10:03:00+00:00".to_string(),
                                duration_seconds: 180,
                            },
                            StoredSession {
                                start: "2026-03-09T10:05:00+00:00".to_string(),
                                end: "2026-03-09T10:07:00+00:00".to_string(),
                                duration_seconds: 120,
                            },
                        ],
                        files: vec![
                            StoredFileEntry {
                                name: "client".to_string(),
                                total_seconds: 180,
                                first_seen: "2026-03-09T10:00:00+00:00".to_string(),
                                last_seen: "2026-03-09T10:03:00+00:00".to_string(),
                                window_title: "Client".to_string(),
                                detected_path: Some("C:/repo/client".to_string()),
                                title_history: vec!["Client".to_string()],
                                activity_type: Some("coding".to_string()),
                            },
                            StoredFileEntry {
                                name: "server".to_string(),
                                total_seconds: 120,
                                first_seen: "2026-03-09T10:05:00+00:00".to_string(),
                                last_seen: "2026-03-09T10:07:00+00:00".to_string(),
                                window_title: "Server".to_string(),
                                detected_path: Some("C:/repo/server".to_string()),
                                title_history: vec!["Server".to_string()],
                                activity_type: Some("coding".to_string()),
                            },
                        ],
                    },
                ),
                (
                    "slack.exe".to_string(),
                    StoredAppDailyData {
                        display_name: "Slack".to_string(),
                        total_seconds: 60,
                        sessions: vec![StoredSession {
                            start: "2026-03-09T11:00:00+00:00".to_string(),
                            end: "2026-03-09T11:01:00+00:00".to_string(),
                            duration_seconds: 60,
                        }],
                        files: vec![StoredFileEntry {
                            name: "general".to_string(),
                            total_seconds: 60,
                            first_seen: "2026-03-09T11:00:00+00:00".to_string(),
                            last_seen: "2026-03-09T11:01:00+00:00".to_string(),
                            window_title: "general".to_string(),
                            detected_path: None,
                            title_history: vec!["general".to_string()],
                            activity_type: Some("communication".to_string()),
                        }],
                    },
                ),
            ]),
        };

        let updated = StoredDailyData {
            date: "2026-03-09".to_string(),
            generated_at: "2026-03-09T12:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code Insiders".to_string(),
                    total_seconds: 240,
                    sessions: vec![StoredSession {
                        start: "2026-03-09T12:00:00+00:00".to_string(),
                        end: "2026-03-09T12:04:00+00:00".to_string(),
                        duration_seconds: 240,
                    }],
                    files: vec![StoredFileEntry {
                        name: "client".to_string(),
                        total_seconds: 240,
                        first_seen: "2026-03-09T12:00:00+00:00".to_string(),
                        last_seen: "2026-03-09T12:04:00+00:00".to_string(),
                        window_title: "Client Updated".to_string(),
                        detected_path: Some("C:/repo/client-new".to_string()),
                        title_history: vec!["Client Updated".to_string()],
                        activity_type: Some("coding".to_string()),
                    }],
                },
            )]),
        };

        let initial_signature = replace_day_snapshot(&mut conn, &initial).expect("initial save");
        let updated_signature = replace_day_snapshot(&mut conn, &updated).expect("updated save");

        assert_eq!(updated_signature.revision, initial_signature.revision + 1);

        let loaded = load_day_snapshot(&conn, "2026-03-09")
            .expect("load")
            .expect("snapshot should exist");
        assert_eq!(loaded, updated);

        let app_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_apps WHERE date = '2026-03-09'",
                [],
                |row| row.get(0),
            )
            .expect("app count");
        let session_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_sessions WHERE date = '2026-03-09'",
                [],
                |row| row.get(0),
            )
            .expect("session count");
        let file_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_files WHERE date = '2026-03-09'",
                [],
                |row| row.get(0),
            )
            .expect("file count");

        assert_eq!(app_count, 1);
        assert_eq!(session_count, 1);
        assert_eq!(file_count, 1);
    }

    #[test]
    fn replace_day_snapshot_keeps_only_last_duplicate_file_entry() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let snapshot = StoredDailyData {
            date: "2026-03-10".to_string(),
            generated_at: "2026-03-10T12:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 300,
                    sessions: vec![],
                    files: vec![
                        StoredFileEntry {
                            name: "client".to_string(),
                            total_seconds: 120,
                            first_seen: "2026-03-10T10:00:00+00:00".to_string(),
                            last_seen: "2026-03-10T10:02:00+00:00".to_string(),
                            window_title: "Client old".to_string(),
                            detected_path: Some("C:/repo/client".to_string()),
                            title_history: vec!["Client old".to_string()],
                            activity_type: Some("coding".to_string()),
                        },
                        StoredFileEntry {
                            name: "client".to_string(),
                            total_seconds: 180,
                            first_seen: "2026-03-10T10:03:00+00:00".to_string(),
                            last_seen: "2026-03-10T10:06:00+00:00".to_string(),
                            window_title: "Client new".to_string(),
                            detected_path: Some("C:/repo/client".to_string()),
                            title_history: vec!["Client new".to_string()],
                            activity_type: Some("coding".to_string()),
                        },
                    ],
                },
            )]),
        };

        replace_day_snapshot(&mut conn, &snapshot).expect("save");

        let loaded = load_day_snapshot(&conn, "2026-03-10")
            .expect("load")
            .expect("snapshot should exist");
        let files = &loaded.apps.get("code.exe").expect("app should exist").files;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "client");
        assert_eq!(files[0].window_title, "Client new");
        assert_eq!(files[0].detected_path.as_deref(), Some("C:/repo/client"));

        let file_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_files WHERE date = '2026-03-10' AND exe_name = 'code.exe'",
                [],
                |row| row.get(0),
            )
            .expect("file count");
        assert_eq!(file_count, 1);
    }

    #[test]
    fn replace_day_snapshot_keeps_same_name_files_with_different_detected_paths() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let snapshot = StoredDailyData {
            date: "2026-03-11".to_string(),
            generated_at: "2026-03-11T12:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 300,
                    sessions: vec![],
                    files: vec![
                        StoredFileEntry {
                            name: "index.ts".to_string(),
                            total_seconds: 120,
                            first_seen: "2026-03-11T10:00:00+00:00".to_string(),
                            last_seen: "2026-03-11T10:02:00+00:00".to_string(),
                            window_title: "Repo A".to_string(),
                            detected_path: Some("C:/repo-a/src/index.ts".to_string()),
                            title_history: vec!["Repo A".to_string()],
                            activity_type: Some("coding".to_string()),
                        },
                        StoredFileEntry {
                            name: "index.ts".to_string(),
                            total_seconds: 180,
                            first_seen: "2026-03-11T10:03:00+00:00".to_string(),
                            last_seen: "2026-03-11T10:06:00+00:00".to_string(),
                            window_title: "Repo B".to_string(),
                            detected_path: Some("C:/repo-b/src/index.ts".to_string()),
                            title_history: vec!["Repo B".to_string()],
                            activity_type: Some("coding".to_string()),
                        },
                    ],
                },
            )]),
        };

        replace_day_snapshot(&mut conn, &snapshot).expect("save");

        let loaded = load_day_snapshot(&conn, "2026-03-11")
            .expect("load")
            .expect("snapshot should exist");
        let files = &loaded.apps.get("code.exe").expect("app should exist").files;
        assert_eq!(files.len(), 2);
        assert_eq!(
            files
                .iter()
                .filter_map(|file| file.detected_path.as_deref())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["C:/repo-a/src/index.ts", "C:/repo-b/src/index.ts"])
        );

        let file_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_files WHERE date = '2026-03-11' AND exe_name = 'code.exe'",
                [],
                |row| row.get(0),
        )
        .expect("file count");
        assert_eq!(file_count, 2);
    }

    #[test]
    fn replace_day_snapshot_removes_all_files_when_app_file_list_becomes_empty() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let initial = StoredDailyData {
            date: "2026-03-12".to_string(),
            generated_at: "2026-03-12T12:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 180,
                    sessions: vec![StoredSession {
                        start: "2026-03-12T10:00:00+00:00".to_string(),
                        end: "2026-03-12T10:03:00+00:00".to_string(),
                        duration_seconds: 180,
                    }],
                    files: vec![StoredFileEntry {
                        name: "client".to_string(),
                        total_seconds: 180,
                        first_seen: "2026-03-12T10:00:00+00:00".to_string(),
                        last_seen: "2026-03-12T10:03:00+00:00".to_string(),
                        window_title: "Client".to_string(),
                        detected_path: Some("C:/repo/client".to_string()),
                        title_history: vec!["Client".to_string()],
                        activity_type: Some("coding".to_string()),
                    }],
                },
            )]),
        };

        let updated = StoredDailyData {
            date: "2026-03-12".to_string(),
            generated_at: "2026-03-12T13:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 60,
                    sessions: vec![StoredSession {
                        start: "2026-03-12T13:00:00+00:00".to_string(),
                        end: "2026-03-12T13:01:00+00:00".to_string(),
                        duration_seconds: 60,
                    }],
                    files: vec![],
                },
            )]),
        };

        replace_day_snapshot(&mut conn, &initial).expect("initial save");
        replace_day_snapshot(&mut conn, &updated).expect("updated save");

        let loaded = load_day_snapshot(&conn, "2026-03-12")
            .expect("load")
            .expect("snapshot should exist");
        let app = loaded.apps.get("code.exe").expect("app should exist");
        assert!(app.files.is_empty());

        let file_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_files WHERE date = '2026-03-12' AND exe_name = 'code.exe'",
                [],
                |row| row.get(0),
            )
            .expect("file count");
        assert_eq!(file_count, 0);
    }

    #[test]
    fn ensure_schema_migrates_legacy_daily_files_primary_key_to_detected_path() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            "CREATE TABLE daily_snapshots (
                 date TEXT PRIMARY KEY,
                 generated_at TEXT NOT NULL DEFAULT '',
                 updated_unix_ms INTEGER NOT NULL DEFAULT 0,
                 revision INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE daily_apps (
                 date TEXT NOT NULL,
                 exe_name TEXT NOT NULL,
                 display_name TEXT NOT NULL,
                 total_seconds INTEGER NOT NULL DEFAULT 0,
                 PRIMARY KEY (date, exe_name),
                 FOREIGN KEY (date) REFERENCES daily_snapshots(date) ON DELETE CASCADE
             );
             CREATE TABLE daily_files (
                 date TEXT NOT NULL,
                 exe_name TEXT NOT NULL,
                 file_name TEXT NOT NULL,
                 ordinal INTEGER NOT NULL,
                 total_seconds INTEGER NOT NULL DEFAULT 0,
                 first_seen TEXT NOT NULL,
                 last_seen TEXT NOT NULL,
                 window_title TEXT NOT NULL DEFAULT '',
                 detected_path TEXT,
                 title_history_json TEXT NOT NULL DEFAULT '[]',
                 activity_type TEXT,
                 PRIMARY KEY (date, exe_name, file_name),
                 FOREIGN KEY (date, exe_name) REFERENCES daily_apps(date, exe_name) ON DELETE CASCADE
             );",
        )
        .expect("legacy schema");
        conn.execute(
            "INSERT INTO daily_snapshots (date, generated_at, updated_unix_ms, revision)
             VALUES (?1, ?2, ?3, ?4)",
            params!["2026-03-12", "2026-03-12T12:00:00+00:00", 1u64, 1u64],
        )
        .expect("snapshot row");
        conn.execute(
            "INSERT INTO daily_apps (date, exe_name, display_name, total_seconds)
             VALUES (?1, ?2, ?3, ?4)",
            params!["2026-03-12", "code.exe", "VS Code", 60u64],
        )
        .expect("app row");
        conn.execute(
            "INSERT INTO daily_files (
                 date, exe_name, file_name, ordinal, total_seconds, first_seen, last_seen,
                 window_title, detected_path, title_history_json, activity_type
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)",
            params![
                "2026-03-12",
                "code.exe",
                "index.ts",
                0i64,
                60u64,
                "2026-03-12T10:00:00+00:00",
                "2026-03-12T10:01:00+00:00",
                "Client",
                "[]",
                "coding"
            ],
        )
        .expect("file row");

        ensure_schema(&conn).expect("migrated schema");

        let detected_path_column: (i64, i64, String) = conn
            .query_row(
                "SELECT pk, [notnull], COALESCE(dflt_value, '')
                 FROM pragma_table_info('daily_files')
                 WHERE name = 'detected_path'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("detected_path column");
        assert_eq!(detected_path_column.0, 4);
        assert_eq!(detected_path_column.1, 1);
        assert_eq!(detected_path_column.2, "''");

        let stored_path: String = conn
            .query_row(
                "SELECT detected_path FROM daily_files
                 WHERE date = '2026-03-12' AND exe_name = 'code.exe' AND file_name = 'index.ts'",
                [],
                |row| row.get(0),
            )
            .expect("stored detected_path");
        assert_eq!(stored_path, "");

        let loaded = load_day_snapshot(&conn, "2026-03-12")
            .expect("load")
            .expect("snapshot should exist");
        let files = &loaded.apps.get("code.exe").expect("app should exist").files;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].detected_path, None);
    }
}

