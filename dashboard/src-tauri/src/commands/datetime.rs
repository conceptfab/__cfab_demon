pub(crate) fn parse_datetime_fixed(value: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        return Some(dt);
    }

    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S.%f") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S.%f") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    None
}

pub(crate) fn parse_datetime_ms(value: &str) -> i64 {
    parse_datetime_fixed(value)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}
