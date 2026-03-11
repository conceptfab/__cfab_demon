export const LOCAL_DATA_CHANGED_EVENT = "timeflow:local-data-changed";
export const PROJECTS_ALL_TIME_INVALIDATED_EVENT =
  "timeflow:projects-all-time-invalidated";
export const APP_REFRESH_EVENT = "timeflow:app-refresh";

export interface LocalDataChangedDetail {
  reason: string;
  at: string;
}

export interface ProjectsAllTimeInvalidatedDetail {
  reason: string;
  at: string;
}

export interface AppRefreshDetail {
  reasons: string[];
  at: string;
  anonymous: boolean;
}

export function emitLocalDataChanged(reason: string): void {
  if (typeof window === "undefined") return;

  const detail: LocalDataChangedDetail = {
    reason,
    at: new Date().toISOString(),
  };
  window.dispatchEvent(new CustomEvent<LocalDataChangedDetail>(LOCAL_DATA_CHANGED_EVENT, { detail }));
}

export function emitProjectsAllTimeInvalidated(reason: string): void {
  if (typeof window === "undefined") return;

  const detail: ProjectsAllTimeInvalidatedDetail = {
    reason,
    at: new Date().toISOString(),
  };
  window.dispatchEvent(
    new CustomEvent<ProjectsAllTimeInvalidatedDetail>(
      PROJECTS_ALL_TIME_INVALIDATED_EVENT,
      { detail },
    ),
  );
}

export function emitAppRefresh(
  reasons: string[],
  anonymous = false,
): void {
  if (typeof window === "undefined") return;

  const detail: AppRefreshDetail = {
    reasons,
    at: new Date().toISOString(),
    anonymous,
  };
  window.dispatchEvent(
    new CustomEvent<AppRefreshDetail>(APP_REFRESH_EVENT, { detail }),
  );
}

