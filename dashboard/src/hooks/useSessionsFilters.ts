import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO, subDays } from 'date-fns';

import type { DateRange } from '@/lib/db-types';
import { buildTodayDate } from '@/lib/date-helpers';
import { SESSION_PAGE_SIZE } from '@/lib/session-utils';
import { loadSessionSettings } from '@/lib/user-settings';
import { useUIStore } from '@/store/ui-store';

type SessionViewMode = 'detailed' | 'compact' | 'ai_detailed';
type SessionsFetchParams = {
  dateRange?: DateRange;
  appId?: number;
  projectId?: number;
  unassigned?: boolean;
  minDuration?: number;
  includeFiles?: boolean;
  includeAiSuggestions?: boolean;
  limit?: number;
  offset?: number;
};

export type RangeMode = 'daily' | 'weekly';

type SessionsFilterSlice = {
  rangeMode: RangeMode;
  anchorDate: string;
  overrideDateRange: DateRange | null;
  activeProjectId: number | 'unassigned' | null;
};

function applySessionsFocusNavigation(
  prev: SessionsFilterSlice,
  focus: {
    date: string | null;
    range: DateRange | null;
    project: number | 'unassigned' | null;
  },
): SessionsFilterSlice {
  let next = prev;

  if (focus.date) {
    next = {
      ...next,
      overrideDateRange: null,
      rangeMode: 'daily',
      anchorDate: focus.date,
    };
  } else if (focus.range) {
    next = {
      ...next,
      overrideDateRange: focus.range,
      anchorDate: focus.range.end,
    };
  }

  if (focus.project !== null) {
    next = { ...next, activeProjectId: focus.project };
  }

  return next;
}

export function useSessionsFilters(viewMode: SessionViewMode) {
  const sessionsFocusDate = useUIStore((s) => s.sessionsFocusDate);
  const clearSessionsFocusDate = useUIStore((s) => s.clearSessionsFocusDate);
  const sessionsFocusRange = useUIStore((s) => s.sessionsFocusRange);
  const setSessionsFocusRange = useUIStore((s) => s.setSessionsFocusRange);
  const sessionsFocusProject = useUIStore((s) => s.sessionsFocusProject);
  const setSessionsFocusProject = useUIStore((s) => s.setSessionsFocusProject);
  const [filterSlice, setFilterSlice] = useState<SessionsFilterSlice>(() => ({
    rangeMode: 'daily',
    anchorDate: sessionsFocusDate ?? format(new Date(), 'yyyy-MM-dd'),
    overrideDateRange: null,
    activeProjectId: sessionsFocusProject,
  }));
  const { rangeMode, anchorDate, overrideDateRange, activeProjectId } = filterSlice;
  const setRangeMode = useCallback(
    (mode: RangeMode) => setFilterSlice((prev) => ({ ...prev, rangeMode: mode })),
    [],
  );
  const setAnchorDate = useCallback(
    (date: string) => setFilterSlice((prev) => ({ ...prev, anchorDate: date })),
    [],
  );
  const setOverrideDateRange = useCallback(
    (range: DateRange | null) =>
      setFilterSlice((prev) => ({ ...prev, overrideDateRange: range })),
    [],
  );
  const setActiveProjectId = useCallback(
    (projectId: number | 'unassigned' | null) =>
      setFilterSlice((prev) => ({ ...prev, activeProjectId: projectId })),
    [],
  );
  const [minDuration, setMinDuration] = useState<number | undefined>(() => {
    const settings = loadSessionSettings();
    return settings.minSessionDurationSeconds > 0
      ? settings.minSessionDurationSeconds
      : undefined;
  });
  const today = buildTodayDate();
  const canShiftForward = anchorDate < today;
  const shiftStepDays = rangeMode === 'weekly' ? 7 : 1;

  const activeDateRange = useMemo<DateRange>(() => {
    if (overrideDateRange) return overrideDateRange;
    const selectedDay = anchorDate || today;
    const selectedDateObj = parseISO(selectedDay);

    switch (rangeMode) {
      case 'daily':
        return { start: selectedDay, end: selectedDay };
      case 'weekly':
        return {
          start: format(subDays(selectedDateObj, 6), 'yyyy-MM-dd'),
          end: selectedDay,
        };
    }
  }, [rangeMode, anchorDate, today, overrideDateRange]);

  const shiftDateRange = useCallback(
    (direction: -1 | 1) => {
      setFilterSlice((prev) => {
        const current = parseISO(prev.anchorDate);
        const next = format(
          addDays(current, direction * shiftStepDays),
          'yyyy-MM-dd',
        );
        if (next > today) return prev;
        return { ...prev, overrideDateRange: null, anchorDate: next };
      });
    },
    [shiftStepDays, today],
  );

  useEffect(() => {
    if (
      !sessionsFocusDate &&
      !sessionsFocusRange &&
      sessionsFocusProject === null
    ) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      startTransition(() => {
        setFilterSlice((prev) =>
          applySessionsFocusNavigation(prev, {
            date: sessionsFocusDate,
            range: sessionsFocusRange,
            project: sessionsFocusProject,
          }),
        );
        if (sessionsFocusDate) clearSessionsFocusDate();
        if (sessionsFocusRange) setSessionsFocusRange(null);
        if (sessionsFocusProject !== null) setSessionsFocusProject(null);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    sessionsFocusDate,
    clearSessionsFocusDate,
    sessionsFocusRange,
    setSessionsFocusRange,
    sessionsFocusProject,
    setSessionsFocusProject,
  ]);

  const effectiveDateRange =
    activeProjectId === 'unassigned' ? undefined : activeDateRange;

  const buildFetchParams = useCallback(
    (offset: number): SessionsFetchParams => ({
      dateRange: effectiveDateRange,
      limit: SESSION_PAGE_SIZE,
      offset,
      projectId:
        activeProjectId === 'unassigned'
          ? undefined
          : (activeProjectId ?? undefined),
      unassigned: activeProjectId === 'unassigned' ? true : undefined,
      minDuration,
      includeFiles: viewMode === 'detailed',
      includeAiSuggestions: true,
    }),
    [effectiveDateRange, activeProjectId, minDuration, viewMode],
  );

  return {
    activeDateRange,
    activeProjectId,
    anchorDate,
    buildFetchParams,
    canShiftForward,
    minDuration,
    overrideDateRange,
    rangeMode,
    setActiveProjectId,
    setAnchorDate,
    setMinDuration,
    setOverrideDateRange,
    setRangeMode,
    shiftDateRange,
    shiftStepDays,
    today,
  };
}
