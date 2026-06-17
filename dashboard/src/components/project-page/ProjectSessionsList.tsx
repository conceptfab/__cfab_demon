import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ProjectManualSessionsCard } from '@/components/project/ProjectManualSessionsCard';
import { ProjectRecentCommentsCard } from '@/components/project/ProjectRecentCommentsCard';
import { ProjectSessionsTable } from '@/components/project/ProjectSessionsTable';
import type {
  ManualSessionWithProject,
  SessionWithApp,
} from '@/lib/db-types';
import { formatDuration } from '@/lib/utils';

export type AutoSessionRow = SessionWithApp & { isManual: false };
export type ManualSessionRow = SessionWithApp &
  ManualSessionWithProject & {
    isManual: true;
  };
export type ProjectSessionRow = AutoSessionRow | ManualSessionRow;

export type RecentCommentItem = {
  key: string;
  start_time: string;
  duration_seconds: number;
  comment: string;
  source: string;
};

type ProjectSessionsListProps = {
  manualSessions: ManualSessionWithProject[];
  recentComments: RecentCommentItem[];
  groupedSessions: Array<{
    date: string;
    sessions: ProjectSessionRow[];
  }>;
  sessionCountLabel: (count: number) => string;
  onSessionContextMenu: (
    event: MouseEvent,
    session: ProjectSessionRow,
  ) => void;
  onAddManual: () => void;
  onEditManual: (session: ManualSessionWithProject) => void;
  onEditComment: (session: ProjectSessionRow) => void;
};

export function ProjectSessionsList({
  manualSessions,
  recentComments,
  groupedSessions,
  sessionCountLabel,
  onSessionContextMenu,
  onAddManual,
  onEditManual,
  onEditComment,
}: ProjectSessionsListProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProjectManualSessionsCard
          sessions={manualSessions}
          labels={{
            title: t('project_page.text.manual_sessions'),
            addManual: t('project_page.text.add_manual'),
            valueAdded: t('project_page.text.value_added'),
            emptyText: t('project_page.text.no_manual_sessions_recorded'),
          }}
          formatDuration={formatDuration}
          onAddManual={onAddManual}
          onEditManual={onEditManual}
        />

        <ProjectRecentCommentsCard
          comments={recentComments}
          labels={{
            title: t('project_page.text.recent_comments'),
            emptyText: t('project_page.text.no_comments_found'),
          }}
          formatDuration={formatDuration}
        />
      </div>

      <ProjectSessionsTable
        groupedSessions={groupedSessions}
        sessionCountLabel={sessionCountLabel}
        onSessionContextMenu={onSessionContextMenu}
        onEditManualSession={onEditManual}
        onEditComment={onEditComment}
      />
    </div>
  );
}
