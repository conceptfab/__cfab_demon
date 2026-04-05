mod commands;
mod db;
mod db_migrations;
pub const VERSION: &str = env!("TIMEFLOW_VERSION");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file (SMTP credentials, etc.)
    // Search: next to exe → CWD → parent dirs (for dev mode where CWD is dashboard/src-tauri/)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let _ = dotenvy::from_path(dir.join(".env"));
        }
    }
    if dotenvy::dotenv().is_err() {
        // Walk up from CWD to find .env in project root
        if let Ok(mut dir) = std::env::current_dir() {
            for _ in 0..5 {
                let env_path = dir.join(".env");
                if env_path.exists() {
                    let _ = dotenvy::from_path(env_path);
                    break;
                }
                if !dir.pop() { break; }
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Setup dashboard logging to %APPDATA%/TimeFlow/logs/dashboard.log
            {
                let base = commands::helpers::timeflow_data_dir()
                    .unwrap_or_else(|_| std::path::PathBuf::from("."));
                let logs_dir = base.join("logs");
                let _ = std::fs::create_dir_all(&logs_dir);

                // Read log level from log_settings.json (shared with daemon)
                let dashboard_level = {
                    let settings_path = base.join("log_settings.json");
                    if let Ok(content) = std::fs::read_to_string(&settings_path) {
                        serde_json::from_str::<serde_json::Value>(&content)
                            .ok()
                            .and_then(|v| v.get("dashboard_level")?.as_str().map(String::from))
                            .unwrap_or_else(|| "info".into())
                    } else {
                        "info".into()
                    }
                };
                let level = match dashboard_level.to_lowercase().as_str() {
                    "trace" => log::LevelFilter::Trace,
                    "debug" => log::LevelFilter::Debug,
                    "warn" => log::LevelFilter::Warn,
                    "error" => log::LevelFilter::Error,
                    _ => log::LevelFilter::Info,
                };

                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(level)
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::Folder {
                                path: logs_dir,
                                file_name: Some("dashboard".into()),
                            },
                        ))
                        .build(),
                )?;

                log::info!("TIMEFLOW Dashboard starting (log level: {})", dashboard_level);
            }

            // Initialize database (sync — rusqlite has no async IO)
            let app_handle = app.handle().clone();
            if let Err(e) = db::initialize(&app_handle) {
                log::error!("Failed to initialize database: {}", e);
                return Err(std::io::Error::other(format!(
                    "Database initialization failed: {}",
                    e
                ))
                .into());
            }

            match commands::daily_store_bridge::migrate_legacy_daily_json_to_store() {
                Ok(migrated) if migrated > 0 => {
                    log::info!(
                        "Migrated {} legacy daily JSON file(s) into SQLite daily store",
                        migrated
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    log::warn!(
                        "Legacy daily JSON migration skipped in dashboard backend: {}",
                        e
                    );
                }
            }

            // Write version to file for daemon to check
            if let Ok(data_dir) = commands::helpers::timeflow_data_dir() {
                let _ = std::fs::write(data_dir.join("dashboard_version.txt"), VERSION.trim());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::send_bug_report,
            commands::import_json_files,
            commands::check_file_imported,
            commands::get_imported_files,
            commands::get_projects,
            commands::get_project,
            commands::get_excluded_projects,
            commands::create_project,
            commands::update_project,
            commands::exclude_project,
            commands::restore_project,
            commands::delete_project,
            commands::delete_all_excluded_projects,
            commands::blacklist_project_names,
            commands::freeze_project,
            commands::unfreeze_project,
            commands::get_project_extra_info,
            commands::get_project_report_data,
            commands::compact_project_data,
            commands::auto_freeze_projects,
            commands::assign_app_to_project,
            commands::get_project_folders,
            commands::add_project_folder,
            commands::remove_project_folder,
            commands::get_folder_project_candidates,
            commands::create_project_from_folder,
            commands::sync_projects_from_folders,
            commands::auto_create_projects_from_detection,
            commands::get_dashboard_data,
            commands::get_dashboard_stats,
            commands::get_activity_date_span,
            commands::get_top_projects,
            commands::get_dashboard_projects,
            commands::get_timeline,
            commands::get_hourly_breakdown,
            commands::get_estimate_settings,
            commands::update_global_hourly_rate,
            commands::update_project_hourly_rate,
            commands::get_project_estimates,
            commands::get_estimates_summary,
            commands::get_applications,
            commands::get_app_timeline,
            commands::get_sessions,
            commands::get_session_count,
            commands::assign_session_to_project,
            commands::assign_sessions_to_project,
            commands::delete_session,
            commands::delete_sessions,
            commands::get_heatmap,
            commands::get_stacked_timeline,
            commands::get_project_timeline,
            commands::auto_import_from_data_dir,
            commands::get_archive_files,
            commands::delete_archive_file,
            commands::get_detected_projects,
            commands::get_monitored_apps,
            commands::add_monitored_app,
            commands::remove_monitored_app,
            commands::rename_monitored_app,
            commands::sync_monitored_apps_from_applications,
            commands::get_daemon_status,
            commands::get_daemon_runtime_status,
            commands::get_background_diagnostics,
            commands::get_daemon_logs,
            commands::get_autostart_enabled,
            commands::set_autostart_enabled,
            commands::start_daemon,
            commands::stop_daemon,
            commands::restart_daemon,
            commands::refresh_today,
            commands::get_today_file_signature,
            commands::reset_app_time,
            commands::rename_application,
            commands::delete_app_and_data,
            commands::reset_project_time,
            commands::clear_all_data,
            commands::export_database,
            commands::get_data_dir,
            commands::get_demo_mode_status,
            commands::set_demo_mode,
            commands::create_manual_session,
            commands::get_manual_sessions,
            commands::update_manual_session,
            commands::delete_manual_session,
            commands::delete_manual_sessions,
            commands::export_data,
            commands::export_data_archive,
            commands::validate_import,
            commands::import_data,
            commands::import_data_archive,
            commands::build_delta_archive,
            commands::update_app_color,
            commands::update_session_rate_multiplier,
            commands::update_session_rate_multipliers,
            commands::update_session_comment,
            commands::update_session_comments,
            commands::rebuild_sessions,
            commands::get_assignment_model_status,
            commands::get_assignment_model_metrics,
            commands::set_assignment_mode,
            commands::set_assignment_model_cooldown,
            commands::set_training_horizon_days,
            commands::set_decay_half_life_days,
            commands::set_training_blacklists,
            commands::reset_assignment_model_knowledge,
            commands::train_assignment_model,
            commands::run_auto_safe_assignment,
            commands::rollback_last_auto_safe_run,
            commands::auto_run_if_needed,
            commands::apply_deterministic_assignment,
            commands::get_session_score_breakdown,
            commands::get_feedback_weight,
            commands::set_feedback_weight,
            commands::append_sync_log,
            commands::get_sync_log,
            commands::get_db_info,
            commands::vacuum_database,
            commands::optimize_database,
            commands::get_database_settings,
            commands::update_database_settings,
            commands::perform_manual_backup,
            commands::open_db_folder,
            commands::restore_database_from_file,
            commands::get_backup_files,
            commands::get_data_folder_stats,
            commands::cleanup_data_folder,
            commands::get_secure_token,
            commands::set_secure_token,
            commands::persist_language_for_daemon,
            commands::persist_session_settings_for_daemon,
            commands::persist_lan_sync_settings_for_daemon,
            commands::split_session,
            commands::suggest_session_split,
            commands::analyze_session_projects,
            commands::analyze_sessions_splittable,
            commands::split_session_multi,
            commands::get_lan_peers,
            commands::get_lan_sync_progress,
            commands::build_table_hashes_only,
            commands::ping_lan_peer,
            commands::scan_lan_subnet,
            commands::get_local_ips,
            commands::run_lan_sync,
            commands::start_lan_server,
            commands::stop_lan_server,
            commands::get_lan_server_status,
            commands::insert_sync_marker,
            commands::get_latest_sync_marker,
            commands::markers_match,
            commands::backup_before_sync,
            commands::upsert_lan_peer,
            commands::get_lan_sync_log,
            commands::get_online_sync_settings,
            commands::save_online_sync_settings,
            commands::run_online_sync,
            commands::get_online_sync_progress,
            commands::cancel_online_sync,
            commands::get_log_settings,
            commands::save_log_settings,
            commands::get_log_files_info,
            commands::read_log_file,
            commands::clear_log_file,
            commands::open_logs_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
