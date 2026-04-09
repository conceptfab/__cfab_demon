import { useEffect, useRef } from 'react';
import { useDataStore } from '@/store/data-store';
import { logger } from '@/lib/logger';
import { dataApi, projectsApi, sessionsApi } from '@/lib/tauri';
import { loadSessionSettings } from '@/lib/user-settings';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import {
  AUTO_PROJECT_FOLDER_SYNC_TTL_MS,
  AUTO_PROJECT_DETECTION_TTL_MS,
  isExpired,
  loadAutoProjectSyncMeta,
  saveAutoProjectSyncMeta,
  runHeavyOperation,
  runAutoAiAssignmentCycle,
  dispatchAiAssignmentDone,
} from '@/lib/background-helpers';

export function useAutoImporter() {
  const { autoImportDone, setAutoImportDone, triggerRefresh } = useDataStore();

  useEffect(() => {
    if (autoImportDone) return;
    const warnTimer = setTimeout(() => {
      logger.warn('Auto-import is still running (longer than 8s)...');
    }, 8_000);

    dataApi.autoImportFromDataDir()
      .then((result) => {
        setAutoImportDone(true, result);
        if (result.files_imported > 0) {
          triggerRefresh('background_auto_import');
        }
      })
      .catch((e) => {
        logger.error('Auto-import failed:', e);
        setAutoImportDone(true, {
          files_found: 0,
          files_imported: 0,
          files_skipped: 0,
          files_archived: 0,
          errors: [String(e)],
        });
      })
      .finally(() => clearTimeout(warnTimer));

    return () => clearTimeout(warnTimer);
  }, [autoImportDone, setAutoImportDone, triggerRefresh]);
}

async function runAutoProjectSyncStartup(
  autoImportResult: ReturnType<typeof useDataStore.getState>['autoImportResult'],
  setDiscoveredProjects: ReturnType<typeof useDataStore.getState>['setDiscoveredProjects'],
): Promise<void> {
  const importedFiles = autoImportResult?.files_imported ?? 0;
  const now = Date.now();
  const meta = loadAutoProjectSyncMeta();
  const shouldRunFolderSync =
    importedFiles > 0 ||
    isExpired(meta.lastFolderSyncAt, AUTO_PROJECT_FOLDER_SYNC_TTL_MS, now);
  const shouldRunDetection =
    importedFiles > 0 ||
    isExpired(meta.lastDetectionAt, AUTO_PROJECT_DETECTION_TTL_MS, now);

  if (!shouldRunFolderSync && !shouldRunDetection) {
    return;
  }

  if (shouldRunFolderSync) {
    const syncResult = await projectsApi.syncProjectsFromFolders();
    saveAutoProjectSyncMeta({ lastFolderSyncAt: now });
    if (syncResult.created_projects.length > 0) {
      setDiscoveredProjects(syncResult.created_projects);
    }
  }

  if (shouldRunDetection) {
    await projectsApi.autoCreateProjectsFromDetection(ALL_TIME_DATE_RANGE, 2);
    saveAutoProjectSyncMeta({ lastDetectionAt: now });
  }
}

export function useAutoSessionRebuild() {
  useEffect(() => {
    const run = async () => {
      try {
        const settings = loadSessionSettings();
        if (settings.rebuildOnStartup && settings.gapFillMinutes > 0) {
          await runHeavyOperation('rebuild', () =>
            sessionsApi.rebuildSessions(settings.gapFillMinutes),
          );
        }
      } catch (e) {
        logger.warn('Auto session rebuild failed:', e);
      }
    };
    void run();
  }, []);
}

export function useStartupProjectSyncAndAiAssignment() {
  const { autoImportDone, autoImportResult, setDiscoveredProjects } =
    useDataStore();
  const hasProcessedStartupRef = useRef(false);

  useEffect(() => {
    if (!autoImportDone || hasProcessedStartupRef.current) return;
    hasProcessedStartupRef.current = true;

    let cancelled = false;
    const run = async () => {
      try {
        await runAutoProjectSyncStartup(
          autoImportResult,
          setDiscoveredProjects,
        );
      } catch (error) {
        logger.warn('Auto project sync failed:', error);
      }

      if (cancelled) return;

      try {
        const aiResult = await runAutoAiAssignmentCycle();
        dispatchAiAssignmentDone(aiResult);
      } catch (error) {
        logger.warn('AI auto-assignment failed:', error);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [autoImportDone, autoImportResult, setDiscoveredProjects]);
}
