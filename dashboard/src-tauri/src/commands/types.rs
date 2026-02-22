use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ==================== JSON Import Types ====================

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct DailyData {
    #[allow(dead_code)]
    pub date: String,
    pub apps: HashMap<String, AppDailyData>,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct AppDailyData {
    pub display_name: String,
    #[allow(dead_code)]
    pub total_seconds: u64,
    pub sessions: Vec<JsonSession>,
    #[serde(default)]
    pub files: Vec<JsonFileEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct JsonSession {
    pub start: String,
    pub end: String,
    pub duration_seconds: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct JsonFileEntry {
    pub name: String,
    pub total_seconds: u64,
    pub first_seen: String,
    pub last_seen: String,
}

// ==================== Response Types ====================

#[derive(Serialize)]
pub struct ImportResult {
    pub file_path: String,
    pub success: bool,
    pub records_imported: usize,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub hourly_rate: Option<f64>,
    pub created_at: String,
    pub excluded_at: Option<String>,
    pub assigned_folder_path: Option<String>,
    pub is_imported: i64,
}

#[derive(Serialize)]
pub struct ProjectWithStats {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub created_at: String,
    pub excluded_at: Option<String>,
    pub total_seconds: i64,
    pub app_count: i64,
    pub last_activity: Option<String>,
    pub assigned_folder_path: Option<String>,
}

#[derive(Serialize)]
pub struct AppWithStats {
    pub id: i64,
    pub executable_name: String,
    pub display_name: String,
    pub project_id: Option<i64>,
    pub total_seconds: i64,
    pub session_count: i64,
    pub last_used: Option<String>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub color: Option<String>,
}

#[derive(Serialize)]
pub struct SessionWithApp {
    pub id: i64,
    pub app_id: i64,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: i64,
    pub app_name: String,
    pub executable_name: String,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub files: Vec<FileActivity>,
    pub suggested_project_id: Option<i64>,
    pub suggested_project_name: Option<String>,
    pub suggested_confidence: Option<f64>,
}

#[derive(Serialize, Clone)]
pub struct FileActivity {
    pub id: i64,
    pub app_id: i64,
    pub file_name: String,
    pub total_seconds: i64,
    pub first_seen: String,
    pub last_seen: String,
    pub project_id: Option<i64>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
}

#[derive(Serialize)]
pub struct DashboardStats {
    pub total_seconds: i64,
    pub app_count: i64,
    pub session_count: i64,
    pub avg_daily_seconds: i64,
    pub top_apps: Vec<TopApp>,
    pub top_project: Option<TopProject>,
}

#[derive(Serialize)]
pub struct TopApp {
    pub name: String,
    pub seconds: i64,
    pub color: Option<String>,
}

#[derive(Serialize)]
pub struct TopProject {
    pub name: String,
    pub seconds: i64,
    pub color: String,
}

#[derive(Serialize)]
pub struct ProjectTimeRow {
    pub name: String,
    pub seconds: i64,
    pub color: String,
    pub session_count: i64,
    pub app_count: i64,
}

#[derive(Serialize)]
pub struct TimelinePoint {
    pub date: String,
    pub seconds: i64,
}

#[derive(Serialize)]
pub struct HourlyData {
    pub hour: i32,
    pub seconds: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EstimateSettings {
    pub global_hourly_rate: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EstimateProjectRow {
    pub project_id: i64,
    pub project_name: String,
    pub project_color: String,
    pub seconds: i64,
    pub hours: f64,
    pub project_hourly_rate: Option<f64>,
    pub effective_hourly_rate: f64,
    pub estimated_value: f64,
    pub session_count: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EstimateSummary {
    pub total_seconds: i64,
    pub total_hours: f64,
    pub total_value: f64,
    pub projects_count: i64,
    pub overrides_count: i64,
}

#[derive(Serialize)]
pub struct HeatmapCell {
    pub day: i32,
    pub hour: i32,
    pub seconds: i64,
}

#[derive(Serialize)]
pub struct StackedBarData {
    pub date: String,
    #[serde(flatten)]
    pub data: HashMap<String, i64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DateRange {
    pub start: String,
    pub end: String,
}

#[derive(Deserialize, Clone)]
pub struct SessionFilters {
    #[serde(rename = "dateRange")]
    pub date_range: Option<DateRange>,
    #[serde(rename = "appId")]
    pub app_id: Option<i64>,
    #[serde(rename = "projectId")]
    pub project_id: Option<i64>,
    pub unassigned: Option<bool>,
    #[serde(rename = "minDuration")]
    pub min_duration: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Serialize)]
pub struct ImportedFileInfo {
    pub file_path: String,
    pub import_date: String,
    pub records_count: i64,
}

#[derive(Serialize)]
pub struct ArchivedFileInfo {
    pub file_name: String,
    pub file_path: String,
    pub modified_at: String,
    pub size_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectFolder {
    pub path: String,
    pub added_at: String,
}

#[derive(Serialize)]
pub struct FolderProjectCandidate {
    pub name: String,
    pub folder_path: String,
    pub root_path: String,
    pub already_exists: bool,
}

#[derive(Serialize)]
pub struct AutoImportResult {
    pub files_found: usize,
    pub files_imported: usize,
    pub files_skipped: usize,
    pub files_archived: usize,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
pub struct DetectedProject {
    pub file_name: String,
    pub total_seconds: i64,
    pub occurrence_count: i64,
    pub apps: Vec<String>,
    pub first_seen: String,
    pub last_seen: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MonitoredApp {
    pub exe_name: String,
    pub display_name: String,
    pub added_at: String,
}

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct MonitoredConfig {
    pub apps: Vec<MonitoredApp>,
}

#[derive(Serialize)]
pub struct DaemonStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub exe_path: Option<String>,
    pub autostart: bool,
    pub needs_assignment: bool,
    pub unassigned_sessions: i64,
    pub unassigned_apps: i64,
}

#[derive(Serialize)]
pub struct RefreshResult {
    pub sessions_upserted: usize,
    pub file_found: bool,
}

#[derive(Serialize)]
pub struct TodayFileSignature {
    pub exists: bool,
    pub path: String,
    pub modified_unix_ms: Option<u128>,
    pub size_bytes: Option<u64>,
}

// ==================== Manual Sessions ====================

#[derive(Serialize, Deserialize, Clone)]
pub struct ManualSession {
    pub id: i64,
    pub title: String,
    pub session_type: String,
    pub project_id: i64,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: i64,
    pub date: String,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct ManualSessionWithProject {
    pub id: i64,
    pub title: String,
    pub session_type: String,
    pub project_id: i64,
    pub project_name: String,
    pub project_color: String,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: i64,
    pub date: String,
}

#[derive(Deserialize)]
pub struct CreateManualSessionInput {
    pub title: String,
    pub session_type: String,
    pub project_id: i64,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Deserialize)]
pub struct ManualSessionFilters {
    #[serde(rename = "dateRange")]
    pub date_range: Option<DateRange>,
    #[serde(rename = "projectId")]
    pub project_id: Option<i64>,
}

// ==================== Export/Import Archive Types ====================

#[derive(Serialize, Deserialize)]
pub struct ExportArchive {
    pub version: String,
    pub exported_at: String,
    pub machine_id: String,
    pub export_type: String,
    pub date_range: DateRange,
    pub metadata: ExportMetadata,
    pub data: ExportData,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ExportMetadata {
    pub project_id: Option<i64>,
    pub project_name: Option<String>,
    pub total_sessions: i64,
    pub total_seconds: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ExportData {
    pub projects: Vec<Project>,
    pub applications: Vec<ApplicationRow>,
    pub sessions: Vec<SessionRow>,
    pub manual_sessions: Vec<ManualSession>,
    pub daily_files: HashMap<String, DailyData>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ApplicationRow {
    pub id: i64,
    pub executable_name: String,
    pub display_name: String,
    pub project_id: Option<i64>,
    pub is_imported: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionRow {
    pub id: i64,
    pub app_id: i64,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: i64,
    pub date: String,
}

#[derive(Serialize)]
pub struct ImportValidation {
    pub valid: bool,
    pub missing_projects: Vec<String>,
    pub missing_applications: Vec<String>,
    pub overlapping_sessions: Vec<SessionConflict>,
}

#[derive(Serialize)]
pub struct SessionConflict {
    pub app_name: String,
    pub start: String,
    pub end: String,
    pub existing_start: String,
    pub existing_end: String,
}

#[derive(Serialize)]
pub struct ImportSummary {
    pub projects_created: usize,
    pub apps_created: usize,
    pub sessions_imported: usize,
    pub sessions_merged: usize,
    pub daily_files_imported: usize,
}
