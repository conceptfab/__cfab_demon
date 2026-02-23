import { useState, useCallback } from "react";
import { Upload, FileJson, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { importJsonFiles } from "@/lib/tauri";
import { useAppStore } from "@/store/app-store";
import { open } from "@tauri-apps/plugin-dialog";
import type { ImportResult } from "@/lib/db-types";

export function FileDropzone() {
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResult[]>([]);
  const triggerRefresh = useAppStore((s) => s.triggerRefresh);

  const handleImport = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    setImporting(true);
    setProgress(10);
    setResults([]);

    try {
      setProgress(30);
      const res = await importJsonFiles(paths);
      setResults(res);
      setProgress(100);
      triggerRefresh();
    } catch (e) {
      setResults([{ file_path: "error", success: false, records_imported: 0, error: String(e) }]);
    } finally {
      setImporting(false);
    }
  }, [triggerRefresh]);

  const handleBrowse = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await handleImport(paths);
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files)
        .filter((f) => f.name.endsWith(".json"))
        .map((f) => (f as File & { path?: string }).path ?? f.name);
      // Note: In Tauri, we get file paths from drag events
      if (files.length > 0) handleImport(files);
    },
    [handleImport]
  );

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalImported = results.reduce((s, r) => s + r.records_imported, 0);

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          "border-2 border-dashed transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-border"
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Upload className={cn("mb-4 h-10 w-10", isDragging ? "text-foreground" : "text-muted-foreground")} />
          <p className="mb-2 text-sm font-medium">
            {isDragging ? "Drop files here" : "Drag & drop JSON files here"}
          </p>
          <p className="mb-4 text-xs text-muted-foreground">or click to browse</p>
          <Button variant="outline" onClick={handleBrowse} disabled={importing}>
            <FileJson className="mr-2 h-4 w-4" />
            Browse Files
          </Button>
        </CardContent>
      </Card>

      {importing && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Importing...</p>
          <Progress value={progress} />
        </div>
      )}

      {results.length > 0 && !importing && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-4 text-sm">
              {succeeded > 0 && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> {succeeded} files imported ({totalImported} sessions)
                </span>
              )}
              {failed > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <XCircle className="h-4 w-4" /> {failed} failed
                </span>
              )}
            </div>
            {results.filter((r) => !r.success).map((r, i) => (
              <p key={i} className="text-xs text-destructive">{r.file_path}: {r.error}</p>
            ))}
            {succeeded > 0 && (
              <p className="text-xs text-muted-foreground">
                Files imported successfully. Original JSON files can be safely deleted.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
