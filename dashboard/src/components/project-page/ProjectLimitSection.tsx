import { Gauge, Pencil, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ProjectLimitController } from '@/hooks/useProjectLimit';
import {
  formatLimitHours,
  limitBarPercent,
  limitTone,
  LIMIT_TONE_CLASSES,
} from '@/lib/project-limit';
import { cn } from '@/lib/utils';

type ProjectLimitSectionProps = {
  controller: ProjectLimitController;
};

export function ProjectLimitSection({ controller }: ProjectLimitSectionProps) {
  const { t, i18n } = useTranslation();
  const {
    status,
    loading,
    error,
    editing,
    form,
    setForm,
    formError,
    saving,
    openEditor,
    closeEditor,
    save,
    setBoostDialogOpen,
  } = controller;

  const tone = limitTone(status?.percent ?? 0);
  const toneClasses = LIMIT_TONE_CLASSES[tone];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          <Gauge className="size-4" />
          {t('project_page.limit.title')}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={editing ? closeEditor : openEditor}
          title={t('project_page.limit.edit')}
        >
          <Pencil className="size-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : null}

        {editing ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('project_page.limit.editor_hint')}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">
                  {t('project_page.limit.field_hours')}
                </span>
                <Input
                  inputMode="decimal"
                  value={form.limitHours}
                  placeholder={t('project_page.limit.field_hours_placeholder')}
                  onChange={(e) =>
                    setForm({ ...form, limitHours: e.target.value })
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">
                  {t('project_page.limit.field_cycle_start_day')}
                </span>
                <Input
                  inputMode="numeric"
                  value={form.cycleStartDay}
                  onChange={(e) =>
                    setForm({ ...form, cycleStartDay: e.target.value })
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">
                  {t('project_page.limit.field_multiplier')}
                </span>
                <Input
                  inputMode="decimal"
                  value={form.multiplier}
                  onChange={(e) =>
                    setForm({ ...form, multiplier: e.target.value })
                  }
                />
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">
                  {t('project_page.limit.field_comment_template')}
                </span>
                <Input
                  value={form.commentTemplate}
                  placeholder={t(
                    'project_page.limit.field_comment_template_placeholder',
                  )}
                  onChange={(e) =>
                    setForm({ ...form, commentTemplate: e.target.value })
                  }
                />
              </label>
            </div>
            {formError ? (
              <p className="text-xs text-destructive">
                {t(`project_page.limit.errors.${formError}`)}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()} disabled={!!formError || saving}>
                {t('project_page.limit.save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={closeEditor}>
                {t('project_page.limit.cancel')}
              </Button>
            </div>
          </div>
        ) : loading && !status ? (
          <p className="text-xs text-muted-foreground">{t('ui.app.loading')}</p>
        ) : !status ? (
          <p className="text-xs text-muted-foreground">
            {t('project_page.limit.not_configured')}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={cn('font-mono text-lg font-semibold', toneClasses.text)}>
                {formatLimitHours(status.used_hours, i18n.language)}
                <span className="text-muted-foreground">
                  {' / '}
                  {formatLimitHours(status.limit_hours, i18n.language)}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {t('project_page.limit.cycle_range', {
                  start: status.cycle_start,
                  end: status.cycle_end,
                })}
              </span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={cn('h-full transition-all', toneClasses.bar)}
                style={{ width: `${limitBarPercent(status.percent)}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <div>
                <div className="text-muted-foreground">
                  {t('project_page.limit.remaining')}
                </div>
                <div className="font-mono font-semibold">
                  {formatLimitHours(status.remaining_hours, i18n.language)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t('project_page.limit.over')}
                </div>
                <div className={cn('font-mono font-semibold', toneClasses.text)}>
                  {formatLimitHours(status.over_hours, i18n.language)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {t('project_page.limit.multiplier')}
                </div>
                <div className="font-mono font-semibold">
                  {status.over_limit_multiplier}×
                </div>
              </div>
            </div>

            {status.manual_over_hours > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t('project_page.limit.manual_note', {
                  hours: formatLimitHours(status.manual_over_hours, i18n.language),
                })}
              </p>
            ) : null}

            <Button
              size="sm"
              className="w-full"
              disabled={status.pending_boost_count === 0}
              onClick={() => setBoostDialogOpen(true)}
            >
              <Zap className="mr-2 size-4" />
              {t('project_page.limit.apply_boost', {
                count: status.pending_boost_count,
              })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
