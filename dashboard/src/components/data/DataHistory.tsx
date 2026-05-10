import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from 'react-i18next';
import { History, Trash2, FileJson, Archive, Database, Clock, File } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deleteArchiveFile, getArchiveFiles, getImportedFiles, getBackupFiles } from "@/lib/tauri";
import type { ArchivedFile, ImportedFile, BackupFile } from "@/lib/db-types";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { formatBytes, logTauriError } from "@/lib/utils";
import {
  LOCAL_DATA_CHANGED_EVENT,
  type LocalDataChangedDetail,
} from "@/lib/sync-events";

const DATA_HISTORY_REFRESH_REASONS = new Set([
  "import_json_files",
  "delete_archive_file",
  "perform_manual_backup",
  "restore_database_from_file",
  "cleanup_data_folder",
  "update_database_settings",
]);

export function DataHistory() {
  const { t } = useTranslation();
  const [imported, setImported] = useState<ImportedFile[]>([]);
  const [archive, setArchive] = useState<ArchivedFile[]>([]);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const isLoadingRef = useRef(false);

  const loadData = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      const [nextImported, nextArchive, nextBackups] = await Promise.all([
        getImportedFiles(),
        getArchiveFiles(),
        getBackupFiles(),
      ]);
      setImported(nextImported);
      setArchive(nextArchive);
      setBackups(nextBackups);
    } catch (error) {
      logTauriError('load data history', error);
    } finally {
      isLoadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void loadData();

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void loadData();
    };
    const handleWindowFocus = () => {
      void loadData();
    };
    const handleLocalDataChange = (
      event: Event,
    ) => {
      const detail = (event as CustomEvent<LocalDataChangedDetail>).detail;
      if (!detail || !DATA_HISTORY_REFRESH_REASONS.has(detail.reason)) return;
      void loadData();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener(
      LOCAL_DATA_CHANGED_EVENT,
      handleLocalDataChange as EventListener,
    );

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener(
        LOCAL_DATA_CHANGED_EVENT,
        handleLocalDataChange as EventListener,
      );
    };
  }, [loadData]);

  const handleDeleteArchive = async (fileName: string) => {
    if (
      !confirm(
        t(
          'data_page.history.archive.delete_confirm',
          { fileName },
        ),
      )
    ) {
      return;
    }
    setDeleting(fileName);
    try {
      await deleteArchiveFile(fileName);
      await loadData();
    } catch (e: unknown) {
      console.error(e);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-8 mt-4">
      <div className="flex items-center gap-4 px-1">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70 whitespace-nowrap">
          {t("data_page.history.title")}
        </h2>
        <div className="h-px w-full bg-border/40" />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Import History */}
        <Card className="border-border/40 bg-background/50 backdrop-blur-sm shadow-xl flex flex-col h-[320px]">
          <CardHeader className="pb-3 shrink-0">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <History className="size-4 text-sky-500" />
              {t("data_page.history.import_history.title")}
            </CardTitle>
            <CardDescription className="text-[10px]">
              {t("data_page.history.import_history.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden flex flex-col">
            {imported.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center opacity-40">
                <FileJson className="size-8 mb-2" />
                <p className="text-[10px] uppercase tracking-wider">
                  {t("data_page.history.import_history.empty")}
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                {imported.map((f) => (
                  <div key={f.file_path} className="flex items-center justify-between text-[11px] p-2 rounded-md bg-accent/20 border border-border/10 hover:bg-accent/30 transition-colors group">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileJson className="size-3 text-muted-foreground shrink-0" />
                      <span className="truncate font-medium" title={f.file_path}>{f.file_path.split(/[/\\]/).pop()}</span>
                    </div>
                    <span className="shrink-0 text-[9px] text-muted-foreground bg-background/50 px-1.5 py-0.5 rounded border border-border/30">
                      {f.records_count} {t("data_page.history.import_history.records_short")}
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
              <Database className="size-4 text-emerald-500" />
              {t("data_page.history.backups.title")}
            </CardTitle>
            <CardDescription className="text-[10px]">
              {t("data_page.history.backups.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden flex flex-col">
            {backups.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center opacity-40">
                <Database className="size-8 mb-2" />
                <p className="text-[10px] uppercase tracking-wider">
                  {t("data_page.history.backups.empty")}
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                {backups.map((f) => (
                  <div key={f.path} className="flex flex-col gap-1 p-2 rounded-md bg-accent/20 border border-border/10 hover:bg-accent/30 transition-colors">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <File className="size-3 text-emerald-500/70 shrink-0" />
                        <span className="truncate font-medium">{f.name}</span>
                      </div>
                      <span className="shrink-0 text-[9px] font-mono text-muted-foreground">{formatBytes(f.size_bytes, 1)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/70">
                      <Clock className="size-2.5" />
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
              <Archive className="size-4 text-amber-500" />
              {t("data_page.history.archive.title")}
            </CardTitle>
            <CardDescription className="text-[10px]">
              {t("data_page.history.archive.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden flex flex-col">
            {archive.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center opacity-40">
                <Archive className="size-8 mb-2" />
                <p className="text-[10px] uppercase tracking-wider">
                  {t("data_page.history.archive.empty")}
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                {archive.map((f) => (
                  <div key={f.file_name} className="flex items-center justify-between gap-2 text-[11px] p-2 rounded-md bg-accent/20 border border-border/10 hover:bg-accent/30 transition-colors group">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileJson className="size-3 text-muted-foreground shrink-0" />
                      <span className="truncate font-medium" title={f.file_path}>{f.file_name}</span>
                    </div>
                    <AppTooltip content={t("layout.tooltips.delete_from_archive")}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                        onClick={() => handleDeleteArchive(f.file_name)}
                        disabled={deleting === f.file_name}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </AppTooltip>
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
