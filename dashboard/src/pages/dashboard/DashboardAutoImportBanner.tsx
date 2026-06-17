import { useTranslation } from 'react-i18next';
import { Archive } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { useDataStore } from '@/store/data-store';

export function DashboardAutoImportBanner() {
  const { t } = useTranslation();
  const result = useDataStore((s) => s.autoImportResult);
  const done = useDataStore((s) => s.autoImportDone);

  if (!done) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-2.5 p-3">
          <Archive className="size-4 text-muted-foreground animate-pulse" />
          <span className="text-xs">
            {t('dashboard.auto_import.importing')}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;
  const importFailed = result.errors.length > 0 && result.files_imported === 0;
  if (result.files_imported === 0 && !importFailed) return null;

  const cardClassName = importFailed
    ? 'border-destructive/30 bg-destructive/5'
    : 'border-emerald-500/30 bg-emerald-500/5';
  const iconClassName = importFailed
    ? 'icon-colored size-4 text-destructive'
    : 'size-4 text-emerald-400';
  const messageClassName = importFailed
    ? 'text-xs text-destructive'
    : 'text-xs text-emerald-300';
  const message = importFailed
    ? t('dashboard.auto_import.failed', { error: result.errors[0] })
    : t('dashboard.auto_import.imported_summary', {
        imported: result.files_imported,
        archived: result.files_archived,
      });
  const skippedMessage =
    !importFailed && result.files_skipped > 0
      ? ` ${t('dashboard.auto_import.already_in_database', { skipped: result.files_skipped })}`
      : '';
  const errorCount =
    result.errors.length > 0 ? (
      <span className="ml-auto text-[10px] text-destructive">
        {t('dashboard.auto_import.errors_count', {
          count: result.errors.length,
        })}
      </span>
    ) : null;

  return (
    <Card className={cardClassName}>
      <CardContent className="flex items-center gap-2.5 p-3">
        <Archive className={iconClassName} />
        <span className={messageClassName}>
          {message}
          {skippedMessage}
        </span>
        {errorCount}
      </CardContent>
    </Card>
  );
}
