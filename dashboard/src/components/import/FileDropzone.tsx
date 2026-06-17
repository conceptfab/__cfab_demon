import { useState, useCallback, useEffect } from 'react';
import { Upload, FileJson, CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { importJsonFiles, hasTauriRuntime } from '@/lib/tauri';
import { useDataStore } from '@/store/data-store';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { ImportResult } from '@/lib/db-types';
import { useTranslation } from 'react-i18next';

const baseName = (path: string) => path.split(/[/\\]/).pop() ?? path;
const isJsonFile = (path: string) => /\.json$/i.test(path);
const isExportArchiveName = (path: string) =>
  /^timeflow-export-.*\.json$/i.test(baseName(path));

export function FileDropzone() {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResult[]>([]);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);

  const handleImport = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      setImporting(true);
      setProgress(10);
      setResults([]);

      const archiveResults: ImportResult[] = [];
      const dailyPaths: string[] = [];
      for (const path of paths) {
        if (isExportArchiveName(path)) {
          archiveResults.push({
            file_path: path,
            success: false,
            records_imported: 0,
            error: t('components.file_dropzone.archive_redirect'),
          });
        } else {
          dailyPaths.push(path);
        }
      }

      try {
        setProgress(30);
        const res = dailyPaths.length > 0 ? await importJsonFiles(dailyPaths) : [];
        setResults([...res, ...archiveResults]);
        setProgress(100);
        if (res.some((r) => r.success)) {
          triggerRefresh('import_json_files');
        }
      } catch (e) {
        setResults([
          ...archiveResults,
          {
            file_path: 'error',
            success: false,
            records_imported: 0,
            error: String(e),
          },
        ]);
      } finally {
        setImporting(false);
      }
    },
    [t, triggerRefresh],
  );

  useEffect(() => {
    // Native drag-drop is Tauri-only (reads __TAURI_INTERNALS__); skip in browser.
    if (!hasTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          setIsDragging(true);
        } else if (event.payload.type === 'leave') {
          setIsDragging(false);
        } else if (event.payload.type === 'drop') {
          setIsDragging(false);
          const jsonPaths = event.payload.paths.filter(isJsonFile);
          if (jsonPaths.length === 0) {
            setResults([
              {
                file_path: baseName(event.payload.paths[0] ?? ''),
                success: false,
                records_imported: 0,
                error: t('components.file_dropzone.not_json'),
              },
            ]);
            return;
          }
          void handleImport(jsonPaths);
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleImport, t]);

  const handleBrowse = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await handleImport(paths);
    }
  };

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalImported = results.reduce((s, r) => s + r.records_imported, 0);

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          'border-2 border-dashed transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-border',
        )}
      >
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Upload
            className={cn(
              'mb-4 size-10',
              isDragging ? 'text-foreground' : 'text-muted-foreground',
            )}
          />
          <p className="mb-2 text-sm font-medium">
            {isDragging
              ? t('components.file_dropzone.drop_files_here')
              : t('components.file_dropzone.drag_drop_json')}
          </p>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('components.file_dropzone.browse_hint')}
          </p>
          <Button variant="outline" onClick={handleBrowse} disabled={importing}>
            <FileJson className="mr-2 size-4" />
            {t('components.file_dropzone.browse_files')}
          </Button>
        </CardContent>
      </Card>

      {importing && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('components.file_dropzone.importing')}</p>
          <Progress value={progress} />
        </div>
      )}

      {results.length > 0 && !importing && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-4 text-sm">
              {succeeded > 0 && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="size-4" />{' '}
                  {t('components.file_dropzone.imported_summary', {
                    succeeded,
                    totalImported,
                  })}
                </span>
              )}
              {failed > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <XCircle className="size-4" />{' '}
                  {t('components.file_dropzone.failed_summary', { failed })}
                </span>
              )}
            </div>
            {results.flatMap((r) => (
              r.success ? [] : [(
                <p key={r.file_path} className="text-xs text-destructive">
                  {r.file_path}: {r.error}
                </p>
              )]
            ))}
            {succeeded > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('components.file_dropzone.success_hint')}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
