// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type {
  BackupFile,
  CleanupResult,
  DataFolderStats,
  DatabaseSettings,
  DbInfo,
} from '../db-types';

export const getDbInfo = () => invoke<DbInfo>('get_db_info');

export const vacuumDatabase = () => invoke<void>('vacuum_database');

export const optimizeDatabase = () => invoke<void>('optimize_database');

export const getDatabaseSettings = () =>
  invoke<DatabaseSettings>('get_database_settings');

export const updateDatabaseSettings = (settings: DatabaseSettings) =>
  invokeMutation<void>('update_database_settings', {
    vacuumOnStartup: settings.vacuum_on_startup,
    backupEnabled: settings.backup_enabled,
    backupPath: settings.backup_path,
    backupIntervalDays: settings.backup_interval_days,
    autoOptimizeEnabled: settings.auto_optimize_enabled,
    autoOptimizeIntervalHours: settings.auto_optimize_interval_hours,
  });

export const performManualBackup = () =>
  invokeMutation<string>('perform_manual_backup');

export const openDbFolder = () => invoke<void>('open_db_folder');

export const restoreDatabaseFromFile = (path: string) =>
  invokeMutation<void>('restore_database_from_file', { path });

export const getBackupFiles = () => invoke<BackupFile[]>('get_backup_files');

export const getDataFolderStats = () =>
  invoke<DataFolderStats>('get_data_folder_stats');

export const cleanupDataFolder = () =>
  invokeMutation<CleanupResult>('cleanup_data_folder');

export const databaseApi = {
  getDbInfo,
  vacuumDatabase,
  optimizeDatabase,
  getDatabaseSettings,
  updateDatabaseSettings,
  performManualBackup,
  openDbFolder,
  restoreDatabaseFromFile,
  getBackupFiles,
  getDataFolderStats,
  cleanupDataFolder,
} as const;
