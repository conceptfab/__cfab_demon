//! Normalizacja znaczników czasu do formatu SQLite ("YYYY-MM-DD HH:MM:SS", UTC),
//! by porównanie leksykograficzne było poprawne dla LWW. Wcześniej zaimplementowane
//! niezależnie po obu stronach (finding #1) — tu jedno źródło.

/// LWW-merge (daemon): RFC3339/offset → UTC; fallback naive.
pub fn normalize_ts(ts: &str) -> String {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        return dt.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    if let Ok(dt) = chrono::DateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%z") {
        return dt.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S"))
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|_| ts.to_string())
}

/// Eksport (dashboard): fast-path dla już-SQLite, RFC3339 → UTC, fallback obcięcia.
pub fn normalize_datetime_for_sqlite(s: &str) -> String {
    if s.len() == 19 && !s.contains('T') && !s.ends_with('Z') {
        return s.to_string();
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return dt.with_timezone(&chrono::Utc).format("%Y-%m-%d %H:%M:%S").to_string();
    }
    let s = s.replace('T', " ");
    let s = s.trim_end_matches('Z');
    if let Some(dot_pos) = s.find('.') {
        s[..dot_pos].to_string()
    } else if s.len() > 19 {
        s[..19].to_string()
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_agree_on_common_inputs() {
        for input in ["2026-03-29T10:00:00Z", "2026-03-29T10:00:00+02:00", "2026-03-29 08:00:00"] {
            assert_eq!(normalize_ts(input), normalize_datetime_for_sqlite(input),
                "rozjazd normalizacji dla {input}");
        }
    }

    #[test]
    fn utc_conversion() {
        assert_eq!(normalize_ts("2026-03-29T10:00:00+02:00"), "2026-03-29 08:00:00");
        assert_eq!(normalize_datetime_for_sqlite("2026-03-29T10:00:00+02:00"), "2026-03-29 08:00:00");
    }
}
