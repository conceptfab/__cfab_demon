import { useRef } from 'react';
import { CircleOff, FolderOpen, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CollapsibleSection } from '@/components/project/CollapsibleSection';
import { ProjectColorPicker } from '@/components/project/ProjectColorPicker';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  DetectedProject,
  FolderProjectCandidate,
  ProjectFolder,
} from '@/lib/db-types';
import { formatDuration, formatPathForDisplay } from '@/lib/utils';

const FOLDER_BADGES = ['', '⭐', '🔥', '💼', '🏠', '🎨', '🔧', '📦', '🚀', '💰', '🏆'] as const;

function FolderRow({
  folder,
  busy,
  onRemove,
  onColorSave,
  onBadgeChange,
  onCategoryChange,
}: {
  folder: ProjectFolder;
  busy: string | null;
  onRemove: () => void;
  onColorSave: (color: string) => Promise<void>;
  onBadgeChange: (badge: string) => void;
  onCategoryChange: (category: string) => void;
}) {
  const { t } = useTranslation();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  return (
    <div className="rounded-md border border-border/40 bg-secondary/10 p-2 text-xs">
      <div className="flex items-center gap-2">
        <ProjectColorPicker
          currentColor={folder.color || '#64748b'}
          labels={{
            changeColor: t('projects.labels.change_color'),
            chooseColor: t('projects.labels.choose_color'),
            saveColor: t('projects.labels.save'),
          }}
          onSave={onColorSave}
          dotClassName="size-5"
        />

        <span
          className="flex-1 truncate text-muted-foreground"
          title={formatPathForDisplay(folder.path)}
        >
          {formatPathForDisplay(folder.path)}
        </span>

        <select
          className="h-6 w-10 cursor-pointer rounded border border-border/40 bg-transparent text-center text-sm"
          value={folder.badge}
          onChange={(e) => onBadgeChange(e.target.value)}
          title="Badge"
        >
          {FOLDER_BADGES.map((b) => (
            <option key={b} value={b}>
              {b || '—'}
            </option>
          ))}
        </select>

        <AppTooltip content={t('layout.tooltips.remove_folder')}>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive"
            onClick={onRemove}
            disabled={busy === `remove-folder:${folder.path}`}
          >
            <CircleOff className="size-3.5" />
          </Button>
        </AppTooltip>
      </div>

      <div className="mt-1.5 flex items-center gap-2 pl-6">
        <span className="text-[10px] font-medium uppercase text-muted-foreground/70">
          {t('projects.labels.folder_category')}:
        </span>
        <input
          type="text"
          className="h-5 flex-1 rounded border border-border/30 bg-transparent px-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none"
          defaultValue={folder.category}
          placeholder={t('projects.placeholders.folder_category')}
          onChange={(e) => {
            clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => onCategoryChange(e.target.value), 500);
          }}
        />
      </div>
    </div>
  );
}

type DetectedCandidatesView = {
  visible: DetectedProject[];
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
  onUpdateFolderMeta: (path: string, color: string, category: string, badge: string) => void;
  onSyncFolders: () => void;
  visibleFolderCandidates: FolderProjectCandidate[];
  hiddenRegisteredFolderCandidatesCount: number;
  onCreateFromFolder: (path: string) => void;
  detectedProjectsCount: number;
  detectedCandidatesView: DetectedCandidatesView;
  isDemoMode: boolean;
  onAutoCreateDetected: () => void;
  onClearCandidates: () => void;
  isClearingCandidates: boolean;
  onBlacklistDetected: (name: string) => void;
  onClearAllDetected: () => void;
  isClearingAllDetected: boolean;
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
  onUpdateFolderMeta,
  onSyncFolders,
  visibleFolderCandidates,
  hiddenRegisteredFolderCandidatesCount,
  onCreateFromFolder,
  detectedProjectsCount,
  detectedCandidatesView,
  isDemoMode,
  onAutoCreateDetected,
  onClearCandidates,
  isClearingCandidates,
  onBlacklistDetected,
  onClearAllDetected,
  isClearingAllDetected,
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
              <Plus className="mr-1.5 size-4" />
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

          <div className="flex justify-start">
            <Button
              size="sm"
              onClick={onSyncFolders}
              disabled={busy === 'sync-folders' || projectFolders.length === 0}
            >
              <RefreshCw className="mr-1.5 size-4" />
              {t('projects_page.sync_subfolders_as_projects')}
            </Button>
          </div>

          {projectFolders.length > 0 ? (
            <div className="space-y-2">
              {projectFolders.map((folder) => (
                <FolderRow
                  key={folder.path}
                  folder={folder}
                  busy={busy}
                  onRemove={() => onRemoveFolder(folder.path)}
                  onColorSave={async (color) => {
                    onUpdateFolderMeta(folder.path, color, folder.category, folder.badge);
                  }}
                  onBadgeChange={(badge) => {
                    onUpdateFolderMeta(folder.path, folder.color, folder.category, badge);
                  }}
                  onCategoryChange={(category) => {
                    onUpdateFolderMeta(folder.path, folder.color, category, folder.badge);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-muted-foreground/30 py-6">
              <FolderOpen className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {t('projects.empty.no_folders_configured')}
              </p>
              <p className="text-xs text-muted-foreground/70">
                {t('projects.empty.no_folders_configured_hint')}
              </p>
            </div>
          )}
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
                  <Plus className="mr-1 size-3" />
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
        {visibleFolderCandidates.length > 0 && (
          <div className="flex justify-end pt-1">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={onClearCandidates}
              disabled={isClearingCandidates}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              {t('projects.actions.exclude_all_candidates', { count: visibleFolderCandidates.length })}
            </Button>
          </div>
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
                  key={candidate.project_name}
                  className="flex items-center justify-between gap-2 py-1 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {candidate.project_name}
                    </p>
                    <p className="truncate text-muted-foreground">
                      {t('projects_page.detected_project_opens_duration', {
                        count: candidate.occurrence_count,
                        duration: formatDuration(candidate.total_seconds),
                      })}
                    </p>
                    {candidate.project_name !== candidate.file_name && (
                      <p
                        className="truncate text-muted-foreground/80"
                        title={candidate.file_name}
                      >
                        {t('projects_page.from')} {candidate.file_name}
                      </p>
                    )}
                  </div>
                  <AppTooltip content={t('projects.actions.blacklist_detected_tooltip')}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-destructive"
                      onClick={() => onBlacklistDetected(candidate.project_name)}
                    >
                      <CircleOff className="size-3.5" />
                    </Button>
                  </AppTooltip>
                </div>
              ))}
            </div>
          )}
          {detectedCandidatesView.hiddenOverflow > 0 && (
            <p className="text-xs text-muted-foreground">
              {t(
                isDemoMode
                  ? 'projects.labels.extra_candidates_demo_cap'
                  : 'projects.labels.extra_candidates',
                { count: detectedCandidatesView.hiddenOverflow },
              )}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {detectedCandidatesView.totalCandidateCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={onClearAllDetected}
                disabled={isClearingAllDetected}
              >
                <Trash2 className="mr-1.5 size-3.5" />
                {t('projects.actions.blacklist_all_detected', { count: detectedCandidatesView.totalCandidateCount })}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onAutoCreateDetected}
              disabled={
                busy === 'auto-detect' ||
                detectedCandidatesView.totalCandidateCount === 0
              }
            >
              <Wand2 className="mr-1.5 size-3.5" />
              {t('projects_page.auto_create_detected_projects')}
            </Button>
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
}
