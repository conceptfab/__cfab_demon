use rusqlite::OptionalExtension;
use std::collections::HashMap;
use tauri::AppHandle;

use super::super::assignment_model;
use super::super::datetime::parse_datetime_fixed;
use super::super::helpers::run_db_blocking;
use super::super::types::{
    MultiProjectAnalysis, ProjectCandidate, SessionSplittableFlag, SplitPart,
};
use super::manual_overrides::upsert_manual_session_override;

#[derive(Clone, Debug)]
struct SplitSegmentMutation {
    session_id: i64,
    start_time: String,
    end_time: String,
    project_id: Option<i64>,
    feedback_source: String,
    feedback_weight: f64,
}

pub(crate) fn parse_iso_datetime(
    value: &str,
) -> Result<chrono::DateTime<chrono::FixedOffset>, String> {
    parse_datetime_fixed(value).ok_or_else(|| format!("Unsupported datetime format: {}", value))
}

fn apply_split_side_effects(
    tx: &rusqlite::Transaction<'_>,
    app_id: i64,
    date: &str,
    from_project_id: Option<i64>,
    segments: &[SplitSegmentMutation],
) -> Result<(), String> {
    if segments.is_empty() {
        return Ok(());
    }

    let mut parsed_segments = Vec::with_capacity(segments.len());
    for segment in segments {
        let start = parse_iso_datetime(&segment.start_time)
            .map_err(|e| format!("Invalid split segment start_time: {}", e))?;
        let end = parse_iso_datetime(&segment.end_time)
            .map_err(|e| format!("Invalid split segment end_time: {}", e))?;
        parsed_segments.push((segment, start, end));
    }

    let overall_start = segments
        .first()
        .map(|segment| segment.start_time.as_str())
        .ok_or_else(|| "Missing first split segment".to_string())?;
    let overall_end = segments
        .last()
        .map(|segment| segment.end_time.as_str())
        .ok_or_else(|| "Missing last split segment".to_string())?;

    let activities: Vec<(i64, String, String)> = {
        let mut stmt = tx
            .prepare_cached(
                "SELECT id, first_seen, last_seen
                 FROM file_activities
                 WHERE app_id = ?1
                   AND date = ?2
                   AND last_seen > ?3
                   AND first_seen < ?4",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                rusqlite::params![app_id, date, overall_start, overall_end],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read file_activities for split: {}", e))?
    };

    for (activity_id, first_seen, last_seen) in activities {
        let first_dt = match parse_iso_datetime(&first_seen) {
            Ok(value) => value,
            Err(error) => {
                log::warn!(
                    "Skipping split file_activity {} due to invalid first_seen '{}': {}",
                    activity_id,
                    first_seen,
                    error
                );
                continue;
            }
        };
        let last_dt = match parse_iso_datetime(&last_seen) {
            Ok(value) => value,
            Err(error) => {
                log::warn!(
                    "Skipping split file_activity {} due to invalid last_seen '{}': {}",
                    activity_id,
                    last_seen,
                    error
                );
                continue;
            }
        };
        let midpoint = first_dt
            + chrono::Duration::milliseconds(
                (last_dt.timestamp_millis() - first_dt.timestamp_millis()).max(0) / 2,
            );
        let chosen_segment = parsed_segments
            .iter()
            .find(|(_, _, end)| midpoint < *end)
            .or_else(|| parsed_segments.last())
            .ok_or_else(|| "No parsed split segment available".to_string())?;
        tx.execute(
            "UPDATE file_activities SET project_id = ?1 WHERE id = ?2",
            rusqlite::params![chosen_segment.0.project_id, activity_id],
        )
        .map_err(|e| e.to_string())?;
    }

    for segment in segments {
        tx.execute(
            "INSERT INTO assignment_feedback (
                session_id, app_id, from_project_id, to_project_id, source, weight, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
            rusqlite::params![
                segment.session_id,
                app_id,
                from_project_id,
                segment.project_id,
                segment.feedback_source,
                segment.feedback_weight,
            ],
        )
        .map_err(|e| e.to_string())?;

        if let Err(error) =
            upsert_manual_session_override(tx, segment.session_id, segment.project_id)
        {
            log::warn!(
                "Failed to update manual override after split for session {}: {}",
                segment.session_id,
                error
            );
        }
    }

    let feedback_count = segments.len() as i64;
    tx.execute(
        "INSERT INTO assignment_model_state (key, value, updated_at)
         VALUES ('feedback_since_train', ?1, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = CAST(COALESCE(NULLIF(assignment_model_state.value, ''), '0') AS INTEGER) + ?1,
           updated_at = datetime('now')",
        [feedback_count],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Clone, Debug)]
pub(crate) struct SplitSourceSession {
    app_id: i64,
    start_time: String,
    end_time: String,
    duration_seconds: i64,
    date_str: String,
    rate_multiplier: f64,
    orig_project_id: Option<i64>,
    comment: Option<String>,
}

pub(crate) fn load_split_source_session(
    conn: &rusqlite::Connection,
    session_id: i64,
    only_visible: bool,
) -> Result<SplitSourceSession, String> {
    let sql = if only_visible {
        "SELECT app_id, start_time, end_time, duration_seconds, date, rate_multiplier, project_id, comment, split_source_session_id
         FROM sessions WHERE id = ?1 AND (is_hidden IS NULL OR is_hidden = 0)"
    } else {
        "SELECT app_id, start_time, end_time, duration_seconds, date, rate_multiplier, project_id, comment, split_source_session_id
         FROM sessions WHERE id = ?1"
    };

    let (session, split_source) = conn
        .query_row(sql, [session_id], |row| {
            Ok((
                SplitSourceSession {
                    app_id: row.get::<_, i64>(0)?,
                    start_time: row.get::<_, String>(1)?,
                    end_time: row.get::<_, String>(2)?,
                    duration_seconds: row.get::<_, i64>(3)?,
                    date_str: row.get::<_, String>(4)?,
                    rate_multiplier: row.get::<_, f64>(5)?,
                    orig_project_id: row.get::<_, Option<i64>>(6)?,
                    comment: row.get::<_, Option<String>>(7)?,
                },
                row.get::<_, Option<i64>>(8)?,
            ))
        })
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Session not found".to_string())?;

    if split_source.is_some() {
        return Err("Session has already been split and cannot be split again".to_string());
    }

    Ok(session)
}

fn validate_split_parts(splits: &[SplitPart]) -> Result<(), String> {
    if splits.is_empty() || splits.len() > 5 {
        return Err("Splits must have 1-5 parts".to_string());
    }

    let ratio_sum: f64 = splits.iter().map(|s| s.ratio).sum();
    if (ratio_sum - 1.0).abs() > 0.01 {
        return Err(format!("Ratios must sum to 1.0, got {:.4}", ratio_sum));
    }

    for (i, part) in splits.iter().enumerate() {
        if part.ratio <= 0.0 || part.ratio > 1.0 {
            return Err(format!("Part {} ratio must be between 0 and 1", i));
        }
    }

    Ok(())
}

/// Remove all "Split N/M" markers (including parenthesized and pipe-separated)
/// from a comment string to prevent nested markers like "Split 1/2 (Split 1/2)".
fn strip_split_markers(input: &str) -> String {
    let mut result = input.to_string();
    // Remove patterns like "(Split 1/2)", "Split 1/2", "| Split 1/2"
    loop {
        let before = result.clone();
        // Remove parenthesized: (Split N/N)
        if let Some(start) = result.find("(Split ") {
            if let Some(end) = result[start..].find(')') {
                let candidate = &result[start..start + end + 1];
                if candidate.contains('/') {
                    result = format!("{}{}", &result[..start], &result[start + end + 1..]);
                }
            }
        }
        // Remove bare: Split N/N (only if it looks like a split marker)
        if let Some(start) = result.find("Split ") {
            let rest = &result[start + 6..];
            if let Some(slash) = rest.find('/') {
                let before_slash = &rest[..slash];
                let after_slash_end = rest[slash + 1..]
                    .find(|c: char| !c.is_ascii_digit())
                    .unwrap_or(rest.len() - slash - 1);
                let after_slash = &rest[slash + 1..slash + 1 + after_slash_end];
                if before_slash.chars().all(|c| c.is_ascii_digit())
                    && !before_slash.is_empty()
                    && after_slash.chars().all(|c| c.is_ascii_digit())
                    && !after_slash.is_empty()
                {
                    let marker_end = start + 6 + slash + 1 + after_slash_end;
                    result = format!("{}{}", &result[..start], &result[marker_end..]);
                }
            }
        }
        // Remove leftover separators
        result = result.replace(" | ", " ").replace("  ", " ");
        result = result.trim().to_string();
        if result == before {
            break;
        }
    }
    result
}

pub(crate) fn execute_session_split(
    conn: &mut rusqlite::Connection,
    session_id: i64,
    source: &SplitSourceSession,
    splits: &[SplitPart],
) -> Result<(), String> {
    validate_split_parts(splits)?;

    let start_dt =
        parse_iso_datetime(&source.start_time).map_err(|e| format!("Invalid start time: {}", e))?;
    let end_dt =
        parse_iso_datetime(&source.end_time).map_err(|e| format!("Invalid end time: {}", e))?;
    let total_ms = (end_dt.timestamp_millis() - start_dt.timestamp_millis()).max(0);

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let n = splits.len();
    let mut cursor_ms: i64 = 0;
    let mut cursor_secs: i64 = 0;
    let mut split_segments: Vec<SplitSegmentMutation> = Vec::with_capacity(n);

    for (i, part) in splits.iter().enumerate() {
        let is_last = i == n - 1;

        let part_ms = if is_last {
            total_ms - cursor_ms
        } else {
            (total_ms as f64 * part.ratio).round() as i64
        };

        let part_secs = if is_last {
            source.duration_seconds - cursor_secs
        } else {
            (source.duration_seconds as f64 * part.ratio).round() as i64
        };

        let part_start = start_dt + chrono::Duration::milliseconds(cursor_ms);
        let part_end = start_dt + chrono::Duration::milliseconds(cursor_ms + part_ms);
        let part_start_str = part_start.to_rfc3339();
        let part_end_str = part_end.to_rfc3339();
        let split_marker = format!("Split {}/{}", i + 1, n);
        let part_comment = match source.comment.as_deref() {
            Some(c) if c.is_empty() => split_marker,
            Some(c) => {
                // Strip any existing split markers to prevent nesting like "Split 1/2 (Split 1/2)"
                let cleaned = strip_split_markers(c);
                if cleaned.is_empty() {
                    split_marker
                } else {
                    format!("{} | {}", cleaned, split_marker)
                }
            }
            None => split_marker,
        };
        let feedback_source = format!("manual_session_split_part_{}", i + 1);

        if i == 0 {
            tx.execute(
                "UPDATE sessions
                 SET end_time = ?1,
                     duration_seconds = ?2,
                     project_id = ?3,
                     comment = ?4,
                     split_source_session_id = ?5
                 WHERE id = ?6",
                rusqlite::params![
                    part_end_str.as_str(),
                    part_secs,
                    part.project_id,
                    part_comment,
                    session_id,
                    session_id,
                ],
            )
            .map_err(|e| e.to_string())?;
            split_segments.push(SplitSegmentMutation {
                session_id,
                start_time: part_start_str,
                end_time: part_end_str,
                project_id: part.project_id,
                feedback_source,
                feedback_weight: part.ratio,
            });
        } else {
            tx.execute(
                "INSERT INTO sessions (
                    app_id, start_time, end_time, duration_seconds, date, rate_multiplier, project_id, comment, split_source_session_id
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    source.app_id,
                    part_start_str.as_str(),
                    part_end_str.as_str(),
                    part_secs,
                    source.date_str.as_str(),
                    source.rate_multiplier,
                    part.project_id,
                    part_comment,
                    session_id,
                ],
            )
            .map_err(|e| e.to_string())?;
            split_segments.push(SplitSegmentMutation {
                session_id: tx.last_insert_rowid(),
                start_time: part_start_str,
                end_time: part_end_str,
                project_id: part.project_id,
                feedback_source,
                feedback_weight: part.ratio,
            });
        }

        cursor_ms += part_ms;
        cursor_secs += part_secs;
    }

    apply_split_side_effects(
        &tx,
        source.app_id,
        &source.date_str,
        source.orig_project_id,
        split_segments.as_slice(),
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn split_session(
    app: AppHandle,
    session_id: i64,
    ratio: f64,
    project_a_id: Option<i64>,
    project_b_id: Option<i64>,
) -> Result<(), String> {
    if ratio <= 0.0 || ratio >= 1.0 {
        return Err("Ratio must be strictly between 0.0 and 1.0".to_string());
    }

    let splits = vec![
        SplitPart {
            project_id: project_a_id,
            ratio,
        },
        SplitPart {
            project_id: project_b_id,
            ratio: 1.0 - ratio,
        },
    ];
    run_db_blocking(app, move |conn| {
        let source = load_split_source_session(conn, session_id, false)?;
        execute_session_split(conn, session_id, &source, splits.as_slice())
    })
    .await
}

#[derive(serde::Serialize)]
pub struct SplitSuggestion {
    pub project_a_id: Option<i64>,
    pub project_a_name: Option<String>,
    pub project_b_id: Option<i64>,
    pub project_b_name: Option<String>,
    pub suggested_ratio: f64,
    pub confidence: f64,
}

#[derive(Clone, Debug)]
struct SplitAnalysisSession {
    app_id: i64,
    date_str: String,
    start_time: String,
    end_time: String,
    current_project_id: Option<i64>,
    current_project_name: Option<String>,
    latest_feedback_project_id: Option<i64>,
    latest_feedback_project_name: Option<String>,
}

fn load_split_analysis_session(
    conn: &rusqlite::Connection,
    session_id: i64,
) -> Result<SplitAnalysisSession, String> {
    conn.query_row(
        "SELECT
            s.app_id,
            s.date,
            s.start_time,
            s.end_time,
            s.project_id,
            p_current.name,
            (
                SELECT af.to_project_id
                FROM assignment_feedback af
                WHERE af.session_id = s.id
                ORDER BY af.created_at DESC, af.id DESC
                LIMIT 1
            ) AS latest_feedback_project_id,
            (
                SELECT p_feedback.name
                FROM assignment_feedback af
                LEFT JOIN projects p_feedback ON p_feedback.id = af.to_project_id
                WHERE af.session_id = s.id
                ORDER BY af.created_at DESC, af.id DESC
                LIMIT 1
            ) AS latest_feedback_project_name
         FROM sessions s
         LEFT JOIN projects p_current ON p_current.id = s.project_id
         WHERE s.id = ?1",
        [session_id],
        |row| {
            Ok(SplitAnalysisSession {
                app_id: row.get(0)?,
                date_str: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
                current_project_id: row.get(4)?,
                current_project_name: row.get(5)?,
                latest_feedback_project_id: row.get(6)?,
                latest_feedback_project_name: row.get(7)?,
            })
        },
    )
    .map_err(|e| format!("Session not found: {}", e))
}

fn finalize_project_candidates(
    mut candidates: Vec<ProjectCandidate>,
    limit: usize,
) -> Vec<ProjectCandidate> {
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.project_id.cmp(&b.project_id))
    });
    candidates.truncate(limit);

    let leader_score = candidates
        .first()
        .map(|candidate| candidate.score)
        .unwrap_or(0.0);
    for candidate in &mut candidates {
        candidate.ratio_to_leader = if leader_score > 0.0 {
            candidate.score / leader_score
        } else {
            0.0
        };
    }

    candidates
}

fn build_multi_project_analysis_from_candidates(
    session_id: i64,
    candidates: Vec<ProjectCandidate>,
    tolerance_threshold: f64,
) -> MultiProjectAnalysis {
    let leader_score = candidates
        .first()
        .map(|candidate| candidate.score)
        .unwrap_or(0.0);
    let leader_project_id = candidates.first().map(|candidate| candidate.project_id);
    let qualifying = candidates
        .iter()
        .filter(|candidate| candidate.ratio_to_leader >= tolerance_threshold)
        .count();

    MultiProjectAnalysis {
        session_id,
        candidates,
        is_splittable: qualifying >= 2,
        leader_project_id,
        leader_score,
    }
}

fn split_ratio_from_top_two(project_a: &ProjectCandidate, project_b: &ProjectCandidate) -> f64 {
    let total_score = project_a.score + project_b.score;
    if total_score > 0.0 {
        (project_a.score / total_score).clamp(0.05, 0.95)
    } else {
        0.5
    }
}

fn load_overlap_project_candidates(
    conn: &rusqlite::Connection,
    session: &SplitAnalysisSession,
    limit: usize,
) -> Result<Vec<ProjectCandidate>, String> {
    let session_start = parse_iso_datetime(&session.start_time)
        .map_err(|e| format!("Invalid session start time: {}", e))?;
    let session_end = parse_iso_datetime(&session.end_time)
        .map_err(|e| format!("Invalid session end time: {}", e))?;

    let mut stmt = conn
        .prepare_cached(
            "SELECT fa.project_id, COALESCE(p.name, ''), fa.first_seen, fa.last_seen
             FROM file_activities fa
             LEFT JOIN projects p ON p.id = fa.project_id
             WHERE fa.app_id = ?1
               AND fa.date = ?2
               AND fa.project_id IS NOT NULL
               AND fa.last_seen > ?3
               AND fa.first_seen < ?4",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            rusqlite::params![
                session.app_id,
                session.date_str,
                session.start_time,
                session.end_time
            ],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1).unwrap_or_default(),
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut overlap_by_project: HashMap<i64, (i64, String)> = HashMap::new();
    for row in rows {
        let (project_id, project_name, first_seen, last_seen) =
            row.map_err(|e| format!("Failed to read split overlap row: {}", e))?;
        let first_dt = match parse_iso_datetime(&first_seen) {
            Ok(value) => value,
            Err(error) => {
                log::warn!(
                    "Skipping split overlap candidate with invalid first_seen '{}': {}",
                    first_seen,
                    error
                );
                continue;
            }
        };
        let last_dt = match parse_iso_datetime(&last_seen) {
            Ok(value) => value,
            Err(error) => {
                log::warn!(
                    "Skipping split overlap candidate with invalid last_seen '{}': {}",
                    last_seen,
                    error
                );
                continue;
            }
        };

        let overlap_ms = std::cmp::min(session_end.timestamp_millis(), last_dt.timestamp_millis())
            - std::cmp::max(
                session_start.timestamp_millis(),
                first_dt.timestamp_millis(),
            );
        if overlap_ms <= 0 {
            continue;
        }

        let display_name = if project_name.is_empty() {
            format!("#{}", project_id)
        } else {
            project_name
        };
        let entry = overlap_by_project
            .entry(project_id)
            .or_insert((0, display_name));
        entry.0 += overlap_ms;
    }

    let candidates = overlap_by_project
        .into_iter()
        .map(
            |(project_id, (overlap_ms, project_name))| ProjectCandidate {
                project_id,
                project_name,
                score: overlap_ms as f64 / 1000.0,
                ratio_to_leader: 0.0,
            },
        )
        .collect::<Vec<_>>();

    Ok(finalize_project_candidates(candidates, limit))
}

fn project_candidates_from_score_breakdown(
    score_breakdown: &assignment_model::ScoreBreakdown,
    limit: usize,
) -> Vec<ProjectCandidate> {
    let candidates = score_breakdown
        .candidates
        .iter()
        .filter(|candidate| candidate.total_score > 0.0)
        .map(|candidate| ProjectCandidate {
            project_id: candidate.project_id,
            project_name: candidate.project_name.clone(),
            score: candidate.total_score,
            ratio_to_leader: 0.0,
        })
        .collect::<Vec<_>>();

    finalize_project_candidates(candidates, limit)
}

fn load_ai_project_candidates(
    conn: &rusqlite::Connection,
    session_id: i64,
    limit: usize,
) -> Result<(Vec<ProjectCandidate>, Option<f64>), String> {
    let score_breakdown = assignment_model::get_session_score_breakdown_sync(conn, session_id)?;
    let candidates = project_candidates_from_score_breakdown(&score_breakdown, limit);
    let confidence = score_breakdown
        .final_suggestion
        .as_ref()
        .filter(|suggestion| {
            candidates
                .first()
                .is_some_and(|candidate| candidate.project_id == suggestion.project_id)
        })
        .map(|suggestion| suggestion.confidence);

    Ok((candidates, confidence))
}

pub(crate) fn suggest_session_split_sync(
    conn: &rusqlite::Connection,
    session_id: i64,
) -> Result<SplitSuggestion, String> {
    let session = load_split_analysis_session(conn, session_id)?;

    let overlap_candidates = load_overlap_project_candidates(conn, &session, 10)?;
    if overlap_candidates.len() >= 2 {
        let project_a = &overlap_candidates[0];
        let project_b = &overlap_candidates[1];
        return Ok(SplitSuggestion {
            project_a_id: Some(project_a.project_id),
            project_a_name: Some(project_a.project_name.clone()),
            project_b_id: Some(project_b.project_id),
            project_b_name: Some(project_b.project_name.clone()),
            suggested_ratio: split_ratio_from_top_two(project_a, project_b),
            confidence: 0.8,
        });
    }

    let (ai_candidates, ai_confidence) = load_ai_project_candidates(conn, session_id, 10)?;
    if ai_candidates.len() >= 2 {
        let project_a = &ai_candidates[0];
        let project_b = &ai_candidates[1];
        return Ok(SplitSuggestion {
            project_a_id: Some(project_a.project_id),
            project_a_name: Some(project_a.project_name.clone()),
            project_b_id: Some(project_b.project_id),
            project_b_name: Some(project_b.project_name.clone()),
            suggested_ratio: split_ratio_from_top_two(project_a, project_b),
            confidence: ai_confidence.unwrap_or(0.4),
        });
    }

    if let (Some(current_project_id), Some(latest_feedback_project_id)) = (
        session.current_project_id,
        session.latest_feedback_project_id,
    ) {
        if current_project_id != latest_feedback_project_id {
            return Ok(SplitSuggestion {
                project_a_id: Some(current_project_id),
                project_a_name: session.current_project_name.clone(),
                project_b_id: Some(latest_feedback_project_id),
                project_b_name: session.latest_feedback_project_name.clone(),
                suggested_ratio: 0.5,
                confidence: 0.4,
            });
        }
    }

    Ok(SplitSuggestion {
        project_a_id: session
            .current_project_id
            .or(session.latest_feedback_project_id),
        project_a_name: session
            .current_project_name
            .or(session.latest_feedback_project_name),
        project_b_id: None,
        project_b_name: None,
        suggested_ratio: 0.5,
        confidence: 0.0,
    })
}

/// Analyzes overlapping file activities first, then AI scoring, to suggest an automatic split.
pub async fn suggest_session_split(
    app: AppHandle,
    session_id: i64,
) -> Result<SplitSuggestion, String> {
    run_db_blocking(app, move |conn| {
        suggest_session_split_sync(conn, session_id)
    })
    .await
}

pub(crate) fn analyze_session_projects_sync(
    conn: &rusqlite::Connection,
    session_id: i64,
    tolerance_threshold: f64,
    max_projects: i64,
) -> Result<MultiProjectAnalysis, String> {
    let normalized_max_projects = max_projects.clamp(2, 5) as usize;
    let normalized_tolerance = tolerance_threshold.clamp(0.2, 1.0);

    let (ai_candidates, _) = load_ai_project_candidates(conn, session_id, normalized_max_projects)?;
    if !ai_candidates.is_empty() {
        return Ok(build_multi_project_analysis_from_candidates(
            session_id,
            ai_candidates,
            normalized_tolerance,
        ));
    }

    let session = load_split_analysis_session(conn, session_id)?;
    let overlap_candidates =
        load_overlap_project_candidates(conn, &session, normalized_max_projects)?;
    if overlap_candidates.is_empty() {
        return Ok(MultiProjectAnalysis {
            session_id,
            candidates: vec![],
            is_splittable: false,
            leader_project_id: None,
            leader_score: 0.0,
        });
    }

    Ok(build_multi_project_analysis_from_candidates(
        session_id,
        overlap_candidates,
        normalized_tolerance,
    ))
}

/// Analyzes a session to determine which projects are present
/// and whether the session is a candidate for multi-project splitting.
pub async fn analyze_session_projects(
    app: AppHandle,
    session_id: i64,
    tolerance_threshold: f64,
    max_projects: i64,
) -> Result<MultiProjectAnalysis, String> {
    run_db_blocking(app, move |conn| {
        analyze_session_projects_sync(conn, session_id, tolerance_threshold, max_projects)
    })
    .await
}

pub(crate) fn analyze_sessions_splittable_sync(
    conn: &rusqlite::Connection,
    session_ids: &[i64],
    tolerance_threshold: f64,
    max_projects: i64,
) -> Result<Vec<SessionSplittableFlag>, String> {
    let mut result = Vec::with_capacity(session_ids.len());
    for &session_id in session_ids {
        let analysis =
            analyze_session_projects_sync(conn, session_id, tolerance_threshold, max_projects)?;
        result.push(SessionSplittableFlag {
            session_id,
            is_splittable: analysis.is_splittable,
        });
    }
    Ok(result)
}

/// Batch variant of `analyze_session_projects` that returns only splittable flags.
pub async fn analyze_sessions_splittable(
    app: AppHandle,
    session_ids: Vec<i64>,
    tolerance_threshold: f64,
    max_projects: i64,
) -> Result<Vec<SessionSplittableFlag>, String> {
    if session_ids.is_empty() {
        return Ok(Vec::new());
    }

    run_db_blocking(app, move |conn| {
        analyze_sessions_splittable_sync(
            conn,
            session_ids.as_slice(),
            tolerance_threshold,
            max_projects,
        )
    })
    .await
}

/// Splits a session into N parts (max 5) with given ratios and optional project assignments.
pub async fn split_session_multi(
    app: AppHandle,
    session_id: i64,
    splits: Vec<SplitPart>,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let source = load_split_source_session(conn, session_id, true)?;
        execute_session_split(conn, session_id, &source, splits.as_slice())
    })
    .await
}
