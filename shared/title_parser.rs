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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_app_name_suffix() {
        assert_eq!(
            extract_file_from_title("main.rs - timeflow_demon - Visual Studio Code"),
            "main.rs - timeflow_demon"
        );
    }

    #[test]
    fn handles_at_separator() {
        assert_eq!(extract_file_from_title("projekt.psd @ 100% (RGB/8)"), "projekt.psd");
    }

    #[test]
    fn passes_through_plain_title() {
        assert_eq!(extract_file_from_title("Blender"), "Blender");
    }
}
