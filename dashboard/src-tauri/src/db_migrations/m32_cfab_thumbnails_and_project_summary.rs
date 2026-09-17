use rusqlite::Connection;

/// m32: CFAB thumbnails, render hours limit inclusion and project summary view.
///
/// - Adds `thumbnail_path TEXT` to `cfab_render_ack` and `cfab_render_cost` (R4, contract cfab_render: 3).
/// - Adds `include_render_in_hours_limit INTEGER NOT NULL DEFAULT 0` to `cfab_render_project_settings` (R2).
/// - Creates view `cfab_project_summary` for external Hub / inspection consumption (P2).
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    let has_thumb_ack: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('cfab_render_ack') WHERE name='thumbnail_path'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_thumb_ack {
        tx.execute_batch("ALTER TABLE cfab_render_ack ADD COLUMN thumbnail_path TEXT;")?;
    }

    let has_thumb_cost: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('cfab_render_cost') WHERE name='thumbnail_path'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_thumb_cost {
        tx.execute_batch("ALTER TABLE cfab_render_cost ADD COLUMN thumbnail_path TEXT;")?;
    }

    let has_include_render: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('cfab_render_project_settings') WHERE name='include_render_in_hours_limit'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_include_render {
        tx.execute_batch(
            "ALTER TABLE cfab_render_project_settings ADD COLUMN include_render_in_hours_limit INTEGER NOT NULL DEFAULT 0;",
        )?;
    }

    tx.execute_batch(
        "DROP VIEW IF EXISTS cfab_project_summary;
        CREATE VIEW cfab_project_summary AS
        SELECT 
            p.id AS project_id,
            p.name AS project_name,
            p.assigned_folder_path,
            p.color,
            p.client_name,
            p.hourly_rate,
            p.monthly_hours_limit AS hour_limit,
            p.frozen_at,
            p.excluded_at,
            p.merged_into,
            ROUND(
                COALESCE(SUM(s.effective_seconds), 0) / 3600.0 
                + CASE 
                    WHEN ps.include_render_in_hours_limit = 1 
                    THEN COALESCE((SELECT SUM(a.rbh * a.coefficient) FROM cfab_render_ack a WHERE a.project_id = p.id), 0.0)
                    ELSE 0.0 
                  END,
                2
            ) AS used_hours,
            CASE 
                WHEN p.monthly_hours_limit IS NULL OR p.monthly_hours_limit <= 0 THEN 'normal'
                WHEN (
                    COALESCE(SUM(s.effective_seconds), 0) / 3600.0 
                    + CASE 
                        WHEN ps.include_render_in_hours_limit = 1 
                        THEN COALESCE((SELECT SUM(a.rbh * a.coefficient) FROM cfab_render_ack a WHERE a.project_id = p.id), 0.0) 
                        ELSE 0.0 
                      END
                ) >= p.monthly_hours_limit THEN 'exceeded_100'
                WHEN (
                    COALESCE(SUM(s.effective_seconds), 0) / 3600.0 
                    + CASE 
                        WHEN ps.include_render_in_hours_limit = 1 
                        THEN COALESCE((SELECT SUM(a.rbh * a.coefficient) FROM cfab_render_ack a WHERE a.project_id = p.id), 0.0) 
                        ELSE 0.0 
                      END
                ) >= p.monthly_hours_limit * 0.8 THEN 'warning_80'
                ELSE 'normal'
            END AS limit_status
        FROM projects p
        LEFT JOIN sessions s ON s.project_id = p.id
        LEFT JOIN cfab_render_project_settings ps ON ps.project_id = p.id
        GROUP BY p.id;",
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_m31_tables(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT DEFAULT '#38bdf8',
                hourly_rate REAL,
                client_name TEXT,
                monthly_hours_limit REAL,
                assigned_folder_path TEXT,
                frozen_at TEXT,
                excluded_at TEXT,
                merged_into TEXT
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                effective_seconds REAL DEFAULT 0
            );",
        ).unwrap();
        crate::db_migrations::m29_cfab_render::run(conn).unwrap();
        crate::db_migrations::m30_cfab_render_instance::run(conn).unwrap();
        crate::db_migrations::m31_cfab_path_index_and_manual::run(conn).unwrap();
    }

    #[test]
    fn m32_creates_summary_view_and_adds_thumbnail_columns() {
        let conn = Connection::open_in_memory().unwrap();
        setup_m31_tables(&conn);

        conn.execute(
            "INSERT INTO projects (id, name, color, client_name, monthly_hours_limit, assigned_folder_path)
             VALUES (1, 'VFX Project', '#ff0055', 'Big Studio', 10.0, '/work/vfx')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO sessions (project_id, effective_seconds) VALUES (1, 3600 * 8.5)",
            [],
        ).unwrap();

        run(&conn).expect("m32 migration should succeed");

        let (name, limit_status, used_hours): (String, String, f64) = conn
            .query_row(
                "SELECT project_name, limit_status, used_hours FROM cfab_project_summary WHERE project_id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();

        assert_eq!(name, "VFX Project");
        assert_eq!(limit_status, "warning_80");
        assert_eq!(used_hours, 8.5);
    }
}
