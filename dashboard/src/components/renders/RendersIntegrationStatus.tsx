import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertTriangle, XCircle, CircleOff, RefreshCw, Cpu, Database, Activity } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cfabRenderApi, type CfabHubPeerInfo } from "@/lib/tauri/cfab-render";

export function RendersIntegrationStatus() {
  const { t } = useTranslation();
  const [peer, setPeer] = useState<CfabHubPeerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPeer = async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await cfabRenderApi.getCfabHubPeer();
      setPeer(info);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPeer();
  }, []);

  const getStatusBadge = (state: string) => {
    switch (state) {
      case "alive":
        return (
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 flex items-center gap-1.5 px-2.5 py-1">
            <CheckCircle2 className="size-3.5" />
            <span>{t("renders_page.status_alive")}</span>
          </Badge>
        );
      case "stale":
        return (
          <Badge variant="outline" className="border-amber-500/40 text-amber-400 bg-amber-500/10 flex items-center gap-1.5 px-2.5 py-1">
            <AlertTriangle className="size-3.5" />
            <span>{t("renders_page.status_stale")}</span>
          </Badge>
        );
      case "incompatible":
        return (
          <Badge variant="outline" className="border-destructive/40 text-destructive bg-destructive/10 flex items-center gap-1.5 px-2.5 py-1">
            <XCircle className="size-3.5" />
            <span>{t("renders_page.status_incompatible")}</span>
          </Badge>
        );
      case "unreadable":
        return (
          <Badge variant="outline" className="border-destructive/40 text-destructive bg-destructive/10 flex items-center gap-1.5 px-2.5 py-1">
            <XCircle className="size-3.5" />
            <span>{t("renders_page.status_unreadable")}</span>
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground bg-secondary/30 flex items-center gap-1.5 px-2.5 py-1">
            <CircleOff className="size-3.5" />
            <span>{t("renders_page.status_absent")}</span>
          </Badge>
        );
    }
  };

  const getSourceLabel = (src: string) => {
    switch (src) {
      case "override":
        return t("renders_page.source_override");
      case "beacon":
        return t("renders_page.source_beacon");
      default:
        return t("renders_page.source_canonical");
    }
  };

  const formatHeartbeat = (ts?: number | null) => {
    if (!ts) return t("renders_page.no_heartbeat");
    const secondsAgo = Math.max(0, Math.round(Date.now() / 1000 - ts));
    if (secondsAgo < 60) {
      return `${secondsAgo}s ${t("renders_page.ago")}`;
    }
    const minsAgo = Math.round(secondsAgo / 60);
    return `${minsAgo}m ${t("renders_page.ago")}`;
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Activity className="size-4 text-emerald-400" />
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
          className="h-8 gap-1.5"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          {t("renders_page.refresh")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/40 bg-secondary/15 p-3.5">
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("renders_page.connection_status")}
            </span>
            <div>{getStatusBadge(peer?.state ?? "absent")}</div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("renders_page.hub_version")}
            </span>
            <p className="text-sm font-medium">
              {peer?.version || "—"}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("renders_page.contract")}
            </span>
            <p className="text-sm font-medium">
              {peer?.contract != null ? `v${peer.contract}` : "—"}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("renders_page.heartbeat")}
            </span>
            <p className="text-sm font-medium">
              {formatHeartbeat(peer?.heartbeat_at)}
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border/40 bg-secondary/10 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold flex items-center gap-1.5 text-muted-foreground">
              <Database className="size-3.5" />
              {t("renders_page.database_path")}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {getSourceLabel(peer?.source ?? "canonical")}
            </Badge>
          </div>
          <p className="truncate font-mono text-[11px] text-foreground/90" title={peer?.resolved_path}>
            {peer?.resolved_path || "—"}
          </p>
          <div className="text-[11px] text-muted-foreground">
            {t("renders_page.probe_status")}: <span className="font-medium text-foreground">{peer?.probe_status || "—"}</span>
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Cpu className="size-3.5" />
            {t("renders_page.machines_title")}
          </div>

          {peer?.machines && peer.machines.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border/40">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/20 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("renders_page.col_machine")}</th>
                    <th className="px-3 py-2 font-medium">{t("renders_page.col_instance")}</th>
                    <th className="px-3 py-2 font-medium">{t("renders_page.col_last_render")}</th>
                    <th className="px-3 py-2 font-medium text-right">{t("renders_page.col_renders_count")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {peer.machines.map((m) => (
                    <tr key={`${m.hub_instance_id}-${m.machine_name}`} className="hover:bg-secondary/10">
                      <td className="px-3 py-2 font-medium">{m.machine_name}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground truncate max-w-[140px]" title={m.hub_instance_id}>
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
          ) : (
            <p className="py-3 text-center text-xs italic text-muted-foreground">
              {t("renders_page.no_machines")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
