import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { FileDropzone } from "@/components/import/FileDropzone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useConfirmDialogState } from "@/hooks/useConfirmDialogState";
import { deleteArchiveFile, getArchiveFiles, getImportedFiles } from "@/lib/tauri";
import type { ArchivedFile } from "@/lib/db-types";
import { useTranslation } from "react-i18next";

export function ImportPage() {
  const { t } = useTranslation();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialogState();
  const [imported, setImported] = useState<{ file_path: string; import_date: string; records_count: number }[]>([]);
  const [archive, setArchive] = useState<ArchivedFile[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadImportData = useCallback(() => {
    getImportedFiles().then(setImported).catch(console.error);
    getArchiveFiles().then(setArchive).catch(console.error);
  }, []);

  useEffect(() => {
    loadImportData();
  }, [loadImportData]);

  const handleDeleteArchive = async (fileName: string) => {
    const confirmed = await confirm(
      t("import_page.delete_archive_confirm", { fileName }),
    );
    if (!confirmed) return;

    setDeleting(fileName);
    try {
      await deleteArchiveFile(fileName);
      loadImportData();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <FileDropzone />

      {imported.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">{t("import_page.imported_files_title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {imported.map((f) => (
                <div key={f.file_path} className="flex items-center justify-between text-xs py-1">
                  <span className="truncate text-muted-foreground">{f.file_path.split(/[/\\]/).pop()}</span>
                  <span className="font-mono text-muted-foreground">
                    {t("import_page.sessions_count", { count: f.records_count })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t("import_page.archive_title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {archive.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("import_page.archive_empty")}</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {archive.map((f) => (
                <div key={f.file_name} className="flex items-center justify-between gap-2 text-xs py-1">
                  <span className="truncate text-muted-foreground">{f.file_name}</span>
                  <AppTooltip content={t("import_page.delete_from_archive")}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => handleDeleteArchive(f.file_name)}
                      disabled={deleting === f.file_name}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AppTooltip>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
