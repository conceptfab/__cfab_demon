// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';

/** Sesja w CAŁOŚCI ponad limitem godzin — kandydat do boostu. */
export interface OverLimitSession {
  id: number;
  start_time: string;
  app_name: string;
  duration_seconds: number;
  /** Czas po dedupie — ten sam, którym liczone jest zużycie limitu. */
  effective_seconds: number;
  rate_multiplier: number;
  /** Sesja ma już własny komentarz — szablonu nie nadpisujemy. */
  has_comment: boolean;
  /** Mnożnik wciąż ≤ 1, więc boost jest do zrobienia. */
  needs_boost: boolean;
}

/** Stan limitu godzin projektu dla jednego okresu rozliczeniowego. */
export interface ProjectLimitStatus {
  limit_hours: number;
  /** YYYY-MM-DD */
  cycle_start: string;
  /** YYYY-MM-DD */
  cycle_end: string;
  cycle_start_day: number;
  used_seconds: number;
  used_hours: number;
  remaining_hours: number;
  over_hours: number;
  percent: number;
  over_limit_multiplier: number;
  over_limit_comment: string | null;
  /** Godziny ponad limitem z sesji ręcznych — liczą się, ale nie da się ich zboostować. */
  manual_over_hours: number;
  over_sessions: OverLimitSession[];
  pending_boost_count: number;
}

/** Skrót stanu limitu dla listy projektów — bez listy sesji. */
export interface ProjectLimitBadge {
  project_id: number;
  limit_hours: number;
  used_hours: number;
  over_hours: number;
  percent: number;
  pending_boost_count: number;
}

export const getProjectLimitStatus = (
  projectId: number,
  referenceDate?: string,
) =>
  invoke<ProjectLimitStatus | null>('get_project_limit_status', {
    projectId,
    referenceDate: referenceDate ?? null,
  });

export const getProjectsLimitOverview = () =>
  invoke<ProjectLimitBadge[]>('get_projects_limit_overview');

export const updateProjectLimit = (
  projectId: number,
  limitHours: number | null,
  cycleStartDay: number | null,
  multiplier: number | null,
  commentTemplate: string | null,
) =>
  invokeMutation<void>('update_project_limit', {
    projectId,
    limitHours,
    cycleStartDay,
    multiplier,
    commentTemplate,
  });

export const applyProjectLimitBoost = (
  projectId: number,
  sessionIds: number[],
  commentFallback: string | null,
) =>
  invokeMutation<number>('apply_project_limit_boost', {
    projectId,
    sessionIds,
    commentFallback,
  });
