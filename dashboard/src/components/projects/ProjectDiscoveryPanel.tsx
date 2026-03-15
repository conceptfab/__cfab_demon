import { CircleOff, Plus, RefreshCw, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CollapsibleSection } from '@/components/project/CollapsibleSection';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  DetectedProject,
  FolderProjectCandidate,
  ProjectFolder,
} from '@/lib/db-types';
import { formatDuration, formatPathForDisplay } from '@/lib/utils';

type DetectedCandidatesView = {
  visible: Array<
    DetectedProject & {
      inferredProjectName: string;
    }
  >;
  hiddenExisting: number;
  hiddenExcluded: number;
  hiddenDuplicates: number;
  hiddenOverflow: number;
  totalCandidateCount: number;
};

type ProjectDiscoveryPanelProps = {
  sectionOpen: {
    folders: boolean;
    candidates: boolean;
    detected: boolean;
  };
  onToggleFolders: () => void;
  onToggleCandidates: () => void;
  onToggleDetected: () => void;
  newFolderPath: string;
  onFolderPathChange: (value: string) => void;
  folderError: string | null;
  isFolderLoadError: boolean;
  folderInfo: string | null;
  projectFolders: ProjectFolder[];
  busy: string | null;
  onBrowseFolder: () => void;
  onAddFolder: () => void;
  onRemoveFolder: (path: string) => void;
  onSyncFolders: () => void;
  visibleFolderCandidates: FolderProjectCandidate[];
  hiddenRegisteredFolderCandidatesCount: number;
  onCreateFromFolder: (path: string) => void;
  detectedProjectsCount: number;
  detectedCandidatesView: DetectedCandidatesView;
  isDemoMode: boolean;
  onAutoCreateDetected: () => void;
};

export function ProjectDiscoveryPanel({
  sectionOpen,
  onToggleFolders,
  onToggleCandidates,
  onToggleDetected,
  newFolderPath,
  onFolderPathChange,
  folderError,
  isFolderLoadError,
  folderInfo,
  projectFolders,
  busy,
  onBrowseFolder,
  onAddFolder,
  onRemoveFolder,
  onSyncFolders,
  visibleFolderCandidates,
  hiddenRegisteredFolderCandidatesCount,
  onCreateFromFolder,
  detectedProjectsCount,
  detectedCandidatesView,
  isDemoMode,
  onAutoCreateDetected,
}: ProjectDiscoveryPanelProps) {
  const { t } = useTranslation();

  return (
    <>
      <CollapsibleSection
        title={t('projects.sections.project_folders')}
        isOpen={sectionOpen.folders}
        onToggle={onToggleFolders}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newFolderPath}
              onChange={(event) => onFolderPathChange(event.target.value)}
              placeholder={t('projects.placeholders.project_folder_path')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onAddFolder();
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={onBrowseFolder}
              disabled={busy === 'add-folder'}
            >
              {t('projects_page.browse')}
            </Button>
            <Button
              size="sm"
              onClick={onAddFolder}
              disabled={busy === 'add-folder'}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {t('projects.actions.add')}
            </Button>
          </div>
          {folderError && (
            <p className="text-xs text-destructive">
              {isFolderLoadError
                ? t('projects.errors.load_project_folders_failed')
                : folderError}
            </p>
          )}
          {folderInfo && !folderError && (
            <p className="text-xs text-emerald-400">{folderInfo}</p>
          )}

          {projectFolders.length > 0 ? (
            <div className="space-y-1">
              {projectFolders.map((folder) => (
                <div
                  key={folder.path}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span
                    className="truncate text-muted-foreground"
                    title={formatPathForDisplay(folder.path)}
                  >
                    {formatPathForDisplay(folder.path)}
                  </span>
                  <AppTooltip content={t('layout.tooltips.remove_folder')}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => onRemoveFolder(folder.path)}
                      disabled={busy === `remove-folder:${folder.path}`}
                    >
                      <CircleOff className="h-3.5 w-3.5" />
                    </Button>
                  </AppTooltip>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('projects.empty.no_folders_configured')}
            </p>
          )}

          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={onSyncFolders}
              disabled={busy === 'sync-folders'}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t('projects_page.sync_subfolders_as_projects')}
            </Button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('projects_page.folder_project_candidates')}
        isOpen={sectionOpen.candidates}
        onToggle={onToggleCandidates}
      >
        {visibleFolderCandidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('projects.empty.no_subfolder_candidates')}
          </p>
        ) : (
          <div className="max-h-52 space-y-1 overflow-y-auto">
            {visibleFolderCandidates.map((candidate) => (
              <div
                key={candidate.folder_path}
                className="flex items-center justify-between gap-2 py-1 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{candidate.name}</p>
                  <p
                    className="truncate text-muted-foreground"
                    title={formatPathForDisplay(candidate.folder_path)}
                  >
                    {formatPathForDisplay(candidate.folder_path)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCreateFromFolder(candidate.folder_path)}
                  disabled={busy === `create-folder:${candidate.folder_path}`}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t('projects.actions.create')}
                </Button>
              </div>
            ))}
          </div>
        )}
        {hiddenRegisteredFolderCandidatesCount > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('projects_page.hidden_already_registered_folders')}{' '}
            {hiddenRegisteredFolderCandidatesCount}
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={t('projects_page.detected_projects_opened_2_times')}
        isOpen={sectionOpen.detected}
        onToggle={onToggleDetected}
      >
        <div className="space-y-3">
          {detectedCandidatesView.visible.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {detectedProjectsCount === 0
                ? t('projects_page.no_detected_projects')
                : t('projects_page.no_candidate_projects_detected_items_already_match_exist')}
            </p>
          ) : (
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {detectedCandidatesView.visible.map((candidate) => (
                <div
                  key={candidate.file_name}
                  className="flex items-center justify-between gap-2 py-1 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {candidate.inferredProjectName}
                    </p>
                    <p className="truncate text-muted-foreground">
                      {t('projects_page.detected_project_opens_duration', {
                        count: candidate.occurrence_count,
                        duration: formatDuration(candidate.total_seconds),
                      })}
                    </p>
                    {candidate.inferredProjectName !== candidate.file_name && (
                      <p
                        className="truncate text-muted-foreground/80"
                        title={candidate.file_name}
                      >
                        {t('projects_page.from')} {candidate.file_name}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline">{t('projects_page.candidate')}</Badge>
                </div>
              ))}
            </div>
          )}
          {(detectedCandidatesView.hiddenExisting > 0 ||
            detectedCandidatesView.hiddenExcluded > 0 ||
            detectedCandidatesView.hiddenDuplicates > 0 ||
            detectedCandidatesView.hiddenOverflow > 0) && (
            <p className="text-xs text-muted-foreground">
              {t('projects.labels.hidden_prefix')}{' '}
              {detectedCandidatesView.hiddenExisting > 0 &&
                t('projects.labels.hidden_existing', {
                  count: detectedCandidatesView.hiddenExisting,
                })}
              {detectedCandidatesView.hiddenExisting > 0 &&
                (detectedCandidatesView.hiddenExcluded > 0 ||
                  detectedCandidatesView.hiddenDuplicates > 0 ||
                  detectedCandidatesView.hiddenOverflow > 0) &&
                ' | '}
              {detectedCandidatesView.hiddenExcluded > 0 &&
                t('projects.labels.hidden_excluded', {
                  count: detectedCandidatesView.hiddenExcluded,
                })}
              {detectedCandidatesView.hiddenExcluded > 0 &&
                (detectedCandidatesView.hiddenDuplicates > 0 ||
                  detectedCandidatesView.hiddenOverflow > 0) &&
                ' | '}
              {detectedCandidatesView.hiddenDuplicates > 0 &&
                t('projects.labels.duplicate_names', {
                  count: detectedCandidatesView.hiddenDuplicates,
                })}
              {detectedCandidatesView.hiddenDuplicates > 0 &&
                detectedCandidatesView.hiddenOverflow > 0 &&
                ' | '}
              {detectedCandidatesView.hiddenOverflow > 0 &&
                t(
                  isDemoMode
                    ? 'projects.labels.extra_candidates_demo_cap'
                    : 'projects.labels.extra_candidates',
                  { count: detectedCandidatesView.hiddenOverflow },
                )}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={onAutoCreateDetected}
              disabled={
                busy === 'auto-detect' ||
                detectedCandidatesView.totalCandidateCount === 0
              }
            >
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              {t('projects_page.auto_create_detected_projects')}
            </Button>
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
}
