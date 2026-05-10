import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { MousePointerClick } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { ManualSessionWithProject } from '@/lib/db-types';
import { resolveDateFnsLocale } from '@/lib/date-helpers';

interface ProjectManualSessionsCardLabels {
  title: string;
  addManual: string;
  valueAdded: string;
  emptyText: string;
}

interface ProjectManualSessionsCardProps {
  sessions: ManualSessionWithProject[];
  labels: ProjectManualSessionsCardLabels;
  formatDuration: (seconds: number) => string;
  onAddManual: () => void;
  onEditManual: (session: ManualSessionWithProject) => void;
}

export function ProjectManualSessionsCard({
  sessions,
  labels,
  formatDuration,
  onAddManual,
  onEditManual,
}: ProjectManualSessionsCardProps) {
  const { i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MousePointerClick className="size-4 text-sky-400" />
            {labels.title}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddManual}
            className="h-6 text-[10px] font-bold text-sky-400 hover:bg-sky-400/10"
          >
            {labels.addManual}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between p-3 rounded-lg bg-secondary/20 border border-border/40 cursor-pointer hover:bg-secondary/30 transition-colors"
              onClick={() => onEditManual(session)}
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">{session.title}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {format(parseISO(session.start_time), 'PP', { locale })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono text-emerald-400">
                  {formatDuration(session.duration_seconds)}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase">
                  {labels.valueAdded}
                </p>
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="text-sm text-muted-foreground italic text-center py-4">
              {labels.emptyText}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

