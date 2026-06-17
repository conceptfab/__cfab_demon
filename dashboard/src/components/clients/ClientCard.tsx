import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { formatDurationWithDaily, formatMoney } from '@/lib/utils';
import type { ClientSummary } from '@/lib/tauri';

interface ClientCardProps {
  summary: ClientSummary;
  currencyCode: string;
  onClick: () => void;
}

/** A clickable client card, mirroring the project-card pattern. */
export function ClientCard({ summary, currencyCode, onClick }: ClientCardProps) {
  const { t } = useTranslation();
  return (
    <Card
      className="cursor-pointer border-border/70 transition-colors hover:border-sky-400/50 hover:bg-secondary/10"
      onClick={onClick}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span
            className="size-3.5 shrink-0 rounded-full"
            style={{ backgroundColor: summary.color }}
          />
          <span className="truncate text-base font-semibold">{summary.client_name}</span>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="font-mono text-lg font-semibold text-sky-400">
            {formatMoney(summary.total_value, currencyCode)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('clients_page.card.projects', { n: summary.project_count })} ·{' '}
            {formatDurationWithDaily(summary.total_seconds, summary.daily_seconds)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
