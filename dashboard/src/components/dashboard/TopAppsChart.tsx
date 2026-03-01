import { AppWindow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_PRIMARY_COLOR } from "@/lib/chart-styles";
import { formatDuration } from "@/lib/utils";

interface Props {
  apps: { name: string; seconds: number; color: string | null }[];
}

export function TopAppsChart({ apps }: Props) {
  const { t } = useTranslation();
  const maxSeconds = apps.length > 0 ? Math.max(...apps.map(a => a.seconds)) : 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("components.top_apps.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-0.5">
          {apps.length === 0 && (
            <p className="py-3 text-xs text-muted-foreground text-center">{t("components.top_apps.no_data")}</p>
          )}
          {apps.map((app, i) => (
            <div
              key={`${app.name}-${i}`}
              className="space-y-1 rounded-md p-1.5 -mx-1.5 cursor-pointer transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <AppWindow className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-medium">{app.name}</span>
                  </div>
                </div>
                <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {formatDuration(app.seconds)}
                </span>
              </div>
              <div className="ml-5.5 h-1 rounded-full bg-secondary/30">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(app.seconds / maxSeconds) * 100}%`,
                    backgroundColor: app.color ?? CHART_PRIMARY_COLOR,
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
