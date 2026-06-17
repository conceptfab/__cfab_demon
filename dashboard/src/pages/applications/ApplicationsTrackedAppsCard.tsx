import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ApplicationsPageController } from '@/hooks/useApplicationsPageController';
import { ApplicationsDesktopAppTable } from '@/pages/applications/ApplicationsDesktopAppTable';
import { ApplicationsMobileAppList } from '@/pages/applications/ApplicationsMobileAppList';

type ApplicationsTrackedAppsCardProps = Pick<
  ApplicationsPageController,
  | 'appsLoadError'
  | 'canLoadMore'
  | 'editingColorId'
  | 'filtered'
  | 'formatLastUsedDate'
  | 'handleDeleteApp'
  | 'handleRenameApp'
  | 'handleResetAppTime'
  | 'handleSearchChange'
  | 'handleUpdateColor'
  | 'loadMoreRows'
  | 'loadingApps'
  | 'monitoredSet'
  | 'pendingColor'
  | 'search'
  | 'setEditingColorId'
  | 'setPendingColor'
  | 't'
  | 'toggleSort'
  | 'visibleFiltered'
>;

export function ApplicationsTrackedAppsCard(props: ApplicationsTrackedAppsCardProps) {
  const {
    appsLoadError,
    canLoadMore,
    editingColorId,
    filtered,
    formatLastUsedDate,
    handleDeleteApp,
    handleRenameApp,
    handleResetAppTime,
    handleSearchChange,
    handleUpdateColor,
    loadMoreRows,
    loadingApps,
    monitoredSet,
    pendingColor,
    search,
    setEditingColorId,
    setPendingColor,
    t,
    toggleSort,
    visibleFiltered,
  } = props;

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="flex h-9 w-full rounded-md border bg-transparent pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={t('applications_page.search_placeholder')}
            placeholder={t('applications_page.search_placeholder')}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground sm:whitespace-nowrap">
          {t('applications_page.apps_count', { count: filtered.length })}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <ApplicationsMobileAppList
            apps={visibleFiltered}
            editingColorId={editingColorId}
            formatLastUsedDate={formatLastUsedDate}
            handleDeleteApp={handleDeleteApp}
            handleRenameApp={handleRenameApp}
            handleResetAppTime={handleResetAppTime}
            pendingColor={pendingColor}
            t={t}
          />
          <ApplicationsDesktopAppTable
            apps={visibleFiltered}
            appsLoadError={appsLoadError}
            editingColorId={editingColorId}
            filteredCount={filtered.length}
            formatLastUsedDate={formatLastUsedDate}
            handleDeleteApp={handleDeleteApp}
            handleRenameApp={handleRenameApp}
            handleResetAppTime={handleResetAppTime}
            handleUpdateColor={handleUpdateColor}
            loadingApps={loadingApps}
            monitoredSet={monitoredSet}
            pendingColor={pendingColor}
            setEditingColorId={setEditingColorId}
            setPendingColor={setPendingColor}
            t={t}
            toggleSort={toggleSort}
          />
          {canLoadMore && (
            <div className="flex justify-center border-t px-4 py-3">
              <Button variant="outline" size="sm" onClick={loadMoreRows}>
                {t('applications_page.actions.load_more')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
