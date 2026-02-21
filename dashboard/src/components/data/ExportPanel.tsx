import { useState, useEffect } from "react";
import { Download, Calendar, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getProjects, exportData } from "@/lib/tauri";
import type { ProjectWithStats } from "@/lib/db-types";

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
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Project</label>
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger>
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
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allTime"
                checked={allTime}
                onChange={(e) => setAllTime(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <label htmlFor="allTime" className="text-sm font-medium">
                All time (from the beginning)
              </label>
            </div>

            {!allTime && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">From</label>
                  <div className="relative">
                    <Calendar className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="date"
                      value={dateStart}
                      onChange={(e) => setDateStart(e.target.value)}
                      className="w-full bg-background border rounded-md py-2 pl-8 pr-2 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">To</label>
                  <div className="relative">
                    <Calendar className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="date"
                      value={dateEnd}
                      onChange={(e) => setDateEnd(e.target.value)}
                      className="w-full bg-background border rounded-md py-2 pl-8 pr-2 text-sm"
                    />
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
