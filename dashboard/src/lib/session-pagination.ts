import type { DateRange, SessionWithApp } from '@/lib/db-types';
import { getSessions } from '@/lib/tauri';

const DEFAULT_PAGE_SIZE = 1000;
const MIN_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 5000;

export interface FetchAllSessionsFilters {
  dateRange?: DateRange;
  appId?: number;
  projectId?: number;
  unassigned?: boolean;
  minDuration?: number;
  includeAiSuggestions?: boolean;
  pageSize?: number;
}

function normalizePageSize(raw?: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_PAGE_SIZE;
  const rounded = Math.floor(raw as number);
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, rounded));
}

export async function fetchAllSessions(
  filters: FetchAllSessionsFilters,
): Promise<SessionWithApp[]> {
  const { pageSize, ...sessionFilters } = filters;
  const limit = normalizePageSize(pageSize);
  const allSessions: SessionWithApp[] = [];
  let offset = 0;

  for (;;) {
    const batch = await getSessions({
      ...sessionFilters,
      limit,
      offset,
    });
    allSessions.push(...batch);
    if (batch.length < limit) break;
    offset += batch.length;
  }

  return allSessions;
}
