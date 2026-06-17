import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { ManualSessionDialog } from '@/components/ManualSessionDialog';
import { CreateProjectDialog } from '@/components/project/CreateProjectDialog';
import { MergeProjectDialog } from '@/components/project/MergeProjectDialog';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ProjectsList } from '@/components/projects/ProjectsList';
import { ExcludedProjectsList } from '@/components/projects/ExcludedProjectsList';
import { MergedProjectsList } from '@/components/projects/MergedProjectsList';
import { ProjectDiscoveryPanel } from '@/components/projects/ProjectDiscoveryPanel';
import { mobileLayout } from '@/lib/mobile-layout';
import { PROJECT_FOLDERS_LOAD_ERROR } from '@/hooks/useProjectsData';
import {
  createProjectEntry,
  mergeProjectEntries,
  restoreProjectEntry,
} from '@/lib/projects-page-api';
import type { ProjectsPageController } from '@/hooks/useProjectsPageController';

interface ProjectsViewProps {
  controller: ProjectsPageController;
}

export function ProjectsView({ controller }: ProjectsViewProps) {
  const {
    t,
    projects,
    excludedProjects,
    projectsAllTimeLoading,
    duplicateProjectsView,
    search,
    setSearch,
    sortBy,
    handleSortChange,
    useFolders,
    toggleFolders,
    viewMode,
    setViewMode,
    handleSaveDefaults,
    setCreateDialogOpen,
    projectFolders,
    projectsByFolder,
    filteredProjects,
    listSlotDeps,
    expandAllSections,
    collapseAllSections,
    sectionOpen,
    toggleSection,
    newFolderPath,
    setNewFolderPath,
    setFolderError,
    setFolderInfo,
    folderError,
    folderInfo,
    busy,
    handleBrowseFolder,
    handleAddFolder,
    handleRemoveFolder,
    handleUpdateFolderMeta,
    handleSyncFolders,
    visibleFolderCandidates,
    hiddenRegisteredFolderCandidatesCount,
    handleCreateFromFolder,
    detectedProjects,
    detectedCandidatesView,
    isDemoMode,
    handleAutoCreateDetected,
    handleClearCandidates,
    handleBlacklistDetected,
    handleClearAllDetected,
    visibleExcludedProjects,
    hiddenExcludedProjectsCount,
    handleDeleteProject,
    handleDeleteAllExcluded,
    loadMoreProjects,
    filteredExcludedProjects,
    mergedProjects,
    handleUnmerge,
    projectDialogId,
    setProjectDialogId,
    setAssignOpen,
    selectedProject,
    renderProjectCard,
    createDialogOpen,
    mergeDialogProjectId,
    setMergeDialogProjectId,
    sessionDialogOpen,
    setSessionDialogOpen,
    sessionDialogProjectId,
    triggerRefresh,
    confirmDialogProps,
  } = controller;

  return (
    <div className={mobileLayout.pageStack}>
      <ProjectsList
        projectCount={projects.length}
        excludedCount={excludedProjects.length}
        projectsAllTimeLoading={projectsAllTimeLoading}
        duplicateGroupCount={duplicateProjectsView.groupCount}
        duplicateProjectCount={duplicateProjectsView.projectCount}
        search={search}
        onSearchChange={setSearch}
        sortBy={sortBy}
        onSortChange={handleSortChange}
        useFolders={useFolders}
        onToggleFolders={toggleFolders}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onSaveDefaults={handleSaveDefaults}
        onCreateProject={() => setCreateDialogOpen(true)}
        projectFolders={projectFolders}
        projectsByFolder={projectsByFolder}
        filteredProjects={filteredProjects}
        listSlotDeps={listSlotDeps}
      />

      {projectFolders.length === 0 && (
        <div className={cn(mobileLayout.alertBox, 'flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3')}>
          <span className="mt-0.5 text-lg leading-none">!</span>
          <div className="min-w-0">
            <p className="font-semibold">{t('projects.warnings.no_folders_title')}</p>
            <p className="mt-0.5 text-[10px] text-amber-300/80 sm:text-xs">{t('projects.warnings.no_folders_defined')}</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={expandAllSections}
          className="hover:text-foreground underline"
        >
          {t('projects.actions.expand_all')}
        </button>
        <span>|</span>
        <button
          type="button"
          onClick={collapseAllSections}
          className="hover:text-foreground underline"
        >
          {t('projects.actions.collapse_all')}
        </button>
      </div>

      <ProjectDiscoveryPanel
        sectionOpen={{
          folders: sectionOpen.folders,
          candidates: sectionOpen.candidates,
          detected: sectionOpen.detected,
        }}
        onToggleFolders={toggleSection('folders')}
        onToggleCandidates={toggleSection('candidates')}
        onToggleDetected={toggleSection('detected')}
        newFolderPath={newFolderPath}
        onFolderPathChange={(value) => {
          setNewFolderPath(value);
          setFolderError(null);
          setFolderInfo(null);
        }}
        folderError={folderError}
        panelFlags={{
          isFolderLoadError: folderError === PROJECT_FOLDERS_LOAD_ERROR,
          isDemoMode,
          isClearingCandidates: busy === 'clear-candidates',
          isClearingAllDetected: busy === 'clear-all-detected',
        }}
        folderInfo={folderInfo}
        projectFolders={projectFolders}
        busy={busy}
        onBrowseFolder={() => {
          void handleBrowseFolder();
        }}
        onAddFolder={() => {
          void handleAddFolder();
        }}
        onRemoveFolder={(path) => {
          void handleRemoveFolder(path);
        }}
        onUpdateFolderMeta={(path, color, category, badge) => {
          void handleUpdateFolderMeta(path, color, category, badge);
        }}
        onSyncFolders={() => {
          void handleSyncFolders();
        }}
        visibleFolderCandidates={visibleFolderCandidates}
        hiddenRegisteredFolderCandidatesCount={
          hiddenRegisteredFolderCandidatesCount
        }
        onCreateFromFolder={(path) => {
          void handleCreateFromFolder(path);
        }}
        detectedProjectsCount={detectedProjects.length}
        detectedCandidatesView={detectedCandidatesView}
        onAutoCreateDetected={() => {
          void handleAutoCreateDetected();
        }}
        onClearCandidates={() => {
          void handleClearCandidates();
        }}
        onBlacklistDetected={(name) => {
          void handleBlacklistDetected(name);
        }}
        onClearAllDetected={() => {
          void handleClearAllDetected();
        }}
      />

      <ExcludedProjectsList
        isOpen={sectionOpen.excluded}
        onToggle={toggleSection('excluded')}
        projects={visibleExcludedProjects}
        totalExcludedCount={excludedProjects.length}
        hiddenCount={hiddenExcludedProjectsCount}
        duplicateByProjectId={duplicateProjectsView.byProjectId}
        isDeleting={(projectId) => busy === `delete-project:${projectId}`}
        isDeletingAll={busy === 'delete-all-excluded'}
        onRestore={(projectId) => {
          void restoreProjectEntry(projectId);
        }}
        onDelete={(project) => {
          void handleDeleteProject(project);
        }}
        onDeleteAll={() => {
          void handleDeleteAllExcluded();
        }}
        onLoadMore={() =>
          loadMoreProjects('excluded', filteredExcludedProjects.length)
        }
      />

      <MergedProjectsList
        isOpen={sectionOpen.merged}
        onToggle={toggleSection('merged')}
        projects={mergedProjects}
        isDeleting={(projectId) => busy === `delete-project:${projectId}`}
        onUnmerge={(projectId) => {
          void handleUnmerge(projectId);
        }}
        onDelete={(project) => {
          void handleDeleteProject(project);
        }}
      />

      <Dialog
        open={projectDialogId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setProjectDialogId(null);
            setAssignOpen(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl border-0 bg-transparent p-0 shadow-none max-sm:max-w-[calc(100vw-1rem)] max-sm:w-[calc(100vw-1rem)]">
          {selectedProject &&
            renderProjectCard(selectedProject, { inDialog: true })}
        </DialogContent>
      </Dialog>

      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        projectCount={projects.length}
        onSave={createProjectEntry}
      />

      <MergeProjectDialog
        open={mergeDialogProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setMergeDialogProjectId(null);
        }}
        project={projects.find((p) => p.id === mergeDialogProjectId) ?? null}
        projects={projects}
        onMerge={mergeProjectEntries}
      />

      <ManualSessionDialog
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
        projects={projects}
        defaultProjectId={sessionDialogProjectId}
        onSaved={() => triggerRefresh('projects_manual_session_saved')}
      />
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
