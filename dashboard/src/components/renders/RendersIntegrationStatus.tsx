import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleOff,
  RefreshCw,
  Database,
  Cpu,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCfabHubPeer, type CfabHubPeerInfo } from "@/lib/tauri/cfab-render";

export function RendersIntegrationStatus() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [peer, setPeer] = useState<CfabHubPeerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPeer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCfabHubPeer();
      setPeer(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPeer();
  }, [fetchPeer]);

  const getStatusBadge = (state: string) => {
    switch (state) {
      case "alive":
        return (
          <Badge variant="secondary" className="flex items-center gap-1.5 text-emerald-400">
            <CheckCircle2 className="size-3.5" />
            <span>{t("renders_page.status_alive")}</span>
          </Badge>
        );
      case "stale":
        return (
          <Badge variant="secondary" className="flex items-center gap-1.5 text-amber-400">
            <AlertTriangle className="size-3.5" />
            <span>{t("renders_page.status_stale")}</span>
          </Badge>
        );
      case "incompatible":
      case "unreadable":
        return (
          <Badge variant="secondary" className="flex items-center gap-1.5 text-destructive">
            <XCircle className="size-3.5" />
            <span>{t(`renders_page.status_${state}`)}</span>
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="flex items-center gap-1.5 text-muted-foreground">
            <CircleOff className="size-3.5" />
            <span>{t("renders_page.status_absent")}</span>
          </Badge>
        );
    }
  };

  const formatHeartbeat = (ts?: number | null) => {
    if (!ts) return t("renders_page.no_heartbeat");
    const secondsAgo = Math.max(0, Math.round(Date.now() / 1000 - ts));
    if (secondsAgo < 60) return `${secondsAgo}s ${t("renders_page.ago")}`;
    const minsAgo = Math.round(secondsAgo / 60);
    return `${minsAgo}m ${t("renders_page.ago")}`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4 text-muted-foreground" />
            {t("renders_page.integration_title")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("renders_page.integration_desc")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchPeer}
          disabled={loading}
          className="h-7 text-xs"
        >
          <RefreshCw className={`mr-1 size-3.5 ${loading ? "animate-spin" : ""}`} />
          {t("renders_page.refresh")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-4">
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("renders_page.connection_status")}
            </p>
            <div>{getStatusBadge(peer?.state ?? "absent")}</div>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("renders_page.hub_version")}
            </p>
            <p className="text-sm font-medium">{peer?.version || "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("renders_page.contract")}
            </p>
            <p className="text-sm font-medium">
              {peer?.contract != null ? `v${peer.contract}` : "—"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("renders_page.heartbeat")}
            </p>
            <p className="text-sm font-medium">{formatHeartbeat(peer?.heartbeat_at)}</p>
          </div>
        </div>

        <div className="space-y-1.5 rounded-md border border-border/70 bg-background/35 p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Database className="size-3.5" />
              {t("renders_page.database_path")}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {peer?.source === "override"
                ? t("renders_page.source_override")
                : peer?.source === "beacon"
                  ? t("renders_page.source_beacon")
                  : t("renders_page.source_canonical")}
            </Badge>
          </div>
          <p className="truncate font-mono text-[11px] text-foreground/90" title={peer?.resolved_path}>
            {peer?.resolved_path || "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("renders_page.probe_status")}:{" "}
            <span className="font-medium text-foreground">{peer?.probe_status || "—"}</span>
          </p>
        </div>

        {peer?.machines && peer.machines.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Cpu className="size-3.5" />
              {t("renders_page.machines_title")}
            </p>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/30 text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t("renders_page.col_machine")}</th>
                    <th className="px-3 py-2 font-medium">{t("renders_page.col_instance")}</th>
                    <th className="px-3 py-2 font-medium">{t("renders_page.col_last_render")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("renders_page.col_renders_count")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {peer.machines.map((m) => (
                    <tr key={`${m.hub_instance_id}-${m.machine_name}`} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{m.machine_name}</td>
                      <td className="max-w-[160px] truncate px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {m.hub_instance_id}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {m.last_ended_at ? new Date(m.last_ended_at * 1000).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{m.total_renders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
