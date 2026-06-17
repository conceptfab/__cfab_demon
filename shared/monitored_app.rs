use serde::{Deserialize, Serialize};

/// Pojedyncza monitorowana aplikacja — wspólna definicja dla demona i dashboardu.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MonitoredApp {
    pub exe_name: String,
    pub display_name: String,
    pub added_at: String,
    /// macOS: CFBundleIdentifier (lowercase). Precyzyjne dopasowanie foreground.
    #[serde(default)]
    pub bundle_id: Option<String>,
    /// macOS: ścieżka do bundle `.app` (lowercase). Dopasowanie CPU w tle po prefiksie.
    #[serde(default)]
    pub app_path: Option<String>,
}
