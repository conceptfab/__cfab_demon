import { FolderOpen, Flame, MousePointerClick } from 'lucide-react';
import { formatDuration } from '@/lib/utils';
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

export function TopProjectsList({
  projects,
  allProjectsList,
  dateRange,
  setSessionsFocusDate,
  boostedByProject,
  manualCountsByProject,
}: TopProjectsListProps) {
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setSessionsFocusProject = useUIStore((s) => s.setSessionsFocusProject);

  if (projects.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground text-center">
        No projects found.
      </p>
    );
  }

  const maxSeconds = Math.max(1, ...projects.map((p) => p.seconds));

  return (
    <div className="space-y-0.5">
      {projects.map((p, i) => {
        const linkedProject =
          p.name === 'Unassigned'
            ? null
            : (allProjectsList.find((x) => x.name === p.name) ?? null);
        return (
          <div
            key={`${p.name}-${i}`}
            data-project-id={linkedProject?.id}
            data-project-name={linkedProject?.name}
            className="space-y-1 rounded-md p-1.5 -mx-1.5 cursor-pointer transition-colors hover:bg-muted/40"
            onClick={() => {
              setSessionsFocusDate(dateRange.end);
              if (p.name === 'Unassigned') {
                setSessionsFocusProject('unassigned');
              } else if (linkedProject) {
                setSessionsFocusProject(linkedProject.id);
              } else {
                setSessionsFocusProject(null);
              }
              setCurrentPage('sessions');
            }}
            title={`Click to view sessions for ${p.name}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs font-medium">{p.name}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 ml-5.5">
                  <span className="text-[10px] text-muted-foreground">
                    {p.session_count} sessions
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {p.app_count} apps
                  </span>
                  {(() => {
                    const boosted =
                      boostedByProject?.get(p.name.toLowerCase()) ?? 0;
                    const manual =
                      manualCountsByProject?.get(p.name.toLowerCase()) ?? 0;
                    return (
                      <div className="flex items-center gap-1.5 ml-auto">
                        {manual > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] text-sky-400"
                            title={`${manual} manual session(s)`}
                          >
                            <MousePointerClick className="h-2.5 w-2.5" />
                            {manual}
                          </span>
                        )}
                        {boosted > 0 && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400"
                            title={`${boosted} boosted session(s)`}
                          >
                            <Flame className="h-2.5 w-2.5" />
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
