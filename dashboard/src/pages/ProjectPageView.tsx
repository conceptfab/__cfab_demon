import { GitMerge, ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { projectsApi } from '@/lib/tauri';
import { formatDurationWithDaily } from '@/lib/utils';
import { manualToSessionRow } from '@/lib/session-utils';
import { ProjectOverview } from '@/components/project-page/ProjectOverview';
import { ProjectEstimatesSection } from '@/components/project-page/ProjectEstimatesSection';
import { ProjectTimelineSection } from '@/components/project-page/ProjectTimelineSection';
import { ProjectSessionsList } from '@/components/project-page/ProjectSessionsList';
import type { ProjectSessionRow } from '@/components/project-page/ProjectSessionsList';
import { ProjectPageOverlays } from '@/components/project-page/ProjectPageOverlays';
import type { ProjectPageController } from '@/hooks/useProjectPageController';

interface ProjectPageViewProps {
  controller: ProjectPageController;
}

export function ProjectPageView({ controller }: ProjectPageViewProps) {
  const { t } = useTranslation();
  const {
    busy,
    currencyCode,
    estimate,
    extraInfo,
    filteredTimeline,
    groupedSessions,
    handleAction,
    handleBack,
    handleCompact,
    handleContextMenu,
    handleEditCommentForSession,
    loading,
    manualSessions,
    mergedChildren,
    project,
    projectPageMinimal,
    recentComments,
    recentSessions,
    sessionCountLabel,
    setCtxMenu,
    setCurrentPage,
    setEditManualSession,
    setPageState,
    setSessionDialogDate,
    setSessionDialogOpen,
    setShowTemplateSelector,
    timelineData,
    timelineError,
  } = controller;

  if (loading && !project) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        {t('project_page.text.loading_project_details')}
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
        <span className="text-sm">
          {t('project_page.text.loading_project_details')}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentPage('projects')}
          className="h-8"
        >
          <ChevronLeft className="mr-1 size-4" />
          {t('project_page.text.back_to_projects')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <ProjectOverview
        project={project}
        onBack={handleBack}
        onGenerateReport={() => setShowTemplateSelector(true)}
        onSaveColor={async (color) => {
          await projectsApi.updateProject(project.id, color);
          setPageState((prev) => ({
            ...prev,
            data: {
              ...prev.data,
              project: prev.data.project
                ? { ...prev.data.project, color }
                : null,
            },
          }));
        }}
      />

      <ProjectEstimatesSection
        project={project}
        extraInfo={extraInfo}
        estimate={estimate}
        currencyCode={currencyCode}
        busy={busy}
        onResetTime={() =>
          void handleAction(
            () => projectsApi.resetProjectTime(project.id),
            t(
              'project_page.text.reset_tracked_time_for_this_project_this_cannot_be_undon',
            ),
          )
        }
        onToggleFreeze={() =>
          void handleAction(() =>
            project.frozen_at
              ? projectsApi.unfreezeProject(project.id)
              : projectsApi.freezeProject(project.id),
          )
        }
        onExclude={() =>
          void handleAction(
            () => projectsApi.excludeProject(project.id),
            t('project_page.text.exclude_this_project'),
          )
        }
        onCompact={handleCompact}
        minimal={projectPageMinimal}
      />

      {mergedChildren.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {t('projects.sections.merged_projects')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mergedChildren.map((child) => (
                <div
                  key={child.id}
                  className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-1.5 font-medium">
                    <GitMerge className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{child.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-emerald-400">
                      {formatDurationWithDaily(
                        child.total_seconds,
                        child.daily_seconds,
                      )}
                    </span>
                    {child.merged_at && (
                      <span className="text-muted-foreground">
                        {child.merged_at}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <ProjectTimelineSection
        project={project}
        data={filteredTimeline}
        isLoading={loading && timelineData.length === 0}
        errorMessage={timelineError}
        onBarClick={(date) => {
          setSessionDialogDate(date);
          setSessionDialogOpen(true);
        }}
        onBarContextMenu={(date, x, y) => {
          const dayLogSessions: ProjectSessionRow[] = recentSessions.reduce<
            ProjectSessionRow[]
          >((acc, s) => {
            if (s.start_time.startsWith(date)) {
              acc.push({ ...s, isManual: false as const });
            }
            return acc;
          }, []);
          const dayManualSessions: ProjectSessionRow[] = manualSessions.reduce<
            ProjectSessionRow[]
          >((acc, m) => {
            if (m.start_time.startsWith(date)) {
              acc.push(
                manualToSessionRow(m, t('project_page.text.manual_session')),
              );
            }
            return acc;
          }, []);
          setCtxMenu({
            type: 'chart',
            x,
            y,
            date,
            sessions: [...dayLogSessions, ...dayManualSessions],
          });
        }}
      />

      <ProjectSessionsList
        manualSessions={manualSessions}
        recentComments={recentComments}
        groupedSessions={groupedSessions}
        sessionCountLabel={sessionCountLabel}
        onSessionContextMenu={handleContextMenu}
        onAddManual={() => {
          setEditManualSession(null);
          setSessionDialogDate(undefined);
          setSessionDialogOpen(true);
        }}
        onEditManual={(session) => {
          setEditManualSession(session);
          setSessionDialogOpen(true);
        }}
        onEditComment={handleEditCommentForSession}
      />

      <ProjectPageOverlays controller={controller} />
    </div>
  );
}
