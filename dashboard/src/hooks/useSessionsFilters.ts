import { useCallback, useEffect, useMemo, useState } from 'react';
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

export function useSessionsFilters(viewMode: SessionViewMode) {
  const {
    sessionsFocusDate,
    clearSessionsFocusDate,
    sessionsFocusRange,
    setSessionsFocusRange,
    sessionsFocusProject,
    setSessionsFocusProject,
  } = useUIStore();
  const [rangeMode, setRangeMode] = useState<RangeMode>('daily');
  const [anchorDate, setAnchorDate] = useState<string>(
    () => sessionsFocusDate ?? format(new Date(), 'yyyy-MM-dd'),
  );
  const [overrideDateRange, setOverrideDateRange] = useState<DateRange | null>(
    null,
  );
  const [activeProjectId, setActiveProjectId] = useState<
    number | 'unassigned' | null
  >(sessionsFocusProject);
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
      setOverrideDateRange(null);
      const current = parseISO(anchorDate);
      const next = format(
        addDays(current, direction * shiftStepDays),
        'yyyy-MM-dd',
      );
      if (next > today) return;
      setAnchorDate(next);
    },
    [anchorDate, shiftStepDays, today],
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
      if (sessionsFocusDate) {
        setOverrideDateRange(null);
        setRangeMode('daily');
        setAnchorDate(sessionsFocusDate);
        clearSessionsFocusDate();
      } else if (sessionsFocusRange) {
        setOverrideDateRange(sessionsFocusRange);
        setAnchorDate(sessionsFocusRange.end);
        setSessionsFocusRange(null);
      }

      if (sessionsFocusProject !== null) {
        setActiveProjectId(sessionsFocusProject);
        setSessionsFocusProject(null);
      }
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
