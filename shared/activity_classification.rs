use std::collections::HashMap;
use std::str::FromStr;
use std::sync::OnceLock;

/// Activity type categories for file activity tagging.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityType {
    Coding,
    Browsing,
    Design,
}

impl ActivityType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Coding => "coding",
            Self::Browsing => "browsing",
            Self::Design => "design",
        }
    }
}

impl FromStr for ActivityType {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "coding" => Ok(Self::Coding),
            "browsing" => Ok(Self::Browsing),
            "design" => Ok(Self::Design),
            _ => Err(()),
        }
    }
}

/// Returns the default exe→ActivityType map (lazily initialized, shared across calls).
pub fn default_classification_map() -> &'static HashMap<&'static str, ActivityType> {
    static MAP: OnceLock<HashMap<&'static str, ActivityType>> = OnceLock::new();
    MAP.get_or_init(|| {
        let mut map = HashMap::new();
        // Coding (Windows .exe + macOS localizedName lowercase)
        for exe in &[
            "code.exe",
            "code-insiders.exe",
            "cursor.exe",
            "idea64.exe",
            "pycharm64.exe",
            "webstorm64.exe",
            "clion64.exe",
            "rider64.exe",
            "devenv.exe",
            "notepad++.exe",
            "vim.exe",
            "nvim.exe",
            // macOS
            "visual studio code",
            "code",
            "cursor",
            "intellij idea",
            "pycharm",
            "webstorm",
            "clion",
            "rider",
            "xcode",
            "zed",
            "nova",
        ] {
            map.insert(*exe, ActivityType::Coding);
        }
        // Browsing (Windows .exe + macOS localizedName lowercase)
        for exe in &[
            "chrome.exe",
            "msedge.exe",
            "firefox.exe",
            "brave.exe",
            "opera.exe",
            "opera_gx.exe",
            "vivaldi.exe",
            "arc.exe",
            // macOS
            "google chrome",
            "microsoft edge",
            "firefox",
            "brave browser",
            "opera",
            "vivaldi",
            "arc",
            "safari",
        ] {
            map.insert(*exe, ActivityType::Browsing);
        }
        // Design (Windows .exe + macOS localizedName lowercase)
        for exe in &[
            "figma.exe",
            "photoshop.exe",
            "illustrator.exe",
            "blender.exe",
            "gimp-2.10.exe",
            "inkscape.exe",
            "adobexd.exe",
            // macOS
            "figma",
            "adobe photoshop 2024",
            "adobe photoshop 2025",
            "adobe illustrator 2024",
            "adobe illustrator 2025",
            "adobe xd",
            "blender",
            "gimp",
            "inkscape",
            "sketch",
            "affinity designer",
            "affinity photo",
        ] {
            map.insert(*exe, ActivityType::Design);
        }
        map
    })
}

/// Classifies an exe name using the default map + optional overrides.
pub fn classify_activity_type(
    exe_name: &str,
    overrides: Option<&HashMap<String, String>>,
) -> Option<ActivityType> {
    let exe = exe_name.to_lowercase();

    // Check overrides first
    if let Some(overrides) = overrides {
        if let Some(type_str) = overrides.get(&exe) {
            return type_str.parse().ok();
        }
    }

    // Fall back to default map
    default_classification_map().get(exe.as_str()).copied()
}
