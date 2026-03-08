export const LOCAL_DATA_CHANGED_EVENT = "timeflow:local-data-changed";
export const PROJECTS_ALL_TIME_INVALIDATED_EVENT =
  "timeflow:projects-all-time-invalidated";

export interface LocalDataChangedDetail {
  reason: string;
  at: string;
}

export interface ProjectsAllTimeInvalidatedDetail {
  reason: string;
  at: string;
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

