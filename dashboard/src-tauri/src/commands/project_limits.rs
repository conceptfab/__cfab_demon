//! Limit godzin projektu na okres rozliczeniowy (m28).
//!
//! Trzy rzeczy, w tej kolejności:
//! 1. **Okres rozliczeniowy** — z `projects.limit_cycle_start_day` (1..28, NULL ⇒ 1)
//!    wyliczamy przedział `[cycle_start, cycle_end]` obejmujący datę odniesienia.
//! 2. **Zużycie** — to ten sam czas, który pokazuje reszta aplikacji: dedup + `min_duration`
//!    z [`compute_project_activity_unique`]. Mnożniki NIE wpływają na zużycie limitu —
//!    boost jest kwestią wyceny, nie budżetu godzin.
//! 3. **Sesje ponad limitem** — po chronologicznym zsumowaniu zużycia sesja jest „w całości
//!    ponad limitem", gdy suma SPRZED niej sięgnęła już limitu. Sesja graniczna (część
//!    poniżej, część powyżej) zostaje nietknięta — świadomie, żeby nie ciąć sesji.

use rusqlite::Connection;
use tauri::AppHandle;

use crate::commands::error::CommandError;

use super::daemon::load_persisted_session_min_duration;
use super::helpers::run_db_blocking;
use super::sql_fragments::{ensure_session_project_cache, SESSION_PROJECT_CTE};
use super::time_algorithm::{compute_project_activity_unique, source_key};
use super::types::{DateRange, OverLimitSession, ProjectLimitBadge, ProjectLimitStatus};

/// Mnożnik użyty, gdy projekt nie ma własnego (`over_limit_multiplier IS NULL`).
pub(crate) const DEFAULT_OVER_LIMIT_MULTIPLIER: f64 = 1.5;
/// Górna granica dnia startu okresu — 28, żeby okres istniał w każdym miesiącu (luty).
const MAX_CYCLE_START_DAY: u32 = 28;

/// Ustawienia limitu odczytane z `projects`, z domyślkami już zastosowanymi.
struct LimitSettings {
    limit_hours: Option<f64>,
    cycle_start_day: u32,
    multiplier: f64,
    comment_template: Option<String>,
}

fn load_limit_settings(conn: &Connection, project_id: i64) -> Result<LimitSettings, String> {
    let row: (Option<f64>, Option<i64>, Option<f64>, Option<String>) = conn
        .query_row(
            "SELECT monthly_hours_limit, limit_cycle_start_day, over_limit_multiplier, \
             over_limit_comment FROM projects WHERE id = ?1",
            [project_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => "Project not found".to_string(),
            other => other.to_string(),
        })?;

    Ok(LimitSettings {
        limit_hours: row.0.filter(|h| h.is_finite() && *h > 0.0),
        cycle_start_day: normalize_cycle_start_day(row.1),
        multiplier: row
            .2
            .filter(|m| m.is_finite() && *m > 1.0)
            .unwrap_or(DEFAULT_OVER_LIMIT_MULTIPLIER),
        comment_template: row.3.filter(|c| !c.trim().is_empty()),
    })
}

fn normalize_cycle_start_day(raw: Option<i64>) -> u32 {
    raw.unwrap_or(1).clamp(1, MAX_CYCLE_START_DAY as i64) as u32
}

/// Granice okresu rozliczeniowego obejmującego `reference`.
///
/// `day = 1` daje miesiąc kalendarzowy. Dla `day > reference.day()` okres zaczął się
/// w poprzednim miesiącu — stąd cofnięcie o miesiąc.
pub(crate) fn cycle_bounds(
    day: u32,
    reference: chrono::NaiveDate,
) -> (chrono::NaiveDate, chrono::NaiveDate) {
    use chrono::{Datelike, Months};

    let day = day.clamp(1, MAX_CYCLE_START_DAY);
    let anchor = reference
        .with_day(day)
        // `day` ≤ 28, więc `with_day` nie może zawieść — fallback tylko dla spokoju typu.
        .unwrap_or(reference);
    let start = if reference.day() >= day {
        anchor
    } else {
        anchor
            .checked_sub_months(Months::new(1))
            .unwrap_or(anchor)
    };
    let end = start
        .checked_add_months(Months::new(1))
        .and_then(|d| d.pred_opt())
        .unwrap_or(start);
    (start, end)
}

/// Jedna pozycja czasu w okresie — sesja zwykła albo ręczna.
struct Entry {
    is_manual: bool,
    id: i64,
    start_time: String,
    label: String,
    duration_seconds: i64,
    rate_multiplier: f64,
    has_comment: bool,
}

fn load_entries(
    conn: &Connection,
    project_id: i64,
    cycle: &DateRange,
    min_duration: i64,
) -> Result<Vec<Entry>, String> {
    ensure_session_project_cache(conn, &cycle.start, &cycle.end)?;

    let sql = format!(
        "{SESSION_PROJECT_CTE}
         SELECT sp.id, sp.start_time, sp.duration_seconds, sp.safe_rate_multiplier,
                COALESCE(a.display_name, a.executable_name), sp.comment
         FROM session_projects sp
         JOIN applications a ON a.id = sp.app_id
         WHERE sp.project_id = ?3
           AND sp.duration_seconds >= ?4
         ORDER BY sp.start_time ASC"
    );
    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let mut entries: Vec<Entry> = stmt
        .query_map(
            rusqlite::params![cycle.start, cycle.end, project_id, min_duration],
            |row| {
                let comment: Option<String> = row.get(5)?;
                Ok(Entry {
                    is_manual: false,
                    id: row.get(0)?,
                    start_time: row.get(1)?,
                    duration_seconds: row.get(2)?,
                    rate_multiplier: row.get(3)?,
                    label: row.get(4)?,
                    has_comment: comment.map(|c| !c.trim().is_empty()).unwrap_or(false),
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Sesje ręczne liczą się do zużycia limitu, ale nie mają `rate_multiplier`,
    // więc nigdy nie trafiają na listę kandydatów do boostu.
    let mut stmt = conn
        .prepare_cached(
            "SELECT id, start_time, duration_seconds, title
             FROM manual_sessions
             WHERE project_id = ?1 AND date >= ?2 AND date <= ?3
             ORDER BY start_time ASC",
        )
        .map_err(|e| e.to_string())?;
    let manual: Vec<Entry> = stmt
        .query_map(
            rusqlite::params![project_id, cycle.start, cycle.end],
            |row| {
                Ok(Entry {
                    is_manual: true,
                    id: row.get(0)?,
                    start_time: row.get(1)?,
                    duration_seconds: row.get(2)?,
                    rate_multiplier: 1.0,
                    label: row.get(3)?,
                    has_comment: false,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    entries.extend(manual);
    entries.sort_by(|a, b| a.start_time.cmp(&b.start_time).then(a.id.cmp(&b.id)));
    Ok(entries)
}

/// Klasyfikacja pozycji względem limitu — czysta funkcja, żeby dało się ją przetestować
/// bez bazy. Zwraca `(zużyte sekundy, sekundy ponad limit, indeksy pozycji W CAŁOŚCI
/// ponad limitem)`.
fn classify(effective: &[f64], limit_seconds: f64) -> (f64, f64, Vec<usize>) {
    let mut used = 0.0_f64;
    let mut over_indexes = Vec::new();
    for (index, seconds) in effective.iter().enumerate() {
        if used >= limit_seconds {
            over_indexes.push(index);
        }
        used += seconds;
    }
    let over = (used - limit_seconds).max(0.0);
    (used, over, over_indexes)
}

pub(crate) fn compute_limit_status(
    conn: &Connection,
    project_id: i64,
    reference_date: Option<&str>,
    min_duration: i64,
) -> Result<Option<ProjectLimitStatus>, String> {
    let settings = load_limit_settings(conn, project_id)?;
    let Some(limit_hours) = settings.limit_hours else {
        return Ok(None);
    };

    let reference = reference_date
        .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        .unwrap_or_else(|| chrono::Local::now().date_naive());
    let (start, end) = cycle_bounds(settings.cycle_start_day, reference);
    let cycle = DateRange {
        start: start.format("%Y-%m-%d").to_string(),
        end: end.format("%Y-%m-%d").to_string(),
    };

    let entries = load_entries(conn, project_id, &cycle, min_duration)?;

    // Ten sam czas, co reszta aplikacji: dedup po źródle, przez aktywną strategię.
    let (_, _, _, _, _, effective_by_source) = compute_project_activity_unique(
        conn,
        &cycle,
        false,
        true,
        Some(project_id),
        Some(min_duration),
        true,
    )?;

    let effective: Vec<f64> = entries
        .iter()
        .map(|e| {
            effective_by_source
                .get(&source_key(e.is_manual, e.id))
                .copied()
                .unwrap_or(0.0)
        })
        .collect();

    let limit_seconds = limit_hours * 3600.0;
    let (used_seconds, over_seconds, over_indexes) = classify(&effective, limit_seconds);

    let mut manual_over_seconds = 0.0_f64;
    let mut over_sessions = Vec::new();
    let mut pending_boost_count = 0_i64;
    for index in over_indexes {
        let entry = &entries[index];
        if entry.is_manual {
            manual_over_seconds += effective[index];
            continue;
        }
        let needs_boost = entry.rate_multiplier <= 1.000_001;
        if needs_boost {
            pending_boost_count += 1;
        }
        over_sessions.push(OverLimitSession {
            id: entry.id,
            start_time: entry.start_time.clone(),
            app_name: entry.label.clone(),
            duration_seconds: entry.duration_seconds,
            effective_seconds: effective[index].round() as i64,
            rate_multiplier: entry.rate_multiplier,
            has_comment: entry.has_comment,
            needs_boost,
        });
    }

    Ok(Some(ProjectLimitStatus {
        limit_hours,
        cycle_start: cycle.start,
        cycle_end: cycle.end,
        cycle_start_day: settings.cycle_start_day as i64,
        used_seconds,
        used_hours: used_seconds / 3600.0,
        remaining_hours: (limit_seconds - used_seconds).max(0.0) / 3600.0,
        over_hours: over_seconds / 3600.0,
        percent: if limit_seconds > 0.0 {
            used_seconds / limit_seconds * 100.0
        } else {
            0.0
        },
        over_limit_multiplier: settings.multiplier,
        over_limit_comment: settings.comment_template,
        manual_over_hours: manual_over_seconds / 3600.0,
        over_sessions,
        pending_boost_count,
    }))
}

#[tauri::command]
pub async fn get_project_limit_status(
    app: AppHandle,
    project_id: i64,
    reference_date: Option<String>,
) -> Result<Option<ProjectLimitStatus>, CommandError> {
    let min_duration = load_persisted_session_min_duration();
    run_db_blocking(app, move |conn| {
        compute_limit_status(conn, project_id, reference_date.as_deref(), min_duration)
    })
    .await
    .map_err(CommandError::Other)
}

/// Lekki wariant dla listy projektów — bez listy sesji, tylko projekty z limitem.
#[tauri::command]
pub async fn get_projects_limit_overview(
    app: AppHandle,
) -> Result<Vec<ProjectLimitBadge>, CommandError> {
    let min_duration = load_persisted_session_min_duration();
    run_db_blocking(app, move |conn| {
        let ids: Vec<i64> = {
            let mut stmt = conn
                .prepare(
                    "SELECT id FROM projects \
                     WHERE monthly_hours_limit IS NOT NULL AND monthly_hours_limit > 0 \
                       AND excluded_at IS NULL AND merged_into IS NULL",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };

        let mut out = Vec::with_capacity(ids.len());
        for project_id in ids {
            if let Some(status) = compute_limit_status(conn, project_id, None, min_duration)? {
                out.push(ProjectLimitBadge {
                    project_id,
                    limit_hours: status.limit_hours,
                    used_hours: status.used_hours,
                    over_hours: status.over_hours,
                    percent: status.percent,
                    pending_boost_count: status.pending_boost_count,
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn update_project_limit(
    app: AppHandle,
    project_id: i64,
    limit_hours: Option<f64>,
    cycle_start_day: Option<i64>,
    multiplier: Option<f64>,
    comment_template: Option<String>,
) -> Result<(), CommandError> {
    if let Some(hours) = limit_hours {
        if !hours.is_finite() || hours <= 0.0 || hours > 24.0 * 366.0 {
            return Err(CommandError::Validation(
                "Limit must be a positive number of hours".to_string(),
            ));
        }
    }
    if let Some(day) = cycle_start_day {
        if !(1..=MAX_CYCLE_START_DAY as i64).contains(&day) {
            return Err(CommandError::Validation(
                "Cycle start day must be between 1 and 28".to_string(),
            ));
        }
    }
    if let Some(m) = multiplier {
        if !m.is_finite() || m < 1.0 || m > 10.0 {
            return Err(CommandError::Validation(
                "Multiplier must be between 1 and 10".to_string(),
            ));
        }
    }
    let comment_template = comment_template.filter(|c| !c.trim().is_empty());

    run_db_blocking(app, move |conn| {
        let updated = conn
            .execute(
                "UPDATE projects SET monthly_hours_limit = ?2, limit_cycle_start_day = ?3, \
                 over_limit_multiplier = ?4, over_limit_comment = ?5 WHERE id = ?1",
                rusqlite::params![
                    project_id,
                    limit_hours,
                    cycle_start_day,
                    multiplier,
                    comment_template
                ],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err("Project not found".to_string());
        }
        Ok(())
    })
    .await
    .map_err(CommandError::Other)
}

/// Nadaje mnożnik + komentarz sesjom w całości ponad limitem.
///
/// `session_ids` pochodzą z podglądu, ale są RE-WALIDOWANE serwerowo względem świeżo
/// policzonej listy kandydatów — front nie może zboostować sesji spoza limitu.
/// Istniejącego komentarza nie nadpisujemy; szablon trafia tylko do sesji bez komentarza
/// (boost bez komentarza odrzuca `update_session_rate_multiplier_tx`).
#[tauri::command]
pub async fn apply_project_limit_boost(
    app: AppHandle,
    project_id: i64,
    session_ids: Vec<i64>,
    comment_fallback: Option<String>,
) -> Result<i64, CommandError> {
    let min_duration = load_persisted_session_min_duration();
    run_db_blocking(app, move |conn| {
        let Some(status) = compute_limit_status(conn, project_id, None, min_duration)? else {
            return Err("Project has no hour limit configured".to_string());
        };

        let requested: std::collections::HashSet<i64> = session_ids.into_iter().collect();
        let targets: Vec<&OverLimitSession> = status
            .over_sessions
            .iter()
            .filter(|s| s.needs_boost && requested.contains(&s.id))
            .collect();
        if targets.is_empty() {
            return Ok(0);
        }

        let comment = status
            .over_limit_comment
            .clone()
            .or(comment_fallback)
            .map(|template| render_comment(&template, &status))
            .filter(|c| !c.trim().is_empty())
            .ok_or_else(|| "Boost requires a non-empty session comment".to_string())?;

        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut applied = 0_i64;
        for target in targets {
            if !target.has_comment {
                super::sessions::update_session_comment_tx(
                    &tx,
                    target.id,
                    &Some(comment.clone()),
                )?;
            }
            super::sessions::update_session_rate_multiplier_tx(
                &tx,
                target.id,
                status.over_limit_multiplier,
            )?;
            applied += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(applied)
    })
    .await
    .map_err(CommandError::Other)
}

/// Podstawia `{limit}` i `{period}` w szablonie komentarza.
fn render_comment(template: &str, status: &ProjectLimitStatus) -> String {
    template
        .replace("{limit}", &format!("{:.0}", status.limit_hours))
        .replace(
            "{period}",
            &format!("{} – {}", status.cycle_start, status.cycle_end),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).expect("valid date")
    }

    #[test]
    fn day_one_is_a_calendar_month() {
        let (start, end) = cycle_bounds(1, date(2026, 9, 17));
        assert_eq!(start, date(2026, 9, 1));
        assert_eq!(end, date(2026, 9, 30));
    }

    #[test]
    fn reference_before_start_day_falls_into_previous_cycle() {
        let (start, end) = cycle_bounds(15, date(2026, 9, 3));
        assert_eq!(start, date(2026, 8, 15));
        assert_eq!(end, date(2026, 9, 14));
    }

    #[test]
    fn reference_on_start_day_opens_a_new_cycle() {
        let (start, end) = cycle_bounds(15, date(2026, 9, 15));
        assert_eq!(start, date(2026, 9, 15));
        assert_eq!(end, date(2026, 10, 14));
    }

    #[test]
    fn cycle_crosses_the_year_boundary() {
        let (start, end) = cycle_bounds(20, date(2026, 1, 5));
        assert_eq!(start, date(2025, 12, 20));
        assert_eq!(end, date(2026, 1, 19));
    }

    #[test]
    fn day_28_survives_february() {
        let (start, end) = cycle_bounds(28, date(2026, 2, 28));
        assert_eq!(start, date(2026, 2, 28));
        assert_eq!(end, date(2026, 3, 27));
    }

    #[test]
    fn out_of_range_day_is_clamped_to_28() {
        let (start, _) = cycle_bounds(31, date(2026, 3, 30));
        assert_eq!(start, date(2026, 3, 28));
    }

    #[test]
    fn straddling_entry_is_not_marked_over_limit() {
        // Limit 10 h. Pozycje: 6 h, 6 h (przekracza w połowie), 2 h.
        let limit = 10.0 * 3600.0;
        let (used, over, indexes) = classify(&[6.0 * 3600.0, 6.0 * 3600.0, 2.0 * 3600.0], limit);
        assert_eq!(used, 14.0 * 3600.0);
        assert_eq!(over, 4.0 * 3600.0);
        // Pozycja 1 kończy się ponad limitem, ale ZACZYNA poniżej → nie boostujemy.
        assert_eq!(indexes, vec![2]);
    }

    #[test]
    fn entry_starting_exactly_at_the_limit_counts_as_over() {
        let limit = 10.0 * 3600.0;
        let (_, over, indexes) = classify(&[10.0 * 3600.0, 3.0 * 3600.0], limit);
        assert_eq!(over, 3.0 * 3600.0);
        assert_eq!(indexes, vec![1]);
    }

    #[test]
    fn under_limit_yields_nothing_to_boost() {
        let limit = 10.0 * 3600.0;
        let (used, over, indexes) = classify(&[3.0 * 3600.0, 4.0 * 3600.0], limit);
        assert_eq!(used, 7.0 * 3600.0);
        assert_eq!(over, 0.0);
        assert!(indexes.is_empty());
    }

    #[test]
    fn comment_template_substitutes_limit_and_period() {
        let status = ProjectLimitStatus {
            limit_hours: 65.0,
            cycle_start: "2026-09-01".to_string(),
            cycle_end: "2026-09-30".to_string(),
            cycle_start_day: 1,
            used_seconds: 0.0,
            used_hours: 0.0,
            remaining_hours: 0.0,
            over_hours: 0.0,
            percent: 0.0,
            over_limit_multiplier: 1.5,
            over_limit_comment: None,
            manual_over_hours: 0.0,
            over_sessions: Vec::new(),
            pending_boost_count: 0,
        };
        assert_eq!(
            render_comment("Ponad limit {limit} h ({period})", &status),
            "Ponad limit 65 h (2026-09-01 – 2026-09-30)"
        );
    }
}
