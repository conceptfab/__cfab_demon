export const LOCAL_DATA_CHANGED_EVENT = "timeflow:local-data-changed";

export interface LocalDataChangedDetail {
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

