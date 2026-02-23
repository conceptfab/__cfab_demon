import { useEffect, useState } from "react";
import { History, Trash2, FileJson, Archive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deleteArchiveFile, getArchiveFiles, getImportedFiles } from "@/lib/tauri";
import type { ArchivedFile, ImportedFile } from "@/lib/db-types";

export function DataHistory() {
  const [imported, setImported] = useState<ImportedFile[]>([]);
  const [archive, setArchive] = useState<ArchivedFile[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadData = () => {
    getImportedFiles().then(setImported).catch(console.error);
    getArchiveFiles().then(setArchive).catch(console.error);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDeleteArchive = async (fileName: string) => {
    if (!confirm(`Are you sure you want to delete ${fileName}?`)) return;
    setDeleting(fileName);
    try {
      await deleteArchiveFile(fileName);
      loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(null);
    }
  };

  if (imported.length === 0 && archive.length === 0) return null;

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <Card className="border-border/40 bg-background/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4 text-sky-500" />
            Import History
          </CardTitle>
          <CardDescription className="text-[10px]">Previously imported JSON files</CardDescription>
        </CardHeader>
        <CardContent>
          {imported.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No history yet</p>
          ) : (
            <div className="max-h-[240px] space-y-2 overflow-y-auto pr-2 custom-scrollbar">
              {imported.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] p-2 rounded-md bg-accent/30 border border-border/20">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileJson className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate font-medium">{f.file_path.split(/[/\\]/).pop()}</span>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground bg-background/50 px-1.5 py-0.5 rounded border border-border/30">
                    {f.records_count} sessions
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-background/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Archive className="h-4 w-4 text-amber-500" />
            Local Archive
          </CardTitle>
          <CardDescription className="text-[10px]">Files stored in the app data directory</CardDescription>
        </CardHeader>
        <CardContent>
          {archive.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Archive is empty</p>
          ) : (
            <div className="max-h-[240px] space-y-2 overflow-y-auto pr-2 custom-scrollbar">
              {archive.map((f) => (
                <div key={f.file_name} className="flex items-center justify-between gap-2 text-[11px] p-2 rounded-md bg-accent/30 border border-border/20">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileJson className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate font-medium" title={f.file_path}>{f.file_name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteArchive(f.file_name)}
                    disabled={deleting === f.file_name}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
