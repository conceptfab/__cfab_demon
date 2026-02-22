mod commands;
mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize database
            let app_handle = app.handle().clone();
            if let Err(e) =
                tauri::async_runtime::block_on(async { db::initialize(&app_handle).await })
            {
                log::error!("Failed to initialize database: {}", e);
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Database initialization failed: {}", e),
                )
                .into());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_json_files,
            commands::check_file_imported,
            commands::get_imported_files,
            commands::get_projects,
            commands::get_excluded_projects,
            commands::create_project,
            commands::update_project,
            commands::exclude_project,
            commands::restore_project,
            commands::delete_project,
            commands::assign_app_to_project,
            commands::get_project_folders,
            commands::add_project_folder,
            commands::remove_project_folder,
            commands::get_folder_project_candidates,
            commands::create_project_from_folder,
            commands::sync_projects_from_folders,
            commands::auto_create_projects_from_detection,
            commands::get_dashboard_stats,
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
            commands::delete_session,
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
            commands::get_daemon_status,
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
            commands::export_data,
            commands::export_data_archive,
            commands::validate_import,
            commands::import_data,
            commands::import_data_archive,
            commands::update_app_color,
            commands::update_session_rate_multiplier,
            commands::rebuild_sessions,
            commands::get_assignment_model_status,
            commands::set_assignment_mode,
            commands::set_assignment_model_cooldown,
            commands::train_assignment_model,
            commands::run_auto_safe_assignment,
            commands::rollback_last_auto_safe_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
