import { useState } from "react";
import { Upload, AlertTriangle, CheckCircle2, FileJson, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { validateImport, importData } from "@/lib/tauri";
import type { ImportValidation, ImportSummary } from "@/lib/db-types";
import { useAppStore } from "@/store/app-store";

import { open } from "@tauri-apps/plugin-dialog";

export function ImportPanel() {
  const [archivePath, setArchivePath] = useState<string | null>(null);
  const [validation, setValidation] = useState<ImportValidation | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const triggerRefresh = useAppStore((s) => s.triggerRefresh);

  const selectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'JSON Archive',
          extensions: ['json']
        }]
      });
      
      if (selected && typeof selected === 'string') {
        handleValidate(selected);
      }
    } catch (e) {
      console.error("File selection failed:", e);
    }
  };

  const handleValidate = async (path: string) => {
    try {
      const result = await validateImport(path);
      setValidation(result);
      setArchivePath(path);
    } catch (e) {
      console.error("Validation failed:", e);
    }
  };

  const handleImport = async () => {
    if (!archivePath) return;
    setImporting(true);
    try {
      const result = await importData(archivePath);
      setSummary(result);
      triggerRefresh();
    } catch (e) {
      console.error("Import failed:", e);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Upload className="h-5 w-5 text-orange-500" />
          Data Import
        </CardTitle>
        <CardDescription>
          Upload an export file to restore or sync your data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!validation && !summary && (
          <div className="border-2 border-dashed rounded-lg p-12 text-center space-y-4 hover:bg-accent/50 transition-colors cursor-pointer" 
               onClick={selectFile}>
            <div className="flex justify-center">
              <FileJson className="h-12 w-12 text-muted-foreground opacity-50" />
            </div>
            <div>
              <p className="text-sm font-medium">Click to pick a .json file</p>
              <p className="text-xs text-muted-foreground mt-1">Supported formats: timeflow-export-*.json</p>
            </div>
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); selectFile(); }}>Select File</Button>
          </div>
        )}

        {validation && !summary && (
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-md space-y-2 border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Validation Status</span>
                {validation.valid ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="icon-colored h-4 w-4 text-amber-500" />
                )}
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Missing Projects: {validation.missing_projects.length}</p>
                <p>Missing Applications: {validation.missing_applications.length}</p>
                <p>Session Conflicts: {validation.overlapping_sessions.length}</p>
              </div>
            </div>

            {validation.missing_projects.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium flex items-center gap-1">
                  <Info className="h-3 w-3" /> New projects to be created:
                </p>
                <div className="text-[10px] bg-sky-500/10 text-sky-400 p-2 rounded max-h-24 overflow-y-auto">
                  {validation.missing_projects.join(", ")}
                </div>
              </div>
            )}

            <Button onClick={handleImport} disabled={importing} className="w-full gap-2 bg-orange-600 hover:bg-orange-500">
              <Upload className="h-4 w-4" />
              {importing ? "Importing..." : "Start Import"}
            </Button>
            <Button variant="ghost" onClick={() => { setValidation(null); setArchivePath(null); }} className="w-full text-xs">
              Cancel and select another file
            </Button>
          </div>
        )}

        {summary && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="text-center space-y-2 py-4">
              <div className="flex justify-center">
                <div className="h-12 w-12 bg-emerald-500/10 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                </div>
              </div>
              <h3 className="font-semibold">Import Finished!</h3>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 border rounded bg-card/50">
                <p className="text-muted-foreground">Projects</p>
                <p className="font-bold">{summary.projects_created} new</p>
              </div>
              <div className="p-2 border rounded bg-card/50">
                <p className="text-muted-foreground">Applications</p>
                <p className="font-bold">{summary.apps_created} new</p>
              </div>
              <div className="p-2 border rounded bg-card/50">
                <p className="text-muted-foreground">Sessions</p>
                <p className="font-bold">{summary.sessions_imported} added</p>
              </div>
              <div className="p-2 border rounded bg-card/50">
                <p className="text-muted-foreground">Merged</p>
                <p className="font-bold">{summary.sessions_merged} sessions</p>
              </div>
            </div>

            <Button variant="outline" onClick={() => { setSummary(null); setValidation(null); setArchivePath(null); }} className="w-full">
              Done
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

