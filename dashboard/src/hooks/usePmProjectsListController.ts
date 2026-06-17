import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PmProject, PmSortField, PmClientColors } from '@/lib/pm-types';
import { buildClientGroupMap, collectUppercasedClientNames } from '@/lib/pm-client-groups';
import type { PmTfMatch } from '@/lib/pm-page-match';
import { loadPmViewDefaults, savePmViewDefaults } from '@/components/pm/pm-view-defaults';
import {
  buildProjectIndexMap,
  sortPmProjects,
  type PmSortDir,
} from '@/lib/pm-projects-list-utils';

export interface UsePmProjectsListControllerOptions {
  projects: PmProject[];
  clientColors: PmClientColors;
  tfMatches: Record<string, PmTfMatch>;
  onSelect: (index: number) => void;
  onOpenProjectCard: (tfProjectId: number) => void;
}

export function usePmProjectsListController({
  projects,
  clientColors,
  tfMatches,
  onSelect,
  onOpenProjectCard,
}: UsePmProjectsListControllerOptions) {
  const { t } = useTranslation();
  const initialView = useMemo(() => loadPmViewDefaults(), []);

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [filterYear, setFilterYear] = useState(initialView.filterYear);
  const [filterClient, setFilterClient] = useState(initialView.filterClient);
  const [filterStatus, setFilterStatus] = useState(initialView.filterStatus);
  const [sortField, setSortField] = useState<PmSortField>(initialView.sortField);
  const [sortDir, setSortDir] = useState<PmSortDir>(initialView.sortDir);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const savedMsgTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const timerRef = savedMsgTimeoutRef;
    return () => {
      const timerId = timerRef.current;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  const uniqueYears = useMemo(
    () =>
      Array.from(new Set(projects.map((p) => p.prj_year))).toSorted((a, b) =>
        b.localeCompare(a),
      ),
    [projects],
  );

  const { uniqueClients, clientGroupOf } = useMemo(() => {
    const rawSet = collectUppercasedClientNames(projects);
    const groupMap = buildClientGroupMap(rawSet);
    const groups = Array.from(new Set(groupMap.values())).toSorted((a, b) =>
      a.localeCompare(b),
    );
    return {
      uniqueClients: groups,
      clientGroupOf: (raw: string) => groupMap.get(raw.toUpperCase()) || raw.toUpperCase(),
    };
  }, [projects]);

  const uniqueStatuses = useMemo(
    () =>
      Array.from(new Set(projects.map((p) => p.prj_status))).toSorted(),
    [projects],
  );

  const displayed = useMemo(() => {
    let list = projects;
    if (deferredSearch.trim()) {
      const q = deferredSearch.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.prj_client.toLowerCase().includes(q) ||
          p.prj_name.toLowerCase().includes(q) ||
          p.prj_desc.toLowerCase().includes(q) ||
          p.prj_full_name.toLowerCase().includes(q) ||
          p.prj_code.includes(q),
      );
    }
    if (filterYear) list = list.filter((p) => p.prj_year === filterYear);
    if (filterClient) {
      list = list.filter((p) => clientGroupOf(p.prj_client) === filterClient);
    }
    if (filterStatus) list = list.filter((p) => p.prj_status === filterStatus);
    return sortPmProjects(list, projects, sortField, sortDir);
  }, [
    projects,
    deferredSearch,
    filterYear,
    filterClient,
    filterStatus,
    sortField,
    sortDir,
    clientGroupOf,
  ]);

  const hasAnyFilter = filterYear || filterClient || filterStatus || search;

  const projectIndexMap = useMemo(
    () => buildProjectIndexMap(projects),
    [projects],
  );

  const originalIndices = useMemo(
    () => displayed.map((dp) => projectIndexMap.get(dp) ?? -1),
    [displayed, projectIndexMap],
  );

  const toggleSortDir = () => setSortDir(sortDir === 'asc' ? 'desc' : 'asc');

  const handleHeaderClick = (field: PmSortField) => {
    if (sortField === field) {
      toggleSortDir();
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const clearFilters = () => {
    setSearch('');
    setFilterYear('');
    setFilterClient('');
    setFilterStatus('');
  };

  const handleSaveView = () => {
    savePmViewDefaults({
      filterYear,
      filterClient,
      filterStatus,
      sortField,
      sortDir,
    });
    setSavedMsg(t('pm.messages.view_settings_saved'));
    if (savedMsgTimeoutRef.current !== null) {
      window.clearTimeout(savedMsgTimeoutRef.current);
    }
    savedMsgTimeoutRef.current = window.setTimeout(() => {
      setSavedMsg(null);
      savedMsgTimeoutRef.current = null;
    }, 3000);
  };

  return {
    clearFilters,
    clientColors,
    clientGroupOf,
    displayed,
    filterClient,
    filterStatus,
    filterYear,
    handleHeaderClick,
    handleSaveView,
    hasAnyFilter,
    onOpenProjectCard,
    onSelect,
    originalIndices,
    projects,
    savedMsg,
    search,
    setFilterClient,
    setFilterStatus,
    setFilterYear,
    setSearch,
    setSortField,
    sortDir,
    sortField,
    t,
    tfMatches,
    toggleSortDir,
    uniqueClients,
    uniqueStatuses,
    uniqueYears,
  };
}

export type PmProjectsListController = ReturnType<
  typeof usePmProjectsListController
>;
