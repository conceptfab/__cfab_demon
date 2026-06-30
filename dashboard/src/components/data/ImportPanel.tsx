import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '@/lib/logger';
import {
  Upload,
  AlertTriangle,
  CheckCircle2,
  FileJson,
  Info,
  Loader2,
} from 'lucide-react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { validateImport, importData, hasTauriRuntime } from '@/lib/tauri';
import {
  importPanelReducer,
  initialImportPanelState,
} from '@/components/data/import-panel-state';

import { open } from '@tauri-apps/plugin-dialog';

export function ImportPanel() {
  const { t } = useTranslation();
  const archivePathRef = useRef<string | null>(null);
  const [state, dispatch] = useReducer(importPanelReducer, initialImportPanelState);
  const { dragActive, error, importing, summary, validating, validation } = state;
  const busyRef = useRef(false);
  // Zapis refa poza renderem (react-hooks/refs); czytany w handlerze drag-drop.
  useEffect(() => {
    busyRef.current = importing || validating;
  });

  const handleValidate = useCallback(
    async (path: string) => {
      dispatch({ type: 'set_error', error: null });
      dispatch({ type: 'set_validating', validating: true });
      dispatch({ type: 'set_validation', validation: null });
      dispatch({ type: 'set_summary', summary: null });
      try {
        const result = await validateImport(path);
        dispatch({ type: 'set_validation', validation: result });
        archivePathRef.current = path;
      } catch (e) {
        logger.error('Validation failed:', e);
        dispatch({ type: 'set_error', error: String(e) });
      } finally {
        dispatch({ type: 'set_validating', validating: false });
      }
    },
    [],
  );

  const selectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: t('data_page.import_panel.json_archive'),
            extensions: ['json'],
          },
        ],
      });

      if (selected && typeof selected === 'string') {
        handleValidate(selected);
      }
    } catch (e) {
      logger.error('File selection failed:', e);
      dispatch({ type: 'set_error', error: String(e) });
    }
  };

  useEffect(() => {
    // Native drag-drop is Tauri-only (reads __TAURI_INTERNALS__); skip in browser.
    if (!hasTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          dispatch({ type: 'set_drag_active', dragActive: true });
        } else if (event.payload.type === 'leave') {
          dispatch({ type: 'set_drag_active', dragActive: false });
        } else if (event.payload.type === 'drop') {
          dispatch({ type: 'set_drag_active', dragActive: false });
          if (busyRef.current) return;
          const jsonPath = event.payload.paths.find((p) => /\.json$/i.test(p));
          if (!jsonPath) {
            dispatch({
              type: 'set_error',
              error: t('data_page.import_panel.not_json'),
            });
            return;
          }
          void handleValidate(jsonPath);
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
  }, [handleValidate, t]);

  const handleImport = async () => {
    if (!archivePathRef.current) return;
    dispatch({ type: 'set_importing', importing: true });
    dispatch({ type: 'set_error', error: null });
    try {
      const result = await importData(archivePathRef.current);
      dispatch({ type: 'set_summary', summary: result });
    } catch (e) {
      logger.error('Import failed:', e);
      dispatch({ type: 'set_error', error: String(e) });
    } finally {
      dispatch({ type: 'set_importing', importing: false });
    }
  };

  return (
    <Card className="border-border/40 bg-background/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Upload className="size-5 text-orange-500" />
          {t('data_page.import_panel.title')}
        </CardTitle>
        <CardDescription>{t('data_page.import_panel.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        )}
        {validating && (
          <div className="rounded-md border border-border/70 bg-background/35 p-4 flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-orange-500 shrink-0" />
            <div>
              <p className="text-sm font-medium">
                {t('data_page.import_panel.validating')}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {t('data_page.import_panel.validating_hint')}
              </p>
            </div>
          </div>
        )}
        {!validation && !summary && !validating && (
          <button
            type="button"
            aria-label={t('data_page.import_panel.select_file')}
            className={cn(
              'w-full border border-dashed rounded-lg p-3 flex items-center gap-4 hover:bg-accent/40 transition-colors cursor-pointer text-left',
              dragActive && 'border-orange-500 bg-orange-500/10',
            )}
            onClick={selectFile}
          >
            <div className="bg-accent/50 p-2 rounded-md">
              <FileJson className="size-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {dragActive
                  ? t('data_page.import_panel.drop_here')
                  : t('data_page.import_panel.pick_file_title')}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {t('data_page.import_panel.supported_formats')}
              </p>
            </div>
            <span className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium">
              {t('data_page.import_panel.select_file')}
            </span>
          </button>
        )}

        {validation && !summary && (
          <div className="space-y-4">
            <div className="rounded-md border border-border/70 bg-background/35 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {t('data_page.import_panel.validation_status')}
                </span>
                {validation.valid ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-500" />
                )}
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  {t('data_page.import_panel.missing_projects')}:{' '}
                  {validation.missing_projects.length}
                </p>
                <p>
                  {t('data_page.import_panel.missing_applications')}:{' '}
                  {validation.missing_applications.length}
                </p>
                <p>
                  {t('data_page.import_panel.session_conflicts')}:{' '}
                  {validation.overlapping_sessions.length}
                </p>
              </div>
            </div>

            {validation.missing_projects.length > 0 && (
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium flex items-center gap-1">
                    <Info className="size-3" />{' '}
                    {t('data_page.import_panel.new_projects_to_create')}
                  </p>
                  <div className="text-[10px] bg-sky-500/10 text-sky-400 p-2 rounded max-h-24 overflow-y-auto">
                    {validation.missing_projects.join(', ')}
                  </div>
                </div>
              </div>
            )}

            <Button
              onClick={handleImport}
              disabled={importing}
              className="w-full gap-2 bg-orange-600 hover:bg-orange-700 text-white border-0 shadow-lg shadow-orange-950/20 transition-all duration-200"
            >
              <Upload className="size-4" />
              {importing
                ? t('data_page.import_panel.importing')
                : t('data_page.import_panel.start_import')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                dispatch({ type: 'reset_flow' });
                archivePathRef.current = null;
              }}
              className="w-full"
            >
              {t('data_page.import_panel.cancel_and_select_other')}
            </Button>
          </div>
        )}

        {summary && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="text-center space-y-2 py-4">
              <div className="flex justify-center">
                <div className="size-12 bg-emerald-500/10 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="size-8 text-emerald-500" />
                </div>
              </div>
              <h3 className="font-semibold">{t('data_page.import_panel.finished')}</h3>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-border/70 bg-background/35 p-2">
                <p className="text-muted-foreground">
                  {t('data_page.import_panel.summary.projects')}
                </p>
                <p className="font-bold">
                  {summary.projects_created} {t('data_page.import_panel.summary.new')}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-2">
                <p className="text-muted-foreground">
                  {t('data_page.import_panel.summary.applications')}
                </p>
                <p className="font-bold">
                  {summary.apps_created} {t('data_page.import_panel.summary.new')}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-2">
                <p className="text-muted-foreground">
                  {t('data_page.import_panel.summary.sessions')}
                </p>
                <p className="font-bold">
                  {summary.sessions_imported}{' '}
                  {t('data_page.import_panel.summary.added')}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-2">
                <p className="text-muted-foreground">
                  {t('data_page.import_panel.summary.merged')}
                </p>
                <p className="font-bold">
                  {summary.sessions_merged}{' '}
                  {t('data_page.import_panel.summary.sessions_unit')}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              onClick={() => {
                dispatch({ type: 'reset_flow' });
                archivePathRef.current = null;
              }}
              className="w-full"
            >
              {t('data_page.import_panel.done')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
