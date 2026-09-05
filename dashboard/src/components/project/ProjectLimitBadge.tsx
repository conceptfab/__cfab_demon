import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppTooltip } from '@/components/ui/app-tooltip';
import {
  formatLimitHours,
  limitTone,
  LIMIT_TONE_CLASSES,
} from '@/lib/project-limit';
import { cn } from '@/lib/utils';
import type { ProjectLimitBadge as ProjectLimitBadgeData } from '@/lib/tauri/project-limits';

/**
 * Skrót limitu na karcie projektu: „65,0 h · 82%". Kolor niesie stan (spokój /
 * ostrzeżenie / przekroczenie), tooltip podaje okres i godziny ponad limitem.
 */
export function ProjectLimitBadge({ badge }: { badge: ProjectLimitBadgeData }) {
  const { t, i18n } = useTranslation();
  const tone = limitTone(badge.percent);

  return (
    <AppTooltip
      content={t('projects.labels.limit_tooltip', {
        used: formatLimitHours(badge.used_hours, i18n.language),
        limit: formatLimitHours(badge.limit_hours, i18n.language),
        over: formatLimitHours(badge.over_hours, i18n.language),
      })}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded border border-current/20 px-1.5 py-0.5 text-[10px] font-medium',
          LIMIT_TONE_CLASSES[tone].text,
        )}
      >
        <Gauge className="size-3" />
        {formatLimitHours(badge.limit_hours, i18n.language)}
        {' · '}
        {Math.round(badge.percent)}%
      </span>
    </AppTooltip>
  );
}
