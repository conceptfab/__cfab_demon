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
  isRetryableNetworkError,
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

async function pushFullArchiveWithRetry(
  settings: OnlineSyncSettings,
  archive: NonNullable<LocalDatasetState['archive']>,
  knownServerRevision: number | null,
  apiToken: string,
  log?: SyncFileLogger | null,
): Promise<SyncPushResponse> {
  const payloadSize = JSON.stringify(archive).length;
  const timeoutMs = Math.max(
    settings.requestTimeoutMs,
    Math.min(60_000, Math.ceil(payloadSize / 1024) * 15),
  );
  const maxAttempts = 3;
  let result: SyncPushResponse | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      result = await postJson<SyncPushResponse>(
        settings.serverUrl,
        '/api/sync/push',
        {
          userId: settings.userId,
          deviceId: settings.deviceId,
          knownServerRevision,
          archive,
        },
        timeoutMs,
        apiToken,
      );
      break;
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableNetworkError(error)) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const delayMs = 1000 * attempt;
      log?.warn('Full push transient failure, retrying', {
        attempt,
        maxAttempts,
        error: msg,
        delayMs,
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!result) {
    throw new Error('Full push retry loop failed unexpectedly');
  }
  return result;
}

let syncRunning = false;

// ── Idle backoff: increase delay after consecutive idle responses ──
const IDLE_BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 300_000]; // 30s, 1m, 2m, 5m
let consecutiveIdles = 0;
let nextSyncAfter = 0; // Date.now() timestamp — skip sync before this

// ── Debounce: minimum 5s between sync triggers ──
const MIN_SYNC_INTERVAL_MS = 5_000;
let lastSyncTriggerAt = 0;

export async function runOnlineSyncOnce(
  options: RunOnlineSyncOptions = {},
): Promise<OnlineSyncRunResult> {
  const now = Date.now();

  // Debounce: skip if called too soon after last trigger
  if (now - lastSyncTriggerAt < MIN_SYNC_INTERVAL_MS) {
    return { ok: true, skipped: true, action: 'none', reason: 'debounce', serverRevision: null };
  }

  // Idle backoff: skip if we're in a backoff window
  if (now < nextSyncAfter) {
    return { ok: true, skipped: true, action: 'none', reason: 'idle_backoff', serverRevision: null };
  }

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
  lastSyncTriggerAt = now;
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
    if (pendingAckResult.attempted) {
      state = loadOnlineSyncState(settings);
    }

    // autoSyncOnStartup only gates the very first sync after app launch.
    // Interval, poll, SSE, and manual syncs should always proceed.
    if (options.isStartupSync && !settings.autoSyncOnStartup) {
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

    // Force full push — skip status/delta, push entire archive
    if (options.forceFullPush) {
      log?.info('Force full push requested');
      const fullLocal = await getLocalDatasetState(state);
      if (!fullLocal.archive || !fullLocal.hasReseedData) {
        log?.error('Force push impossible: no local data', {
          exportOk: fullLocal.exportOk,
          exportError: fullLocal.exportError ?? null,
        });
        throw new Error(fullLocal.exportError ?? 'No local data for force push');
      }

      const pushT0 = Date.now();
      const push = await pushFullArchiveWithRetry(
        settings,
        fullLocal.archive,
        state.serverRevision ?? null,
        secureApiToken,
        log,
      );

      if (push.accepted === false) {
        log?.error('Force push rejected', { reason: push.reason });
        throw new Error(`Force push rejected: ${push.reason}`);
      }

      log?.info('Force push accepted', {
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
        reason: 'force_full_push',
        serverRevision: push.revision,
      };
      log?.info('Sync finished: force full push', { reason: result.reason });
      updateIndicatorFromRunResult(result);
      await log?.flush();
      return result;
    }

    // ── Heartbeat: report presence, receive command from server ──
    log?.info('Heartbeat', { revision: state.localRevision });
    const statusT0 = Date.now();
    const status = await postJson<SyncStatusResponse>(
      settings.serverUrl,
      '/api/sync/status',
      {
        userId: settings.userId,
        deviceId: settings.deviceId,
        clientRevision: state.localRevision,
        clientHash: state.localHash,
      },
      settings.requestTimeoutMs,
      secureApiToken,
    );

    const cmd = status.command ?? (status.shouldPull ? 'pull' : status.shouldPush ? 'send_delta' : 'idle');
    log?.info('Server command', {
      command: cmd,
      reason: status.reason,
      onlineDevices: status.onlineDevices,
      serverRevision: status.serverRevision,
      durationMs: Date.now() - statusT0,
    });

    logSyncDiagnostic('status', {
      command: cmd,
      reason: status.reason,
      onlineDevices: status.onlineDevices,
      serverRevision: status.serverRevision,
    });

    state.serverRevision = Math.max(0, Math.floor(status.serverRevision || 0));
    state.serverHash = status.serverHash ?? null;
    saveOnlineSyncState(state, settings);

    // ── IDLE: nothing to do, align hash and wait ──
    if (cmd === 'idle') {
      if (status.serverHash) {
        state.localHash = status.serverHash;
        state.localRevision = status.serverRevision;
      }
      state.lastSyncAt = new Date().toISOString();
      saveOnlineSyncState(state, settings);

      // Idle backoff: increase delay after consecutive idles
      consecutiveIdles++;
      const backoffMs = IDLE_BACKOFF_STEPS_MS[Math.min(consecutiveIdles - 1, IDLE_BACKOFF_STEPS_MS.length - 1)];
      nextSyncAfter = Date.now() + backoffMs;

      const result: OnlineSyncRunResult = {
        ok: true,
        action: 'none',
        reason: status.reason,
        serverRevision: status.serverRevision ?? null,
      };
      log?.info('Idle', { reason: status.reason, onlineDevices: status.onlineDevices, backoffMs, consecutiveIdles });
      updateIndicatorFromRunResult(result);
      await log?.flush();
      return result;
    }

    // Non-idle command: reset backoff
    consecutiveIdles = 0;
    nextSyncAfter = 0;

    // Step 2: Export local delta (only when server says sync is needed)
    log?.info('Exporting local dataset as delta');
    const exportT0 = Date.now();
    const local = await getLocalDeltaState(state);
    log?.info('Local dataset delta state', {
      exportOk: local.exportOk,
      hasArchive: local.archive !== null,
      hasDeltaData: local.hasReseedData,
      revision: local.revision,
      hash: local.payloadSha256?.substring(0, 12) ?? null,
      exportError: local.exportError ?? null,
      durationMs: Date.now() - exportT0,
    });
    if (local.exportOk) {
      state.localRevision = local.revision;
      if (local.hasReseedData) {
        state.localHash = local.payloadSha256;
      }
      saveOnlineSyncState(state, settings);
    }

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

    if (cmd === 'pull') {
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

    if (cmd === 'send_delta' || cmd === 'send_full') {
      // Server commands what to send
      const needsFullPush = cmd === 'send_full' || status.reason === 'server_has_no_snapshot' || (status.serverRevision ?? 0) === 0;

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

        log?.info('Pushing full archive to server', {
          knownServerRevision: status.serverRevision ?? null,
          payloadSizeKB: Math.round(JSON.stringify(fullLocal.archive).length / 1024),
        });

        const pushT0 = Date.now();
        const push = await pushFullArchiveWithRetry(
          settings,
          fullLocal.archive,
          status.serverRevision ?? null,
          secureApiToken,
          log,
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

      // Skip delta-push when there are no actual changes to send
      if (!local.hasReseedData) {
        log?.info('Delta is empty — skipping push, treating as noop');
        state.lastSyncAt = new Date().toISOString();
        saveOnlineSyncState(state, settings);

        const result: OnlineSyncRunResult = {
          ok: true,
          action: 'none',
          reason: 'empty_delta_skip',
          serverRevision: status.serverRevision ?? null,
        };
        log?.info('Sync finished: empty delta skip', { reason: result.reason });
        updateIndicatorFromRunResult(result);
        await log?.flush();
        return result;
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
          baseRevision: state.serverRevision ?? 0,
          delta: deltaArchive.data,
        },
        settings.requestTimeoutMs,
        secureApiToken,
      );

      if (push.accepted === false) {
        const pushDuration = Date.now() - pushT0;
        log?.warn('Delta push rejected, falling back to full push', {
          reason: push.reason,
          durationMs: pushDuration,
        });

        // Fallback: full push when delta is rejected (revision mismatch, no base snapshot, etc.)
        const fullLocal = await getLocalDatasetState(state);
        if (!fullLocal.archive || !fullLocal.hasReseedData) {
          log?.error('Full push fallback impossible: no local data', {
            exportOk: fullLocal.exportOk,
            exportError: fullLocal.exportError ?? null,
          });
          throw new Error(fullLocal.exportError ?? 'No local data for full push fallback');
        }

        log?.info('Pushing full archive to server (fallback)', {
          knownServerRevision: push.revision,
          payloadSizeKB: Math.round(JSON.stringify(fullLocal.archive).length / 1024),
        });

        const fullPushT0 = Date.now();
        const fullPush = await pushFullArchiveWithRetry(
          settings,
          fullLocal.archive,
          push.revision,
          secureApiToken,
          log,
        );

        if (fullPush.accepted === false) {
          log?.error('Full push fallback rejected', {
            reason: fullPush.reason,
            durationMs: Date.now() - fullPushT0,
          });
          throw new Error(`full push fallback rejected: ${fullPush.reason}`);
        }

        log?.info('Full push fallback accepted', {
          revision: fullPush.revision,
          durationMs: Date.now() - fullPushT0,
        });

        state.localRevision = fullPush.revision;
        state.localHash = fullPush.payloadSha256;
        state.serverRevision = fullPush.revision;
        state.serverHash = fullPush.payloadSha256;
        state.needsReseed = false;
        state.lastSyncAt = new Date().toISOString();
        saveOnlineSyncState(state, settings);

        const result: OnlineSyncRunResult = {
          ok: true,
          action: 'push',
          reason: `delta_rejected_full_push_fallback (${push.reason})`,
          serverRevision: fullPush.revision,
        };
        log?.info('Sync finished: full push fallback', { reason: result.reason });
        updateIndicatorFromRunResult(result);
        await log?.flush();
        return result;
      }

      log?.info('Delta push accepted', {
        revision: push.revision,
        snapshotHash: push.snapshotHash?.substring(0, 12) ?? null,
        durationMs: Date.now() - pushT0,
      });

      state.localRevision = push.revision;
      // Sync snapshot hash from server so next status check won't get hash_mismatch
      if (push.snapshotHash) {
        state.localHash = push.snapshotHash;
        state.serverHash = push.snapshotHash;
      }

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
      status.reason === 'same_revision_hash_not_provided' ||
      status.reason === 'same_revision_hash_drift' ||
      status.reason === 'single_device'
    ) {
      state.localRevision = status.serverRevision;
      state.localHash = status.serverHash;
      state.serverHash = status.serverHash;
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
