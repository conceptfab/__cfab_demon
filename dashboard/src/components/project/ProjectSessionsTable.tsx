import type { MouseEvent } from 'react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import {
  CircleDollarSign,
  History,
  MessageSquare,
  PenLine,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  ManualSessionWithProject,
  SessionWithApp,
} from '@/lib/db-types';
import { formatDuration } from '@/lib/utils';
import { resolveDateFnsLocale } from '@/lib/date-helpers';

type AutoSessionTableRow = SessionWithApp & { isManual: false };
type ManualSessionTableRow = SessionWithApp &
  ManualSessionWithProject & {
    isManual: true;
  };
type ProjectSessionTableRow = AutoSessionTableRow | ManualSessionTableRow;

type ProjectSessionsTableProps = {
  groupedSessions: Array<{
    date: string;
    sessions: ProjectSessionTableRow[];
  }>;
  sessionCountLabel: (count: number) => string;
  onSessionContextMenu: (
    event: MouseEvent,
    session: ProjectSessionTableRow,
  ) => void;
  onEditManualSession: (session: ManualSessionTableRow) => void;
  onEditComment: (session: ProjectSessionTableRow) => void;
};

export function ProjectSessionsTable({
  groupedSessions,
  sessionCountLabel,
  onSessionContextMenu,
  onEditManualSession,
  onEditComment,
}: ProjectSessionsTableProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm font-medium uppercase tracking-wider text-muted-foreground">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4" />
            {t('project_page.text.detailed_session_list')}
          </div>
          <span className="text-xs font-normal lowercase text-muted-foreground">
            {t('project_page.text.right_click_to_edit_sessions')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-4">
        <div className="overflow-x-auto text-muted-foreground">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary/30 text-[10px] font-bold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">{t('project_page.text.date')}</th>
                <th className="px-4 py-3">{t('project_page.text.duration')}</th>
                <th className="px-4 py-3">
                  {t('project_page.text.application')}
                </th>
                <th className="px-4 py-3">
                  {t('project_page.text.details_comment')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {groupedSessions.map(({ date, sessions }) => (
                <Fragment key={date}>
                  <tr className="border-y border-border/5 bg-secondary/5">
                    <td colSpan={4} className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <span className="select-none text-[10px] font-bold uppercase tracking-widest text-muted-foreground/30">
                          {isToday(parseISO(date))
                            ? t('project_page.text.today')
                            : isYesterday(parseISO(date))
                              ? t('project_page.text.yesterday')
                              : format(parseISO(date), 'PPPP', { locale })}
                        </span>
                        <div className="h-[1px] flex-1 bg-border/5" />
                        <span className="font-mono text-[9px] font-medium italic text-muted-foreground/20">
                          {sessionCountLabel(sessions.length)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {sessions.map((session) => (
                    <tr
                      key={`${session.isManual ? 'm' : 's'}-${session.id}`}
                      className="cursor-context-menu transition-colors hover:bg-accent/10"
                      onContextMenu={(event) => onSessionContextMenu(event, session)}
                    >
                      <td className="min-w-[120px] whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          {session.isManual && (
                            <PenLine className="h-3 w-3 text-emerald-400" />
                          )}
                          {format(parseISO(session.start_time), 'HH:mm')}
                          <span className="mx-1.5 select-none text-muted-foreground opacity-30">
                            -
                          </span>
                          {format(parseISO(session.end_time), 'HH:mm')}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-emerald-400">
                        <div className="flex items-center gap-2">
                          {formatDuration(session.duration_seconds)}
                          {(session.rate_multiplier ?? 1) > 1.000_001 && (
                            <CircleDollarSign className="h-3 w-3 text-emerald-400" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{
                              backgroundColor: session.project_color || '#64748b',
                            }}
                          />
                          {session.isManual ? (
                            <span className="font-medium text-emerald-400">
                              {t('project_page.text.manual_session')}
                            </span>
                          ) : (
                            session.app_name
                          )}
                        </div>
                      </td>
                      <td className="group/comment px-4 py-3">
                        <div
                          className="flex max-w-xs cursor-pointer items-center gap-2 truncate text-sky-200 italic transition-colors hover:text-sky-100"
                          onClick={() => {
                            if (session.isManual) {
                              onEditManualSession(session);
                              return;
                            }
                            onEditComment(session);
                          }}
                          title={
                            session.comment
                              ? t('project_page.text.click_to_edit')
                              : t('project_page.text.click_to_add_comment')
                          }
                        >
                          {session.comment ? (
                            <>
                              <MessageSquare className="h-3 w-3 shrink-0" />
                              {session.comment}
                              {session.isManual && (
                                <PenLine className="ml-1 h-2 w-2 text-muted-foreground" />
                              )}
                            </>
                          ) : (
                            <>
                              <MessageSquare className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/comment:opacity-100" />
                              <span className="text-muted-foreground/20 transition-colors group-hover/comment:text-muted-foreground/50">
                                -
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {groupedSessions.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center italic text-muted-foreground"
                  >
                    {t('project_page.text.no_sessions_found_for_this_project')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

