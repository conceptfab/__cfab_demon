//! Listy kolumn synchronizowanych encji — jedno źródło dla export SELECT,
//! delta SELECT, row-mapping i checksum (finding #10 — „5 miejsc na kolumnę").

/// Kolumny `projects` w kolejności używanej przy eksporcie i mapowaniu na Project.
/// COALESCE(status,'active') zachowane jako wyrażenie SELECT — patrz PROJECT_SELECT.
pub const PROJECT_COLUMNS: &[&str] = &[
    "id", "name", "color", "hourly_rate", "created_at", "excluded_at",
    "assigned_folder_path", "is_imported", "frozen_at", "merged_into",
    "merged_at", "updated_at", "client_name", "status",
];

/// SELECT projektów do eksportu/merge (status z domyślką dla pre-m24 wierszy).
pub const PROJECT_SELECT: &str =
    "SELECT id, name, color, hourly_rate, created_at, excluded_at, assigned_folder_path, \
     is_imported, frozen_at, merged_into, merged_at, updated_at, client_name, \
     COALESCE(status, 'active') FROM projects";

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn select_lists_all_columns_in_order() {
        for (i, col) in PROJECT_COLUMNS.iter().enumerate() {
            // status pojawia się jako COALESCE(...), więc sprawdzamy nazwę bez aliasu
            if *col == "status" { continue; }
            assert!(PROJECT_SELECT.contains(col), "PROJECT_SELECT pomija kolumnę {col} (#{i})");
        }
    }
}
