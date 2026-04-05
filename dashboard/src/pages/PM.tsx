import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, Plus, FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pmApi } from '@/lib/tauri/pm';
import { projectsApi, dashboardApi } from '@/lib/tauri';
import type { PmProject, PmSettings, PmClientColors, PmClientInfo } from '@/lib/pm-types';
import type { ProjectWithStats, EstimateProjectRow } from '@/lib/db-types';
import { PmProjectsList } from '@/components/pm/PmProjectsList';
import { PmClientsList } from '@/components/pm/PmClientsList';
import { PmCreateProjectDialog } from '@/components/pm/PmCreateProjectDialog';
import { PmProjectDetailDialog } from '@/components/pm/PmProjectDetailDialog';
import { getErrorMessage } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';

type PmTab = 'projects' | 'clients';

const DEFAULT_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#a855f7',
  '#6366f1', '#84cc16', '#e11d48', '#0ea5e9', '#d946ef',
  '#10b981', '#f43f5e', '#7c3aed', '#eab308', '#64748b',
];

/** Ensure every client group has a color entry */
function ensureClientColors(projects: PmProject[], saved: PmClientColors): PmClientColors {
  // Build group map (same logic as PmClientsList/PmProjectsList)
  const rawSet = new Set<string>();
  for (const p of projects) rawSet.add(p.prj_client.toUpperCase());

  const groups = new Set<string>();
  for (const name of rawSet) {
    const underIdx = name.indexOf('_');
    if (underIdx > 0 && rawSet.has(name.slice(0, underIdx))) {
      groups.add(name.slice(0, underIdx));
    } else {
      groups.add(name);
    }
  }

  const result = { ...saved };
  let nextIdx = 0;
  for (const g of [...groups].sort()) {
    if (!result[g]) {
      result[g] = { color: DEFAULT_PALETTE[nextIdx % DEFAULT_PALETTE.length], comment: '', contact: '' };
      nextIdx++;
    }
  }
  return result;
}

export interface PmTfMatch {
  status: string;
  totalSeconds: number;
  estimatedValue: number;
  hasRate: boolean;
  isHot: boolean;
  tfProjectId: number | null;
}

function findTfProject(pm: PmProject, tfProjects: ProjectWithStats[]): ProjectWithStats | null {
  let bestMatch: ProjectWithStats | null = null;
  let bestScore = 0;

  const pmFull = pm.prj_full_name.toLowerCase();
  const pmName = pm.prj_name.toLowerCase();
  const pmClient = pm.prj_client.toLowerCase();

  for (const p of tfProjects) {
    const pName = p.name.toLowerCase();
    const pFolder = (p.assigned_folder_path || '').toLowerCase();
    let score = 0;

    if (pFolder && pFolder.includes(pmFull)) score = 100;
    else if (pName === pmFull) score = 90;
    else if (pName === pmClient) score = 80;
    else if (pmName && pName === pmName) score = 70;
    else if (pmClient && pmName && pName.includes(pmClient) && pName.includes(pmName)) score = 60;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = p;
    }
  }
  return bestMatch;
}

function buildTfMatch(
  match: ProjectWithStats | null,
  estimates: Map<number, EstimateProjectRow>,
  hotIds: Set<number>,
): PmTfMatch {
  if (!match) return { status: 'Archiwalny', totalSeconds: 0, estimatedValue: 0, hasRate: false, isHot: false, tfProjectId: null };
  const status = match.excluded_at ? 'Wykluczony' : match.frozen_at ? 'Zamrożony' : 'Aktywny';
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

export function PM() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<PmProject[]>([]);
  const [settings, setSettings] = useState<PmSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<PmTab>('projects');
  const [clientColors, setClientColors] = useState<PmClientColors>({});
  const [tfMatches, setTfMatches] = useState<Record<string, PmTfMatch>>({});
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setProjectPageId = useUIStore((s) => s.setProjectPageId);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sett = await pmApi.getPmSettings();
      setSettings(sett);
      if (sett.work_folder) {
        const [prj, tfActive, tfExcluded, colors, estRows] = await Promise.all([
          pmApi.getPmProjects(),
          projectsApi.getProjects(ALL_TIME_DATE_RANGE),
          projectsApi.getExcludedProjects(ALL_TIME_DATE_RANGE),
          pmApi.getPmClientColors().catch(() => ({} as PmClientColors)),
          dashboardApi.getProjectEstimates(ALL_TIME_DATE_RANGE).catch(() => [] as EstimateProjectRow[]),
        ]);
        const allTfProjects = [...tfActive, ...tfExcluded];
        const estimates = new Map<number, EstimateProjectRow>();
        for (const e of estRows) estimates.set(e.project_id, e);
        // Top 5 projects by time = "hot"
        const hotIds = new Set(
          [...tfActive].sort((a, b) => b.total_seconds - a.total_seconds).slice(0, 5).map((p) => p.id),
        );
        // Enrich PM with TF data (status, time, value)
        const matchMap: Record<string, PmTfMatch> = {};
        const enriched = prj.map((p) => {
          const tfProject = findTfProject(p, allTfProjects);
          const m = buildTfMatch(tfProject, estimates, hotIds);
          matchMap[p.prj_code] = m;
          return { ...p, prj_status: m.status };
        });
        setProjects(enriched);
        setTfMatches(matchMap);
        setClientColors(ensureClientColors(enriched, colors));
      } else {
        setProjects([]);
      }
    } catch (e) {
      const msg = getErrorMessage(e, t('pm.errors.load_failed'));
      if (typeof e === 'string' && e.includes('not configured')) {
        setSettings({ work_folder: '', settings_folder: '00_PM_NX' });
        setProjects([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadData(); }, [loadData]);

  const thisYearCount = projects.filter(
    (p) => p.prj_year === new Date().getFullYear().toString().slice(-2),
  ).length;

  const noFolder = !loading && settings && !settings.work_folder;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">{t('pm.title')}</h1>
          {!loading && settings?.work_folder && (
            <span className="ml-2 text-xs text-muted-foreground">
              {t('pm.total_projects')}: {projects.length} | {t('pm.this_year')}: {thisYearCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t('pm.refresh')}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!!noFolder}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('pm.new_project')}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      {!loading && !error && !noFolder && (
        <div className="flex items-center gap-1 border-b border-border px-4">
          {(['projects', 'clients'] as PmTab[]).map((tab) => (
            <button
              key={tab}
              className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {t(`pm.tabs.${tab}`)}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden p-4 flex flex-col">
        {loading && (
          <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
            {t('ui.app.loading')}
          </div>
        )}
        {error && (
          <div className="flex h-40 items-center justify-center text-destructive text-sm">
            {error}
          </div>
        )}
        {noFolder && !loading && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
            <FolderOpen className="h-8 w-8 opacity-40" />
            <p>{t('pm.no_work_folder')}</p>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage('settings')}>
              {t('pm.go_to_settings')}
            </Button>
          </div>
        )}
        {!loading && !error && !noFolder && activeTab === 'projects' && (
          <PmProjectsList
            projects={projects}
            clientColors={clientColors}
            tfMatches={tfMatches}
            onSelect={(i) => setSelectedIndex(i)}
            onOpenProjectCard={(id) => { setProjectPageId(id, true); setCurrentPage('project-card'); }}
          />
        )}
        {!loading && !error && !noFolder && activeTab === 'clients' && (
          <PmClientsList
            projects={projects}
            clientColors={clientColors}
            onColorsChanged={setClientColors}
          />
        )}
      </div>

      {/* Dialogs */}
      {createOpen && (
        <PmCreateProjectDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            loadData();
          }}
        />
      )}

      {selectedIndex !== null && projects[selectedIndex] && (
        <PmProjectDetailDialog
          open={selectedIndex !== null}
          project={projects[selectedIndex]}
          index={selectedIndex}
          onClose={() => setSelectedIndex(null)}
          onUpdated={() => {
            setSelectedIndex(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}
