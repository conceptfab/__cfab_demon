import { Plus, FolderOpen, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PmProjectsList } from '@/components/pm/PmProjectsList';
import { PmClientsList } from '@/components/pm/PmClientsList';
import { PmCreateProjectDialog } from '@/components/pm/PmCreateProjectDialog';
import { PmProjectDetailDialog } from '@/components/pm/PmProjectDetailDialog';
import type { PmPageController } from '@/hooks/usePmPageController';
import type { PmTab } from '@/lib/pm-page-match';

type PmPageViewProps = PmPageController;

export function PmPageView({
  activeTab,
  clientColors,
  closeCreateDialog,
  closeProjectDetail,
  createOpen,
  error,
  existingClients,
  goToSettings,
  handleCreateProjectCreated,
  handleProjectUpdated,
  loadData,
  loading,
  noFolder,
  openCreateDialog,
  openProjectCard,
  projects,
  selectedIndex,
  setActiveTab,
  setClientColors,
  setSelectedIndex,
  settings,
  t,
  tfMatches,
  thisYearCount,
}: PmPageViewProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          {!loading && settings?.work_folder && (
            <span className="text-xs text-muted-foreground">
              {t('pm.total_projects')}: {projects.length} | {t('pm.this_year')}: {thisYearCount}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={loadData} disabled={loading}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t('pm.refresh')}
          </Button>
          <Button size="sm" className="w-full sm:w-auto" onClick={openCreateDialog} disabled={!!noFolder}>
            <Plus className="mr-1.5 size-3.5" />
            {t('pm.new_project')}
          </Button>
        </div>
      </div>

      {!loading && !error && !noFolder && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 sm:px-4" role="tablist">
          {(['projects', 'clients'] as PmTab[]).map((tab) => (
            <button
              type="button"
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {t(`pm.tabs.${tab}`)}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden p-3 sm:p-4">
        {loading && (
          <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
            {t('ui.app.loading')}
          </div>
        )}
        {error && (
          <div className="flex h-40 items-center justify-center text-destructive text-sm">
            {error}
          </div>
        )}
        {noFolder && !loading && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
            <FolderOpen className="size-8 opacity-40" />
            <p>{t('pm.no_work_folder')}</p>
            <Button variant="outline" size="sm" onClick={goToSettings}>
              {t('pm.go_to_settings')}
            </Button>
          </div>
        )}
        {!loading && !error && !noFolder && activeTab === 'projects' && (
          <PmProjectsList
            projects={projects}
            clientColors={clientColors}
            tfMatches={tfMatches}
            onSelect={setSelectedIndex}
            onOpenProjectCard={openProjectCard}
          />
        )}
        {!loading && !error && !noFolder && activeTab === 'clients' && (
          <PmClientsList
            projects={projects}
            clientColors={clientColors}
            onColorsChanged={setClientColors}
          />
        )}
      </div>

      {createOpen && (
        <PmCreateProjectDialog
          open={createOpen}
          clients={existingClients}
          onClose={closeCreateDialog}
          onCreated={handleCreateProjectCreated}
        />
      )}

      {selectedIndex !== null && projects[selectedIndex] && (
        <PmProjectDetailDialog
          open={selectedIndex !== null}
          project={projects[selectedIndex]}
          index={selectedIndex}
          onClose={closeProjectDetail}
          onUpdated={handleProjectUpdated}
        />
      )}
    </div>
  );
}
