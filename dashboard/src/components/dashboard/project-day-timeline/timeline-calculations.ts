import type { CSSProperties } from 'react';

import type { ManualSessionWithProject, ProjectWithStats, SessionWithApp } from '@/lib/db-types';
import { localizeProjectLabel } from '@/lib/project-labels';
import { normalizeHexColor } from '@/lib/normalize';
import { compareProjectsByName, isRecentProject } from '@/lib/project-utils';
import { timeToMinutes, type WorkingHoursSettings } from '@/lib/user-settings';
import type { AssignProjectListMode } from '@/store/ui-store';

export interface SegmentData {
  sessionId: number;
  sessionIds?: number[];
  fragmentCount?: number;
  fragments?: SegmentData[];
  startMs: number;
  endMs: number;
  appName: string;
  appNames?: string[];
  appId: number;
  rateMultiplier?: number;
  mixedRateMultiplier?: boolean;
  isManual?: boolean;
  manualTitle?: string;
  manualSession?: ManualSessionWithProject;
  comment?: string | null;
  hasSuggestion?: boolean;
  suggestedProjectName?: string;
  suggestedProjectId?: number;
  suggestedConfidence?: number;
}

export interface TimelineRow {
  name: string;
  color: string;
  totalSeconds: number;
  isUnassigned: boolean;
  boostedCount: number;
  segments: SegmentData[];
}

export type CtxMenu =
  | { type: 'assign'; x: number; y: number; segment: SegmentData; rowName: string; rowColor: string }
  | { type: 'timeline'; x: number; y: number; timeMs: number; editSession?: ManualSessionWithProject };

export interface ClusterDetailsState {
  rowName: string;
  rowColor: string;
  segment: SegmentData;
}

export type TimelineSortMode = 'time_desc' | 'alpha_asc';

export interface ContextMenuPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

export interface TimelineModelWorkingRange {
  leftPct: number;
  widthPct: number;
  label: string;
  color: string;
}

export interface TimelineModel {
  rows: TimelineRow[];
  ticks: number[];
  rangeStart: number;
  rangeSpan: number;
  totalSeconds: number;
  workingRange: TimelineModelWorkingRange | null;
}

export interface AssignProjectSection {
  key: 'all' | 'new' | 'top' | 'rest';
  label: string;
  projects: ProjectWithStats[];
}

const TIMELINE_SORT_STORAGE_KEY = 'timeflow-dashboard-activity-timeline-sort-mode';
const TIMELINE_SAVE_VIEW_STORAGE_KEY = 'timeflow-dashboard-activity-timeline-save-view';
const TOP_PROJECTS_LIMIT = 5;
const CONTEXT_MENU_EDGE_PADDING = 8;
const ASSIGN_MENU_FALLBACK_WIDTH = 320;
const ASSIGN_MENU_FALLBACK_HEIGHT = 520;
const TIMELINE_MENU_FALLBACK_WIDTH = 200;
const TIMELINE_MENU_FALLBACK_HEIGHT = 64;
const SESSION_FRAGMENT_CLUSTER_GAP_MS = 60_000;

export const HATCH_STYLE: CSSProperties = {
  background: `repeating-linear-gradient(
    30deg,
    transparent,
    transparent 3px,
    rgba(0,0,0,0.15) 3px,
    rgba(0,0,0,0.15) 4px
  )`,
  pointerEvents: 'none',
};

export function normalizeProjectName(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveContextMenuPlacement(
  menu: CtxMenu,
  viewportWidth: number,
  viewportHeight: number,
  menuSize?: { width: number; height: number } | null,
): ContextMenuPlacement {
  const fallbackWidth =
    menu.type === 'assign' ? ASSIGN_MENU_FALLBACK_WIDTH : TIMELINE_MENU_FALLBACK_WIDTH;
  const fallbackHeight =
    menu.type === 'assign' ? ASSIGN_MENU_FALLBACK_HEIGHT : TIMELINE_MENU_FALLBACK_HEIGHT;

  const width = Math.max(fallbackWidth, menuSize?.width ?? 0);
  const maxHeight = Math.max(180, viewportHeight - CONTEXT_MENU_EDGE_PADDING * 2);
  const height = Math.min(Math.max(fallbackHeight, menuSize?.height ?? 0), maxHeight);

  const maxLeft = Math.max(
    CONTEXT_MENU_EDGE_PADDING,
    viewportWidth - width - CONTEXT_MENU_EDGE_PADDING,
  );
  const left = Math.min(Math.max(menu.x, CONTEXT_MENU_EDGE_PADDING), maxLeft);

  const overflowsDown = menu.y + height > viewportHeight - CONTEXT_MENU_EDGE_PADDING;
  const canFlipUp = menu.y - height >= CONTEXT_MENU_EDGE_PADDING;
  const maxTop = Math.max(
    CONTEXT_MENU_EDGE_PADDING,
    viewportHeight - height - CONTEXT_MENU_EDGE_PADDING,
  );
  const top =
    overflowsDown && canFlipUp
      ? menu.y - height
      : Math.min(Math.max(menu.y, CONTEXT_MENU_EDGE_PADDING), maxTop);

  return { left, top, maxHeight };
}

export function loadTimelineSortMode(): TimelineSortMode {
  if (typeof window === 'undefined') return 'time_desc';
  try {
    const raw = window.localStorage.getItem(TIMELINE_SORT_STORAGE_KEY);
    return raw === 'alpha_asc' ? 'alpha_asc' : 'time_desc';
  } catch {
    return 'time_desc';
  }
}

export function loadTimelineSaveView(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(TIMELINE_SAVE_VIEW_STORAGE_KEY);
    return raw !== 'false';
  } catch {
    return true;
  }
}

export function getSegmentSessionIds(segment: SegmentData): number[] {
  if (segment.isManual) return [];
  if (segment.sessionIds && segment.sessionIds.length > 0) return segment.sessionIds;
  return [segment.sessionId];
}

export function getSegmentFragments(segment: SegmentData): SegmentData[] {
  if (segment.fragments && segment.fragments.length > 0) return segment.fragments;
  return [segment];
}

export function summarizeCluster(segment: SegmentData) {
  const fragments = getSegmentFragments(segment)
    .filter((fragment) => !fragment.isManual)
    .slice()
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const sessionIds = Array.from(new Set(fragments.flatMap((fragment) => getSegmentSessionIds(fragment))));
  const appNames = Array.from(new Set(fragments.map((fragment) => fragment.appName))).sort((left, right) =>
    left.localeCompare(right),
  );
  const spanMs = Math.max(0, segment.endMs - segment.startMs);
  const sumMs = fragments.reduce(
    (acc, fragment) => acc + Math.max(0, fragment.endMs - fragment.startMs),
    0,
  );

  let unionMs = 0;
  let cursorStart = -1;
  let cursorEnd = -1;
  for (const fragment of fragments) {
    if (cursorStart < 0) {
      cursorStart = fragment.startMs;
      cursorEnd = fragment.endMs;
      continue;
    }
    if (fragment.startMs <= cursorEnd) {
      cursorEnd = Math.max(cursorEnd, fragment.endMs);
      continue;
    }
    unionMs += Math.max(0, cursorEnd - cursorStart);
    cursorStart = fragment.startMs;
    cursorEnd = fragment.endMs;
  }
  if (cursorStart >= 0) {
    unionMs += Math.max(0, cursorEnd - cursorStart);
  }

  const overlapMs = Math.max(0, sumMs - unionMs);
  const boostedCount = fragments.filter((fragment) => (fragment.rateMultiplier ?? 1) > 1.000_001).length;
  return { fragments, sessionIds, appNames, spanMs, sumMs, unionMs, overlapMs, boostedCount };
}

export function mergeSessionFragments(segments: SegmentData[]): SegmentData[] {
  if (segments.length <= 1) return segments;

  const sorted = [...segments].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const out: SegmentData[] = [];

  for (const segment of sorted) {
    const prev = out[out.length - 1];
    const canMerge =
      prev &&
      !prev.isManual &&
      !segment.isManual &&
      segment.startMs <= prev.endMs + SESSION_FRAGMENT_CLUSTER_GAP_MS;

    if (!canMerge) {
      const fragments = segment.isManual ? undefined : [segment];
      const appNames = segment.isManual ? undefined : [segment.appName];
      out.push({
        ...segment,
        sessionIds: segment.isManual ? undefined : getSegmentSessionIds(segment),
        fragmentCount: segment.isManual ? undefined : 1,
        fragments,
        appNames,
        mixedRateMultiplier: segment.isManual ? undefined : false,
      });
      continue;
    }

    const prevIds = getSegmentSessionIds(prev);
    const nextIds = getSegmentSessionIds(segment);
    const prevRate = typeof prev.rateMultiplier === 'number' ? prev.rateMultiplier : 1;
    const nextRate = typeof segment.rateMultiplier === 'number' ? segment.rateMultiplier : 1;
    const mergedRate = Math.max(prevRate, nextRate);
    const mixedRateMultiplier =
      Boolean(prev.mixedRateMultiplier) ||
      Boolean(segment.mixedRateMultiplier) ||
      Math.abs(prevRate - nextRate) > 0.000_001;

    const prevFragments = getSegmentFragments(prev);
    const nextFragments = getSegmentFragments(segment);
    const mergedFragments = [...prevFragments, ...nextFragments].sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
    );
    const appNames = Array.from(new Set(mergedFragments.map((fragment) => fragment.appName)));
    const appLabel =
      appNames.length <= 1 ? (appNames[0] ?? prev.appName) : `${appNames.length} apps`;

    out[out.length - 1] = {
      ...prev,
      sessionIds: [...prevIds, ...nextIds],
      sessionId: prevIds[0] ?? prev.sessionId,
      fragmentCount: (prev.fragmentCount ?? 1) + (segment.fragmentCount ?? 1),
      fragments: mergedFragments,
      appNames,
      appName: appLabel,
      startMs: Math.min(prev.startMs, segment.startMs),
      endMs: Math.max(prev.endMs, segment.endMs),
      rateMultiplier: mergedRate,
      mixedRateMultiplier,
      hasSuggestion: Boolean(prev.hasSuggestion) || Boolean(segment.hasSuggestion),
      suggestedProjectName:
        (prev.suggestedConfidence ?? 0) >= (segment.suggestedConfidence ?? 0)
          ? prev.suggestedProjectName || segment.suggestedProjectName
          : segment.suggestedProjectName || prev.suggestedProjectName,
      suggestedProjectId:
        (prev.suggestedConfidence ?? 0) >= (segment.suggestedConfidence ?? 0)
          ? prev.suggestedProjectId ?? segment.suggestedProjectId
          : segment.suggestedProjectId ?? prev.suggestedProjectId,
      suggestedConfidence: Math.max(prev.suggestedConfidence ?? 0, segment.suggestedConfidence ?? 0),
    };
  }

  return out;
}

export function computeUnionSeconds(intervals: Array<{ startMs: number; endMs: number }>): number {
  if (intervals.length === 0) return 0;
  const sorted = intervals
    .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs) && interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  if (sorted.length === 0) return 0;

  let unionMs = 0;
  let cursorStart = sorted[0].startMs;
  let cursorEnd = sorted[0].endMs;
  for (let i = 1; i < sorted.length; i++) {
    const { startMs, endMs } = sorted[i];
    if (startMs <= cursorEnd) {
      if (endMs > cursorEnd) cursorEnd = endMs;
    } else {
      unionMs += cursorEnd - cursorStart;
      cursorStart = startMs;
      cursorEnd = endMs;
    }
  }
  unionMs += cursorEnd - cursorStart;
  return Math.round(unionMs / 1000);
}

export function fmtHourMinute(ms: number): string {
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function chooseTickMinutes(spanMinutes: number): number {
  if (spanMinutes <= 120) return 15;
  if (spanMinutes <= 360) return 30;
  if (spanMinutes <= 720) return 60;
  return 120;
}

export function hexToRgba(hex: string, alpha: number): string {
  const color = normalizeHexColor(hex).replace('#', '');
  const expanded =
    color.length === 3
      ? color
          .split('')
          .map((ch) => `${ch}${ch}`)
          .join('')
      : color;
  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildProjectTimelineModel(params: {
  sessions: SessionWithApp[];
  manualSessions: ManualSessionWithProject[];
  workingHours?: WorkingHoursSettings;
  projects?: ProjectWithStats[];
  sortMode: TimelineSortMode;
  unassignedLabel: string;
}): TimelineModel | null {
  const { sessions, manualSessions, workingHours, projects, sortMode, unassignedLabel } = params;
  const valid = sessions
    .map((session) => {
      const startMs = new Date(session.start_time).getTime();
      const endMs = new Date(session.end_time).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
      return { session, startMs, endMs };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((left, right) => left.startMs - right.startMs);

  const validManual = manualSessions
    .map((manualSession) => {
      const startMs = new Date(manualSession.start_time).getTime();
      const endMs = new Date(manualSession.end_time).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
      return { manualSession, startMs, endMs };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (valid.length === 0 && validManual.length === 0) {
    return null;
  }

  const allStarts = [...valid.map((value) => value.startMs), ...validManual.map((value) => value.startMs)];
  const allEnds = [...valid.map((value) => value.endMs), ...validManual.map((value) => value.endMs)];
  const rawStart = Math.min(...allStarts);
  const rawEnd = Math.max(...allEnds);
  const workingColor = normalizeHexColor(workingHours?.color ?? '');

  const workingStartMinutes = timeToMinutes(workingHours?.start ?? '');
  const workingEndMinutes = timeToMinutes(workingHours?.end ?? '');

  const workingRangeRaw =
    workingStartMinutes !== null &&
    workingEndMinutes !== null &&
    workingEndMinutes > workingStartMinutes
      ? (() => {
          const base = new Date(rawStart);
          const dayStart = new Date(
            base.getFullYear(),
            base.getMonth(),
            base.getDate(),
            0,
            0,
            0,
            0,
          ).getTime();
          return {
            startMs: dayStart + workingStartMinutes * 60_000,
            endMs: dayStart + workingEndMinutes * 60_000,
            label: `${workingHours?.start ?? '09:00'} - ${workingHours?.end ?? '17:00'}`,
          };
        })()
      : null;

  const alignedStart = workingRangeRaw ? Math.min(rawStart, workingRangeRaw.startMs) : rawStart;
  const alignedEnd = workingRangeRaw ? Math.max(rawEnd, workingRangeRaw.endMs) : rawEnd;

  const spanMinutes = Math.max(1, Math.ceil((alignedEnd - alignedStart) / 60000));
  const tickMinutes = chooseTickMinutes(spanMinutes);
  const tickMs = tickMinutes * 60_000;

  const rangeStart = Math.floor(alignedStart / tickMs) * tickMs;
  const rangeEnd = Math.ceil(alignedEnd / tickMs) * tickMs;
  const rangeSpan = Math.max(60_000, rangeEnd - rangeStart);

  const workingRange = workingRangeRaw
    ? (() => {
        const left = ((workingRangeRaw.startMs - rangeStart) / rangeSpan) * 100;
        const right = ((workingRangeRaw.endMs - rangeStart) / rangeSpan) * 100;
        const leftClamped = Math.max(0, Math.min(100, left));
        const rightClamped = Math.max(0, Math.min(100, right));
        if (rightClamped <= leftClamped) return null;
        return {
          leftPct: leftClamped,
          widthPct: rightClamped - leftClamped,
          label: workingRangeRaw.label,
          color: workingColor,
        };
      })()
    : null;

  const byProject = new Map<string, TimelineRow>();
  const projectById = new Map<number, ProjectWithStats>();
  const projectIdByNormalizedName = new Map<string, number>();
  for (const project of projects ?? []) {
    projectById.set(project.id, project);
    projectIdByNormalizedName.set(normalizeProjectName(project.name), project.id);
  }

  for (const item of valid) {
    const projectName = item.session.project_name ?? unassignedLabel;
    const projectColor = item.session.project_color ?? '#64748b';
    const isUnassigned = item.session.project_name === null;

    const key = projectName.toLowerCase();
    if (!byProject.has(key)) {
      byProject.set(key, {
        name: projectName,
        color: projectColor,
        totalSeconds: 0,
        isUnassigned,
        boostedCount: 0,
        segments: [],
      });
    }
    const row = byProject.get(key)!;
    if ((item.session.rate_multiplier ?? 1) > 1.000_001) {
      row.boostedCount += 1;
    }

    const rawSuggestedName = (item.session.suggested_project_name ?? '').trim();
    const normalizedSuggestedName =
      rawSuggestedName.length > 0 && rawSuggestedName !== '?' ? rawSuggestedName : undefined;
    const suggestedIdFromName = normalizedSuggestedName
      ? projectIdByNormalizedName.get(normalizeProjectName(normalizedSuggestedName))
      : undefined;
    const resolvedSuggestedProjectId =
      suggestedIdFromName ?? item.session.suggested_project_id ?? undefined;
    const hasValidSuggestion = Boolean(
      resolvedSuggestedProjectId != null && projectById.has(resolvedSuggestedProjectId),
    );
    const suggestedName =
      localizeProjectLabel(
        normalizedSuggestedName ??
          (resolvedSuggestedProjectId != null
            ? projectById.get(resolvedSuggestedProjectId)?.name
            : undefined),
        {
          projectId: resolvedSuggestedProjectId ?? null,
        },
      ) || 'Unknown';

    row.segments.push({
      sessionId: item.session.id,
      startMs: item.startMs,
      endMs: item.endMs,
      appName: item.session.app_name,
      appId: item.session.app_id,
      rateMultiplier: item.session.rate_multiplier ?? 1,
      comment: item.session.comment,
      hasSuggestion: hasValidSuggestion,
      suggestedProjectName: suggestedName,
      suggestedProjectId: hasValidSuggestion ? resolvedSuggestedProjectId : undefined,
      suggestedConfidence: item.session.suggested_confidence,
    });
  }

  for (const item of validManual) {
    const projectName = item.manualSession.project_name;
    const key = projectName.toLowerCase();
    if (!byProject.has(key)) {
      byProject.set(key, {
        name: projectName,
        color: item.manualSession.project_color,
        totalSeconds: 0,
        isUnassigned: false,
        boostedCount: 0,
        segments: [],
      });
    }
    const row = byProject.get(key)!;
    row.segments.push({
      sessionId: item.manualSession.id,
      startMs: item.startMs,
      endMs: item.endMs,
      appName: item.manualSession.title,
      appId: -1,
      isManual: true,
      manualTitle: item.manualSession.title,
      manualSession: item.manualSession,
    });
  }

  const rows = Array.from(byProject.values())
    .map((row) => ({
      ...row,
      totalSeconds: computeUnionSeconds(row.segments),
      segments: mergeSessionFragments(row.segments),
    }))
    .sort((left, right) => {
      if (sortMode === 'alpha_asc') {
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      }
      const byTime = right.totalSeconds - left.totalSeconds;
      if (byTime !== 0) return byTime;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });
  const ticks: number[] = [];
  for (let tick = rangeStart; tick <= rangeEnd; tick += tickMs) {
    ticks.push(tick);
  }

  const totalSeconds = rows.reduce((acc, row) => acc + row.totalSeconds, 0);
  return { rows, ticks, rangeStart, rangeSpan, totalSeconds, workingRange };
}

export function buildAssignProjectSections(params: {
  assignProjectListMode: AssignProjectListMode;
  projects?: ProjectWithStats[];
  activeProjectsLabel: string;
  newestProjectsLabel: string;
  topProjectsLabel: string;
  remainingProjectsLabel: string;
  newProjectMaxAgeMs: number;
}): AssignProjectSection[] {
  const {
    assignProjectListMode,
    projects,
    activeProjectsLabel,
    newestProjectsLabel,
    topProjectsLabel,
    remainingProjectsLabel,
    newProjectMaxAgeMs,
  } = params;

  const activeProjects = (projects ?? []).filter((project) => !project.frozen_at);
  const activeAlpha = [...activeProjects].sort(compareProjectsByName);

  if (assignProjectListMode === 'alpha_active') {
    return [
      {
        key: 'all',
        label: activeProjectsLabel,
        projects: activeAlpha,
      },
    ];
  }

  const topProjectIds = new Set(
    [...activeProjects]
      .sort((left, right) => {
        const byTime = right.total_seconds - left.total_seconds;
        if (byTime !== 0) return byTime;
        return compareProjectsByName(left, right);
      })
      .slice(0, TOP_PROJECTS_LIMIT)
      .map((project) => project.id),
  );
  const newestAlpha = activeAlpha.filter((project) => isRecentProject(project, newProjectMaxAgeMs));
  const topAlpha = activeAlpha.filter((project) => topProjectIds.has(project.id));

  if (assignProjectListMode === 'new_top_rest') {
    const used = new Set<number>();
    const newest = newestAlpha;
    newest.forEach((project) => used.add(project.id));
    const top = topAlpha.filter((project) => !used.has(project.id));
    top.forEach((project) => used.add(project.id));
    const rest = activeAlpha.filter((project) => !used.has(project.id));

    return [
      { key: 'new', label: newestProjectsLabel, projects: newest },
      { key: 'top', label: topProjectsLabel, projects: top },
      { key: 'rest', label: remainingProjectsLabel, projects: rest },
    ];
  }

  const used = new Set<number>();
  const top = topAlpha;
  top.forEach((project) => used.add(project.id));
  const newest = newestAlpha.filter((project) => !used.has(project.id));
  newest.forEach((project) => used.add(project.id));
  const rest = activeAlpha.filter((project) => !used.has(project.id));

  return [
    { key: 'top', label: topProjectsLabel, projects: top },
    { key: 'new', label: newestProjectsLabel, projects: newest },
    { key: 'rest', label: remainingProjectsLabel, projects: rest },
  ];
}
