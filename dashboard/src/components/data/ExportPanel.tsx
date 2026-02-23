import { useState, useEffect } from "react";
import { Download, Calendar, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getProjects, exportData } from "@/lib/tauri";
import type { ProjectWithStats } from "@/lib/db-types";

const labelClassName = "text-sm font-medium text-muted-foreground";
const compactSelectClassName =
  "h-8 w-[3.75rem] rounded-md border border-input bg-background px-1.5 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function ExportPanel() {
  const [exportType, setExportType] = useState<"all" | "single">("all");
  const [selectedProject, setSelectedProject] = useState<string>("0");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");
  const [allTime, setAllTime] = useState(true);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getProjects().then(setProjects).catch(console.error);
  }, []);

  const handleExport = async () => {
    setLoading(true);
    try {
      const result = await exportData(
        exportType === "single" ? parseInt(selectedProject) : undefined,
        allTime ? undefined : dateStart,
        allTime ? undefined : dateEnd
      );
      console.log("Export successful:", result);
    } catch (e) {
      console.error("Export failed:", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Archive className="h-5 w-5 text-sky-500" />
          Data Export
        </CardTitle>
        <CardDescription>
          Export properties, sessions, and recordings to a JSON file.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="flex gap-4">
            <Button
              variant={exportType === "all" ? "default" : "outline"}
              onClick={() => setExportType("all")}
              className="flex-1"
            >
              All Data
            </Button>
            <Button
              variant={exportType === "single" ? "default" : "outline"}
              onClick={() => setExportType("single")}
              className="flex-1"
            >
              Single Project
            </Button>
          </div>

          {exportType === "single" && (
            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
                <label className={labelClassName}>Select Project</label>
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger className={compactSelectClassName}>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <label
              htmlFor="allTime"
              className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">All time (from beginning)</p>
                <p className="text-xs leading-5 break-words text-muted-foreground">
                  Export all data from the beginning of time.
                </p>
              </div>
              <input
                id="allTime"
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-primary"
                checked={allTime}
                onChange={(e) => setAllTime(e.target.checked)}
              />
            </label>

            {!allTime && (
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <div className="grid gap-1.5 text-sm">
                  <span className={labelClassName}>Date Range</span>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">From</span>
                      <div className="relative">
                        <Calendar className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                          type="date"
                          value={dateStart}
                          onChange={(e) => setDateStart(e.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 pl-8"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">To</span>
                      <div className="relative">
                        <Calendar className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                          type="date"
                          value={dateEnd}
                          onChange={(e) => setDateEnd(e.target.value)}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 pl-8"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <Button onClick={handleExport} disabled={loading} className="w-full gap-2">
          <Download className="h-4 w-4" />
          {loading ? "Exporting..." : "Export Data"}
        </Button>
      </CardContent>
    </Card>
  );
}
