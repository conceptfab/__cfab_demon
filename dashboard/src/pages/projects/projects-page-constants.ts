export const PROJECT_RENDER_PAGE_SIZE = 120;
export const EMPTY_PROJECT_RENDER_LIMITS: Record<string, number> = {};

export const VIEW_MODE_STORAGE_KEY = 'timeflow-dashboard-projects-view-mode';
export const SORT_STORAGE_KEY = 'timeflow-dashboard-projects-sort';
export const FOLDERS_STORAGE_KEY = 'timeflow-dashboard-projects-use-folders';
export const SECTION_STORAGE_KEY = 'timeflow-dashboard-projects-section-open';
export const LEGACY_SECTION_STORAGE_KEY = 'cfab-dashboard-projects-section-open';

export const DEFAULT_SECTION_OPEN: Record<
  'excluded' | 'merged' | 'folders' | 'candidates' | 'detected',
  boolean
> = {
  excluded: true,
  merged: true,
  folders: true,
  candidates: true,
  detected: true,
};

