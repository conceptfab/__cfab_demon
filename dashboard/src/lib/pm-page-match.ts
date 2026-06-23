import type { EstimateProjectRow, ProjectWithStats } from '@/lib/db-types';
import type { PmClientColors, PmProject } from '@/lib/pm-types';
import { buildClientGroupMap, collectUppercasedClientNames } from '@/lib/pm-client-groups';

const DEFAULT_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#a855f7',
  '#6366f1', '#84cc16', '#e11d48', '#0ea5e9', '#d946ef',
  '#10b981', '#f43f5e', '#7c3aed', '#eab308', '#64748b',
];

export interface PmTfMatch {
  status: string;
  totalSeconds: number;
  estimatedValue: number;
  hasRate: boolean;
  isHot: boolean;
  tfProjectId: number | null;
}

type TfProjectMatchIndex = {
  byName: Map<string, ProjectWithStats>;
  withFolder: ProjectWithStats[];
  nameTokenEntries: Array<{ project: ProjectWithStats; tokens: Set<string> }>;
  all: ProjectWithStats[];
};

function tokenizeProjectName(name: string): Set<string> {
  const tokens = new Set<string>();
  const lower = name.toLowerCase();
  tokens.add(lower);
  for (const part of lower.split(/[\s_\-/]+/)) {
    if (part) tokens.add(part);
  }
  return tokens;
}

export function buildTfProjectMatchIndex(tfProjects: ProjectWithStats[]): TfProjectMatchIndex {
  const byName = new Map<string, ProjectWithStats>();
  const withFolder: ProjectWithStats[] = [];
  const nameTokenEntries: Array<{ project: ProjectWithStats; tokens: Set<string> }> = [];
  for (const project of tfProjects) {
    const nameLC = project.name.toLowerCase();
    byName.set(nameLC, project);
    nameTokenEntries.push({ project, tokens: tokenizeProjectName(project.name) });
    if (project.assigned_folder_path) {
      withFolder.push(project);
    }
  }
  return { byName, withFolder, nameTokenEntries, all: tfProjects };
}

export function findTfProject(
  pm: PmProject,
  index: TfProjectMatchIndex,
): ProjectWithStats | null {
  let bestMatch: ProjectWithStats | null = null;
  let bestScore = 0;

  const pmFull = pm.prj_full_name.toLowerCase();
  const pmName = pm.prj_name.toLowerCase();
  const pmClient = pm.prj_client.toLowerCase();

  for (const project of index.withFolder) {
    const folder = (project.assigned_folder_path || '').toLowerCase();
    if (folder.length < pmFull.length) continue;
    if (folder.includes(pmFull)) {
      const score = 100;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = project;
      }
    }
  }

  const scoreCandidates: Array<{ score: number; project: ProjectWithStats | undefined }> = [
    { score: 90, project: index.byName.get(pmFull) },
    { score: 80, project: index.byName.get(pmClient) },
    { score: 70, project: pmName ? index.byName.get(pmName) : undefined },
  ];

  for (const candidate of scoreCandidates) {
    if (candidate.project && candidate.score > bestScore) {
      bestScore = candidate.score;
      bestMatch = candidate.project;
    }
  }

  if (pmClient && pmName) {
    for (const entry of index.nameTokenEntries) {
      if (entry.tokens.has(pmClient) && entry.tokens.has(pmName)) {
        const score = 60;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = entry.project;
        }
      }
    }
  }

  return bestMatch;
}

export function buildTfMatch(
  match: ProjectWithStats | null,
  estimates: Map<number, EstimateProjectRow>,
  hotIds: Set<number>,
): PmTfMatch {
  if (!match) {
    return {
      status: 'archived',
      totalSeconds: 0,
      estimatedValue: 0,
      hasRate: false,
      isHot: false,
      tfProjectId: null,
    };
  }
  const status = match.excluded_at ? 'excluded' : match.frozen_at ? 'frozen' : 'active';
  const est = estimates.get(match.id);
  return {
    status,
    totalSeconds: est?.seconds || match.total_seconds || 0,
    estimatedValue: est?.estimated_value || 0,
    hasRate: (est?.effective_hourly_rate || 0) > 0,
    isHot: hotIds.has(match.id),
    tfProjectId: match.id,
  };
}

/** Ensure every client group has a color entry */
export function ensureClientColors(
  projects: PmProject[],
  saved: PmClientColors,
): PmClientColors {
  const rawSet = collectUppercasedClientNames(projects);
  const groupMap = buildClientGroupMap(rawSet);
  const groups = new Set(groupMap.values());

  const result = { ...saved };
  let nextIdx = 0;
  for (const g of [...groups].toSorted()) {
    if (!result[g]) {
      result[g] = {
        // safe: modulo always yields a valid index into a non-empty fixed array
        color: DEFAULT_PALETTE[nextIdx % DEFAULT_PALETTE.length]!,
        comment: '',
        contact: '',
      };
      nextIdx++;
    }
  }
  return result;
}

export type PmTab = 'projects' | 'clients';
