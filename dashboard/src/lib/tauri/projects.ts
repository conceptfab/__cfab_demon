import { invoke, invokeMutation } from './core';
import type {
  DateRange,
  DetectedProject,
  FolderProjectCandidate,
  Project,
  ProjectExtraInfo,
  ProjectFolder,
  ProjectReportData,
  ProjectWithStats,
} from '../db-types';

export const getProjects = (dateRange?: DateRange) =>
  invoke<ProjectWithStats[]>('get_projects', { dateRange });

export const getProject = (id: number) =>
  invoke<ProjectWithStats>('get_project', { id });

export const getExcludedProjects = (dateRange?: DateRange) =>
  invoke<ProjectWithStats[]>('get_excluded_projects', { dateRange });

export const createProject = (
  name: string,
  color: string,
  assignedFolderPath: string | null,
) =>
  invokeMutation<Project>('create_project', {
    name,
    color,
    assignedFolderPath,
  });

export const updateProject = (id: number, color: string) =>
  invokeMutation<void>('update_project', { id, color });

export const excludeProject = (id: number) =>
  invokeMutation<void>('exclude_project', { id });

export const restoreProject = (id: number) =>
  invokeMutation<void>('restore_project', { id });

export const deleteProject = (id: number) =>
  invokeMutation<void>('delete_project', { id });

export const freezeProject = (id: number) =>
  invokeMutation<void>('freeze_project', { id });

export const unfreezeProject = (id: number) =>
  invokeMutation<void>('unfreeze_project', { id });

export const autoFreezeProjects = (thresholdDays?: number) =>
  invokeMutation<{ frozen_count: number }>(
    'auto_freeze_projects',
    {
      thresholdDays: thresholdDays ?? null,
    },
    {
      notify: (result) => result.frozen_count > 0,
    },
  );

export const assignAppToProject = (appId: number, projectId: number | null) =>
  invokeMutation<void>('assign_app_to_project', { appId, projectId });

export function assignSessionToProject(
  sessionId: number,
  projectId: number | null,
  source?: string,
) {
  return invokeMutation('assign_session_to_project', {
    sessionId,
    projectId,
    source,
  });
}

export function assignSessionsToProjectBatch(
  sessionIds: number[],
  projectId: number | null,
  source?: string,
) {
  return invokeMutation('assign_sessions_to_project', {
    sessionIds,
    projectId,
    source,
  });
}

export const getProjectExtraInfo = (id: number, dateRange: DateRange) =>
  invoke<ProjectExtraInfo>('get_project_extra_info', { id, dateRange });

export const getProjectReportData = (
  projectId: number,
  dateRange: DateRange,
) =>
  invoke<ProjectReportData>('get_project_report_data', {
    projectId,
    dateRange,
  });

export const compactProjectData = (id: number) =>
  invokeMutation<void>('compact_project_data', { id });

export const getProjectFolders = () =>
  invoke<ProjectFolder[]>('get_project_folders');

export const addProjectFolder = (path: string) =>
  invokeMutation<void>('add_project_folder', { path });

export const removeProjectFolder = (path: string) =>
  invokeMutation<void>('remove_project_folder', { path });

export const updateProjectFolderMeta = (
  path: string,
  color: string,
  category: string,
  badge: string,
) => invokeMutation<void>('update_project_folder_meta', { path, color, category, badge });

export const getFolderProjectCandidates = () =>
  invoke<FolderProjectCandidate[]>('get_folder_project_candidates');

export const createProjectFromFolder = (folderPath: string) =>
  invokeMutation<Project>('create_project_from_folder', { folderPath });

export const syncProjectsFromFolders = () =>
  invokeMutation<{ created_projects: string[]; scanned_folders: number }>(
    'sync_projects_from_folders',
    undefined,
    {
      notify: (result) => result.created_projects.length > 0,
    },
  );

export const autoCreateProjectsFromDetection = (
  dateRange: DateRange,
  minOccurrences = 2,
) =>
  invokeMutation<number>(
    'auto_create_projects_from_detection',
    {
      dateRange,
      minOccurrences,
    },
    {
      notify: (createdCount) => createdCount > 0,
    },
  );

export const getDetectedProjects = (dateRange: DateRange) =>
  invoke<DetectedProject[]>('get_detected_projects', { dateRange });

export const resetProjectTime = (projectId: number) =>
  invokeMutation<void>('reset_project_time', { projectId });

export const deleteAllExcludedProjects = () =>
  invokeMutation<number>('delete_all_excluded_projects', undefined, {
    notify: (count) => count > 0,
  });

export const blacklistProjectNames = (names: string[]) =>
  invokeMutation<number>('blacklist_project_names', { names }, {
    notify: (count) => count > 0,
  });

export const projectsApi = {
  getProjects,
  getProject,
  getExcludedProjects,
  createProject,
  updateProject,
  excludeProject,
  restoreProject,
  deleteProject,
  freezeProject,
  unfreezeProject,
  autoFreezeProjects,
  assignAppToProject,
  assignSessionToProject,
  assignSessionsToProjectBatch,
  getProjectExtraInfo,
  getProjectReportData,
  compactProjectData,
  getProjectFolders,
  addProjectFolder,
  removeProjectFolder,
  updateProjectFolderMeta,
  getFolderProjectCandidates,
  createProjectFromFolder,
  syncProjectsFromFolders,
  autoCreateProjectsFromDetection,
  getDetectedProjects,
  resetProjectTime,
  deleteAllExcludedProjects,
  blacklistProjectNames,
} as const;
