import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ManualSessionWithProject, SessionWithApp } from '@/lib/db-types';
import { resolveDateFnsLocale } from '@/lib/date-helpers';

type AutoSessionRowLike = SessionWithApp & { isManual: false };
type ManualSessionRowLike = SessionWithApp &
  ManualSessionWithProject & {
    isManual: true;
  };
type ProjectSessionRowLike = AutoSessionRowLike | ManualSessionRowLike;

interface ProjectSessionDetailDialogLabels {
  title: string;
  project: string;
  unassigned: string;
  appActivity: string;
  manualSession: string;
  timeRange: string;
  duration: string;
  rateMultiplier: string;
  id: string;
  manualTag: string;
  comment: string;
  filesAccessed: string;
  close: string;
  editManualSession: string;
  editComment: string;
}

interface ProjectSessionDetailDialogProps {
  open: boolean;
  session: ProjectSessionRowLike | null;
  labels: ProjectSessionDetailDialogLabels;
  formatDuration: (seconds: number) => string;
  onOpenChange: (open: boolean) => void;
  onEditManualSession: (session: ManualSessionWithProject) => void;
  onEditComment: (session: SessionWithApp) => void;
}

export function ProjectSessionDetailDialog({
  open,
  session,
  labels,
  formatDuration,
  onOpenChange,
  onEditManualSession,
  onEditComment,
}: ProjectSessionDetailDialogProps) {
  const { i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[#1a1b26] border-white/10 text-white">
        {session && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: session.project_color || '#64748b' }}
                />
                <span>{labels.title}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-4">
              <div className="rounded-md border border-white/5 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  {labels.project}
                </p>
                <p className="truncate text-sm font-medium mt-1">
                  {session.project_name || labels.unassigned}
                </p>
              </div>
              <div className="rounded-md border border-white/5 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  {labels.appActivity}
                </p>
                <p className="truncate text-sm font-medium mt-1">
                  {session.isManual ? labels.manualSession : session.app_name}
                </p>
              </div>
              <div className="rounded-md border border-white/5 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  {labels.timeRange}
                </p>
                <p className="text-sm font-mono mt-1">
                  {format(parseISO(session.start_time), 'HH:mm')} -{' '}
                  {format(parseISO(session.end_time), 'HH:mm')}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {format(parseISO(session.start_time), 'PPP', { locale })}
                </p>
              </div>
              <div className="rounded-md border border-white/5 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  {labels.duration}
                </p>
                <p className="text-sm font-mono mt-1 text-emerald-400">
                  {formatDuration(session.duration_seconds)}
                </p>
              </div>
              <div className="rounded-md border border-white/5 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  {labels.rateMultiplier}
                </p>
                <p className="text-sm font-medium mt-1">
                  x{(session.rate_multiplier || 1).toFixed(2)}
                </p>
              </div>
              <div className="rounded-md border border-white/5 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  {labels.id}
                </p>
                <p className="text-sm font-mono mt-1 text-muted-foreground">
                  #{session.id} {session.isManual ? labels.manualTag : ''}
                </p>
              </div>
            </div>

            {session.comment && (
              <div className="mt-4 rounded-md border border-sky-500/20 bg-sky-500/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-sky-400 font-bold flex items-center gap-1.5">
                  <MessageSquare className="h-3 w-3" />
                  {labels.comment}
                </p>
                <p className="mt-1 text-sm italic text-sky-100/90 leading-relaxed">
                  "{session.comment}"
                </p>
              </div>
            )}

            {session.files.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  {labels.filesAccessed}
                </p>
                <div className="max-h-[200px] overflow-y-auto rounded-md border border-white/5 bg-white/5 p-2 space-y-1">
                  {session.files.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between gap-4 px-2 py-1.5 rounded hover:bg-white/5 text-[12px] border-b border-white/5 last:border-0"
                    >
                      <span
                        className="truncate text-muted-foreground/90 font-mono"
                        title={file.file_name}
                      >
                        {file.file_name}
                      </span>
                      <span className="shrink-0 text-emerald-400 font-mono opacity-80">
                        {formatDuration(file.total_seconds)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="outline"
                className="border-white/10"
                onClick={() => onOpenChange(false)}
              >
                {labels.close}
              </Button>
              {session.isManual ? (
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => onEditManualSession(session)}
                >
                  {labels.editManualSession}
                </Button>
              ) : (
                <Button
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                  onClick={() => onEditComment(session)}
                >
                  {labels.editComment}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

