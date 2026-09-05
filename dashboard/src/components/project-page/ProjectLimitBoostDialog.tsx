import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ProjectLimitController } from '@/hooks/useProjectLimit';
import { renderLimitComment } from '@/lib/project-limit';
import { formatDurationRaw } from '@/lib/utils';

type ProjectLimitBoostDialogProps = {
  controller: ProjectLimitController;
};

/**
 * Podgląd przed zmianą rozliczenia: pokazuje DOKŁADNIE te sesje, które backend uzna
 * za w całości ponad limitem, i pozwala odznaczyć dowolną z nich. Nic nie dzieje się
 * automatycznie — dopiero „Zastosuj" nadaje mnożnik i komentarz.
 */
export function ProjectLimitBoostDialog({
  controller,
}: ProjectLimitBoostDialogProps) {
  const { t } = useTranslation();
  const { status, boostDialogOpen, setBoostDialogOpen, applying, applyBoost } =
    controller;

  const candidates = useMemo(
    () => status?.over_sessions.filter((s) => s.needs_boost) ?? [],
    [status],
  );
  // `null` = „wszystko zaznaczone" — stan startowy dialogu. Dopiero pierwsze
  // odznaczenie materializuje zbiór, więc lista kandydatów może się przeładować
  // (po booście) bez efektu resetującego zaznaczenie.
  const [deselected, setDeselected] = useState<Set<number> | null>(null);
  const selectedIds = useMemo(() => {
    const ids: number[] = [];
    for (const session of candidates) {
      if (!deselected || !deselected.has(session.id)) ids.push(session.id);
    }
    return ids;
  }, [candidates, deselected]);

  if (!status) return null;

  // Podgląd pokazuje tekst PO podstawieniu — to samo, co zapisze backend.
  const defaultComment = status.over_limit_comment
    ? renderLimitComment(
        status.over_limit_comment,
        status.limit_hours,
        status.cycle_start,
        status.cycle_end,
      )
    : t('project_page.limit.default_comment', {
        limit: Math.round(status.limit_hours),
        period: `${status.cycle_start} – ${status.cycle_end}`,
      });

  const toggle = (id: number) => {
    setDeselected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const close = () => {
    setDeselected(null);
    setBoostDialogOpen(false);
  };

  return (
    <Dialog
      open={boostDialogOpen}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('project_page.limit.boost_dialog_title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('project_page.limit.boost_dialog_hint', {
              multiplier: status.over_limit_multiplier,
              limit: status.limit_hours,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('project_page.limit.boost_dialog_comment')}{' '}
            <span className="font-mono text-foreground">{defaultComment}</span>
          </p>
          {status.manual_over_hours > 0 ? (
            <p className="text-xs text-amber-500">
              {t('project_page.limit.boost_dialog_manual_warning')}
            </p>
          ) : null}

          <div className="max-h-80 overflow-y-auto rounded border border-border/40">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background text-muted-foreground">
                <tr className="border-b border-border/40 text-left">
                  <th className="w-8 py-2 pl-2" />
                  <th className="py-2 pr-2 font-medium">
                    {t('project_page.limit.column_date')}
                  </th>
                  <th className="py-2 pr-2 font-medium">
                    {t('project_page.limit.column_app')}
                  </th>
                  <th className="py-2 pr-2 text-right font-medium">
                    {t('project_page.limit.column_time')}
                  </th>
                  <th className="py-2 pr-2 text-right font-medium">
                    {t('project_page.limit.column_comment')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((session) => (
                  <tr
                    key={session.id}
                    className="border-b border-border/20 last:border-0"
                  >
                    <td className="py-1.5 pl-2">
                      <input
                        type="checkbox"
                        aria-label={t('project_page.limit.column_date')}
                        checked={selectedIds.includes(session.id)}
                        onChange={() => toggle(session.id)}
                      />
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-muted-foreground">
                      {format(parseISO(session.start_time), 'yyyy-MM-dd HH:mm')}
                    </td>
                    <td className="max-w-[180px] truncate py-1.5 pr-2">
                      {session.app_name}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono">
                      {formatDurationRaw(session.effective_seconds)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-muted-foreground">
                      {session.has_comment
                        ? t('project_page.limit.comment_kept')
                        : t('project_page.limit.comment_from_template')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={close}
            >
              {t('project_page.limit.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={selectedIds.length === 0 || applying}
              onClick={() =>
                void applyBoost(selectedIds, defaultComment)
              }
            >
              {t('project_page.limit.confirm_boost', { count: selectedIds.length })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
