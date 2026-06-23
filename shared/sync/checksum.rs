//! Kanoniczna checksum treści tabeli (SHA-256 → 128-bit, hex 32 znaki).
//! Jedno źródło dla daemona i dashboardu (finding #2 — wcześniej rozjazd
//! SHA-256/128 vs FNV-1a/64, plus komentarz referujący nieistniejącą fn).

use sha2::{Digest, Sha256};

/// Hash treści: SHA-256 z bajtów, obcięty do 128 bitów, sformatowany jako 32-znakowy hex.
pub fn content_hash(concat: &str) -> String {
    let digest = Sha256::digest(concat.as_bytes());
    let mut bytes16 = [0u8; 16];
    bytes16.copy_from_slice(&digest[..16]);
    format!("{:032x}", u128::from_be_bytes(bytes16))
}

/// SQL budujący wejście do content_hash dla danej encji.
/// Hashuje PEŁNY zestaw synchronizowanych kolumn (finding #3) — nie tylko
/// key+updated_at — by rozjazd przy równym updated_at był wykrywalny.
///
/// FK (app_id/project_id) są LOKALNE i remapowane per maszyna, więc NIGDY ich
/// nie hashujemy — rozwiązujemy do stabilnej nazwy (projects.name / applications.
/// executable_name) korelowanym podzapytaniem. Inaczej dwa zbieżne peery dałyby
/// różny hash i sync nigdy nie zgłosiłby konwergencji.
pub fn table_hash_sql(table: &str) -> Option<&'static str> {
    Some(match table {
        "projects" =>
            "SELECT COALESCE(group_concat( \
                name || '|' || COALESCE(color,'') || '|' || COALESCE(hourly_rate,'') || '|' || \
                COALESCE(excluded_at,'') || '|' || COALESCE(frozen_at,'') || '|' || \
                COALESCE(merged_into,'') || '|' || COALESCE(client_name,'') || '|' || \
                COALESCE(status,'') || '|' || updated_at, ';'), '') \
             FROM (SELECT * FROM projects ORDER BY name)",
        "clients" =>
            "SELECT COALESCE(group_concat( \
                name || '|' || COALESCE(contact,'') || '|' || COALESCE(address,'') || '|' || \
                COALESCE(tax_id,'') || '|' || COALESCE(currency,'') || '|' || \
                COALESCE(default_hourly_rate,'') || '|' || COALESCE(color,'') || '|' || \
                COALESCE(archived_at,'') || '|' || updated_at, ';'), '') \
             FROM (SELECT * FROM clients ORDER BY name)",
        "applications" =>
            "SELECT COALESCE(group_concat( \
                executable_name || '|' || display_name || '|' || COALESCE(proj_name,'') || '|' || \
                COALESCE(color,'') || '|' || updated_at, ';'), '') \
             FROM (SELECT a.executable_name, a.display_name, \
                          (SELECT p.name FROM projects p WHERE p.id = a.project_id) AS proj_name, \
                          a.color, \
                          a.updated_at \
                   FROM applications a ORDER BY a.executable_name)",
        "sessions" =>
            "SELECT COALESCE(group_concat( \
                app_name || '|' || start_time || '|' || end_time || '|' || duration_seconds || '|' || \
                date || '|' || rate_multiplier || '|' || COALESCE(comment,'') || '|' || \
                COALESCE(is_hidden,'') || '|' || COALESCE(proj_name,'') || '|' || updated_at, ';'), '') \
             FROM (SELECT a.executable_name AS app_name, s.start_time, s.end_time, s.duration_seconds, \
                          s.date, s.rate_multiplier, s.comment, s.is_hidden, \
                          (SELECT p.name FROM projects p WHERE p.id = s.project_id) AS proj_name, \
                          s.updated_at \
                   FROM sessions s JOIN applications a ON s.app_id = a.id \
                   ORDER BY a.executable_name, s.start_time)",
        "manual_sessions" =>
            "SELECT COALESCE(group_concat( \
                title || '|' || session_type || '|' || start_time || '|' || end_time || '|' || \
                duration_seconds || '|' || date || '|' || COALESCE(proj_name,'') || '|' || \
                COALESCE(app_name,'') || '|' || updated_at, ';'), '') \
             FROM (SELECT m.title, m.session_type, m.start_time, m.end_time, m.duration_seconds, m.date, \
                          (SELECT p.name FROM projects p WHERE p.id = m.project_id) AS proj_name, \
                          (SELECT a.executable_name FROM applications a WHERE a.id = m.app_id) AS app_name, \
                          m.updated_at \
                   FROM manual_sessions m ORDER BY m.title, m.start_time)",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_32_hex_chars() {
        let a = content_hash("Acme|#fff|2026-01-01 00:00:00");
        let b = content_hash("Acme|#fff|2026-01-01 00:00:00");
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn distinct_input_distinct_hash() {
        assert_ne!(content_hash("a"), content_hash("b"));
        assert_ne!(content_hash(""), content_hash("a"));
    }
}

#[cfg(test)]
mod table_hash_sql_tests {
    use super::*;
    #[test]
    fn known_tables_have_sql_unknown_none() {
        for t in ["projects", "clients", "applications", "sessions", "manual_sessions"] {
            assert!(table_hash_sql(t).is_some(), "brak SQL dla {t}");
        }
        assert!(table_hash_sql("assignment_feedback").is_none());
        assert!(table_hash_sql("nonexistent").is_none());
    }
}
