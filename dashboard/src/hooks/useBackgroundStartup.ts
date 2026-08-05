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
  dispatchSessionRebuildResult,
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
// Baza bywa zajęta zaraz po starcie (import, backfill, przypisania AI działające
// równolegle). Zamiast cicho odpuścić — ponawiamy z rosnącym odstępem.
const REBUILD_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

function isDatabaseBusy(error: unknown): boolean {
  return /database is locked|database table is locked|busy/i.test(String(error));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAutoSessionRebuild(): Promise<void> {
  const settings = loadSessionSettings();
  if (!settings.rebuildOnStartup || settings.gapFillMinutes <= 0) return;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= REBUILD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const merged = await runHeavyOperation('rebuild', () =>
        sessionsApi.rebuildSessions(settings.gapFillMinutes),
      );
      // null = ta sama operacja już trwa gdzie indziej; jej wynik zgłosi ona sama.
      if (merged === null) return;
      if (merged > 0) {
        dispatchSessionRebuildResult({ status: 'merged', merged });
      }
      return;
    } catch (e) {
      lastError = e;
      const canRetry =
        isDatabaseBusy(e) && attempt < REBUILD_RETRY_DELAYS_MS.length;
      if (!canRetry) break;
      logger.warn(
        `Auto session rebuild: database busy, retry ${attempt + 1}/${REBUILD_RETRY_DELAYS_MS.length}`,
      );
      await delay(REBUILD_RETRY_DELAYS_MS[attempt]!);
    }
  }

  logger.warn('Auto session rebuild failed:', lastError);
  dispatchSessionRebuildResult({ status: 'failed', error: String(lastError) });
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
