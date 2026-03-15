use serde::{Deserialize, Serialize};

/// Pojedyncza monitorowana aplikacja — wspólna definicja dla demona i dashboardu.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MonitoredApp {
    pub exe_name: String,
    pub display_name: String,
    pub added_at: String,
}
