import { FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { LanSyncCardController } from '@/hooks/useLanSyncCardController';

import type { LanSyncCardProps } from './lan-sync-card-types';

type LanSyncLogPanelProps = Pick<
  LanSyncCardProps,
  'showLogLabel' | 'hideLogLabel' | 'noLogEntriesText'
> &
  Pick<
    LanSyncCardController,
    'showLog' | 'setShowLog' | 'syncLog' | 'logRef'
  >;

export function LanSyncLogPanel({
  showLogLabel,
  hideLogLabel,
  noLogEntriesText,
  showLog,
  setShowLog,
  syncLog,
  logRef,
}: LanSyncLogPanelProps) {
  return (
    <>
      <div className="flex items-center gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => setShowLog((v) => !v)}
        >
          <FileText className="size-3 mr-1" />
          {showLog ? (hideLogLabel ?? 'Hide Log') : (showLogLabel ?? 'Show Log')}
        </Button>
      </div>

      {showLog && (
        <pre
          ref={logRef}
          className="mt-2 max-h-48 overflow-auto rounded-md border border-border/50 bg-black/30 p-2 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap"
        >
          {syncLog || (noLogEntriesText ?? '(no log entries yet)')}
        </pre>
      )}
    </>
  );
}
