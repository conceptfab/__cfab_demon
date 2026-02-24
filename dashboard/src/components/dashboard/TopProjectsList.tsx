import { FolderOpen, CircleDollarSign } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { ProjectTimeRow, ProjectWithStats, DateRange } from "@/lib/db-types";

interface TopProjectsListProps {
  projects: ProjectTimeRow[];
  allProjectsList: ProjectWithStats[];
  dateRange: DateRange;
  setSessionsFocusDate: (date: string | null) => void;
  boostedByProject?: Map<string, number>;
}

export function TopProjectsList({
  projects,
  allProjectsList,
  dateRange,
  setSessionsFocusDate,
  boostedByProject,
}: TopProjectsListProps) {
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const setSessionsFocusProject = useAppStore((s) => s.setSessionsFocusProject);

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
      {projects.map((p, i) => (
        <div
          key={`${p.name}-${i}`}
          className="space-y-1 rounded-md p-1.5 -mx-1.5 cursor-pointer transition-colors hover:bg-muted/40"
          onClick={() => {
            setSessionsFocusDate(dateRange.end);
            if (p.name === "Unassigned") {
              setSessionsFocusProject("unassigned");
            } else {
              const prj = allProjectsList.find((x) => x.name === p.name);
              if (prj) setSessionsFocusProject(prj.id);
              else setSessionsFocusProject(null);
            }
            setCurrentPage("sessions");
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
                  const boosted = boostedByProject?.get(p.name.toLowerCase()) ?? 0;
                  return boosted > 0 ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-300" title={`${boosted} session(s) with rate multiplier`}>
                      <CircleDollarSign className="h-3 w-3" />
                      {boosted} boosted
                    </span>
                  ) : null;
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
              style={{ width: `${(p.seconds / maxSeconds) * 100}%`, backgroundColor: p.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
