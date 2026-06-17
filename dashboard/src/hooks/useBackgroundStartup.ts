import { useEffect, useRef } from 'react';
import { useDataStore } from '@/store/data-store';
import { logger } from '@/lib/logger';
import { daemonApi, dataApi, projectsApi, sessionsApi } from '@/lib/tauri';
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
  const autoImportDone = useDataStore((s) => s.autoImportDone);
  const setAutoImportDone = useDataStore((s) => s.setAutoImportDone);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);

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
        // Recover days the daemon recorded while the dashboard was closed
        // (these never went through refresh_today). Best-effort: a failure
        // here must not block startup.
        daemonApi.refreshMissingDays()
          .then((backfill) => {
            if (backfill.days_backfilled > 0) {
              logger.info(
                `Recovered ${backfill.days_backfilled} day(s) from daily_store ` +
                  `(${backfill.sessions_upserted} sessions)`,
              );
              // Reuse the auto-import reason: backfill produces the same kind
              // of newly-imported historical data, and every page that reacts
              // to auto-import should also react here.
              triggerRefresh('background_auto_import');
            }
          })
          .catch((e) => logger.warn('Missing-days backfill failed:', e));
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

// Runs gap-based session merge after AI assignment. Ordering matters:
// rebuild merges only sessions sharing the same project_id, so projects must
// be assigned first — otherwise adjacent sessions belonging to different
// projects could be glued into one block.
async function runAutoSessionRebuild(): Promise<void> {
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
}

export function useStartupProjectSyncAndAiAssignment() {
  const autoImportDone = useDataStore((s) => s.autoImportDone);
  const autoImportResult = useDataStore((s) => s.autoImportResult);
  const setDiscoveredProjects = useDataStore((s) => s.setDiscoveredProjects);
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

      if (cancelled) return;

      // Merge close sessions last, once projects are assigned (see
      // runAutoSessionRebuild for why ordering matters).
      await runAutoSessionRebuild();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [autoImportDone, autoImportResult, setDiscoveredProjects]);
}
