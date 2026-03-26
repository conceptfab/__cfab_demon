import { invoke, invokeMutation } from './core';
import type {
  ArchivedFile,
  AutoImportResult,
  ExportArchive,
  ImportResult,
  ImportSummary,
  ImportValidation,
  ImportedFile,
} from '../db-types';
import type { DeltaArchive } from '../online-sync-types';

export const getImportedFiles = () =>
  invoke<ImportedFile[]>('get_imported_files');

export const getArchiveFiles = () =>
  invoke<ArchivedFile[]>('get_archive_files');

export const deleteArchiveFile = (fileName: string) =>
  invokeMutation<void>('delete_archive_file', { fileName });

export const importJsonFiles = (filePaths: string[]) =>
  invokeMutation<ImportResult[]>('import_json_files', { filePaths });

export const autoImportFromDataDir = () =>
  invoke<AutoImportResult>('auto_import_from_data_dir');

export const exportData = (
  projectId?: number,
  dateStart?: string,
  dateEnd?: string,
) => invoke<string>('export_data', { projectId, dateStart, dateEnd });

export const exportDataArchive = (
  projectId?: number,
  dateStart?: string,
  dateEnd?: string,
) =>
  invoke<ExportArchive>('export_data_archive', {
    projectId,
    dateStart,
    dateEnd,
  });

export const buildDeltaArchive = (since: string) =>
  invoke<[DeltaArchive, string]>('build_delta_archive', { since });

export const validateImport = (archivePath: string) =>
  invoke<ImportValidation>('validate_import', { archivePath });

export const importData = (archivePath: string) =>
  invokeMutation<ImportSummary>('import_data', { archivePath }, {
    notify: (result) =>
      result.projects_created > 0 ||
      result.apps_created > 0 ||
      result.sessions_imported > 0 ||
      result.sessions_merged > 0 ||
      result.daily_files_imported > 0,
  });

export const importDataArchive = (archive: ExportArchive) =>
  invokeMutation<ImportSummary>('import_data_archive', { archive });

export const appendSyncLog = (lines: string[]) =>
  invoke<void>('append_sync_log', { lines });

export const getSyncLog = (tailLines?: number) =>
  invoke<string>('get_sync_log', { tailLines });

export const dataApi = {
  getImportedFiles,
  getArchiveFiles,
  deleteArchiveFile,
  importJsonFiles,
  autoImportFromDataDir,
  exportData,
  exportDataArchive,
  buildDeltaArchive,
  validateImport,
  importData,
  importDataArchive,
  appendSyncLog,
  getSyncLog,
} as const;
