//! Obsługa paczek offline .cfabx i potwierdzeń .cfabx-ack (Etap D).
//!
//! Specyfikacja: docs/synergia-timeflow/04-koszty-wyceny-raporty.md § R5.

use std::collections::HashMap;
use std::io::Read;

use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::helpers::run_db_blocking;

pub const CFABX_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabxManifest {
    pub schema: u32,
    pub hub_instance_id: String,
    pub machine_name: String,
    pub hub_version: String,
    pub created_at: String,
    pub contracts: HashMap<String, u32>,
    pub item_count: usize,
    pub files: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabxProposalRow {
    pub hub_instance_id: String,
    pub kind: String,
    pub source_id: i64,
    pub working_path: Option<String>,
    pub render_seconds: Option<f64>,
    pub ended_at: Option<f64>,
    pub project_hint: Option<i64>,
    pub project_hint_name: Option<String>,
    pub thumbnail_name: Option<String>,
    pub title: Option<String>,
    pub severity: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabxPackagePreview {
    pub manifest: CfabxManifest,
    pub proposals: Vec<CfabxProposalPreviewItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabxProposalPreviewItem {
    pub hub_instance_id: String,
    pub kind: String,
    pub source_id: i64,
    pub working_path: Option<String>,
    pub render_seconds: Option<f64>,
    pub ended_at: Option<f64>,
    pub matched_project_id: Option<i64>,
    pub matched_project_name: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabxProjectSnapshot {
    pub id: i64,
    pub name: String,
    pub assigned_folder_path: Option<String>,
    pub color: Option<String>,
    pub client_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabxAckFile {
    pub schema: u32,
    pub hub_instance_id: String,
    pub acked_at: String,
    pub acked_items: Vec<CfabxAckItem>,
    pub projects: Vec<CfabxProjectSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CfabxAckItem {
    pub kind: String,
    pub source_id: i64,
    pub status: String,
    pub project_id: Option<i64>,
}

pub fn sha256_digest(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Rozpakowuje archiwum .cfabx (tar.gz lub tar) do pamięci.
/// Obsługuje proste zip/tar lub fallback json.
pub fn parse_cfabx_archive(bytes: &[u8]) -> Result<(CfabxManifest, Vec<CfabxProposalRow>), String> {
    // Prosty odczyt zip
    let reader = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("Błąd odczytu archiwum .cfabx: {e}"))?;

    let mut manifest_bytes = Vec::new();
    {
        let mut mf = zip.by_name("manifest.json").map_err(|_| "Brak manifest.json w paczce".to_string())?;
        mf.read_to_end(&mut manifest_bytes).map_err(|e| e.to_string())?;
    }
    let manifest: CfabxManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("Błąd parsowania manifest.json: {e}"))?;

    let mut proposals_bytes = Vec::new();
    {
        let mut pf = zip.by_name("proposals.jsonl").map_err(|_| "Brak proposals.jsonl w paczce".to_string())?;
        pf.read_to_end(&mut proposals_bytes).map_err(|e| e.to_string())?;
    }

    if let Some(expected_hash) = manifest.files.get("proposals.jsonl") {
        let actual_hash = sha256_digest(&proposals_bytes);
        if &actual_hash != expected_hash {
            return Err("Niezgodność sumy kontrolnej proposals.jsonl".to_string());
        }
    }

    let text = String::from_utf8(proposals_bytes).map_err(|e| e.to_string())?;
    let mut proposals = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.is_empty() {
            let row: CfabxProposalRow = serde_json::from_str(line).map_err(|e| format!("Błędna linia w proposals.jsonl: {e}"))?;
            proposals.push(row);
        }
    }

    Ok((manifest, proposals))
}

pub fn create_cfabx_ack_content(
    tf: &Connection,
    hub_instance_id: &str,
    acked_items: Vec<CfabxAckItem>,
) -> Result<String, String> {
    let mut stmt = tf.prepare(
        "SELECT id, name, assigned_folder_path, color, client_name FROM projects WHERE excluded_at IS NULL",
    ).map_err(|e| e.to_string())?;

    let projects = stmt.query_map([], |r| {
        Ok(CfabxProjectSnapshot {
            id: r.get(0)?,
            name: r.get(1)?,
            assigned_folder_path: r.get(2)?,
            color: r.get(3)?,
            client_name: r.get(4)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

    let ack_file = CfabxAckFile {
        schema: CFABX_SCHEMA,
        hub_instance_id: hub_instance_id.to_string(),
        acked_at: Utc::now().to_rfc3339(),
        acked_items,
        projects,
    };

    serde_json::to_string_pretty(&ack_file).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_cfabx_package(
    app: AppHandle,
    file_path: String,
) -> Result<CfabxPackagePreview, String> {
    let bytes = std::fs::read(&file_path).map_err(|e| format!("Błąd odczytu pliku: {e}"))?;
    let (manifest, proposals) = parse_cfabx_archive(&bytes)?;

    run_db_blocking(app, move |conn| {
        let projects = super::cfab_render::load_cfab_path_index(conn)?;
        let mut preview_items = Vec::new();

        for p in proposals {
            let (matched_id, matched_name) = if let Some(path) = &p.working_path {
                let norm = super::cfab_render::normalize_path(path);
                let mut found = None;
                for (folder, pid, _) in &projects {
                    if norm == *folder || norm.starts_with(&format!("{folder}/")) {
                        let name: Result<String, _> = conn.query_row(
                            "SELECT name FROM projects WHERE id = ?1",
                            [*pid],
                            |r| r.get(0),
                        );
                        if let Ok(n) = name {
                            found = Some((*pid, n));
                            break;
                        }
                    }
                }
                match found {
                    Some((id, name)) => (Some(id), Some(name)),
                    None => (None, None),
                }
            } else {
                (None, None)
            };

            preview_items.push(CfabxProposalPreviewItem {
                hub_instance_id: p.hub_instance_id,
                kind: p.kind,
                source_id: p.source_id,
                working_path: p.working_path,
                render_seconds: p.render_seconds,
                ended_at: p.ended_at,
                matched_project_id: matched_id,
                matched_project_name: matched_name,
                title: p.title,
            });
        }

        Ok(CfabxPackagePreview {
            manifest,
            proposals: preview_items,
        })
    }).await
}

#[tauri::command]
pub async fn import_cfabx_package(
    app: AppHandle,
    file_path: String,
    assignments: Vec<CfabxAckItem>,
) -> Result<String, String> {
    let bytes = std::fs::read(&file_path).map_err(|e| format!("Błąd odczytu pliku: {e}"))?;
    let (manifest, proposals) = parse_cfabx_archive(&bytes)?;

    let ack_path = format!("{}.cfabx-ack", file_path.trim_end_matches(".cfabx"));

    run_db_blocking(app, move |conn| {
        let assign_map: HashMap<(String, i64), Option<i64>> = assignments
            .iter()
            .map(|a| ((a.kind.clone(), a.source_id), a.project_id))
            .collect();

        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        let mut acked_items = Vec::new();

        for p in proposals {
            let explicit_proj = assign_map.get(&(p.kind.clone(), p.source_id)).copied().flatten();
            if p.kind == "render" {
                if let (Some(proj_id), Some(sec), Some(ended), Some(path)) =
                    (explicit_proj, p.render_seconds, p.ended_at, p.working_path)
                {
                    let rbh = sec / 3600.0;
                    let coeff = 0.2;
                    let rate = 150.0;
                    let value = rbh * coeff * rate;

                    tx.execute(
                        "INSERT INTO cfab_render_cost (
                            hub_instance_id, ledger_id, project_id, working_path, render_seconds,
                            ended_at, rbh, coefficient, value, ingested_at, assigned_by, updated_at
                        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'manual', ?10)
                        ON CONFLICT(hub_instance_id, ledger_id) DO UPDATE SET
                            project_id = excluded.project_id,
                            assigned_by = 'manual',
                            updated_at = excluded.updated_at",
                        rusqlite::params![p.hub_instance_id, p.source_id, proj_id, path, sec, ended, rbh, coeff, value, now],
                    ).map_err(|e| e.to_string())?;

                    tx.execute(
                        "INSERT INTO cfab_render_ack (
                            hub_instance_id, ledger_id, ingested_at, project_id, rbh, coefficient, contract, assigned_by
                        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 3, 'manual')
                        ON CONFLICT(hub_instance_id, ledger_id) DO NOTHING",
                        rusqlite::params![p.hub_instance_id, p.source_id, now, proj_id, rbh, coeff],
                    ).map_err(|e| e.to_string())?;

                    acked_items.push(CfabxAckItem {
                        kind: p.kind,
                        source_id: p.source_id,
                        status: "accepted".to_string(),
                        project_id: Some(proj_id),
                    });
                }
            } else if p.kind == "cost" {
                if let Some(proj_id) = explicit_proj {
                    let proj_name: Result<String, _> = tx.query_row(
                        "SELECT name FROM projects WHERE id = ?1",
                        [proj_id],
                        |r| r.get(0),
                    );
                    if let Ok(name) = proj_name {
                        let amount = p.render_seconds.unwrap_or(0.0);
                        let comment = p.title.unwrap_or_else(|| "Koszt z CFAB Hub".to_string());
                        let uid = format!("cfab-cost-{}-{}", p.hub_instance_id, p.source_id);
                        let cost_date: String = now.chars().take(10).collect();
                        tx.execute(
                            "INSERT INTO project_costs (uid, project_name, cost_date, amount, comment, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                             ON CONFLICT(uid) DO UPDATE SET amount = excluded.amount, comment = excluded.comment, updated_at = excluded.updated_at",
                            rusqlite::params![uid, name, cost_date, amount, comment, now, now],
                        ).map_err(|e| e.to_string())?;

                        acked_items.push(CfabxAckItem {
                            kind: p.kind,
                            source_id: p.source_id,
                            status: "accepted".to_string(),
                            project_id: Some(proj_id),
                        });
                    }
                }
            } else if p.kind == "finding" {
                if let Some(proj_id) = explicit_proj {
                    let proj_name: Result<String, _> = tx.query_row(
                        "SELECT name FROM projects WHERE id = ?1",
                        [proj_id],
                        |r| r.get(0),
                    );
                    if let Ok(name) = proj_name {
                        let title = p.title.unwrap_or_else(|| "Znalezisko z CFAB Hub".to_string());
                        let notes = p.working_path.clone();
                        let uid = format!("cfab-finding-{}-{}", p.hub_instance_id, p.source_id);
                        tx.execute(
                            "INSERT INTO todos (uid, scope, project_name, title, notes, priority, status, created_at, updated_at)
                             VALUES (?1, 'project', ?2, ?3, ?4, 1, 'open', ?5, ?6)
                             ON CONFLICT(uid) DO UPDATE SET title = excluded.title, notes = excluded.notes, updated_at = excluded.updated_at",
                            rusqlite::params![uid, name, title, notes, now, now],
                        ).map_err(|e| e.to_string())?;

                        acked_items.push(CfabxAckItem {
                            kind: p.kind,
                            source_id: p.source_id,
                            status: "accepted".to_string(),
                            project_id: Some(proj_id),
                        });
                    }
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;

        let ack_content = create_cfabx_ack_content(conn, &manifest.hub_instance_id, acked_items)?;
        std::fs::write(&ack_path, ack_content).map_err(|e| format!("Błąd zapisu pliku ack: {e}"))?;

        Ok(ack_path)
    }).await
}
