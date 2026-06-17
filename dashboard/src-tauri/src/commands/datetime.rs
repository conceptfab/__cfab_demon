use chrono::{DateTime, FixedOffset, Local, LocalResult, NaiveDateTime, TimeZone};

fn local_from_naive(naive: NaiveDateTime) -> Option<DateTime<Local>> {
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(value, _) => Some(value),
        LocalResult::None => None,
    }
}

fn fixed_from_naive_local(naive: NaiveDateTime) -> Option<DateTime<FixedOffset>> {
    local_from_naive(naive).map(|dt| dt.fixed_offset())
}

pub(crate) fn parse_datetime_fixed(value: &str) -> Option<DateTime<FixedOffset>> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        return Some(dt);
    }

    // Naive formats (no offset) come from manual-session forms and are saved
    // in LOCAL time — same as the frontend interprets them via Date.parse.
    // Treating them as UTC caused a 1-2 h shift, wrong day buckets, broken dedup.
    for fmt in [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S.%f",
    ] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(value, fmt) {
            return fixed_from_naive_local(ndt);
        }
    }

    None
}

pub(crate) fn parse_datetime_local(value: &str) -> Option<DateTime<Local>> {
    if let Some(dt) = parse_datetime_fixed(value) {
        return Some(dt.with_timezone(&Local));
    }

    for fmt in ["%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(value, fmt) {
            return local_from_naive(naive);
        }
    }

    None
}

pub(crate) fn parse_datetime_ms(value: &str) -> i64 {
    parse_datetime_fixed(value)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

pub(crate) fn parse_datetime_ms_opt(value: &str) -> Option<i64> {
    parse_datetime_fixed(value).map(|dt| dt.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, TimeZone};

    #[test]
    fn naive_timestamps_are_interpreted_as_local_time() {
        for value in [
            "2026-01-15T09:00:00",
            "2026-01-15 09:00:00",
            "2026-01-15T09:00:00.500",
            "2026-01-15 09:00:00.500",
        ] {
            let parsed = parse_datetime_fixed(value).expect("parses");
            let expected = Local.with_ymd_and_hms(2026, 1, 15, 9, 0, 0).unwrap();
            assert_eq!(
                parsed.timestamp(),
                expected.timestamp(),
                "naiwny timestamp '{}' musi byc czasem LOKALNYM (spojnie z JS Date.parse)",
                value
            );
        }
    }

    #[test]
    fn rfc3339_timestamps_are_unchanged() {
        let parsed = parse_datetime_fixed("2026-01-15T09:00:00+02:00").expect("parses");
        let reference = chrono::DateTime::parse_from_rfc3339("2026-01-15T09:00:00+02:00").unwrap();
        assert_eq!(parsed, reference);
    }
}
