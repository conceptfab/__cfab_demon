import { useState } from 'react';
import {
  Upload,
  AlertTriangle,
  CheckCircle2,
  FileJson,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { validateImport, importData } from '@/lib/tauri';
import type { ImportValidation, ImportSummary } from '@/lib/db-types';
import { useDataStore } from '@/store/data-store';
import { useInlineT } from '@/lib/inline-i18n';

import { open } from '@tauri-apps/plugin-dialog';

export function ImportPanel() {
  const t = useInlineT();
  const [archivePath, setArchivePath] = useState<string | null>(null);
  const [validation, setValidation] = useState<ImportValidation | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);

  const selectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: t('Archiwum JSON', 'JSON Archive'),
            extensions: ['json'],
          },
        ],
      });

      if (selected && typeof selected === 'string') {
        handleValidate(selected);
      }
    } catch (e) {
      console.error('File selection failed:', e);
    }
  };

  const handleValidate = async (path: string) => {
    try {
      const result = await validateImport(path);
      setValidation(result);
      setArchivePath(path);
    } catch (e) {
      console.error('Validation failed:', e);
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
      console.error('Import failed:', e);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card className="border-border/40 bg-background/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Upload className="h-5 w-5 text-orange-500" />
          {t('Import danych', 'Data Import')}
        </CardTitle>
        <CardDescription>
          {t(
            'Wczytaj plik eksportu, aby przywrócić lub zsynchronizować dane.',
            'Upload an export file to restore or sync your data.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!validation && !summary && (
          <div
            className="border border-dashed rounded-lg p-3 flex items-center gap-4 hover:bg-accent/40 transition-colors cursor-pointer"
            onClick={selectFile}
          >
            <div className="bg-accent/50 p-2 rounded-md">
              <FileJson className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {t('Kliknij, aby wybrać plik .json', 'Click to pick a .json file')}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {t('Obsługiwane formaty: timeflow-export-*.json', 'Supported formats: timeflow-export-*.json')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={(e) => {
                e.stopPropagation();
                selectFile();
              }}
            >
              {t('Wybierz plik', 'Select File')}
            </Button>
          </div>
        )}

        {validation && !summary && (
          <div className="space-y-4">
            <div className="rounded-md border border-border/70 bg-background/35 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t('Status walidacji', 'Validation Status')}</span>
                {validation.valid ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>{t('Brakujące projekty', 'Missing Projects')}: {validation.missing_projects.length}</p>
                <p>
                  {t('Brakujące aplikacje', 'Missing Applications')}: {validation.missing_applications.length}
                </p>
                <p>
                  {t('Konflikty sesji', 'Session Conflicts')}: {validation.overlapping_sessions.length}
                </p>
              </div>
            </div>

            {validation.missing_projects.length > 0 && (
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <div className="space-y-1">
                  <p className="text-xs font-medium flex items-center gap-1">
                    <Info className="h-3 w-3" /> {t('Nowe projekty do utworzenia:', 'New projects to be created:')}
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
              <Upload className="h-4 w-4" />
              {importing ? t('Importowanie...', 'Importing...') : t('Rozpocznij import', 'Start Import')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setValidation(null);
                setArchivePath(null);
              }}
              className="w-full"
            >
              {t('Anuluj i wybierz inny plik', 'Cancel and select another file')}
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
              <h3 className="font-semibold">{t('Import zakończony!', 'Import Finished!')}</h3>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-border/70 bg-background/35 p-2">
                <p className="text-muted-foreground">{t('Projekty', 'Projects')}</p>
                <p className="font-bold">{summary.projects_created} {t('nowe', 'new')}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-2">
                <p className="text-muted-foreground">{t('Aplikacje', 'Applications')}</p>
                <p className="font-bold">{summary.apps_created} {t('nowe', 'new')}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-2">
                <p className="text-muted-foreground">{t('Sesje', 'Sessions')}</p>
                <p className="font-bold">{summary.sessions_imported} {t('dodane', 'added')}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-background/35 p-2">
                <p className="text-muted-foreground">{t('Połączone', 'Merged')}</p>
                <p className="font-bold">{summary.sessions_merged} {t('sesji', 'sessions')}</p>
              </div>
            </div>

            <Button
              variant="outline"
              onClick={() => {
                setSummary(null);
                setValidation(null);
                setArchivePath(null);
              }}
              className="w-full"
            >
              {t('Gotowe', 'Done')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
