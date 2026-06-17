import type { AppWithStats, ProjectWithStats } from '@/lib/db-types';

type ProjectCardAssignListProps = {
  apps: AppWithStats[];
  project: ProjectWithStats;
  isDeleting: boolean;
  onAssignApp: (appId: number, projectId: number | null) => void | Promise<void>;
};

export function ProjectCardAssignList({
  apps,
  project,
  isDeleting,
  onAssignApp,
}: ProjectCardAssignListProps) {
  return (
    <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
      {apps.map((app) => (
        <label
          key={app.id}
          className="flex items-center gap-2 rounded p-1 text-sm hover:bg-accent"
        >
          <input
            type="checkbox"
            checked={app.project_id === project.id}
            onChange={() =>
              void onAssignApp(
                app.id,
                app.project_id === project.id ? null : project.id,
              )
            }
            className="accent-primary"
            disabled={isDeleting}
          />
          <span className="truncate">{app.display_name}</span>
        </label>
      ))}
    </div>
  );
}
