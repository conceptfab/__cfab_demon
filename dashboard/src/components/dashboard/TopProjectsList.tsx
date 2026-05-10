import { FolderOpen, Flame, MousePointerClick } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '@/lib/utils';
import { localizeProjectLabel } from '@/lib/project-labels';
import { useUIStore } from '@/store/ui-store';
import type {
  ProjectTimeRow,
  ProjectWithStats,
  DateRange,
} from '@/lib/db-types';

interface TopProjectsListProps {
  projects: ProjectTimeRow[];
  allProjectsList: ProjectWithStats[];
  dateRange: DateRange;
  setSessionsFocusDate: (date: string | null) => void;
  boostedByProject?: Map<string, number>;
  manualCountsByProject?: Map<string, number>;
}

const UNASSIGNED_PROJECT_KEY = 'unassigned';

export function TopProjectsList({
  projects,
  allProjectsList,
  dateRange,
  setSessionsFocusDate,
  boostedByProject,
  manualCountsByProject,
}: TopProjectsListProps) {
  const { t } = useTranslation();
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setSessionsFocusProject = useUIStore((s) => s.setSessionsFocusProject);

  const openProjectSessions = (projectId: number | null) => {
    setSessionsFocusDate(dateRange.end);
    if (projectId == null) {
      setSessionsFocusProject('unassigned');
    } else {
      setSessionsFocusProject(projectId);
    }
    setCurrentPage('sessions');
  };

  if (projects.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground text-center">
        {t('components.top_projects.no_projects')}
      </p>
    );
  }

  const maxSeconds = Math.max(1, ...projects.map((p) => p.seconds));

  return (
    <div className="space-y-0.5">
      {projects.map((p) => {
        const projectKey =
          p.project_id == null ? UNASSIGNED_PROJECT_KEY : String(p.project_id);
        const projectLabel = localizeProjectLabel(p.name, {
          projectId: p.project_id ?? null,
        });
        const linkedProject =
          p.project_id == null
            ? null
            : (allProjectsList.find((x) => x.id === p.project_id) ?? null);
        return (
          <div
            key={projectKey}
            data-project-id={linkedProject?.id}
            data-project-name={linkedProject?.name}
            role="button"
            tabIndex={0}
            className="space-y-1 rounded-md p-1.5 -mx-1.5 cursor-pointer transition-colors hover:bg-muted/40"
            onClick={() => openProjectSessions(p.project_id ?? null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openProjectSessions(p.project_id ?? null);
              }
            }}
            title={t('components.top_projects.click_to_view', {
              name: projectLabel,
            })}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <FolderOpen className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs font-medium">{projectLabel}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 ml-5.5">
                  <span className="text-[10px] text-muted-foreground">
                    {t('components.top_projects.sessions_count', {
                      count: p.session_count,
                    })}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t('components.top_projects.apps_count', {
                      count: p.app_count,
                    })}
                  </span>
                  {(() => {
                    const boosted =
                      boostedByProject?.get(projectKey) ?? 0;
                    const manual =
                      manualCountsByProject?.get(projectKey) ?? 0;
                    return (
                      <div className="flex items-center gap-1.5 ml-auto">
                        {manual > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] text-sky-400"
                            title={t(
                              'components.top_projects.manual_sessions_count',
                              { count: manual },
                            )}
                          >
                            <MousePointerClick className="size-2.5" />
                            {manual}
                          </span>
                        )}
                        {boosted > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400"
                            title={t(
                              'components.top_projects.boosted_sessions_count',
                              { count: boosted },
                            )}
                          >
                            <Flame className="size-2.5" />
                            {boosted}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {formatDuration(p.seconds)}
              </span>
            </div>
            <div className="ml-5.5 h-1 rounded-full bg-secondary/30">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${(p.seconds / maxSeconds) * 100}%`,
                  backgroundColor: p.color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
