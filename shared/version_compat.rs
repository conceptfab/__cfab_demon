pub fn check_version_compatibility(v1: &str, v2: &str) -> bool {
    let parse = |v: &str| -> Option<(i32, i32, i32)> {
        let parts: Vec<&str> = v.trim().split('.').collect();
        if parts.len() != 3 {
            return None;
        }
        Some((
            parts[0].parse().ok()?,
            parts[1].parse().ok()?,
            parts[2].parse().ok()?,
        ))
    };

    match (parse(v1), parse(v2)) {
        (Some((maj1, min1, rel1)), Some((maj2, min2, rel2))) => {
            if maj1 != maj2 || min1 != min2 {
                return false;
            }
            rel1.abs_diff(rel2) <= 3
        }
        // Be permissive when a version string cannot be parsed (missing/corrupted file).
        // A strict "false" here blocks startup with a mismatch warning even without real incompatibility.
        _ => true,
    }
}
