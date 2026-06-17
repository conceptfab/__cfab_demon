use std::collections::{BTreeMap, HashMap, HashSet};
use tauri::AppHandle;

use super::analysis::{compute_project_activity_unique, daily_seconds_by_series};
use super::helpers::run_db_blocking;
use super::types::{
    Client, ClientAutofillResult, ClientProjectSummary, ClientSummary, DateRange, ProjectClientRow,
};
use rusqlite::OptionalExtension;

const VALID_STATUSES: [&str; 4] = ["active", "frozen", "excluded", "archived"];

/// PM's default client palette (mirrors PmClientsList DEFAULT_PALETTE) so colors
/// match the PM module exactly for clients that have no explicit stored color.
const DEFAULT_PALETTE: [&str; 20] = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4",
    "#f97316", "#14b8a6", "#a855f7", "#6366f1", "#84cc16", "#e11d48", "#0ea5e9",
    "#d946ef", "#10b981", "#f43f5e", "#7c3aed", "#eab308", "#64748b",
];

/// Groups a raw UPPERCASE client name to its base, mirroring PM's groupClients:
/// "METRO_AKCESORIA" → "METRO" when "METRO" also exists in the set.
fn group_of(raw_upper: &str, raw_set: &HashSet<String>) -> String {
    if let Some(idx) = raw_upper.find('_') {
        if idx > 0 {
            let base = &raw_upper[..idx];
            if raw_set.contains(base) {
                return base.to_string();
            }
        }
    }
    raw_upper.to_string()
}

/// PM LIVE overlay: lower(prj_full_name) → (client_group UPPER, status lower).
/// Empty when PM is not configured. Lets the panel reflect PM's real client +
/// status WITHOUT requiring a manual "Sync from PM" first.
fn load_pm_project_map(conn: &rusqlite::Connection) -> HashMap<String, (String, String)> {
    let mut out: HashMap<String, (String, String)> = HashMap::new();
    let Some(folder) = super::pm::resolve_work_folder(conn) else {
        return out;
    };
    let Ok(projects) = super::pm_manager::read_projects(&folder) else {
        return out;
    };
    let raw_set: HashSet<String> = projects
        .iter()
        .map(|p| p.prj_client.trim().to_uppercase())
        .filter(|c| !c.is_empty())
        .collect();
    for p in &projects {
        let full = p.prj_full_name.trim().to_lowercase();
        if full.is_empty() {
            continue;
        }
        let client = p.prj_client.trim().to_uppercase();
        let group = if client.is_empty() {
            String::new()
        } else {
            group_of(&client, &raw_set)
        };
        out.insert(full, (group, p.prj_status.trim().to_lowercase()));
    }
    out
}

/// PM LIVE client set: (group UPPER, color, contact), grouped + colored exactly
/// like the PM Clients tab. Empty when PM is not configured.
fn pm_client_set(conn: &rusqlite::Connection) -> Vec<(String, String, String)> {
    let Some(folder) = super::pm::resolve_work_folder(conn) else {
        return Vec::new();
    };
    let Ok(projects) = super::pm_manager::read_projects(&folder) else {
        return Vec::new();
    };
    let pm_colors = super::pm_manager::read_client_colors(&folder).unwrap_or_default();
    let raw_set: HashSet<String> = projects
        .iter()
        .map(|p| p.prj_client.trim().to_uppercase())
        .filter(|c| !c.is_empty())
        .collect();
    let mut groups: Vec<String> = raw_set
        .iter()
        .map(|r| group_of(r, &raw_set))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    groups.sort();

    let mut next_idx = 0usize;
    let mut out = Vec::new();
    for g in groups {
        let info = pm_colors.get(&g);
        let color = info
            .map(|i| i.color.clone())
            .filter(|c| !c.trim().is_empty())
            .unwrap_or_else(|| {
                let c = DEFAULT_PALETTE[next_idx % DEFAULT_PALETTE.len()].to_string();
                next_idx += 1;
                c
            });
        let contact = info.map(|i| i.contact.clone()).unwrap_or_default();
        out.push((g, color, contact));
    }
    out
}

fn map_client_row(row: &rusqlite::Row) -> rusqlite::Result<Client> {
    Ok(Client {
        id: row.get(0)?,
        name: row.get(1)?,
        contact: row.get(2)?,
        address: row.get(3)?,
        tax_id: row.get(4)?,
        currency: row.get(5)?,
        default_hourly_rate: row.get(6)?,
        color: row.get::<_, String>(7).unwrap_or_else(|_| "#38bdf8".to_string()),
        archived_at: row.get(8)?,
        created_at: row.get::<_, String>(9).unwrap_or_default(),
        updated_at: row.get::<_, String>(10).unwrap_or_default(),
    })
}

const CLIENT_COLUMNS: &str =
    "id, name, contact, address, tax_id, currency, default_hourly_rate, color, archived_at, created_at, updated_at";

fn load_client_by_id(conn: &rusqlite::Connection, id: i64) -> Result<Client, String> {
    conn.query_row(
        &format!("SELECT {} FROM clients WHERE id = ?1", CLIENT_COLUMNS),
        [id],
        map_client_row,
    )
    .map_err(|e| format!("Client not found: {}", e))
}

#[tauri::command]
pub async fn clients_list(app: AppHandle) -> Result<Vec<Client>, String> {
    run_db_blocking(app, move |conn| {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM clients ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE",
                CLIENT_COLUMNS
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_client_row)
            .map_err(|e| e.to_string())?;
        let local = rows
            .collect::<Result<Vec<Client>, _>>()
            .map_err(|e| format!("Failed to read client row: {}", e))?;

        // When PM is configured, the list IS PM's client set (consistent names +
        // colors everywhere), merged with any local metadata by name. Stale local
        // clients not in PM (derivation noise) are dropped from the view.
        let pm = pm_client_set(conn);
        if pm.is_empty() {
            return Ok(local);
        }
        let by_name: HashMap<String, &Client> =
            local.iter().map(|c| (c.name.to_lowercase(), c)).collect();
        let merged = pm
            .into_iter()
            .map(|(name, color, contact)| {
                let l = by_name.get(&name.to_lowercase());
                Client {
                    id: l.map(|c| c.id).unwrap_or(0),
                    name,
                    contact: l.and_then(|c| c.contact.clone()).or_else(|| {
                        if contact.trim().is_empty() { None } else { Some(contact) }
                    }),
                    address: l.and_then(|c| c.address.clone()),
                    tax_id: l.and_then(|c| c.tax_id.clone()),
                    currency: l.and_then(|c| c.currency.clone()),
                    default_hourly_rate: l.and_then(|c| c.default_hourly_rate),
                    color,
                    archived_at: l.and_then(|c| c.archived_at.clone()),
                    created_at: l.map(|c| c.created_at.clone()).unwrap_or_default(),
                    updated_at: l.map(|c| c.updated_at.clone()).unwrap_or_default(),
                }
            })
            .collect();
        Ok(merged)
    })
    .await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn clients_create(
    app: AppHandle,
    name: String,
    contact: Option<String>,
    address: Option<String>,
    tax_id: Option<String>,
    currency: Option<String>,
    default_hourly_rate: Option<f64>,
    color: Option<String>,
) -> Result<Client, String> {
    run_db_blocking(app, move |conn| {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("Client name is required".to_string());
        }
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM clients WHERE lower(name) = lower(?1)",
                [&name],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if exists {
            return Err("Client already exists".to_string());
        }
        let color = color.unwrap_or_else(|| "#38bdf8".to_string());
        let now = chrono::Local::now().to_rfc3339();
        conn.execute(
            "INSERT INTO clients (name, contact, address, tax_id, currency, default_hourly_rate, color, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
            rusqlite::params![name, contact, address, tax_id, currency, default_hourly_rate, color, now],
        )
        .map_err(|e| e.to_string())?;
        load_client_by_id(conn, conn.last_insert_rowid())
    })
    .await
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn clients_update(
    app: AppHandle,
    id: i64,
    name: String,
    contact: Option<String>,
    address: Option<String>,
    tax_id: Option<String>,
    currency: Option<String>,
    default_hourly_rate: Option<f64>,
    color: Option<String>,
) -> Result<Client, String> {
    run_db_blocking(app, move |conn| {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("Client name is required".to_string());
        }
        let clash: bool = conn
            .query_row(
                "SELECT 1 FROM clients WHERE lower(name) = lower(?1) AND id <> ?2",
                rusqlite::params![name, id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if clash {
            return Err("Another client already uses this name".to_string());
        }
        // Keep project links in sync when a client is renamed.
        let old_name: Option<String> = conn
            .query_row("SELECT name FROM clients WHERE id = ?1", [id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        let color = color.unwrap_or_else(|| "#38bdf8".to_string());
        conn.execute(
            "UPDATE clients SET name=?1, contact=?2, address=?3, tax_id=?4, currency=?5,
                default_hourly_rate=?6, color=?7, updated_at=datetime('now') WHERE id=?8",
            rusqlite::params![name, contact, address, tax_id, currency, default_hourly_rate, color, id],
        )
        .map_err(|e| e.to_string())?;
        if let Some(old) = old_name {
            if old != name {
                conn.execute(
                    "UPDATE projects SET client_name=?1, updated_at=datetime('now') WHERE client_name=?2",
                    rusqlite::params![name, old],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        load_client_by_id(conn, id)
    })
    .await
}

#[tauri::command]
pub async fn clients_archive(app: AppHandle, id: i64, archived: bool) -> Result<Client, String> {
    run_db_blocking(app, move |conn| {
        let archived_at = if archived {
            Some(chrono::Local::now().to_rfc3339())
        } else {
            None
        };
        conn.execute(
            "UPDATE clients SET archived_at=?1, updated_at=datetime('now') WHERE id=?2",
            rusqlite::params![archived_at, id],
        )
        .map_err(|e| e.to_string())?;
        load_client_by_id(conn, id)
    })
    .await
}

#[tauri::command]
pub async fn clients_delete(app: AppHandle, id: i64, name: String) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        // Resolve the canonical name (by id, or fall back to the provided name —
        // PM-sourced clients have id 0, so name is the reliable key).
        let resolved: Option<String> = if id > 0 {
            conn.query_row("SELECT name FROM clients WHERE id = ?1", [id], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?
        } else {
            None
        };
        let target = resolved.unwrap_or(name);
        if target.trim().is_empty() {
            return Err("Client name is required to delete".to_string());
        }
        // Unlink projects first so history is never orphaned by a hard delete.
        conn.execute(
            "UPDATE projects SET client_name=NULL, updated_at=datetime('now')
             WHERE lower(client_name)=lower(?1)",
            [&target],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM clients WHERE lower(name)=lower(?1)",
            [&target],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn project_set_client(
    app: AppHandle,
    project_id: i64,
    client_name: Option<String>,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let normalized = client_name
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty());
        conn.execute(
            "UPDATE projects SET client_name=?1, updated_at=datetime('now') WHERE id=?2",
            rusqlite::params![normalized, project_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn project_set_status(
    app: AppHandle,
    project_id: i64,
    status: String,
) -> Result<(), String> {
    if !VALID_STATUSES.contains(&status.as_str()) {
        return Err(format!("Invalid status: {}", status));
    }
    // Status is NOT a separate field — it is derived from the project's real
    // frozen_at/excluded_at, exactly like the Projects tab (the single source
    // of truth). Setting a status here drives those columns via the same
    // canonical operations used by the Projects tab.
    run_db_blocking(app, move |conn| match status.as_str() {
        "frozen" => super::projects::freeze_project_in_conn(conn, project_id),
        "excluded" | "archived" => {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE applications SET project_id = NULL WHERE project_id = ?1",
                [project_id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE projects
                 SET excluded_at = COALESCE(excluded_at, datetime('now'))
                 WHERE id = ?1",
                [project_id],
            )
            .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())
        }
        // "active": clear both excluded_at (restore + un-blacklist) and frozen_at.
        _ => {
            super::projects::restore_project_in_conn(conn, project_id)?;
            conn.execute(
                "UPDATE projects
                 SET frozen_at = NULL, unfreeze_reason = datetime('now')
                 WHERE id = ?1",
                [project_id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        }
    })
    .await
}

/// Synchronizes clients from the PM module — the SINGLE source of truth. Client
/// names are PM's `prj_client` UPPERCASED and grouped exactly like the PM Clients
/// tab; colors come from PM (`pm_clients.json`) with PM's default palette as the
/// fallback. Every project is re-mapped to its PM client by full name, and local
/// clients not present in PM are removed — so the panel stays consistent with PM.
#[tauri::command]
pub async fn clients_sync_from_pm(app: AppHandle) -> Result<ClientAutofillResult, String> {
    run_db_blocking(app, move |conn| {
        let folder = super::pm::resolve_work_folder(conn)
            .ok_or_else(|| "PM work folder is not configured".to_string())?;
        let pm_projects = super::pm_manager::read_projects(&folder)?;
        let pm_colors = super::pm_manager::read_client_colors(&folder).unwrap_or_default();

        // Grouped, uppercased client set — identical to PM's groupClients().
        let raw_set: HashSet<String> = pm_projects
            .iter()
            .map(|p| p.prj_client.trim().to_uppercase())
            .filter(|c| !c.is_empty())
            .collect();
        let mut groups: Vec<String> = raw_set
            .iter()
            .map(|r| group_of(r, &raw_set))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        groups.sort();

        // Color per group: PM stored color, else PM palette in sorted order
        // (incrementing only for groups without a stored color) — mirrors PM.
        let mut group_color: HashMap<String, String> = HashMap::new();
        let mut group_contact: HashMap<String, String> = HashMap::new();
        let mut next_idx = 0usize;
        for g in &groups {
            let info = pm_colors.get(g);
            let stored = info
                .map(|i| i.color.clone())
                .filter(|c| !c.trim().is_empty());
            let color = match stored {
                Some(c) => c,
                None => {
                    let c = DEFAULT_PALETTE[next_idx % DEFAULT_PALETTE.len()].to_string();
                    next_idx += 1;
                    c
                }
            };
            group_color.insert(g.clone(), color);
            group_contact.insert(g.clone(), info.map(|i| i.contact.clone()).unwrap_or_default());
        }

        let now = chrono::Local::now().to_rfc3339();
        let mut clients_created = 0i64;

        // Upsert PM clients (authoritative name + color + contact).
        for g in &groups {
            let color = group_color.get(g).cloned().unwrap_or_default();
            let contact = group_contact.get(g).cloned().unwrap_or_default();
            let existed: bool = conn
                .query_row("SELECT 1 FROM clients WHERE name = ?1", [g], |_| Ok(true))
                .optional()
                .map_err(|e| e.to_string())?
                .unwrap_or(false);
            if existed {
                conn.execute(
                    "UPDATE clients SET color = ?1,
                        contact = COALESCE(NULLIF(?2, ''), contact),
                        updated_at = datetime('now') WHERE name = ?3",
                    rusqlite::params![color, contact, g],
                )
                .map_err(|e| e.to_string())?;
            } else {
                let contact_opt = if contact.trim().is_empty() { None } else { Some(contact) };
                conn.execute(
                    "INSERT INTO clients (name, color, contact, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, datetime('now'))",
                    rusqlite::params![g, color, contact_opt, now],
                )
                .map_err(|e| e.to_string())?;
                clients_created += 1;
            }
        }

        // Re-map TF projects → PM client + PM status by full name. Reset client
        // first so earlier derivation assignments are wiped, then assign from PM.
        let fullname_to_group: HashMap<String, String> = pm_projects
            .iter()
            .filter_map(|p| {
                let client = p.prj_client.trim().to_uppercase();
                if client.is_empty() || p.prj_full_name.trim().is_empty() {
                    return None;
                }
                Some((p.prj_full_name.to_lowercase(), group_of(&client, &raw_set)))
            })
            .collect();
        // NOTE: project status is intentionally NOT synced from PM. PM carries no
        // meaningful per-project status (every project is "Aktywny"); the real
        // status lives in frozen_at/excluded_at and is owned by TIMEFLOW
        // (Projects tab). Only the client grouping is synced from PM.
        conn.execute(
            "UPDATE projects SET client_name = NULL, updated_at = datetime('now')
             WHERE merged_into IS NULL AND excluded_at IS NULL",
            [],
        )
        .map_err(|e| e.to_string())?;

        let mut projects_assigned = 0i64;
        {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name FROM projects WHERE merged_into IS NULL AND excluded_at IS NULL",
                )
                .map_err(|e| e.to_string())?;
            let rows: Vec<(i64, String)> = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            for (id, name) in rows {
                let key = name.to_lowercase();
                if let Some(g) = fullname_to_group.get(&key) {
                    conn.execute(
                        "UPDATE projects SET client_name = ?1, updated_at = datetime('now') WHERE id = ?2",
                        rusqlite::params![g, id],
                    )
                    .map_err(|e| e.to_string())?;
                    projects_assigned += 1;
                }
            }
        }

        // Drop local clients that are not in PM (removes earlier derivation noise).
        if !groups.is_empty() {
            let placeholders: Vec<String> =
                (1..=groups.len()).map(|i| format!("?{}", i)).collect();
            let sql = format!(
                "DELETE FROM clients WHERE name NOT IN ({})",
                placeholders.join(", ")
            );
            let params: Vec<&dyn rusqlite::types::ToSql> =
                groups.iter().map(|g| g as &dyn rusqlite::types::ToSql).collect();
            conn.execute(&sql, params.as_slice())
                .map_err(|e| e.to_string())?;
        }

        Ok(ClientAutofillResult {
            clients_created,
            projects_assigned,
        })
    })
    .await
}

#[tauri::command]
pub async fn projects_with_client(app: AppHandle) -> Result<Vec<ProjectClientRow>, String> {
    run_db_blocking(app, move |conn| {
        // Status is derived from the real frozen_at/excluded_at — identical to
        // the Projects tab (the single source of truth). Excluded projects are
        // filtered out (they leave the active list), so the panel shows
        // 'active' or 'frozen' only.
        let mut stmt = conn
            .prepare(
                "SELECT id, name, color, client_name,
                        CASE WHEN frozen_at IS NOT NULL THEN 'frozen' ELSE 'active' END
                 FROM projects
                 WHERE merged_into IS NULL AND excluded_at IS NULL
                 ORDER BY name COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ProjectClientRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get::<_, String>(2).unwrap_or_else(|_| "#64748b".to_string()),
                    client_name: row.get(3)?,
                    status: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read project row: {}", e))?;

        // Overlay PM's live client so the panel matches PM's grouping. Status is
        // NOT taken from PM — PM has no per-project status (all "Aktywny"); the
        // real status comes from frozen_at/excluded_at above (Projects tab parity).
        let pm_map = load_pm_project_map(conn);
        if !pm_map.is_empty() {
            let canonical: HashMap<String, String> = pm_map
                .values()
                .filter(|(g, _)| !g.is_empty())
                .map(|(g, _)| (g.to_lowercase(), g.clone()))
                .collect();
            for r in out.iter_mut() {
                if let Some((group, _status)) = pm_map.get(&r.name.to_lowercase()) {
                    if !group.is_empty() {
                        r.client_name = Some(group.clone());
                    }
                }
                // Normalize remaining local client variant → PM canonical.
                if let Some(cn) = r.client_name.as_ref() {
                    if let Some(canon) = canonical.get(&cn.to_lowercase()) {
                        r.client_name = Some(canon.clone());
                    }
                }
            }
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn get_clients_summary(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<ClientSummary>, String> {
    run_db_blocking(app, move |conn| {
        // Reuse the canonical estimate computation (value with rate cascade + multipliers).
        let estimate_rows = super::estimates::build_estimate_rows(conn, &date_range)?;
        let by_project: HashMap<i64, (i64, f64)> = estimate_rows
            .iter()
            .map(|r| (r.project_id, (r.seconds, r.estimated_value)))
            .collect();

        // Seed buckets from ALL PM clients (so every client appears, even with no
        // tracked time yet). Falls back to the local clients table when PM is off.
        let mut buckets: HashMap<String, ClientSummary> = HashMap::new();
        let pm_clients = pm_client_set(conn);
        if !pm_clients.is_empty() {
            for (name, color, _contact) in pm_clients {
                buckets.insert(name.clone(), empty_summary(name, color));
            }
        } else {
            let mut stmt = conn
                .prepare("SELECT name, color FROM clients WHERE archived_at IS NULL")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (name, color) = row.map_err(|e| e.to_string())?;
                buckets.insert(name.clone(), empty_summary(name, color));
            }
        }

        // Walk active (non-merged, non-excluded) projects that have a client.
        let mut stmt = conn
            .prepare(
                "SELECT id, name, color, COALESCE(client_name,''),
                        CASE WHEN frozen_at IS NOT NULL THEN 'frozen' ELSE 'active' END
                 FROM projects
                 WHERE merged_into IS NULL AND excluded_at IS NULL
                   AND client_name IS NOT NULL AND client_name <> ''",
            )
            .map_err(|e| e.to_string())?;
        let mut project_rows: Vec<(i64, String, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2).unwrap_or_else(|_| "#64748b".to_string()),
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        // Overlay PM's live client so summaries match PM's grouping. Status is
        // NOT taken from PM — it is the real frozen_at/excluded_at derived above
        // (Projects tab parity).
        let pm_map = load_pm_project_map(conn);
        if !pm_map.is_empty() {
            // Canonical name map (lower → PM group) to merge case/derivation
            // variants like "Metro" and "METRO" into ONE bucket.
            let canonical: HashMap<String, String> = pm_map
                .values()
                .filter(|(g, _)| !g.is_empty())
                .map(|(g, _)| (g.to_lowercase(), g.clone()))
                .collect();
            for row in project_rows.iter_mut() {
                if let Some((group, _status)) = pm_map.get(&row.1.to_lowercase()) {
                    if !group.is_empty() {
                        row.3 = group.clone();
                    }
                }
                // Normalize any remaining local client name to its PM canonical.
                if let Some(canon) = canonical.get(&row.3.to_lowercase()) {
                    row.3 = canon.clone();
                }
            }
        }

        // Dzienne rozbicie (do zaokrąglania per_day): per projekt oraz per klient
        // sumowane PER KALENDARZOWY DZIEŃ (spójnie z dashboardem — dzień klienta liczony
        // łącznie). Liczone tym samym silnikiem dedup co wartości w estymatach.
        let client_of_project: HashMap<i64, String> = project_rows
            .iter()
            .map(|(id, _, _, client, _)| (*id, client.clone()))
            .collect();
        let mut daily_by_project: HashMap<i64, Vec<i64>> = HashMap::new();
        let mut client_date_secs: HashMap<String, BTreeMap<String, i64>> = HashMap::new();
        {
            let (buckets_map, _totals, meta, _, _) = compute_project_activity_unique(
                conn,
                &date_range,
                false,
                true,
                None,
                Some(super::daemon::load_persisted_session_min_duration()),
                true,
            )?;
            for (series_key, daily) in daily_seconds_by_series(&buckets_map) {
                if let Some(pid) = meta.get(&series_key).and_then(|m| m.project_id) {
                    daily_by_project.insert(pid, daily);
                }
            }
            for (date, day_map) in &buckets_map {
                for (series_key, secs) in day_map {
                    let s = secs.round() as i64;
                    if s <= 0 {
                        continue;
                    }
                    let Some(pid) = meta.get(series_key).and_then(|m| m.project_id) else {
                        continue;
                    };
                    if let Some(client) = client_of_project.get(&pid) {
                        *client_date_secs
                            .entry(client.clone())
                            .or_default()
                            .entry(date.clone())
                            .or_default() += s;
                    }
                }
            }
        }

        // Project name/color resolved from the estimate rows when available.
        let meta_by_id: HashMap<i64, (String, String)> = estimate_rows
            .iter()
            .map(|r| (r.project_id, (r.project_name.clone(), r.project_color.clone())))
            .collect();

        for (project_id, project_name_raw, project_color_raw, client_name, status) in project_rows {
            let (seconds, value) = by_project.get(&project_id).copied().unwrap_or((0, 0.0));
            // Skip projects with no tracked time — they only add 0-value noise.
            if seconds <= 0 {
                continue;
            }
            // Real name/color from the projects table (estimate rows as a fallback).
            let (project_name, project_color) = meta_by_id
                .get(&project_id)
                .cloned()
                .unwrap_or((project_name_raw, project_color_raw));

            let bucket = buckets
                .entry(client_name.clone())
                .or_insert_with(|| empty_summary(client_name.clone(), "#38bdf8".to_string()));

            bucket.projects.push(ClientProjectSummary {
                project_id,
                project_name,
                project_color,
                status: status.clone(),
                seconds,
                value,
                daily_seconds: daily_by_project.get(&project_id).cloned().unwrap_or_default(),
            });
            bucket.project_count += 1;
            bucket.total_seconds += seconds;
            bucket.total_value += value;
            // Real project status (frozen_at/excluded_at derived) drives buckets:
            // active → active_value, frozen → done_value, archived → paid_value.
            // (Excluded projects are filtered out, so 'archived' is unused here.)
            match status.as_str() {
                "archived" => {
                    bucket.paid_value += value;
                    bucket.paid_seconds += seconds;
                }
                "frozen" => bucket.done_value += value,
                _ => bucket.active_value += value,
            }
        }

        // Łączny dzienny czas per klient (suma projektów w obrębie dnia).
        for (client_name, by_date) in client_date_secs {
            if let Some(bucket) = buckets.get_mut(&client_name) {
                bucket.daily_seconds = by_date.into_values().collect();
            }
        }

        let mut out: Vec<ClientSummary> = buckets.into_values().collect();
        out.sort_by(|a, b| {
            b.total_value
                .total_cmp(&a.total_value)
                .then_with(|| a.client_name.to_lowercase().cmp(&b.client_name.to_lowercase()))
        });
        Ok(out)
    })
    .await
}

fn empty_summary(client_name: String, color: String) -> ClientSummary {
    ClientSummary {
        client_name,
        color,
        projects: Vec::new(),
        project_count: 0,
        total_seconds: 0,
        total_value: 0.0,
        active_value: 0.0,
        done_value: 0.0,
        paid_value: 0.0,
        paid_seconds: 0,
        daily_seconds: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::group_of;
    use std::collections::HashSet;

    #[test]
    fn groups_client_variants_like_pm() {
        let set: HashSet<String> = ["METRO", "METRO_AKCESORIA", "PROFIL", "CFAB"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        // Variant folds into base when the base exists in the set.
        assert_eq!(group_of("METRO_AKCESORIA", &set), "METRO");
        // Plain names stay as-is.
        assert_eq!(group_of("METRO", &set), "METRO");
        assert_eq!(group_of("PROFIL", &set), "PROFIL");
        // No matching base → unchanged.
        let set2: HashSet<String> = ["YOPE_X"].iter().map(|s| s.to_string()).collect();
        assert_eq!(group_of("YOPE_X", &set2), "YOPE_X");
    }
}
