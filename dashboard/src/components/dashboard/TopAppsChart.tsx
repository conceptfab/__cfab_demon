import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/utils";

interface Props {
  apps: { name: string; seconds: number; color: string | null }[];
}

export function TopAppsChart({ apps }: Props) {
  const maxSeconds = apps.length > 0 ? apps[0].seconds : 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Top Applications</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {apps.length === 0 && (
            <p className="text-sm text-muted-foreground">No data yet. Import some JSON files.</p>
          )}
          {apps.map((app, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate">{app.name}</span>
                <span className="font-mono text-muted-foreground">{formatDuration(app.seconds)}</span>
              </div>
              <div className="h-2 rounded-full bg-secondary">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(app.seconds / maxSeconds) * 100}%`,
                    backgroundColor: app.color ?? "#38bdf8",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
