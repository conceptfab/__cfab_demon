import { invoke } from './core';
import type { PmProject, PmNewProject, PmSettings, PmFolderTemplate, PmClientColors } from '../pm-types';

export const getPmProjects = () =>
  invoke<PmProject[]>('pm_get_projects');

export const createPmProject = (project: PmNewProject) =>
  invoke<PmProject>('pm_create_project', { project });

export const updatePmProject = (index: number, project: PmProject) =>
  invoke<void>('pm_update_project', { index, project });

export const deletePmProject = (index: number) =>
  invoke<void>('pm_delete_project', { index });

export const getPmSettings = () =>
  invoke<PmSettings>('pm_get_settings');

export const setPmWorkFolder = (path: string) =>
  invoke<void>('pm_set_work_folder', { path });

export const getPmFolderSize = (fullName: string) =>
  invoke<number | null>('pm_get_folder_size', { fullName });

export const getPmTemplates = () =>
  invoke<PmFolderTemplate[]>('pm_get_templates');

export const savePmTemplate = (template: PmFolderTemplate) =>
  invoke<void>('pm_save_template', { template });

export const deletePmTemplate = (id: string) =>
  invoke<void>('pm_delete_template', { id });

export const setDefaultPmTemplate = (id: string) =>
  invoke<void>('pm_set_default_template', { id });

export const detectPmWorkFolder = () =>
  invoke<string[]>('pm_detect_work_folder');

export const getPmClientColors = () =>
  invoke<PmClientColors>('pm_get_client_colors');

export const savePmClientColors = (colors: PmClientColors) =>
  invoke<void>('pm_save_client_colors', { colors });

export const pmApi = {
  getPmProjects,
  createPmProject,
  updatePmProject,
  deletePmProject,
  getPmSettings,
  setPmWorkFolder,
  getPmFolderSize,
  getPmTemplates,
  savePmTemplate,
  deletePmTemplate,
  setDefaultPmTemplate,
  detectPmWorkFolder,
  getPmClientColors,
  savePmClientColors,
} as const;
