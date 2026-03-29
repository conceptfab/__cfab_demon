CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#38bdf8',
    hourly_rate REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    excluded_at TEXT,
    assigned_folder_path TEXT,
    frozen_at TEXT,
    unfreeze_reason TEXT,
    is_imported INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_name_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_name_blacklist_name_key
ON project_name_blacklist(name_key);

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_block_insert
BEFORE INSERT ON projects
FOR EACH ROW
WHEN NEW.excluded_at IS NULL
 AND trim(NEW.name) <> ''
 AND EXISTS (
    SELECT 1
    FROM project_name_blacklist b
    WHERE b.name_key = lower(trim(NEW.name))
 )
BEGIN
    SELECT RAISE(ABORT, 'Project name is blacklisted');
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_block_update
BEFORE UPDATE OF name, excluded_at ON projects
FOR EACH ROW
WHEN NEW.excluded_at IS NULL
 AND trim(NEW.name) <> ''
 AND EXISTS (
    SELECT 1
    FROM project_name_blacklist b
    WHERE b.name_key = lower(trim(NEW.name))
 )
BEGIN
    SELECT RAISE(ABORT, 'Project name is blacklisted');
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_sync_insert
AFTER INSERT ON projects
FOR EACH ROW
WHEN NEW.excluded_at IS NOT NULL AND trim(NEW.name) <> ''
BEGIN
    INSERT OR IGNORE INTO project_name_blacklist (name, name_key, created_at)
    VALUES (NEW.name, lower(trim(NEW.name)), COALESCE(NEW.excluded_at, datetime('now')));
    UPDATE project_name_blacklist
    SET name = NEW.name
    WHERE name_key = lower(trim(NEW.name));
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_sync_exclude
AFTER UPDATE OF excluded_at ON projects
FOR EACH ROW
WHEN NEW.excluded_at IS NOT NULL AND trim(NEW.name) <> ''
BEGIN
    INSERT OR IGNORE INTO project_name_blacklist (name, name_key, created_at)
    VALUES (NEW.name, lower(trim(NEW.name)), COALESCE(NEW.excluded_at, datetime('now')));
    UPDATE project_name_blacklist
    SET name = NEW.name
    WHERE name_key = lower(trim(NEW.name));
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_sync_restore
AFTER UPDATE OF excluded_at ON projects
FOR EACH ROW
WHEN OLD.excluded_at IS NOT NULL AND NEW.excluded_at IS NULL AND trim(NEW.name) <> ''
BEGIN
    DELETE FROM project_name_blacklist
    WHERE name_key = lower(trim(NEW.name));
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_sync_delete
AFTER DELETE ON projects
FOR EACH ROW
WHEN OLD.excluded_at IS NOT NULL AND trim(OLD.name) <> ''
BEGIN
    DELETE FROM project_name_blacklist
    WHERE name_key = lower(trim(OLD.name));
END;

CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    executable_name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    project_id INTEGER,
    color TEXT DEFAULT NULL,
    is_imported INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TRIGGER IF NOT EXISTS trg_applications_updated_at
AFTER UPDATE OF executable_name, display_name, project_id, is_imported
ON applications
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE applications SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_applications_updated_at_insert
AFTER INSERT ON applications
FOR EACH ROW
WHEN NEW.updated_at = '1970-01-01 00:00:00' OR NEW.updated_at IS NULL
BEGIN
    UPDATE applications SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS monitored_apps (
    exe_name TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    date TEXT NOT NULL,
    rate_multiplier REAL NOT NULL DEFAULT 1.0,
    split_source_session_id INTEGER,
    project_id INTEGER,
    updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
    FOREIGN KEY (app_id) REFERENCES applications(id),
    FOREIGN KEY (split_source_session_id) REFERENCES sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    UNIQUE(app_id, start_time)
);

CREATE TRIGGER IF NOT EXISTS trg_sessions_updated_at
AFTER UPDATE OF app_id, start_time, end_time, duration_seconds, date,
               rate_multiplier, project_id, split_source_session_id, comment
ON sessions
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE sessions SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sessions_updated_at_insert
AFTER INSERT ON sessions
FOR EACH ROW
WHEN NEW.updated_at = '1970-01-01 00:00:00' OR NEW.updated_at IS NULL
BEGIN
    UPDATE sessions SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS file_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    total_seconds INTEGER NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    project_id INTEGER,
    window_title TEXT,
    detected_path TEXT,
    title_history TEXT,
    activity_type TEXT,
    FOREIGN KEY (app_id) REFERENCES applications(id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    UNIQUE(app_id, date, file_path)
);

CREATE TABLE IF NOT EXISTS imported_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    records_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_manual_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    executable_name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    project_name TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(executable_name, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS idx_sessions_app_id ON sessions(app_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_app_date ON sessions(app_id, date, start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_applications_project_id ON applications(project_id);
CREATE INDEX IF NOT EXISTS idx_file_activities_app_date_overlap
ON file_activities(app_id, date, last_seen, first_seen);
CREATE INDEX IF NOT EXISTS idx_file_activities_project_id ON file_activities(project_id);
CREATE INDEX IF NOT EXISTS idx_session_manual_overrides_lookup
ON session_manual_overrides(executable_name, start_time, end_time);

CREATE TABLE IF NOT EXISTS session_project_cache (
    session_id INTEGER PRIMARY KEY,
    session_date TEXT NOT NULL,
    app_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    project_id INTEGER,
    multiplier REAL NOT NULL,
    duration_seconds REAL NOT NULL,
    comment TEXT,
    built_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_session_project_cache_date
ON session_project_cache(session_date);
CREATE INDEX IF NOT EXISTS idx_session_project_cache_project_date
ON session_project_cache(project_id, session_date);

CREATE TABLE IF NOT EXISTS session_project_cache_dirty (
    date TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS trg_sessions_cache_dirty_insert
AFTER INSERT ON sessions
FOR EACH ROW
BEGIN
    INSERT INTO session_project_cache_dirty (date, updated_at)
    VALUES (NEW.date, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS trg_sessions_cache_dirty_update
AFTER UPDATE ON sessions
FOR EACH ROW
BEGIN
    INSERT INTO session_project_cache_dirty (date, updated_at)
    VALUES (OLD.date, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
    INSERT INTO session_project_cache_dirty (date, updated_at)
    VALUES (NEW.date, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS trg_sessions_cache_dirty_delete
AFTER DELETE ON sessions
FOR EACH ROW
BEGIN
    INSERT INTO session_project_cache_dirty (date, updated_at)
    VALUES (OLD.date, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS trg_file_activities_cache_dirty_insert
AFTER INSERT ON file_activities
FOR EACH ROW
BEGIN
    INSERT INTO session_project_cache_dirty (date, updated_at)
    VALUES (NEW.date, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS trg_file_activities_cache_dirty_update
AFTER UPDATE ON file_activities
FOR EACH ROW
BEGIN
    INSERT INTO session_project_cache_dirty (date, updated_at)
    VALUES (OLD.date, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
    INSERT INTO session_project_cache_dirty (date, updated_at)
    VALUES (NEW.date, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS trg_file_activities_cache_dirty_delete
AFTER DELETE ON file_activities
FOR EACH ROW
BEGIN
    INSERT INTO session_project_cache_dirty (date, updated_at)
    VALUES (OLD.date, CURRENT_TIMESTAMP)
    ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
END;

CREATE TABLE IF NOT EXISTS assignment_model_app (
    app_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    cnt INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (app_id, project_id)
);

CREATE TABLE IF NOT EXISTS assignment_model_token (
    token TEXT NOT NULL,
    project_id INTEGER NOT NULL,
    cnt INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (token, project_id)
);

CREATE TABLE IF NOT EXISTS assignment_model_time (
    app_id INTEGER NOT NULL,
    hour_bucket INTEGER NOT NULL,
    weekday INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    cnt INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (app_id, hour_bucket, weekday, project_id)
);

CREATE TABLE IF NOT EXISTS assignment_model_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS estimate_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    suggested_project_id INTEGER NOT NULL,
    suggested_confidence REAL NOT NULL,
    suggested_evidence_count INTEGER NOT NULL,
    model_version TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id INTEGER,
    session_id INTEGER,
    app_id INTEGER,
    from_project_id INTEGER,
    to_project_id INTEGER,
    source TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_auto_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    mode TEXT NOT NULL,
    min_confidence_auto REAL NOT NULL,
    min_evidence_auto INTEGER NOT NULL,
    sessions_scanned INTEGER NOT NULL DEFAULT 0,
    sessions_suggested INTEGER NOT NULL DEFAULT 0,
    sessions_assigned INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    rolled_back_at TEXT,
    rollback_reverted INTEGER NOT NULL DEFAULT 0,
    rollback_skipped INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assignment_auto_run_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    from_project_id INTEGER,
    to_project_id INTEGER NOT NULL,
    suggestion_id INTEGER,
    confidence REAL NOT NULL,
    evidence_count INTEGER NOT NULL,
    applied_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES assignment_auto_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assignment_model_app_app ON assignment_model_app(app_id);
CREATE INDEX IF NOT EXISTS idx_assignment_model_token_token ON assignment_model_token(token);
CREATE INDEX IF NOT EXISTS idx_assignment_model_time_key ON assignment_model_time(app_id, hour_bucket, weekday);
CREATE INDEX IF NOT EXISTS idx_assignment_feedback_created ON assignment_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_assignment_feedback_source ON assignment_feedback(source);
CREATE INDEX IF NOT EXISTS idx_assignment_feedback_session ON assignment_feedback(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_suggestions_session ON assignment_suggestions(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_suggestions_status ON assignment_suggestions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_assignment_auto_runs_started ON assignment_auto_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_auto_runs_rollback ON assignment_auto_runs(rolled_back_at);
CREATE INDEX IF NOT EXISTS idx_assignment_auto_run_items_run ON assignment_auto_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_assignment_auto_run_items_session ON assignment_auto_run_items(session_id);

CREATE TABLE IF NOT EXISTS manual_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    session_type TEXT NOT NULL,
    project_id INTEGER NOT NULL,
    app_id INTEGER,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    date TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, start_time, title)
);

CREATE TABLE IF NOT EXISTS tombstones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    record_id INTEGER,
    record_uuid TEXT, -- For future proofing if we move to UUIDs
    deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_key TEXT -- app_id + start_time or project name
);

CREATE INDEX IF NOT EXISTS idx_tombstones_sync_key ON tombstones(sync_key);

CREATE TRIGGER IF NOT EXISTS trg_projects_tombstone
AFTER DELETE ON projects
FOR EACH ROW
BEGIN
    INSERT INTO tombstones (table_name, record_id, sync_key)
    VALUES ('projects', OLD.id, OLD.name);
END;

CREATE TRIGGER IF NOT EXISTS trg_manual_sessions_tombstone
AFTER DELETE ON manual_sessions
FOR EACH ROW
BEGIN
    INSERT INTO tombstones (table_name, record_id, sync_key)
    VALUES ('manual_sessions', OLD.id, OLD.project_id || '|' || OLD.start_time || '|' || OLD.title);
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_updated_at
AFTER UPDATE ON projects
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_manual_sessions_updated_at
AFTER UPDATE ON manual_sessions
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE manual_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
