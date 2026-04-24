// Wspólne helpery używane zarówno przez Windows (`monitor.rs`), jak i macOS (`monitor_macos.rs`).
// Żaden kod w tym module nie używa API zależnego od platformy — to czysta logika.

use std::collections::{HashMap, HashSet};

use crate::activity::ActivityType;

/// Klasyfikuje aktywność aplikacji po nazwie pliku wykonywalnego.
/// Thin wrapper nad `timeflow_shared::activity_classification::classify_activity_type`
/// — opakowuje `None` jako drugi argument, żeby wywołujący nie musieli o nim pamiętać.
pub fn classify_activity_type(exe_name: &str) -> Option<ActivityType> {
    timeflow_shared::activity_classification::classify_activity_type(exe_name, None)
}

/// Heurystyka wyciągania nazwy pliku z tytułu okna aplikacji.
/// Priorytet separatorów: ` — ` i ` | ` (rfind) przed ` - ` (rfind) przed ` @ ` (find).
/// Przykłady:
///   `"main.rs - timeflow_demon - Visual Studio Code"` → `"main.rs - timeflow_demon"`
///   `"projekt.psd @ 100% (RGB/8)"` → `"projekt.psd"`
///   `"Blender"` → `"Blender"`
pub fn extract_file_from_title(title: &str) -> String {
    let separators = [" — ", " | "];
    for sep in separators {
        if let Some(pos) = title.rfind(sep) {
            let left = title[..pos].trim();
            if !left.is_empty() {
                return left.to_string();
            }
        }
    }

    if let Some(pos) = title.rfind(" - ") {
        let left = title[..pos].trim();
        if !left.is_empty() {
            return left.to_string();
        }
    }

    if let Some(pos) = title.find(" @ ") {
        let left = title[..pos].trim();
        if !left.is_empty() {
            return left.to_string();
        }
    }

    title.trim().to_string()
}

/// Rekurencyjnie zbiera wszystkich potomków `root` w drzewie PID→children.
/// `visited` chroni przed cyklami.
pub(crate) fn collect_descendants(
    tree: &HashMap<u32, Vec<u32>>,
    root: u32,
    result: &mut Vec<u32>,
    visited: &mut HashSet<u32>,
) {
    if !visited.insert(root) {
        return;
    }
    if let Some(children) = tree.get(&root) {
        for &child in children {
            result.push(child);
            collect_descendants(tree, child, result, visited);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_file_single_separator() {
        assert_eq!(
            extract_file_from_title("main.rs - timeflow_demon - Visual Studio Code"),
            "main.rs - timeflow_demon"
        );
    }

    #[test]
    fn extract_file_at_separator() {
        assert_eq!(
            extract_file_from_title("projekt.psd @ 100% (RGB/8)"),
            "projekt.psd"
        );
    }

    #[test]
    fn extract_file_no_separator() {
        assert_eq!(extract_file_from_title("Blender"), "Blender");
    }

    #[test]
    fn extract_file_pipe_separator() {
        assert_eq!(extract_file_from_title("file.py | VS Code"), "file.py");
    }

    #[test]
    fn extract_file_mixed_separators() {
        assert_eq!(
            extract_file_from_title("file.py - projekt | VS Code"),
            "file.py - projekt"
        );
    }

    #[test]
    fn extract_file_empty_after_trim() {
        assert_eq!(extract_file_from_title("   "), "");
    }

    #[test]
    fn extract_file_em_dash() {
        assert_eq!(extract_file_from_title("dokument — Edytor"), "dokument");
    }

    #[test]
    fn classify_activity_type_for_known_apps() {
        assert_eq!(classify_activity_type("code.exe"), Some(ActivityType::Coding));
        assert_eq!(
            classify_activity_type("chrome.exe"),
            Some(ActivityType::Browsing)
        );
        assert_eq!(
            classify_activity_type("blender.exe"),
            Some(ActivityType::Design)
        );
        assert_eq!(classify_activity_type("unknown.exe"), None);
    }

    #[test]
    fn collect_descendants_walks_tree_without_cycles() {
        let mut tree: HashMap<u32, Vec<u32>> = HashMap::new();
        tree.insert(1, vec![2, 3]);
        tree.insert(2, vec![4]);
        tree.insert(3, vec![5, 6]);
        tree.insert(5, vec![1]); // cycle back to root — recursion must terminate

        let mut result = Vec::new();
        let mut visited = HashSet::new();
        collect_descendants(&tree, 1, &mut result, &mut visited);

        // Every child (including the cycle-causing edge 5→1) is pushed once,
        // then the recursion terminates when it re-visits root.
        result.sort();
        assert_eq!(result, vec![1, 2, 3, 4, 5, 6]);
    }
}
