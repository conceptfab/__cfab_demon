use rusqlite::{OptionalExtension, ToSql};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use crate::commands::assignment_model::{
    config::is_project_active_cached,
    context::{build_session_context, SessionContext},
    AssignmentModelStatus, CandidateScore, ProjectSuggestion, ScoreBreakdown, SuggestionBreakdown,
    AUTO_SAFE_MIN_MARGIN,
};

fn load_project_names(
    conn: &rusqlite::Connection,
    project_ids: &[i64],
) -> Result<HashMap<i64, String>, String> {
    let mut project_names = HashMap::with_capacity(project_ids.len());

    for chunk in project_ids.chunks(200) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id, name FROM projects WHERE id IN ({})",
            placeholders
        );
        let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
        let params: Vec<&dyn ToSql> = chunk
            .iter()
            .map(|project_id| project_id as &dyn ToSql)
            .collect();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (project_id, project_name) = row.map_err(|e| e.to_string())?;
            project_names.insert(project_id, project_name);
        }
    }

    Ok(project_names)
}

/// Check if a session has a manual override that forces it to a specific project.
/// Returns Some(project_id) if override exists and target project is valid, None otherwise.
pub fn check_manual_override(conn: &rusqlite::Connection, session_id: i64) -> Option<i64> {
    let meta = match conn
        .query_row(
            "SELECT a.executable_name, s.start_time, s.end_time
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             WHERE s.id = ?1",
            rusqlite::params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
    {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "Failed to read session metadata for manual override check (session_id={}): {}",
                session_id,
                e
            );
            return None;
        }
    }?;

    let (exe_name, start_time, end_time) = meta;

    let project_name: Option<String> = match conn
        .query_row(
            "SELECT project_name
             FROM session_manual_overrides
             WHERE session_id = ?1
                OR (
                    session_id IS NULL
                    AND lower(executable_name) = lower(?2)
                    AND start_time = ?3
                    AND end_time = ?4
                )
             ORDER BY CASE WHEN session_id = ?1 THEN 0 ELSE 1 END, updated_at DESC
             LIMIT 1",
            rusqlite::params![session_id, exe_name, start_time, end_time],
            |row| row.get(0),
        )
        .optional()
    {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "Failed to read manual override mapping (session_id={}): {}",
                session_id,
                e
            );
            return None;
        }
    };

    let project_name = project_name?;

    match conn
        .query_row(
            "SELECT id FROM projects
         WHERE lower(name) = lower(?1)
           AND excluded_at IS NULL
           AND frozen_at IS NULL
         LIMIT 1",
            rusqlite::params![project_name],
            |row| row.get::<_, i64>(0),
        )
        .optional()
    {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "Failed to resolve target project for manual override (session_id={}): {}",
                session_id,
                e
            );
            None
        }
    }
}

pub fn compute_score_breakdowns(
    conn: &rusqlite::Connection,
    context: &SessionContext,
) -> Result<(Vec<CandidateScore>, Option<ProjectSuggestion>), String> {
    let mut layer0: HashMap<i64, f64> = HashMap::new();
    let mut layer1: HashMap<i64, f64> = HashMap::new();
    let mut layer2: HashMap<i64, f64> = HashMap::new();
    let mut layer3: HashMap<i64, f64> = HashMap::new();
    let mut layer3b: HashMap<i64, f64> = HashMap::new();
    let mut candidate_evidence: HashMap<i64, i64> = HashMap::new();
    let mut active_project_cache: HashMap<i64, bool> = HashMap::new();

    // Layer 0: direct file-activity project evidence.
    // Path-inferred candidates are deterministic facts: weight 1.5 sits above
    // the combined cap of the memory layers (L1 0.55 + L2 0.20 + L3 0.55 = 1.30)
    // and evidence +4 lets a lone, uncontested path fact clear the default
    // auto-safe gate (sigmoid(1.5-0.3) * (1 - e^-2) ≈ 0.86 ≥ 0.85).
    // Overlap dilutes the weight only when SEVERAL file projects compete —
    // certainty of the evidence must not be scaled by exposure time.
    let single_file_candidate = context.file_project_weights.len() == 1;
    for (&pid, &weight) in &context.file_project_weights {
        if is_project_active_cached(conn, &mut active_project_cache, pid) {
            let effective_weight = if single_file_candidate { 1.0 } else { weight };
            let (base, evidence) = if context.path_inferred.contains(&pid) {
                (1.5, 4)
            } else {
                (0.80, 2)
            };
            *layer0.entry(pid).or_insert(0.0) += base * effective_weight;
            *candidate_evidence.entry(pid).or_insert(0) += evidence;
        }
    }

    // Layer 1: app
    // For background apps (no file evidence), boost evidence from +1 to +2
    // so that the evidence_factor grows at a comparable rate to file-based apps.
    let is_background_app = context.file_project_weights.is_empty();
    let layer1_evidence_weight: i64 = if is_background_app { 2 } else { 1 };

    // Collect raw counts first, then normalize per-app
    let mut app_raw_counts: Vec<(i64, f64)> = Vec::new();
    {
        let mut stmt = conn
            .prepare_cached("SELECT project_id, cnt FROM assignment_model_app WHERE app_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(rusqlite::params![context.app_id])
            .map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let pid: i64 = row.get(0).map_err(|e| e.to_string())?;
            let cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
            app_raw_counts.push((pid, cnt));
        }
    }

    let app_total: f64 = app_raw_counts.iter().map(|(_, c)| *c).sum();
    for (pid, cnt) in app_raw_counts {
        if !is_project_active_cached(conn, &mut active_project_cache, pid) {
            continue;
        }
        // Blend log-scale with inverse-proportion dampening: prevents historical
        // dominance while still rewarding higher absolute counts.
        // Projects that already dominate this app get slightly dampened,
        // giving minority projects a fairer chance.
        let proportion = if app_total > 0.0 { cnt / app_total } else { 0.0 };
        let log_score = (1.0 + cnt).ln();
        let score = (0.30 * log_score * (0.6 + 0.4 * (1.0 - proportion).sqrt())).min(0.55);
        *layer1.entry(pid).or_insert(0.0) += score;
        *candidate_evidence.entry(pid).or_insert(0) += layer1_evidence_weight;
    }

    // Layer 2: time
    let mut stmt = conn
        .prepare_cached(
            "SELECT project_id, cnt FROM assignment_model_time WHERE app_id = ?1 AND hour_bucket = ?2 AND weekday = ?3",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params![
            context.app_id,
            context.hour_bucket,
            context.weekday
        ])
        .map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let pid: i64 = row.get(0).map_err(|e| e.to_string())?;
        if !is_project_active_cached(conn, &mut active_project_cache, pid) {
            continue;
        }
        let cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
        let score = (0.10 * (1.0 + cnt).ln()).min(0.20);
        *layer2.entry(pid).or_insert(0.0) += score;
        *candidate_evidence.entry(pid).or_insert(0) += 1;
    }

    // Layer 3: tokens — IDF-weighted. A token present in many projects carries
    // little discriminating signal (home-dir fragments, app names), so each
    // token contributes ln(1+cnt) * 1/(1+ln(df)), where df = number of projects
    // that learned this token.
    if !context.tokens.is_empty() {
        let mut token_rows: Vec<(String, i64, f64)> = Vec::new();
        for chunk in context.tokens.chunks(200) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT token, project_id, cnt FROM assignment_model_token WHERE token IN ({})",
                placeholders
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let params: Vec<&dyn ToSql> = chunk.iter().map(|t| t as &dyn ToSql).collect();
            let mut rows = stmt
                .query(rusqlite::params_from_iter(params))
                .map_err(|e| e.to_string())?;
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let token: String = row.get(0).map_err(|e| e.to_string())?;
                let pid: i64 = row.get(1).map_err(|e| e.to_string())?;
                let cnt = row.get::<_, i64>(2).map_err(|e| e.to_string())? as f64;
                token_rows.push((token, pid, cnt));
            }
        }

        let mut df: HashMap<&str, f64> = HashMap::new();
        for (token, _, _) in &token_rows {
            *df.entry(token.as_str()).or_insert(0.0) += 1.0;
        }

        let token_total = context.tokens.len() as f64;
        let mut project_sums: HashMap<i64, f64> = HashMap::new();
        for (token, pid, cnt) in &token_rows {
            let idf = 1.0 / (1.0 + df[token.as_str()].ln());
            *project_sums.entry(*pid).or_insert(0.0) += idf * (1.0 + cnt).ln();
        }

        for (pid, sum) in project_sums {
            if !is_project_active_cached(conn, &mut active_project_cache, pid) {
                continue;
            }
            let score = (0.30 * sum / token_total).min(0.55);
            *layer3.entry(pid).or_insert(0.0) += score;
            *candidate_evidence.entry(pid).or_insert(0) += 1;
        }
    }

    // Layer 3b: folder-scan tokens (static knowledge from project folder
    // contents), IDF-weighted the same way as Layer 3.
    if !context.tokens.is_empty() {
        let mut token_rows: Vec<(String, i64, f64)> = Vec::new();
        for chunk in context.tokens.chunks(200) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT token, project_id, count FROM project_folder_tokens WHERE token IN ({})",
                placeholders
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let params: Vec<&dyn ToSql> = chunk.iter().map(|t| t as &dyn ToSql).collect();
            let mut rows = stmt
                .query(rusqlite::params_from_iter(params))
                .map_err(|e| e.to_string())?;
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let token: String = row.get(0).map_err(|e| e.to_string())?;
                let pid: i64 = row.get(1).map_err(|e| e.to_string())?;
                let cnt = row.get::<_, i64>(2).map_err(|e| e.to_string())? as f64;
                token_rows.push((token, pid, cnt));
            }
        }

        let mut df: HashMap<&str, f64> = HashMap::new();
        for (token, _, _) in &token_rows {
            *df.entry(token.as_str()).or_insert(0.0) += 1.0;
        }

        let token_total = context.tokens.len() as f64;
        let mut project_sums: HashMap<i64, f64> = HashMap::new();
        for (token, pid, cnt) in &token_rows {
            let idf = 1.0 / (1.0 + df[token.as_str()].ln());
            *project_sums.entry(*pid).or_insert(0.0) += idf * (1.0 + cnt).ln();
        }

        for (pid, sum) in project_sums {
            if !is_project_active_cached(conn, &mut active_project_cache, pid) {
                continue;
            }
            let score = (0.15 * sum / token_total).min(0.45);
            *layer3b.entry(pid).or_insert(0.0) += score;
            *candidate_evidence.entry(pid).or_insert(0) += 1;
        }
    }

    let mut all_pids: HashSet<i64> = HashSet::new();
    all_pids.extend(layer0.keys());
    all_pids.extend(layer1.keys());
    all_pids.extend(layer2.keys());
    all_pids.extend(layer3.keys());
    all_pids.extend(layer3b.keys());

    let mut all_pids: Vec<i64> = all_pids.into_iter().collect();
    all_pids.sort_unstable();
    let project_names = load_project_names(conn, &all_pids)?;
    let mut candidates: Vec<CandidateScore> = Vec::with_capacity(all_pids.len());

    for pid in all_pids {
        let l0 = *layer0.get(&pid).unwrap_or(&0.0);
        let l1 = *layer1.get(&pid).unwrap_or(&0.0);
        let l2 = *layer2.get(&pid).unwrap_or(&0.0);
        let l3 = *layer3.get(&pid).unwrap_or(&0.0);
        let l3b = *layer3b.get(&pid).unwrap_or(&0.0);
        let total = l0 + l1 + l2 + l3 + l3b;
        let evidence = *candidate_evidence.get(&pid).unwrap_or(&0);

        let project_name = project_names
            .get(&pid)
            .cloned()
            .unwrap_or_else(|| format!("#{}", pid));

        candidates.push(CandidateScore {
            project_id: pid,
            project_name,
            layer0_file_score: (l0 * 1000.0).round() / 1000.0,
            layer1_app_score: (l1 * 1000.0).round() / 1000.0,
            layer2_time_score: (l2 * 1000.0).round() / 1000.0,
            layer3_token_score: (l3 * 1000.0).round() / 1000.0,
            layer3b_folder_score: (l3b * 1000.0).round() / 1000.0,
            total_score: (total * 1000.0).round() / 1000.0,
            evidence_count: evidence,
        });
    }

    candidates.sort_by(|a, b| {
        b.total_score
            .partial_cmp(&a.total_score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.project_id.cmp(&b.project_id))
    });

    let suggestion = if let Some(best) = candidates.first() {
        let second_score = candidates.get(1).map(|c| c.total_score).unwrap_or(0.0);
        let margin = (best.total_score - second_score).max(0.0);
        let evidence_factor = 1.0 - (-(best.evidence_count as f64) / 2.0).exp();
        // Shifted sigmoid: requires margin > ~0.3 to cross 0.5
        // At margin=0 → ~0.23, at margin=0.3 → ~0.50, at margin=1.0 → ~0.94
        let sigmoid_margin = 1.0 / (1.0 + (-(margin - 0.3) * 4.0).exp());
        let confidence = sigmoid_margin * evidence_factor;

        let breakdown = SuggestionBreakdown {
            file_score: best.layer0_file_score,
            app_score: best.layer1_app_score,
            time_score: best.layer2_time_score,
            token_score: best.layer3_token_score,
            folder_score: best.layer3b_folder_score,
        };

        Some(ProjectSuggestion {
            project_id: best.project_id,
            confidence,
            evidence_count: best.evidence_count,
            margin,
            breakdown: Some(breakdown),
        })
    } else {
        None
    };

    Ok((candidates, suggestion))
}

pub fn compute_raw_suggestion(
    conn: &rusqlite::Connection,
    context: &SessionContext,
) -> Result<Option<ProjectSuggestion>, String> {
    let (_, suggestion) = compute_score_breakdowns(conn, context)?;
    Ok(suggestion)
}

pub fn get_session_score_breakdown_sync(
    conn: &rusqlite::Connection,
    session_id: i64,
) -> Result<ScoreBreakdown, String> {
    let context = build_session_context(conn, session_id)?;
    let manual_override_pid = check_manual_override(conn, session_id);

    let Some(context) = context else {
        return Ok(ScoreBreakdown {
            candidates: vec![],
            final_suggestion: None,
            has_manual_override: manual_override_pid.is_some(),
            manual_override_project_id: manual_override_pid,
        });
    };

    let (candidates, final_suggestion) = compute_score_breakdowns(conn, &context)?;

    Ok(ScoreBreakdown {
        candidates,
        final_suggestion,
        has_manual_override: manual_override_pid.is_some(),
        manual_override_project_id: manual_override_pid,
    })
}

pub fn meets_suggest_threshold(
    status: &AssignmentModelStatus,
    suggestion: &ProjectSuggestion,
) -> bool {
    suggestion.confidence >= status.min_confidence_suggest
}

pub fn meets_auto_safe_threshold(
    status: &AssignmentModelStatus,
    suggestion: &ProjectSuggestion,
) -> bool {
    suggestion.confidence >= status.min_confidence_auto
        && suggestion.evidence_count >= status.min_evidence_auto
        && suggestion.margin >= AUTO_SAFE_MIN_MARGIN
}

pub fn suggest_project_for_session_with_status(
    conn: &rusqlite::Connection,
    status: &AssignmentModelStatus,
    session_id: i64,
) -> Result<Option<ProjectSuggestion>, String> {
    if status.mode == "off" {
        return Ok(None);
    }

    let Some(context) = build_session_context(conn, session_id)? else {
        return Ok(None);
    };
    let Some(suggestion) = compute_raw_suggestion(conn, &context)? else {
        return Ok(None);
    };

    let accepted = if status.mode == "auto_safe" {
        meets_auto_safe_threshold(status, &suggestion)
    } else {
        meets_suggest_threshold(status, &suggestion)
    };

    if accepted {
        Ok(Some(suggestion))
    } else {
        Ok(None)
    }
}

pub fn suggest_projects_for_sessions_with_status(
    conn: &rusqlite::Connection,
    status: &AssignmentModelStatus,
    session_ids: &[i64],
) -> Result<HashMap<i64, ProjectSuggestion>, String> {
    let mut out = HashMap::new();
    if status.mode == "off" || session_ids.is_empty() {
        return Ok(out);
    }

    for &session_id in session_ids {
        if let Some(suggestion) = suggest_project_for_session_with_status(conn, status, session_id)?
        {
            out.insert(session_id, suggestion);
        }
    }
    Ok(out)
}

/// Returns the best project suggestion for a session WITHOUT applying
/// confidence/threshold filters. Use `suggest_project_for_session_with_status`
/// if you need threshold-based acceptance logic.
pub fn suggest_project_for_session_unfiltered(
    conn: &rusqlite::Connection,
    status: &AssignmentModelStatus,
    session_id: i64,
) -> Result<Option<ProjectSuggestion>, String> {
    if status.mode == "off" {
        return Ok(None);
    }

    let Some(context) = build_session_context(conn, session_id)? else {
        return Ok(None);
    };
    compute_raw_suggestion(conn, &context)
}

/// Batch version of `suggest_project_for_session_unfiltered` — returns
/// unfiltered suggestions (no threshold logic) for multiple sessions at once.
pub fn suggest_projects_for_sessions_unfiltered(
    conn: &rusqlite::Connection,
    status: &AssignmentModelStatus,
    session_ids: &[i64],
) -> Result<HashMap<i64, ProjectSuggestion>, String> {
    let mut out = HashMap::new();
    if status.mode == "off" || session_ids.is_empty() {
        return Ok(out);
    }

    for &session_id in session_ids {
        if let Some(suggestion) = suggest_project_for_session_unfiltered(conn, status, session_id)?
        {
            out.insert(session_id, suggestion);
        }
    }

    Ok(out)
}

#[cfg(test)]
mod confidence_tests {
    #[test]
    fn zero_margin_gives_low_confidence() {
        let margin = 0.0;
        let sigmoid = 1.0 / (1.0 + (-(margin - 0.3) * 4.0_f64).exp());
        assert!(sigmoid < 0.30, "sigmoid at margin=0 was {}", sigmoid);
    }

    #[test]
    fn high_margin_gives_high_confidence() {
        let margin = 1.0;
        let sigmoid = 1.0 / (1.0 + (-(margin - 0.3) * 4.0_f64).exp());
        assert!(sigmoid > 0.90, "sigmoid at margin=1.0 was {}", sigmoid);
    }

    #[test]
    fn moderate_margin_is_around_half() {
        let margin = 0.3;
        let sigmoid = 1.0 / (1.0 + (-(margin - 0.3) * 4.0_f64).exp());
        assert!(
            (sigmoid - 0.5).abs() < 0.01,
            "sigmoid at margin=0.3 was {}",
            sigmoid
        );
    }

    #[test]
    fn normalized_app_score_reduces_dominance() {
        // Scenario: project A has 20 sessions, project B has 2
        // Old: pure log → ln(21)=3.04 vs ln(3)=1.10 → ratio 2.76x
        // New: blended with inverse-proportion dampening → ratio reduced
        let cnt_a = 20.0_f64;
        let cnt_b = 2.0_f64;
        let total = cnt_a + cnt_b;

        let prop_a = cnt_a / total;
        let prop_b = cnt_b / total;
        let log_a = (1.0 + cnt_a).ln();
        let log_b = (1.0 + cnt_b).ln();

        let old_ratio = log_a / log_b;
        // New formula: log_score * (0.6 + 0.4 * sqrt(1 - proportion))
        let new_a = log_a * (0.6 + 0.4 * (1.0 - prop_a).sqrt());
        let new_b = log_b * (0.6 + 0.4 * (1.0 - prop_b).sqrt());
        let new_ratio = new_a / new_b;

        assert!(old_ratio > 2.5, "old ratio should be >2.5, was {}", old_ratio);
        assert!(new_ratio < old_ratio, "new ratio {} should be less than old {}", new_ratio, old_ratio);
        // The new ratio should still favor A but less aggressively
        assert!(new_ratio > 1.0, "new ratio should still favor A");
    }
}

#[cfg(test)]
mod scoring_db_tests {
    use super::*;
    use crate::commands::assignment_model::context::SessionContext;
    use std::collections::{HashMap, HashSet};

    fn setup_scoring_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, excluded_at TEXT, frozen_at TEXT);
             CREATE TABLE assignment_model_app (app_id INTEGER, project_id INTEGER, cnt INTEGER, last_seen TEXT, PRIMARY KEY (app_id, project_id));
             CREATE TABLE assignment_model_time (app_id INTEGER, hour_bucket INTEGER, weekday INTEGER, project_id INTEGER, cnt INTEGER, PRIMARY KEY (app_id, hour_bucket, weekday, project_id));
             CREATE TABLE assignment_model_token (token TEXT, project_id INTEGER, cnt INTEGER, last_seen TEXT, PRIMARY KEY (token, project_id));
             CREATE TABLE project_folder_tokens (token TEXT NOT NULL, project_id INTEGER NOT NULL, count INTEGER NOT NULL);
             INSERT INTO projects (id, name) VALUES (10, 'Alpha'), (20, 'Beta');",
        )
        .unwrap();
        conn
    }

    fn path_context(weights: HashMap<i64, f64>, path_inferred: HashSet<i64>) -> SessionContext {
        SessionContext {
            app_id: 1,
            hour_bucket: 10,
            weekday: 1,
            tokens: vec![],
            file_project_weights: weights,
            path_inferred,
        }
    }

    #[test]
    fn path_fact_beats_heavy_app_memory() {
        let conn = setup_scoring_conn();
        // Beta has massive app-layer memory (cnt=200). Alpha has a single short
        // file activity (10% overlap) whose path deterministically points at it.
        conn.execute(
            "INSERT INTO assignment_model_app (app_id, project_id, cnt, last_seen) VALUES (1, 20, 200, '')",
            [],
        )
        .unwrap();

        let ctx = path_context(
            HashMap::from([(10_i64, 0.10_f64)]),
            HashSet::from([10_i64]),
        );
        let (candidates, suggestion) = compute_score_breakdowns(&conn, &ctx).unwrap();

        assert_eq!(candidates[0].project_id, 10, "path evidence must outrank app memory");
        let s = suggestion.expect("suggestion");
        assert_eq!(s.project_id, 10);
        assert!(s.evidence_count >= 4, "path evidence should count as strong evidence, got {}", s.evidence_count);
    }

    #[test]
    fn memory_layers_are_capped() {
        let conn = setup_scoring_conn();
        conn.execute(
            "INSERT INTO assignment_model_app (app_id, project_id, cnt, last_seen) VALUES (1, 20, 100000, '')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assignment_model_time (app_id, hour_bucket, weekday, project_id, cnt) VALUES (1, 10, 1, 20, 100000)",
            [],
        )
        .unwrap();

        let ctx = path_context(HashMap::new(), HashSet::new());
        let (candidates, _) = compute_score_breakdowns(&conn, &ctx).unwrap();
        let beta = candidates.iter().find(|c| c.project_id == 20).unwrap();
        assert!(beta.layer1_app_score <= 0.55 + 1e-9, "L1 capped, got {}", beta.layer1_app_score);
        assert!(beta.layer2_time_score <= 0.20 + 1e-9, "L2 capped, got {}", beta.layer2_time_score);
    }

    #[test]
    fn lone_path_evidence_passes_auto_safe_threshold() {
        let conn = setup_scoring_conn();
        let ctx = path_context(
            HashMap::from([(10_i64, 1.0_f64)]),
            HashSet::from([10_i64]),
        );
        let (_, suggestion) = compute_score_breakdowns(&conn, &ctx).unwrap();
        let s = suggestion.expect("suggestion");
        assert!(
            s.confidence >= 0.85,
            "a clean, uncontested path fact must be able to pass the default auto threshold, got {}",
            s.confidence
        );
        assert!(s.evidence_count >= 3);
    }

    #[test]
    fn ubiquitous_tokens_are_dampened_by_idf() {
        let conn = setup_scoring_conn();
        conn.execute("INSERT INTO projects (id, name) VALUES (30, 'Gamma'), (40, 'Delta')", [])
            .unwrap();
        // 'alpha' is unique to project 10; 'micz' appears in 4 projects with the
        // same count — it carries no discriminating signal.
        conn.execute_batch(
            "INSERT INTO assignment_model_token (token, project_id, cnt, last_seen) VALUES
                ('alpha', 10, 50, ''),
                ('micz', 10, 50, ''), ('micz', 20, 50, ''), ('micz', 30, 50, ''), ('micz', 40, 50, '');",
        )
        .unwrap();

        let mut ctx = path_context(HashMap::new(), HashSet::new());
        ctx.tokens = vec!["alpha".to_string(), "micz".to_string()];

        let (candidates, _) = compute_score_breakdowns(&conn, &ctx).unwrap();
        let p10 = candidates.iter().find(|c| c.project_id == 10).unwrap();
        let p20 = candidates.iter().find(|c| c.project_id == 20).unwrap();

        // Project 10 matches a unique token + the ubiquitous one; project 20 only
        // the ubiquitous one. With IDF the ubiquitous token contributes a small
        // fraction, so p20's token score must be well below half of p10's.
        assert!(p10.layer3_token_score > 0.0);
        assert!(
            p20.layer3_token_score < p10.layer3_token_score * 0.5,
            "ubiquitous-only project should score far lower: p10={} p20={}",
            p10.layer3_token_score,
            p20.layer3_token_score
        );
    }
}
