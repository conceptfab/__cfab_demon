import { prefersCoarsePointer } from '@/lib/mobile-shell';
import type { TimelineSortMode } from '@/components/dashboard/project-day-timeline/timeline-calculations';

const TIMELINE_SORT_STORAGE_KEY =
  'timeflow-dashboard-activity-timeline-sort-mode';
const TIMELINE_SAVE_VIEW_STORAGE_KEY =
  'timeflow-dashboard-activity-timeline-save-view';

export function subscribeCoarsePointer(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  const media = window.matchMedia('(hover: none), (pointer: coarse)');
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
}

export function getCoarsePointerSnapshot() {
  return prefersCoarsePointer();
}

export function persistTimelineView(
  sortMode: TimelineSortMode,
  saveView: boolean,
) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      TIMELINE_SAVE_VIEW_STORAGE_KEY,
      saveView ? 'true' : 'false',
    );
    if (saveView) {
      window.localStorage.setItem(TIMELINE_SORT_STORAGE_KEY, sortMode);
    }
  } catch {
    /* ignore localStorage failures */
  }
}
