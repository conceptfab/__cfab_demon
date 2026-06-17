import { useTranslation } from 'react-i18next';

import { sessionsApi } from '@/lib/tauri';
import { logTauriError } from '@/lib/utils';
import { PromptModal } from '@/components/ui/prompt-modal';
import { MultiSplitSessionModal } from '@/components/sessions/MultiSplitSessionModal';
import { SessionContextMenu } from '@/components/sessions/SessionContextMenu';
import { SessionsProjectContextMenu } from '@/components/sessions/SessionsProjectContextMenu';
import type { SplitPart } from '@/lib/db-types';
import type { SessionsPageController } from '@/hooks/useSessionsPageController';

interface SessionsPageOverlaysProps {
  controller: SessionsPageController;
}

export function SessionsPageOverlays({ controller }: SessionsPageOverlaysProps) {
  const { t } = useTranslation();
  const {
    assignProjectListMode,
    assignProjectSections,
    assignProjectsCount,
    ctxMenu,
    ctxMenuPlacement,
    ctxMenuSplitSuggested,
    ctxRef,
    displayProjectName,
    handleAcceptSuggestion,
    handleAssign,
    handleCustomRateMultiplier,
    handleEditComment,
    handleSetRateMultiplier,
    multiSplitSession,
    openMultiSplitModal,
    projectCtxMenu,
    projectCtxRef,
    projects,
    promptConfig,
    selectedSplitAnalysis,
    selectedSplitAnalysisLoading,
    setAssignProjectListMode,
    setCtxMenu,
    setCurrentPage,
    setMultiSplitSession,
    setProjectCtxMenu,
    setProjectPageId,
    setPromptConfig,
    showAssignSectionHeaders,
    splitSettings,
    triggerRefresh,
    updateSessionComments,
  } = controller;

  return (
    <>
      {ctxMenu && (
        <SessionContextMenu
          menu={ctxMenu}
          menuRef={ctxRef}
          placement={ctxMenuPlacement}
          splitSuggested={ctxMenuSplitSuggested}
          assignProjectListMode={assignProjectListMode}
          onAssignProjectListModeChange={setAssignProjectListMode}
          assignProjectSections={assignProjectSections}
          assignProjectsCount={assignProjectsCount}
          showAssignSectionHeaders={showAssignSectionHeaders}
          onAcceptSuggestion={() =>
            void handleAcceptSuggestion(ctxMenu.session, {
              stopPropagation: () => {},
            } as React.MouseEvent)
          }
          onRejectSuggestion={() =>
            void handleRejectSuggestion(ctxMenu.session, {
              stopPropagation: () => {},
            } as React.MouseEvent)
          }
          onSetRateMultiplier={(multiplier) =>
            void handleSetRateMultiplier(multiplier)
          }
          onCustomRateMultiplier={() => {
            void handleCustomRateMultiplier();
          }}
          onEditComment={() => {
            void handleEditComment();
          }}
          onOpenSplit={() => {
            openMultiSplitModal(ctxMenu.session);
          }}
          onAssign={(projectId, source) => {
            void handleAssign(projectId, source);
          }}
          isManual={
            'isManual' in ctxMenu.session &&
            !!(ctxMenu.session as { isManual?: boolean }).isManual
          }
        />
      )}

      <SessionsProjectContextMenu
        menu={projectCtxMenu}
        menuRef={projectCtxRef}
        projectLabel={t('sessions.menu.project_label')}
        projectNameDisplay={
          projectCtxMenu
            ? displayProjectName(
                projectCtxMenu.projectName,
                projectCtxMenu.projectId,
              )
            : ''
        }
        goToProjectCardLabel={t('sessions.menu.go_to_project_card')}
        noLinkedProjectCardLabel={t('sessions.menu.no_linked_project_card')}
        bulkCommentLabel={t('sessions.menu.bulk_comment')}
        onNavigateToProject={(projectId) => {
          setProjectPageId(projectId);
          setCurrentPage('project-card');
        }}
        onBulkComment={(sessionIds) => {
          setPromptConfig({
            title: t('sessions.prompts.bulk_comment_title'),
            description: t('sessions.prompts.bulk_comment_description', {
              count: sessionIds.length,
            }),
            initialValue: '',
            onConfirm: async (raw) => {
              const trimmed = raw.trim();
              try {
                await updateSessionComments(sessionIds, trimmed || null);
              } catch (err) {
                logTauriError('bulk update session comments', err);
              }
            },
          });
        }}
        onClose={() => setProjectCtxMenu(null)}
      />

      <PromptModal
        open={promptConfig !== null}
        onOpenChange={(open) => {
          if (!open) {
            promptConfig?.onCancel?.();
            setPromptConfig(null);
          }
        }}
        title={promptConfig?.title ?? ''}
        description={promptConfig?.description}
        initialValue={promptConfig?.initialValue ?? ''}
        onConfirm={promptConfig?.onConfirm ?? (() => {})}
      />

      {multiSplitSession && (
        <MultiSplitSessionModal
          session={multiSplitSession}
          projects={projects}
          analysis={selectedSplitAnalysis}
          isAnalysisLoading={selectedSplitAnalysisLoading}
          maxProjects={splitSettings.maxProjectsPerSession}
          onConfirm={async (splits: SplitPart[]) => {
            await sessionsApi.splitSessionMulti(multiSplitSession.id, splits);
            setMultiSplitSession(null);
            void triggerRefresh('sessions_multi_split');
          }}
          onCancel={() => setMultiSplitSession(null)}
        />
      )}
    </>
  );
}
