import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';

import { pmApi } from '@/lib/tauri/pm';
import { projectsApi, dashboardApi } from '@/lib/tauri';
import type { EstimateProjectRow } from '@/lib/db-types';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import {
  buildTfMatch,
  buildTfProjectMatchIndex,
  ensureClientColors,
  findTfProject,
  type PmTab,
  type PmTfMatch,
} from '@/lib/pm-page-match';
import type { PmClientColors } from '@/lib/pm-types';
import { getErrorMessage } from '@/lib/utils';
import {
  initialPmPageState,
  pmPageReducer,
} from '@/pages/pm/pm-page-state';
import { useUIStore } from '@/store/ui-store';

export function usePmPageController() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(pmPageReducer, initialPmPageState);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setProjectPageId = useUIStore((s) => s.setProjectPageId);

  const loadData = useCallback(async () => {
    dispatch({ type: 'load_start' });
    try {
      const sett = await pmApi.getPmSettings();
      if (sett.work_folder) {
        const [prj, tfActive, tfExcluded, colors, estRows] = await Promise.all([
          pmApi.getPmProjects(),
          projectsApi.getProjects(ALL_TIME_DATE_RANGE),
          projectsApi.getExcludedProjects(ALL_TIME_DATE_RANGE),
          pmApi.getPmClientColors().catch(() => ({} as PmClientColors)),
          dashboardApi.getProjectEstimates(ALL_TIME_DATE_RANGE).catch(() => [] as EstimateProjectRow[]),
        ]);
        const allTfProjects = [...tfActive, ...tfExcluded];
        const tfProjectIndex = buildTfProjectMatchIndex(allTfProjects);
        const estimates = new Map<number, EstimateProjectRow>();
        for (const e of estRows) estimates.set(e.project_id, e);
        const hotIds = new Set(
          tfActive.toSorted((a, b) => b.total_seconds - a.total_seconds).slice(0, 5).map((p) => p.id),
        );
        const matchMap: Record<string, PmTfMatch> = {};
        const enriched = prj.map((p) => {
          const tfProject = findTfProject(p, tfProjectIndex);
          const m = buildTfMatch(tfProject, estimates, hotIds);
          matchMap[p.prj_code] = m;
          return { ...p, prj_status: m.status };
        });
        dispatch({
          type: 'load_success',
          payload: {
            settings: sett,
            projects: enriched,
            tfMatches: matchMap,
            clientColors: ensureClientColors(enriched, colors),
          },
        });
      } else {
        dispatch({ type: 'load_empty_settings', settings: sett });
      }
    } catch (e) {
      const msg = getErrorMessage(e, t('pm.errors.load_failed'));
      if (typeof e === 'string' && e.includes('not configured')) {
        dispatch({ type: 'load_not_configured' });
      } else {
        dispatch({ type: 'load_error', error: msg });
      }
    } finally {
      dispatch({ type: 'load_end' });
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const thisYearCount = useMemo(
    () =>
      state.projects.filter(
        (p) => p.prj_year === new Date().getFullYear().toString().slice(-2),
      ).length,
    [state.projects],
  );

  const existingClients = useMemo(
    () =>
      [
        ...new Set(
          state.projects.map((p) => p.prj_client?.trim()).filter((c): c is string => !!c),
        ),
      ].toSorted((a, b) => a.localeCompare(b)),
    [state.projects],
  );

  const noFolder = !state.loading && state.settings && !state.settings.work_folder;

  const openCreateDialog = useCallback(() => {
    dispatch({ type: 'set_create_open', createOpen: true });
  }, []);

  const closeCreateDialog = useCallback(() => {
    dispatch({ type: 'set_create_open', createOpen: false });
  }, []);

  const handleCreateProjectCreated = useCallback(() => {
    dispatch({ type: 'set_create_open', createOpen: false });
    void loadData();
  }, [loadData]);

  const setActiveTab = useCallback((activeTab: PmTab) => {
    dispatch({ type: 'set_active_tab', activeTab });
  }, []);

  const setSelectedIndex = useCallback((selectedIndex: number | null) => {
    dispatch({ type: 'set_selected_index', selectedIndex });
  }, []);

  const setClientColors = useCallback((clientColors: PmClientColors) => {
    dispatch({ type: 'set_client_colors', clientColors });
  }, []);

  const openProjectCard = useCallback(
    (id: number) => {
      setProjectPageId(id, true);
      setCurrentPage('project-card');
    },
    [setCurrentPage, setProjectPageId],
  );

  const closeProjectDetail = useCallback(() => {
    dispatch({ type: 'set_selected_index', selectedIndex: null });
  }, []);

  const handleProjectUpdated = useCallback(() => {
    dispatch({ type: 'set_selected_index', selectedIndex: null });
    void loadData();
  }, [loadData]);

  const goToSettings = useCallback(() => {
    setCurrentPage('settings');
  }, [setCurrentPage]);

  return {
    ...state,
    closeCreateDialog,
    closeProjectDetail,
    existingClients,
    goToSettings,
    handleCreateProjectCreated,
    handleProjectUpdated,
    loadData,
    noFolder,
    openCreateDialog,
    openProjectCard,
    setActiveTab,
    setClientColors,
    setSelectedIndex,
    t,
    thisYearCount,
  };
}

export type PmPageController = ReturnType<typeof usePmPageController>;
