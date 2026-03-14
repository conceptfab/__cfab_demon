use chrono::{DateTime, FixedOffset, Local, LocalResult, NaiveDateTime, TimeZone};

fn local_from_naive(naive: NaiveDateTime) -> Option<DateTime<Local>> {
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(value, _) => Some(value),
        LocalResult::None => None,
    }
}

pub(crate) fn parse_datetime_fixed(value: &str) -> Option<DateTime<FixedOffset>> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        return Some(dt);
    }

    if let Ok(ndt) = NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    if let Ok(ndt) = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    if let Ok(ndt) = NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S.%f") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    if let Ok(ndt) = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S.%f") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
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
