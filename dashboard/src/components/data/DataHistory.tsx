import { useEffect, useState } from "react";
import { History, Trash2, FileJson, Archive, Database, Clock, File } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deleteArchiveFile, getArchiveFiles, getImportedFiles, getBackupFiles } from "@/lib/tauri";
import type { ArchivedFile, ImportedFile, BackupFile } from "@/lib/db-types";
import { useInlineT } from "@/lib/inline-i18n";

export function DataHistory() {
  const t = useInlineT();
  const [imported, setImported] = useState<ImportedFile[]>([]);
  const [archive, setArchive] = useState<ArchivedFile[]>([]);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadData = () => {
    getImportedFiles().then(setImported).catch(console.error);
    getArchiveFiles().then(setArchive).catch(console.error);
    getBackupFiles().then(setBackups).catch(console.error);
  };

  useEffect(() => {
    loadData();
    // Refresh every minute to show updated backup list if things happen in background
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteArchive = async (fileName: string) => {
    if (!confirm(t(`Czy na pewno chcesz usunąć ${fileName}?`, `Are you sure you want to delete ${fileName}?`))) return;
    setDeleting(fileName);
    try {
      await deleteArchiveFile(fileName);
      loadData();
    } catch (e: any) {
      console.error(e);
    } finally {
      setDeleting(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="space-y-8 mt-4">
      <div className="flex items-center gap-4 px-1">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70 whitespace-nowrap">{t("Pamięć i historia", "Storage & History")}</h2>
        <div className="h-px w-full bg-border/40" />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Import History */}
        <Card className="border-border/40 bg-background/50 backdrop-blur-sm shadow-xl flex flex-col h-[320px]">
          <CardHeader className="pb-3 shrink-0">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <History className="h-4 w-4 text-sky-500" />
              {t("Historia importów", "Import History")}
            </CardTitle>
            <CardDescription className="text-[10px]">{t("Wcześniej zaimportowane pliki JSON", "Previously imported JSON files")}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden flex flex-col">
            {imported.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center opacity-40">
                <FileJson className="h-8 w-8 mb-2" />
                <p className="text-[10px] uppercase tracking-wider">{t("Brak historii", "No history")}</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                {imported.map((f) => (
                  <div key={f.file_path} className="flex items-center justify-between text-[11px] p-2 rounded-md bg-accent/20 border border-border/10 hover:bg-accent/30 transition-colors group">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileJson className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate font-medium" title={f.file_path}>{f.file_path.split(/[/\\]/).pop()}</span>
                    </div>
                    <span className="shrink-0 text-[9px] text-muted-foreground bg-background/50 px-1.5 py-0.5 rounded border border-border/30">
                      {f.records_count} {t("rek.", "rec.")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Database Backups */}
        <Card className="border-border/40 bg-background/50 backdrop-blur-sm shadow-xl flex flex-col h-[320px]">
          <CardHeader className="pb-3 shrink-0">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-500" />
              {t("Kopie DB", "DB Backups")}
            </CardTitle>
            <CardDescription className="text-[10px]">{t("Ostatnie snapshoty w folderze backupu", "Recent snapshots in backup folder")}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden flex flex-col">
            {backups.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center opacity-40">
                <Database className="h-8 w-8 mb-2" />
                <p className="text-[10px] uppercase tracking-wider">{t("Brak kopii", "No backups found")}</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                {backups.map((f) => (
                  <div key={f.path} className="flex flex-col gap-1 p-2 rounded-md bg-accent/20 border border-border/10 hover:bg-accent/30 transition-colors">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <File className="h-3 w-3 text-emerald-500/70 shrink-0" />
                        <span className="truncate font-medium">{f.name}</span>
                      </div>
                      <span className="shrink-0 text-[9px] font-mono text-muted-foreground">{formatSize(f.size_bytes)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/70">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(f.modified_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Local Archive */}
        <Card className="border-border/40 bg-background/50 backdrop-blur-sm shadow-xl flex flex-col h-[320px]">
          <CardHeader className="pb-3 shrink-0">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Archive className="h-4 w-4 text-amber-500" />
              {t("Lokalne archiwum", "Local Archive")}
            </CardTitle>
            <CardDescription className="text-[10px]">{t("Dane aktywności w folderze aplikacji", "Activity data in app folder")}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden flex flex-col">
            {archive.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center opacity-40">
                <Archive className="h-8 w-8 mb-2" />
                <p className="text-[10px] uppercase tracking-wider">{t("Puste archiwum", "Empty archive")}</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                {archive.map((f) => (
                  <div key={f.file_name} className="flex items-center justify-between gap-2 text-[11px] p-2 rounded-md bg-accent/20 border border-border/10 hover:bg-accent/30 transition-colors group">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileJson className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="truncate font-medium" title={f.file_path}>{f.file_name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
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
    </div>
  );
}
