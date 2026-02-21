import { useEffect, useState, useMemo, useCallback } from "react";
import { Search, ArrowUpDown, Plus, Trash2, Shield, TimerReset } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getApplications, getMonitoredApps, addMonitoredApp, removeMonitoredApp, resetAppTime, updateAppColor } from "@/lib/tauri";
import { formatDuration } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { AppWithStats, MonitoredApp } from "@/lib/db-types";

type SortKey = "display_name" | "total_seconds" | "session_count" | "last_used";

export function Applications() {
  const { triggerRefresh, refreshKey } = useAppStore();
  const [apps, setApps] = useState<AppWithStats[]>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_seconds");
  const [sortAsc, setSortAsc] = useState(false);
  const [editingColorId, setEditingColorId] = useState<number | null>(null);

  // Monitored apps state
  const [monitored, setMonitored] = useState<MonitoredApp[]>([]);
  const [newExe, setNewExe] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [monitoredError, setMonitoredError] = useState("");

  const loadMonitored = useCallback(() => {
    getMonitoredApps().then(setMonitored).catch(console.error);
  }, []);

  useEffect(() => {
    Promise.allSettled([getApplications(), getMonitoredApps()]).then((results) => {
      const [appsResult, monitoredResult] = results;

      if (appsResult.status === "fulfilled") {
        setApps(appsResult.value);
      } else {
        console.error("Failed to load applications:", appsResult.reason);
      }

      if (monitoredResult.status === "fulfilled") {
        setMonitored(monitoredResult.value);
        setMonitoredError("");
      } else {
        console.error("Failed to load monitored apps:", monitoredResult.reason);
        setMonitoredError("Failed to load monitored applications");
      }
    });
  }, [loadMonitored, refreshKey]);

  const monitoredSet = useMemo(
    () => new Set(monitored.map((m) => m.exe_name)),
    [monitored]
  );

  const handleAddApp = async () => {
    setMonitoredError("");
    try {
      await addMonitoredApp(newExe, newDisplay);
      setNewExe("");
      setNewDisplay("");
      loadMonitored();
    } catch (e) {
      setMonitoredError(String(e));
    }
  };

  const handleRemoveApp = async (exeName: string) => {
    try {
      await removeMonitoredApp(exeName);
      loadMonitored();
    } catch (e) {
      console.error(e);
    }
  };

  const filtered = useMemo(() => {
    let result = apps;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) => a.display_name.toLowerCase().includes(q) || a.executable_name.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "display_name") cmp = a.display_name.localeCompare(b.display_name);
      else if (sortKey === "total_seconds") cmp = a.total_seconds - b.total_seconds;
      else if (sortKey === "session_count") cmp = a.session_count - b.session_count;
      else if (sortKey === "last_used") cmp = (a.last_used ?? "").localeCompare(b.last_used ?? "");
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [apps, search, sortKey, sortAsc]);

  const handleResetAppTime = async (appId: number) => {
    await resetAppTime(appId);
    triggerRefresh();
  };

  const handleUpdateColor = async (appId: number, color: string) => {
    await updateAppColor(appId, color);
    setEditingColorId(null);
    triggerRefresh();
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  return (
    <div className="space-y-4">
      {/* Monitored Apps Management */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Monitored Applications
            <Badge variant="secondary" className="ml-auto">{monitored.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Add form */}
          <div className="flex items-center gap-2">
            <input
              className="flex h-8 flex-1 rounded-md border bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="exe name (e.g. code.exe)"
              value={newExe}
              onChange={(e) => setNewExe(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddApp()}
            />
            <input
              className="flex h-8 flex-1 rounded-md border bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Display name (optional)"
              value={newDisplay}
              onChange={(e) => setNewDisplay(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddApp()}
            />
            <Button size="sm" className="h-8" onClick={handleAddApp} disabled={!newExe.trim()}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Button>
          </div>
          {monitoredError && (
            <p className="text-xs text-destructive">{monitoredError}</p>
          )}

          {/* Monitored list */}
          {monitored.length > 0 ? (
            <div className="space-y-1">
              {monitored.map((app) => (
                <div key={app.exe_name} className="flex items-center justify-between rounded-md px-3 py-1.5 hover:bg-accent/50 transition-colors">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{app.display_name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{app.exe_name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveApp(app.exe_name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">
              No monitored applications. Add exe names above to start tracking.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tracked Apps Table */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="flex h-9 w-full rounded-md border bg-transparent pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Search applications..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground whitespace-nowrap">{filtered.length} apps</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                {([
                  ["display_name", "Application"],
                  ["total_seconds", "Total Time"],
                  ["session_count", "Sessions"],
                  ["last_used", "Last Used"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th key={key} className="px-4 py-3 text-left font-medium">
                    <Button variant="ghost" size="sm" className="-ml-3 h-auto p-1" onClick={() => toggleSort(key)}>
                      {label}
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </th>
                ))}
                <th className="px-4 py-3 text-left font-medium">Project</th>
                <th className="px-4 py-3 text-left font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((app) => (
                <tr key={app.id} className="border-b last:border-0 hover:bg-accent/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="relative group">
                        <div
                          className="h-3 w-3 rounded-full cursor-pointer hover:scale-125 transition-transform"
                          style={{ backgroundColor: app.color }}
                          onClick={() => setEditingColorId(editingColorId === app.id ? null : app.id)}
                          title="Change color"
                        />
                        {editingColorId === app.id && (
                          <div className="absolute top-full left-0 z-50 mt-1 p-2 rounded border bg-popover shadow-md">
                            <input
                              type="color"
                              defaultValue={app.color || "#38bdf8"}
                              className="w-16 h-8 border border-border rounded cursor-pointer"
                              onChange={(e) => handleUpdateColor(app.id, e.target.value)}
                              title="Choose color"
                            />
                            <div className="mt-2 flex gap-1">
                              {["#38bdf8", "#a78bfa", "#34d399", "#fb923c", "#f87171", "#fbbf24", "#818cf8", "#22d3ee"].map((c) => (
                                <button
                                  key={c}
                                  className="h-5 w-5 rounded-full border border-white/10 hover:scale-110 transition-transform"
                                  style={{ backgroundColor: c }}
                                  onClick={() => handleUpdateColor(app.id, c)}
                                  title={c}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{app.display_name}</p>
                        <p className="text-xs text-muted-foreground">{app.executable_name}</p>
                      </div>
                      {monitoredSet.has(app.executable_name) && (
                        <Badge variant="outline" className="text-xs h-5">monitored</Badge>
                      )}
                      {app.is_imported === 1 && (
                        <Badge variant="secondary" className="bg-orange-500/10 text-orange-500 border-orange-500/20 px-1 py-0 h-4 text-[10px]">Imported</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">{formatDuration(app.total_seconds)}</td>
                  <td className="px-4 py-3 font-mono">{app.session_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {app.last_used ? new Date(app.last_used).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {app.project_name ? (
                      <Badge variant="secondary" style={{ borderLeft: `3px solid ${app.project_color ?? "#38bdf8"}` }}>
                        {app.project_name}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleResetAppTime(app.id)}
                      title="Reset time"
                    >
                      <TimerReset className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No applications found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
