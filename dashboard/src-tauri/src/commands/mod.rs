mod error;
pub(crate) use error::CommandError;

mod analysis;
mod assignment_model;
mod bughunter;
mod clients;
mod daemon;
pub(crate) mod daily_store_bridge;
mod dashboard;
mod database;
mod datetime;
mod delta_export;
mod estimates;
mod export;
pub mod helpers;
mod import;
mod import_data;
mod lan_server;
mod log_management;
mod lan_sync;
mod online_sync;
mod manual_sessions;
mod monitored;
mod projects;
mod report;
mod secure_store;
mod sessions;
mod settings;
mod sql_fragments;
mod sync_log;
mod sync_markers;
mod time_algorithm;
mod types;
mod user_settings;
mod pm_manager;
mod pm;
mod webserver;
pub(crate) use timeflow_shared::daily_store;
pub(crate) use types::DateRange;

// Finding #78: the re-exports below use glob syntax because #[tauri::command] generates
// macro_rules! helper items (__cmd__X, __tauri_command_name_X) that are resolved by
// generate_handler![] via the module path (commands::__cmd__X). Explicitly listing those
// generated identifiers alongside the command functions would triple the line count with
// pure mechanical churn and no readability benefit.
//
// The EXPLICIT command surface is documented per module below. Any command that disappears
// from a module will surface as an E0433 in lib.rs (generate_handler![]) — which is the
// effective dead-code gate for the tauri command surface.
//
// analysis (1):       get_project_timeline
// assignment_model (19): apply_deterministic_assignment, auto_run_if_needed,
//                     clear_folder_scan_data, get_assignment_model_metrics,
//                     get_assignment_model_status, get_folder_scan_status,
//                     get_session_score_breakdown, reset_model_full, reset_model_weights,
//                     rollback_last_auto_safe_run, run_auto_safe_assignment,
//                     scan_project_folders_for_ai, set_assignment_mode,
//                     set_assignment_model_cooldown, set_decay_half_life_days,
//                     set_feedback_weight, set_training_blacklists,
//                     set_training_horizon_days, train_assignment_model
// bughunter (1):      send_bug_report
// clients (10):       clients_archive, clients_create, clients_delete, clients_list,
//                     clients_sync_from_pm, clients_update, get_clients_summary,
//                     project_set_client, project_set_status, projects_with_client
// daemon (13):        get_autostart_enabled, get_background_diagnostics, get_daemon_logs,
//                     get_daemon_runtime_status, get_daemon_status, get_persisted_language,
//                     persist_lan_sync_settings_for_daemon, persist_language_for_daemon,
//                     persist_session_settings_for_daemon, restart_daemon,
//                     set_autostart_enabled, start_daemon, stop_daemon
// dashboard (6):      get_activity_date_span, get_applications, get_dashboard_data,
//                     get_dashboard_stats, get_timeline, update_app_color
// database (11):      cleanup_data_folder, get_backup_files, get_data_folder_stats,
//                     get_database_settings, get_db_info, open_db_folder, optimize_database,
//                     perform_manual_backup, restore_database_from_file,
//                     update_database_settings, vacuum_database
// delta_export (1):   build_delta_archive
// estimates (5):      get_estimate_settings, get_estimates_summary, get_project_estimates,
//                     update_global_hourly_rate, update_project_hourly_rate
// export (2):         export_data, export_data_archive
// import (6):         auto_import_from_data_dir, delete_archive_file, get_archive_files,
//                     get_detected_projects, get_imported_files, import_json_files
// import_data (3):    import_data, import_data_archive, validate_import
// lan_server (4):     get_lan_server_status, get_local_ips, start_lan_server, stop_lan_server
// lan_sync (12):      build_table_hashes_only, generate_pairing_code, get_lan_peers,
//                     get_lan_sync_log, get_lan_sync_progress, get_paired_devices,
//                     ping_lan_peer, run_lan_sync, scan_lan_subnet, submit_pairing_code,
//                     unpair_device, upsert_lan_peer
// log_management (6): clear_log_file, get_log_files_info, get_log_settings, open_logs_folder,
//                     read_log_file, save_log_settings
// online_sync (6):    cancel_online_sync, get_online_sync_progress, get_online_sync_result,
//                     get_online_sync_settings, run_online_sync, save_online_sync_settings
// manual_sessions (5): create_manual_session, delete_manual_session, delete_manual_sessions,
//                     get_manual_sessions, update_manual_session
// monitored (6):      add_monitored_app, get_monitored_apps, inspect_dropped_app,
//                     remove_monitored_app, rename_monitored_app,
//                     sync_monitored_apps_from_applications
// projects (27):      add_project_folder, assign_app_to_project,
//                     auto_create_projects_from_detection, auto_freeze_projects,
//                     blacklist_project_names, compact_project_data, create_project,
//                     create_project_from_folder, delete_all_excluded_projects, delete_project,
//                     exclude_project, freeze_project, get_excluded_projects,
//                     get_folder_project_candidates, get_merged_projects, get_project,
//                     get_project_extra_info, get_project_folders, get_projects, merge_project,
//                     remove_project_folder, restore_project, sync_projects_from_folders,
//                     unfreeze_project, unmerge_project, update_project,
//                     update_project_folder_meta
// report (2):         get_project_report_data, print_report
// secure_store (2):   get_secure_token, set_secure_token
// sessions (15):      analyze_session_projects, analyze_sessions_splittable,
//                     assign_session_to_project, assign_sessions_to_project, delete_session,
//                     delete_sessions, get_session_count, get_sessions, rebuild_sessions,
//                     split_session, split_session_multi, update_session_comment,
//                     update_session_comments, update_session_rate_multiplier,
//                     update_session_rate_multipliers
// settings (11):      clear_all_data, delete_app_and_data, get_data_dir, get_demo_mode_status,
//                     get_today_file_signature, refresh_missing_days, refresh_today,
//                     rename_application, reset_app_time, reset_project_time, set_demo_mode
// sync_log (2):       append_sync_log, get_sync_log
// sync_markers (4):   backup_before_sync, get_latest_sync_marker, insert_sync_marker,
//                     markers_match
// time_algorithm (3): get_time_algorithm, list_time_algorithms, set_time_algorithm
// user_settings (3):  get_all_user_settings, set_user_setting, webui_is_headless_process
// pm (15):            pm_create_project, pm_delete_project, pm_delete_template,
//                     pm_detect_work_folder, pm_get_client_colors, pm_get_folder_size,
//                     pm_get_projects, pm_get_settings, pm_get_templates, pm_save_client_colors,
//                     pm_save_template, pm_set_default_template, pm_set_work_folder,
//                     pm_suggest_project_number, pm_update_project
// webserver (5):      webserver_generate_pairing_code, webserver_list_sessions,
//                     webserver_revoke_session, webserver_set_config, webserver_status
// Total: 171 registered tauri commands across 29 modules.
pub use analysis::*;
pub use assignment_model::*;
pub use bughunter::*;
pub use clients::*;
pub use daemon::*;
pub use dashboard::*;
pub use database::*;
pub use delta_export::*;
pub use estimates::*;
pub use export::*;
pub use import::*;
pub use import_data::*;
pub use lan_server::*;
pub use lan_sync::*;
pub use log_management::*;
pub use online_sync::*;
pub use manual_sessions::*;
pub use monitored::*;
pub use projects::*;
pub use report::*;
pub use secure_store::*;
pub use sessions::*;
pub use settings::*;
pub use sync_log::*;
pub use sync_markers::*;
pub use time_algorithm::*;
pub use user_settings::*;
pub use pm::*;
pub use webserver::*;
