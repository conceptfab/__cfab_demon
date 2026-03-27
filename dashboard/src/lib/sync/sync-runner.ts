import { importDataArchive } from '@/lib/tauri';
import type {
  FlushPendingAckResult,
  LocalDatasetState,
  OnlineSyncPendingAck,
  OnlineSyncRunResult,
  OnlineSyncSettings,
  OnlineSyncState,
  RunOnlineSyncOptions,
  SyncPullResponse,
  SyncPushResponse,
  SyncDeltaPushResponse,
  SyncStatusResponse,
  DeltaArchive,
} from '@/lib/online-sync-types';
import {
  emitSyncingIndicatorSnapshot,
  refreshIndicatorFromStorage,
  updateIndicatorFromRunResult,
} from '@/lib/sync/sync-indicator';
import {
  getLocalDatasetState,
  getLocalDeltaState,
  isDemoModeSyncDisabled,
  logSyncDiagnostic,
  postAckWithRetries,
  postJson,
  SyncFileLogger,
  SyncHttpError,
} from '@/lib/sync/sync-http';
import {
  loadOnlineSyncSettings,
  loadOnlineSyncState,
  loadSecureApiToken,
  saveOnlineSyncStateRaw,
} from '@/lib/sync/sync-state';

function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 8)}...` : 'n/a';
}

function saveOnlineSyncState(
  next: OnlineSyncState,
  settings: OnlineSyncSettings,
): OnlineSyncState {
  const normalized = saveOnlineSyncStateRaw(next, settings);
  refreshIndicatorFromStorage();
  return normalized;
}

async function flushPendingAck(
  settings: OnlineSyncSettings,
  state: OnlineSyncState,
  apiToken: string = '',
  log?: SyncFileLogger | null,
): Promise<FlushPendingAckResult> {
  if (!state.pendingAck) {
    return {
      attempted: false,
      accepted: false,
      pendingRemains: false,
      reason: 'no_pending_ack',
    };
  }

  const pendingAck: OnlineSyncPendingAck = { ...state.pendingAck };
  log?.info('Sending ACK', {
    revision: pendingAck.revision,
    payloadSha256: pendingAck.payloadSha256.substring(0, 12),
    previousRetries: pendingAck.retries,
  });

  try {
    const t0 = Date.now();
    const ackRes = await postAckWithRetries(
      settings,
      {
        userId: settings.userId,
        deviceId: settings.deviceId,
        revision: pendingAck.revision,
        payloadSha256: pendingAck.payloadSha256,
      },
      apiToken,
      log,
    );
    const ackDurationMs = Date.now() - t0;

    log?.info('ACK response received', {
      accepted: ackRes.accepted,
      isLatest: ackRes.isLatest,
      reason: ackRes.reason,
      serverRevision: ackRes.serverRevision,
      durationMs: ackDurationMs,
    });
    logSyncDiagnostic('ack', {
      reason: ackRes.reason,
      accepted: ackRes.accepted,
      isLatest: ackRes.isLatest,
    });

    state.serverRevision = Math.max(0, Math.floor(ackRes.serverRevision || 0));
    state.serverHash = ackRes.serverHash ?? null;

    if (ackRes.accepted === true) {
      state.pendingAck = null;
      saveOnlineSyncState(state, settings);
      return {
        attempted: true,
        accepted: true,
        pendingRemains: false,
        reason: ackRes.reason,
        response: ackRes,
      };
    }

    if (
      ackRes.reason === 'unknown_revision' ||
      ackRes.reason === 'hash_mismatch_for_revision'
    ) {
      state.pendingAck = null;
      saveOnlineSyncState(state, settings);
      return {
        attempted: true,
        accepted: false,
        pendingRemains: false,
        reason: ackRes.reason,
        response: ackRes,
      };
    }

    throw new Error(`ack rejected: ${ackRes.reason}`);
  } catch (error) {
    pendingAck.retries += 1;
    pendingAck.lastError =
      error instanceof Error ? error.message : String(error);
    state.pendingAck = pendingAck;
    saveOnlineSyncState(state, settings);
    return {
      attempted: true,
      accepted: false,
      pendingRemains: true,
      reason: 'ack_deferred',
      error: pendingAck.lastError,
    };
  }
}

async function handleServerSnapshotPruned(
  settings: OnlineSyncSettings,
  state: OnlineSyncState,
  local: LocalDatasetState,
  statusRes: SyncStatusResponse,
  apiToken: string = '',
  log?: SyncFileLogger | null,
): Promise<OnlineSyncRunResult> {
  log?.info('Handling server_snapshot_pruned', {
    hasArchive: local.archive !== null,
    hasReseedData: local.hasReseedData,
    exportOk: local.exportOk,
    exportError: local.exportError ?? null,
  });

  if (local.archive && local.hasReseedData) {
    const reseedPayloadSize = JSON.stringify(local.archive).length;
    log?.info('Reseeding: pushing full archive to server', {
      payloadSizeKB: Math.round(reseedPayloadSize / 1024),
      knownServerRevision: statusRes.serverRevision ?? null,
    });
    const t0 = Date.now();
    const push = await postJson<SyncPushResponse>(
      settings.serverUrl,
      '/api/sync/push',
      {
        userId: settings.userId,
        deviceId: settings.deviceId,
        knownServerRevision: statusRes.serverRevision ?? null,
        archive: local.archive,
      },
      settings.requestTimeoutMs,
      apiToken,
    );

    if (push.accepted === false) {
      log?.error('Reseed push rejected', { reason: push.reason });
      throw new Error('reseed push rejected after server_snapshot_pruned');
    }

    log?.info('Reseed push accepted', {
      revision: push.revision,
      noOp: push.noOp ?? false,
      durationMs: Date.now() - t0,
    });

    state.localRevision = push.revision;
    state.localHash = push.payloadSha256;
    state.serverRevision = push.revision;
    state.serverHash = push.payloadSha256;
    state.needsReseed = false;
    state.lastSyncAt = new Date().toISOString();
    saveOnlineSyncState(state, settings);

    return {
      ok: true,
      action: push.noOp ? 'noop' : 'push',
      reason: 'server_snapshot_pruned_reseeded',
      serverRevision: push.revision,
      needsReseed: false,
    };
  }

  log?.error('Reseed impossible: no local data available', {
    exportOk: local.exportOk,
    hasArchive: local.archive !== null,
    hasReseedData: local.hasReseedData,
    exportError: local.exportError ?? null,
  });
  state.needsReseed = true;
  saveOnlineSyncState(state, settings);
  return {
    ok: false,
    action: 'none',
    reason: 'server_snapshot_pruned',
    serverRevision: statusRes.serverRevision ?? state.serverRevision,
    error:
      local.exportError ??
      'Server snapshot payload was pruned and no local data is available for reseed',
    needsReseed: true,
  };
}

let syncRunning = false;

export async function runOnlineSyncOnce(
  options: RunOnlineSyncOptions = {},
): Promise<OnlineSyncRunResult> {
  if (syncRunning) {
    console.info('[online-sync] Skipped: already running');
    return {
      ok: true,
      skipped: true,
      action: 'none',
      reason: 'already_running',
      serverRevision: null,
    };
  }
  syncRunning = true;
  try {
    return await runOnlineSyncOnceImpl(options);
  } finally {
    syncRunning = false;
  }
}

async function runOnlineSyncOnceImpl(
  options: RunOnlineSyncOptions = {},
): Promise<OnlineSyncRunResult> {
  const settings = loadOnlineSyncSettings();
  const log = settings.enableLogging ? new SyncFileLogger() : null;

  log?.info('Sync started', {
    ignoreStartupToggle: options.ignoreStartupToggle ?? false,
  });

  if (!settings.enabled) {
    log?.info('Sync skipped: disabled');
    const result: OnlineSyncRunResult = {
      ok: true,
      skipped: true,
      action: 'none',
      reason: 'disabled',
      serverRevision: null,
    };
    updateIndicatorFromRunResult(result);
    await log?.flush();
    return result;
  }

  if (!settings.serverUrl || !settings.userId) {
    log?.warn('Sync skipped: missing config', {
      hasServerUrl: Boolean(settings.serverUrl),
      hasUserId: Boolean(settings.userId),
    });
    const result: OnlineSyncRunResult = {
      ok: true,
      skipped: true,
      action: 'none',
      reason: 'missing_config',
      serverRevision: null,
    };
    updateIndicatorFromRunResult(result);
    await log?.flush();
    return result;
  }

  if (await isDemoModeSyncDisabled()) {
    log?.info('Sync skipped: demo mode');
    const state = loadOnlineSyncState(settings);
    const result: OnlineSyncRunResult = {
      ok: true,
      skipped: true,
      action: 'none',
      reason: 'demo_mode',
      serverRevision: state.serverRevision,
    };
    updateIndicatorFromRunResult(result);
    await log?.flush();
    return result;
  }

  const secureApiToken = await loadSecureApiToken();

  log?.info('Connecting to server', {
    serverUrl: settings.serverUrl,
    userId: settings.userId,
    deviceId: settings.deviceId,
    hasToken: Boolean(secureApiToken),
    requestTimeoutMs: settings.requestTimeoutMs,
  });

  emitSyncingIndicatorSnapshot(settings.serverUrl);

  let state = loadOnlineSyncState(settings);

  try {
    log?.info('Flushing pending ACK', {
      hasPendingAck: state.pendingAck !== null,
    });
    const pendingAckResult = await flushPendingAck(
      settings,
      state,
      secureApiToken,
      log,
    );
    log?.info('Pending ACK result', {
      attempted: pendingAckResult.attempted,
      accepted: pendingAckResult.accepted,
      pendingRemains: pendingAckResult.pendingRemains,
      reason: pendingAckResult.reason,
    });
    state = loadOnlineSyncState(settings);

    if (!options.ignoreStartupToggle && !settings.autoSyncOnStartup) {
      if (pendingAckResult.accepted) {
        state.lastSyncAt = new Date().toISOString();
        saveOnlineSyncState(state, settings);
      }

      log?.info('Sync skipped: startup sync disabled');
      const result: OnlineSyncRunResult = {
        ok: true,
        skipped: true,
        action: 'none',
        reason: 'startup_disabled',
        serverRevision: state.serverRevision,
      };
      updateIndicatorFromRunResult(result);
      await log?.flush();
      return result;
    }

    log?.info('Loaded sync state', {
      serverRevision: state.serverRevision,
      serverHash: shortHash(state.serverHash),
      localRevision: state.localRevision,
      localHash: shortHash(state.localHash),
      hasPendingAck: state.pendingAck !== null,
      needsReseed: state.needsReseed,
    });

    log?.info('Exporting local dataset as delta');
    const exportT0 = Date.now();
    const local = await getLocalDeltaState(state);
    log?.info('Local dataset delta state', {
      exportOk: local.exportOk,
      hasArchive: local.archive !== null,
      revision: local.revision,
      hash: local.payloadSha256?.substring(0, 12) ?? null,
      exportError: local.exportError ?? null,
      durationMs: Date.now() - exportT0,
    });
    if (local.exportOk) {
      state.localRevision = local.revision;
      state.localHash = local.payloadSha256;
      saveOnlineSyncState(state, settings);
    }

    const clientHashForStatus = local.payloadSha256 ?? state.localHash;
    log?.info('Checking server status', {
      clientRevision: state.localRevision,
      clientHash: clientHashForStatus?.substring(0, 12) ?? null,
    });
    const statusT0 = Date.now();
    const status = await postJson<SyncStatusResponse>(
      settings.serverUrl,
      '/api/sync/status',
      {
        userId: settings.userId,
        deviceId: settings.deviceId,
        clientRevision: state.localRevision,
        clientHash: clientHashForStatus,
        tableHashes: local.tableHashes ?? undefined,
      },
      settings.requestTimeoutMs,
      secureApiToken,
    );

    log?.info('Server status response', {
      reason: status.reason,
      shouldPull: status.shouldPull,
      shouldPush: status.shouldPush,
      serverRevision: status.serverRevision,
      serverHash: shortHash(status.serverHash),
      durationMs: Date.now() - statusT0,
    });

    logSyncDiagnostic('status', {
      reason: status.reason,
      shouldPull: status.shouldPull,
      shouldPush: status.shouldPush,
      serverRevision: status.serverRevision,
    });

    state.serverRevision = Math.max(0, Math.floor(status.serverRevision || 0));
    state.serverHash = status.serverHash ?? null;
    saveOnlineSyncState(state, settings);

    if (status.reason === 'server_snapshot_pruned') {
      log?.warn('Server snapshot pruned, handling reseed');
      const result = await handleServerSnapshotPruned(
        settings,
        state,
        local,
        status,
        secureApiToken,
        log,
      );
      log?.info('Sync finished (server_snapshot_pruned)', {
        ok: result.ok,
        reason: result.reason,
      });
      updateIndicatorFromRunResult(result);
      await log?.flush();
      return result;
    }

    if (status.shouldPull) {
      log?.info('Pulling from server', { clientRevision: state.localRevision });
      const pullT0 = Date.now();
      const pull = await postJson<SyncPullResponse>(
        settings.serverUrl,
        '/api/sync/delta-pull',
        {
          userId: settings.userId,
          deviceId: settings.deviceId,
          clientRevision: state.localRevision,
        },
        settings.requestTimeoutMs,
        secureApiToken,
      );

      log?.info('Pull response', {
        reason: pull.reason,
        hasUpdate: pull.hasUpdate,
        revision: pull.revision,
        durationMs: Date.now() - pullT0,
      });

      logSyncDiagnostic('pull', {
        reason: pull.reason,
        hasUpdate: pull.hasUpdate,
        revision: pull.revision,
      });

      if (pull.reason === 'server_snapshot_pruned') {
        log?.warn('Pull returned server_snapshot_pruned, handling reseed');
        const result = await handleServerSnapshotPruned(
          settings,
          state,
          local,
          status,
          secureApiToken,
          log,
        );
        log?.info('Sync finished (pull server_snapshot_pruned)', {
          ok: result.ok,
          reason: result.reason,
        });
        updateIndicatorFromRunResult(result);
        await log?.flush();
        return result;
      }

      if (pull.hasUpdate) {
        if (!pull.archive || pull.revision == null || !pull.payloadSha256) {
          log?.error('Pull response incomplete');
          throw new Error('pull response incomplete');
        }

        log?.info('Importing pulled archive', { revision: pull.revision });
        const importT0 = Date.now();
        const importSummary = await importDataArchive(pull.archive);
        log?.info('Import complete', {
          sessions_imported: importSummary.sessions_imported,
          sessions_merged: importSummary.sessions_merged,
          projects_created: importSummary.projects_created,
          durationMs: Date.now() - importT0,
        });

        state.localRevision = pull.revision;
        state.localHash = pull.payloadSha256;
        state.serverRevision = pull.revision;
        state.serverHash = pull.payloadSha256;
        state.needsReseed = false;
        state.pendingAck = {
          revision: pull.revision,
          payloadSha256: pull.payloadSha256,
          createdAt: new Date().toISOString(),
          retries: 0,
        };
        saveOnlineSyncState(state, settings);

        log?.info('Flushing post-pull ACK');
        const ackResult = await flushPendingAck(
          settings,
          state,
          secureApiToken,
          log,
        );
        log?.info('Post-pull ACK result', {
          accepted: ackResult.accepted,
          reason: ackResult.reason,
        });
        state = loadOnlineSyncState(settings);

        if (ackResult.accepted) {
          state.lastSyncAt = new Date().toISOString();
          saveOnlineSyncState(state, settings);

          const result: OnlineSyncRunResult = {
            ok: true,
            action: 'pull',
            reason: 'pull_applied_ack_accepted',
            serverRevision: state.serverRevision,
            importSummary,
            ackAccepted: true,
            ackPending: false,
            ackReason: ackResult.reason,
            ackIsLatest: ackResult.response?.isLatest ?? null,
          };
          log?.info('Sync finished: pull + ack accepted', {
            serverRevision: state.serverRevision,
          });
          updateIndicatorFromRunResult(result);
          await log?.flush();
          return result;
        }

        const ackPending =
          ackResult.pendingRemains ||
          loadOnlineSyncState(settings).pendingAck !== null;
        const result: OnlineSyncRunResult = {
          ok: true,
          action: 'pull',
          reason: ackPending
            ? 'pull_applied_ack_pending'
            : 'pull_applied_ack_not_accepted',
          serverRevision: state.serverRevision,
          importSummary,
          ackAccepted: false,
          ackPending,
          ackReason: ackResult.error ?? ackResult.reason,
          ackIsLatest: ackResult.response?.isLatest ?? null,
        };
        log?.info('Sync finished: pull applied, ack pending', {
          ackPending,
          reason: result.reason,
        });
        updateIndicatorFromRunResult(result);
        await log?.flush();
        return result;
      }

      state.serverRevision =
        pull.revision ?? status.serverRevision ?? state.serverRevision;
      state.serverHash =
        pull.payloadSha256 ?? status.serverHash ?? state.serverHash;
      if (
        pull.reason === 'client_up_to_date' &&
        pull.revision != null &&
        pull.payloadSha256
      ) {
        state.localRevision = pull.revision;
        state.localHash = pull.payloadSha256;
      }
      state.lastSyncAt = new Date().toISOString();
      saveOnlineSyncState(state, settings);

      const result: OnlineSyncRunResult = {
        ok: true,
        action: 'none',
        reason: pull.reason,
        serverRevision: pull.revision ?? status.serverRevision ?? null,
      };
      log?.info('Sync finished: no update needed (pull path)', {
        reason: pull.reason,
      });
      updateIndicatorFromRunResult(result);
      await log?.flush();
      return result;
    }

    if (status.shouldPush) {
      // When server has no snapshot, we must do a full push (not delta)
      const needsFullPush = status.reason === 'server_has_no_snapshot' || (status.serverRevision ?? 0) === 0;

      if (needsFullPush) {
        log?.info('Server has no snapshot, performing full push instead of delta');
        const fullLocal = await getLocalDatasetState(state);
        if (!fullLocal.archive || !fullLocal.hasReseedData) {
          log?.error('Full push impossible: no local data', {
            exportOk: fullLocal.exportOk,
            exportError: fullLocal.exportError ?? null,
          });
          throw new Error(fullLocal.exportError ?? 'No local data available for full push');
        }

        const fullPayloadSize = JSON.stringify(fullLocal.archive).length;
        log?.info('Pushing full archive to server', {
          knownServerRevision: status.serverRevision ?? null,
          payloadSizeKB: Math.round(fullPayloadSize / 1024),
        });

        const pushT0 = Date.now();
        const push = await postJson<SyncPushResponse>(
          settings.serverUrl,
          '/api/sync/push',
          {
            userId: settings.userId,
            deviceId: settings.deviceId,
            knownServerRevision: status.serverRevision ?? null,
            archive: fullLocal.archive,
          },
          settings.requestTimeoutMs,
          secureApiToken,
        );

        if (push.accepted === false) {
          log?.error('Full push rejected', { reason: push.reason, durationMs: Date.now() - pushT0 });
          throw new Error(`full push rejected: ${push.reason}`);
        }

        log?.info('Full push accepted', {
          revision: push.revision,
          noOp: push.noOp ?? false,
          durationMs: Date.now() - pushT0,
        });

        state.localRevision = push.revision;
        state.localHash = push.payloadSha256;
        state.serverRevision = push.revision;
        state.serverHash = push.payloadSha256;
        state.needsReseed = false;
        state.lastSyncAt = new Date().toISOString();
        saveOnlineSyncState(state, settings);

        const result: OnlineSyncRunResult = {
          ok: true,
          action: push.noOp ? 'noop' : 'push',
          reason: 'full_push_no_server_snapshot',
          serverRevision: push.revision,
        };
        log?.info('Sync finished: full push', { reason: result.reason });
        updateIndicatorFromRunResult(result);
        await log?.flush();
        return result;
      }

      if (!local.archive) {
        log?.error('Local export unavailable for push', {
          exportError: local.exportError ?? null,
        });
        throw new Error(
          local.exportError ?? 'Local export unavailable for push',
        );
      }

      const pushPayloadSize = JSON.stringify(local.archive).length;
      log?.info('Pushing delta to server', {
        knownServerRevision: status.serverRevision ?? null,
        payloadSizeKB: Math.round(pushPayloadSize / 1024),
        timeoutMs: settings.requestTimeoutMs,
      });

      const deltaArchive = local.archive as DeltaArchive;

      const pushT0 = Date.now();
      const push = await postJson<SyncDeltaPushResponse>(
        settings.serverUrl,
        '/api/sync/delta-push',
        {
          userId: settings.userId,
          deviceId: settings.deviceId,
          tableHashes: deltaArchive.table_hashes,
          baseRevision: state.localRevision ?? 0,
          delta: deltaArchive.data,
        },
        settings.requestTimeoutMs,
        secureApiToken,
      );

      if (push.accepted === false) {
        log?.error('Delta push rejected', {
          reason: push.reason,
          durationMs: Date.now() - pushT0,
        });
        throw new Error(`delta push rejected: ${push.reason}`);
      }

      log?.info('Delta push accepted', {
        revision: push.revision,
        durationMs: Date.now() - pushT0,
      });

      state.localRevision = push.revision;

      // Update local storage representation after push applied on server
      state.serverRevision = push.revision;
      state.needsReseed = false;
      state.lastSyncAt = new Date().toISOString();
      saveOnlineSyncState(state, settings);

      const result: OnlineSyncRunResult = {
        ok: true,
        action: 'push',
        reason: push.reason,
        serverRevision: push.revision,
      };
      log?.info('Sync finished: push', {
        action: result.action,
        reason: result.reason,
      });
      updateIndicatorFromRunResult(result);
      await log?.flush();
      return result;
    }

    if (
      status.reason === 'same_hash' ||
      status.reason === 'same_revision_hash_not_provided'
    ) {
      state.localRevision = status.serverRevision;
      state.localHash = status.serverHash;
    }
    state.lastSyncAt = new Date().toISOString();
    saveOnlineSyncState(state, settings);

    const result: OnlineSyncRunResult = {
      ok: true,
      action: 'none',
      reason: status.reason,
      serverRevision: status.serverRevision ?? null,
    };
    log?.info('Sync finished: already in sync', { reason: status.reason });
    updateIndicatorFromRunResult(result);
    await log?.flush();
    return result;
  } catch (error) {
    state = loadOnlineSyncState(settings);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorKind = error instanceof SyncHttpError ? error.kind : 'unknown';
    const errorStatus = error instanceof SyncHttpError ? error.status : null;
    log?.error('Sync failed', {
      error: errorMessage,
      kind: errorKind,
      httpStatus: errorStatus,
      needsReseed: state.needsReseed,
    });
    const result: OnlineSyncRunResult = {
      ok: false,
      action: 'none',
      reason: 'sync_failed',
      serverRevision: state.serverRevision,
      error: errorMessage,
      needsReseed: state.needsReseed,
    };
    updateIndicatorFromRunResult(result);
    await log?.flush();
    return result;
  }
}
