import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { resolveDateFnsLocale } from '@/lib/date-helpers';

interface RecentCommentItemLike {
  key: string;
  start_time: string;
  duration_seconds: number;
  comment: string;
  source: string;
}

interface ProjectRecentCommentsCardLabels {
  title: string;
  emptyText: string;
}

interface ProjectRecentCommentsCardProps {
  comments: RecentCommentItemLike[];
  labels: ProjectRecentCommentsCardLabels;
  formatDuration: (seconds: number) => string;
}

export function ProjectRecentCommentsCard({
  comments,
  labels,
  formatDuration,
}: ProjectRecentCommentsCardProps) {
  const { i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <MessageSquare className="size-4 text-sky-500" />
          {labels.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {comments.map((item) => (
            <div
              key={item.key}
              className="p-3 rounded-lg bg-secondary/20 border border-border/40 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">
                  {format(parseISO(item.start_time), 'PP', { locale })}
                </span>
                <span className="text-[10px] font-mono text-emerald-400/70">
                  {formatDuration(item.duration_seconds)}
                </span>
              </div>
              <p className="text-sm text-sky-100 italic">"{item.comment}"</p>
              <p className="text-[10px] text-muted-foreground text-right">
                - {item.source}
              </p>
            </div>
          ))}
          {comments.length === 0 && (
            <p className="text-sm text-muted-foreground italic text-center py-4">
              {labels.emptyText}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

