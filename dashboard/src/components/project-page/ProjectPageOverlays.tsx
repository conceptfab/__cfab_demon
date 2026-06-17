import { useTranslation } from 'react-i18next';

import { ManualSessionDialog } from '@/components/ManualSessionDialog';
import { PromptModal } from '@/components/ui/prompt-modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ProjectSessionDetailDialog } from '@/components/project/ProjectSessionDetailDialog';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { ProjectPageContextMenus } from '@/components/project-page/ProjectPageContextMenus';
import { formatDuration } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import type { ProjectPageController } from '@/hooks/useProjectPageController';

interface ProjectPageOverlaysProps {
  controller: ProjectPageController;
}

export function ProjectPageOverlays({ controller }: ProjectPageOverlaysProps) {
  const { t } = useTranslation();
  const {
    appCountLabel,
    confirm,
    confirmDialogProps,
    ctxMenu,
    ctxRef,
    deleteManualSessions,
    deleteSessions,
    editManualSession,
    handleAssign,
    handleBulkDelete,
    handleBulkUnassign,
    handleCustomRateMultiplier,
    handleEditComment,
    handleEditCommentForSession,
    handleSetRateMultiplier,
    i18n,
    project,
    projectsList,
    promptConfig,
    sessionDetailOpen,
    sessionDialogDate,
    sessionDialogOpen,
    selectedSessionDetail,
    sessionCountLabel,
    setCtxMenu,
    setCurrentPage,
    setEditManualSession,
    setProjectPageId,
    setPromptConfig,
    setSelectedSessionDetail,
    setSessionDetailOpen,
    setSessionDialogDate,
    setSessionDialogOpen,
    setShowTemplateSelector,
    showInfo,
    showTemplateSelector,
    triggerRefresh,
  } = controller;

  return (
    <>
      <ProjectPageContextMenus
        ctxMenu={ctxMenu}
        ctxRef={ctxRef}
        t={t}
        i18n={i18n}
        sessionCountLabel={sessionCountLabel}
        appCountLabel={appCountLabel}
        showInfo={showInfo}
        setCtxMenu={setCtxMenu}
        setSessionDialogDate={setSessionDialogDate}
        setEditManualSession={setEditManualSession}
        setSessionDialogOpen={setSessionDialogOpen}
        setSelectedSessionDetail={setSelectedSessionDetail}
        setSessionDetailOpen={setSessionDetailOpen}
        handleSetRateMultiplier={handleSetRateMultiplier}
        handleCustomRateMultiplier={handleCustomRateMultiplier}
        handleEditComment={handleEditComment}
        handleBulkUnassign={handleBulkUnassign}
        handleBulkDelete={handleBulkDelete}
        handleAssign={handleAssign}
        confirm={confirm}
        deleteManualSessions={deleteManualSessions}
        deleteSessions={deleteSessions}
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
        confirmLabel={t('project_page.text.save')}
      />

      <ProjectSessionDetailDialog
        open={sessionDetailOpen}
        session={selectedSessionDetail}
        labels={{
          title: t('project_page.text.session_details_2'),
          project: t('project_page.text.project'),
          unassigned: t('project_page.text.unassigned'),
          appActivity: t('project_page.text.app_activity'),
          manualSession: t('project_page.text.manual_session'),
          timeRange: t('project_page.text.time_range'),
          duration: t('project_page.text.duration'),
          rateMultiplier: t('project_page.text.rate_multiplier'),
          id: 'ID',
          manualTag: t('project_page.text.manual'),
          comment: t('project_page.text.comment'),
          filesAccessed: t('project_page.text.files_accessed'),
          close: t('project_page.text.close'),
          editManualSession: t('project_page.text.edit_manual_session_3'),
          editComment: t('project_page.text.edit_comment_2'),
        }}
        formatDuration={formatDuration}
        onOpenChange={setSessionDetailOpen}
        onEditManualSession={(session) => {
          setEditManualSession(session);
          setSessionDetailOpen(false);
          setSessionDialogOpen(true);
        }}
        onEditComment={(session) => {
          handleEditCommentForSession(session);
          setSessionDetailOpen(false);
        }}
      />

      <ManualSessionDialog
        open={sessionDialogOpen}
        onOpenChange={(open) => {
          setSessionDialogOpen(open);
          if (!open) setEditManualSession(null);
        }}
        projects={projectsList}
        defaultProjectId={project?.id}
        defaultStartTime={
          sessionDialogDate ? `${sessionDialogDate}T09:00` : undefined
        }
        editSession={editManualSession || undefined}
        onSaved={() => triggerRefresh('project_page_manual_session_saved')}
      />

      <ConfirmDialog {...confirmDialogProps} />

      {showTemplateSelector && project && (
        <ReportTemplateSelector
          onSelect={(templateId) => {
            setShowTemplateSelector(false);
            useUIStore.getState().setReportTemplateId(templateId);
            setProjectPageId(project.id);
            setCurrentPage('report-view');
          }}
          onCancel={() => setShowTemplateSelector(false)}
          onEditTemplates={() => {
            setShowTemplateSelector(false);
            setCurrentPage('reports');
          }}
        />
      )}
    </>
  );
}
