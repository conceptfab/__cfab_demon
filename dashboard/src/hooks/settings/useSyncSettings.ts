import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { setSecureToken, triggerDaemonOnlineSync } from '@/lib/tauri';
import {
  activateLicense,
  clearLicenseInfo,
  loadLicenseInfo,
  loadOnlineSyncState,
  loadOnlineSyncSettings,
  loadSecureApiToken,
  saveLicenseInfo,
  saveOnlineSyncSettings,
  type LicenseInfo,
  type OnlineSyncRunResult,
  type OnlineSyncSettings,
  type OnlineSyncState,
} from '@/lib/online-sync';
import { getErrorMessage, logTauriWarn } from '@/lib/utils';
import {
  type StateUpdater,
  resolveStateUpdate,
} from './useSettingsFormTypes';

interface UseSyncSettingsOptions {
  setSavedSettings: (saved: boolean) => void;
  showInfo: (message: string) => void;
  t: TFunction;
  triggerRefresh: (reason: string) => void;
}

export function useSyncSettings({
  setSavedSettings,
  showInfo,
  t,
  triggerRefresh,
}: UseSyncSettingsOptions) {
  const [onlineSyncSettings, setOnlineSyncSettings] =
    useState<OnlineSyncSettings>(() => loadOnlineSyncSettings());
  const [manualSyncing, setManualSyncing] = useState(false);
  const [manualSyncResult, setManualSyncResult] =
    useState<OnlineSyncRunResult | null>(null);
  const [onlineSyncState, setOnlineSyncState] = useState<OnlineSyncState>(() =>
    loadOnlineSyncState(),
  );
  const [showOnlineSyncToken, setShowOnlineSyncToken] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(() =>
    loadLicenseInfo(),
  );
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [licenseActivating, setLicenseActivating] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [testingRoundtrip, setTestingRoundtrip] = useState(false);
  const [testRoundtripResult, setTestRoundtripResult] = useState<string | null>(
    null,
  );
  const [testRoundtripSuccess, setTestRoundtripSuccess] = useState(false);

  useEffect(() => {
    loadSecureApiToken().then((token) => {
      if (token) {
        setOnlineSyncSettings((prev) => ({ ...prev, apiToken: token }));
      }
    });
  }, []);

  const lastSyncLabel = onlineSyncState.lastSyncAt
    ? new Date(onlineSyncState.lastSyncAt).toLocaleString()
    : t('settings_page.never');
  const shortHash = onlineSyncState.serverHash
    ? `${onlineSyncState.serverHash.slice(0, 12)}...`
    : 'n/a';
  const localHashShort = onlineSyncState.localHash
    ? `${onlineSyncState.localHash.slice(0, 12)}...`
    : 'n/a';
  const pendingAckHashShort = onlineSyncState.pendingAck?.payloadSha256
    ? `${onlineSyncState.pendingAck.payloadSha256.slice(0, 12)}...`
    : 'n/a';
  const manualSyncResultText = manualSyncResult
    ? manualSyncResult.ok
      ? manualSyncResult.skipped && manualSyncResult.reason === 'demo_mode'
        ? t('settings_page.last_manual_sync_skipped_disabled_in_demo_mode')
        : manualSyncResult.ackPending
          ? t('settings_page.last_manual_sync_pull_applied_ack_pending', {
              detail: manualSyncResult.ackReason ?? manualSyncResult.reason,
            })
          : t('settings_page.last_manual_sync', {
              action: manualSyncResult.action,
              reason: manualSyncResult.reason,
            })
      : t('settings_page.last_manual_sync_failed', {
          error: manualSyncResult.error ?? manualSyncResult.reason,
        })
    : null;
  const manualSyncResultSuccess = manualSyncResult?.ok ?? false;

  const updateOnlineSyncSettings = useCallback(
    (next: StateUpdater<OnlineSyncSettings>) => {
      setOnlineSyncSettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [setSavedSettings],
  );

  const persistDaemonOnlineSyncSettings = useCallback(
    async (savedOnlineSync: OnlineSyncSettings, authToken: string) => {
      const { saveDaemonOnlineSyncSettings } = await import(
        '@/lib/tauri/online-sync'
      );
      await saveDaemonOnlineSyncSettings({
        enabled: savedOnlineSync.enabled,
        server_url: savedOnlineSync.serverUrl,
        auth_token: authToken,
        device_id: savedOnlineSync.deviceId,
        encryption_key: savedOnlineSync.encryptionKey ?? '',
        sync_interval_minutes: savedOnlineSync.autoSyncIntervalMinutes,
        auto_sync_on_startup: savedOnlineSync.autoSyncOnStartup,
      });
    },
    [],
  );

  const handleSyncNow = useCallback(
    async (demoModeEnabled: boolean) => {
      if (demoModeEnabled) {
        setManualSyncResult({
          ok: true,
          skipped: true,
          action: 'none',
          reason: 'demo_mode',
          serverRevision: onlineSyncState.serverRevision,
        });
        return;
      }

      setManualSyncing(true);
      setManualSyncResult(null);
      try {
        const uiToken = onlineSyncSettings.apiToken;
        const savedOnlineSync = saveOnlineSyncSettings(onlineSyncSettings);
        setOnlineSyncSettings({ ...savedOnlineSync, apiToken: uiToken });

        try {
          await persistDaemonOnlineSyncSettings(savedOnlineSync, uiToken);
        } catch {
          // Daemon not available; UI sync state can still be updated locally.
        }

        await triggerDaemonOnlineSync();
        await new Promise((r) => setTimeout(r, 2_000));
        setOnlineSyncState(loadOnlineSyncState());
        setManualSyncResult({
          ok: true,
          action: 'push',
          reason: 'daemon_sync_triggered',
          serverRevision: null,
        });
        triggerRefresh('settings_manual_sync');
      } catch (e) {
        setManualSyncResult({
          ok: false,
          action: 'none',
          reason: 'daemon_unreachable',
          serverRevision: onlineSyncState.serverRevision,
          error: getErrorMessage(e, t('ui.common.unknown_error')),
        });
      } finally {
        setManualSyncing(false);
      }
    },
    [
      onlineSyncSettings,
      onlineSyncState.serverRevision,
      persistDaemonOnlineSyncSettings,
      t,
      triggerRefresh,
    ],
  );

  const handleForceSyncNow = useCallback(
    async (demoModeEnabled: boolean) => {
      if (demoModeEnabled) return;

      setManualSyncing(true);
      setManualSyncResult(null);
      try {
        const uiToken = onlineSyncSettings.apiToken;
        const savedOnlineSync = saveOnlineSyncSettings(onlineSyncSettings);
        setOnlineSyncSettings({ ...savedOnlineSync, apiToken: uiToken });

        await triggerDaemonOnlineSync();
        await new Promise((r) => setTimeout(r, 2_000));
        setOnlineSyncState(loadOnlineSyncState());
        setManualSyncResult({
          ok: true,
          action: 'push',
          reason: 'daemon_force_sync_triggered',
          serverRevision: null,
        });
      } catch (e) {
        setManualSyncResult({
          ok: false,
          action: 'none',
          reason: 'force_sync_failed',
          serverRevision: onlineSyncState.serverRevision,
          error: getErrorMessage(e, t('ui.common.unknown_error')),
        });
      } finally {
        setManualSyncing(false);
      }
    },
    [onlineSyncSettings, onlineSyncState.serverRevision, t],
  );

  const resetManualSyncResult = useCallback(() => {
    setManualSyncResult(null);
  }, []);

  const handleActivateLicense = useCallback(async () => {
    const key = licenseKeyInput.trim();
    if (!key) return;

    const serverUrl = onlineSyncSettings.serverUrl;
    if (!serverUrl) {
      setLicenseError(t('settings.license.no_server_url'));
      return;
    }

    setLicenseActivating(true);
    setLicenseError(null);

    try {
      const deviceId = onlineSyncSettings.deviceId || crypto.randomUUID();
      const deviceName = `${navigator.platform || 'Desktop'} — TIMEFLOW`;

      const result = await activateLicense(serverUrl, key, deviceId, deviceName);

      if (!result.ok) {
        setLicenseError(result.error || 'Activation failed');
        return;
      }

      const info: LicenseInfo = {
        licenseKey: key,
        licenseId: result.licenseId!,
        plan: result.plan!,
        status: result.status!,
        groupId: result.groupId!,
        groupName: result.groupName!,
        maxDevices: result.maxDevices!,
        activeDevices: result.activeDevices!,
        expiresAt: result.expiresAt ?? null,
        activatedAt: new Date().toISOString(),
      };
      saveLicenseInfo(info);
      setLicenseInfo(info);
      setLicenseKeyInput('');

      if (result.apiToken) {
        try {
          await setSecureToken(result.apiToken);
          setOnlineSyncSettings((prev) => ({
            ...prev,
            apiToken: result.apiToken!,
          }));
        } catch {
          logTauriWarn('[license] Failed to auto-save API token');
        }
      }

      const effectiveDeviceId = onlineSyncSettings.deviceId || deviceId;
      if (!onlineSyncSettings.deviceId) {
        setOnlineSyncSettings((prev) => ({ ...prev, deviceId }));
      }

      if (result.apiToken) {
        void persistDaemonOnlineSyncSettings(
          { ...onlineSyncSettings, deviceId: effectiveDeviceId },
          result.apiToken,
        ).catch((err) => {
          logTauriWarn(
            '[license] Failed to persist daemon settings after activation:',
            err,
          );
        });
      }

      showInfo(t('settings.license.activated_success'));
    } catch (e) {
      setLicenseError(getErrorMessage(e, t('ui.common.unknown_error')));
    } finally {
      setLicenseActivating(false);
    }
  }, [
    licenseKeyInput,
    onlineSyncSettings,
    persistDaemonOnlineSyncSettings,
    showInfo,
    t,
  ]);

  const handleDeactivateLicense = useCallback(() => {
    clearLicenseInfo();
    setLicenseInfo(null);
  }, []);

  const handleTestRoundtrip = useCallback(async () => {
    const serverUrl = onlineSyncSettings.serverUrl;
    if (!serverUrl) {
      setTestRoundtripResult('Brak adresu serwera / No server URL');
      setTestRoundtripSuccess(false);
      return;
    }

    setTestingRoundtrip(true);
    setTestRoundtripResult(null);

    try {
      const { postJson, getLocalDatasetState, compressGzip } = await import(
        '@/lib/sync/sync-http'
      );
      const token = onlineSyncSettings.apiToken || (await loadSecureApiToken()) || '';
      const deviceId = onlineSyncSettings.deviceId || 'test-device';
      const syncState = loadOnlineSyncState();

      setTestRoundtripResult('Eksport danych...');
      const local = await getLocalDatasetState(syncState);
      const archive = local.archive;
      const archiveSize = archive ? JSON.stringify(archive).length : 0;

      const testPayload = {
        timestamp: new Date().toISOString(),
        archiveSizeBytes: archiveSize,
        exportOk: local.exportOk,
        hasData: local.hasReseedData,
        hash: local.payloadSha256?.substring(0, 12) ?? null,
        archive: archive ?? { data: {} },
      };

      const rawJsonStr = JSON.stringify({
        userId: onlineSyncSettings.userId,
        deviceId,
        testPayload,
      });
      const rawBytes = new TextEncoder().encode(rawJsonStr);
      const gzipAvailable = typeof CompressionStream !== 'undefined';
      let compressedSize = rawBytes.length;
      if (gzipAvailable) {
        const compressed = await compressGzip(rawBytes);
        compressedSize = compressed.length;
      }
      const ratio = ((1 - compressedSize / rawBytes.length) * 100).toFixed(0);

      setTestRoundtripResult(
        gzipAvailable
          ? `Wysyłanie ${(compressedSize / 1024).toFixed(0)} KB (gzip ${ratio}% kompresji z ${(rawBytes.length / 1024).toFixed(0)} KB)...`
          : `Wysyłanie ${(rawBytes.length / 1024).toFixed(0)} KB (brak kompresji)...`,
      );
      const t0 = Date.now();
      const timeoutMs = Math.max(30000, Math.ceil(archiveSize / 1024) * 20);
      const result = await postJson<{
        ok: boolean;
        steps: {
          write: { success: boolean; sizeBytes: number };
          read: { success: boolean; matches: boolean };
          cleanup: { success: boolean };
        };
        echoPayload: Record<string, unknown>;
        serverTimestamp: string;
        roundtripMs: number;
      }>(
        serverUrl,
        '/api/sync/test-roundtrip',
        {
          userId: onlineSyncSettings.userId,
          deviceId,
          testPayload,
        },
        timeoutMs,
        token,
      );

      const clientMs = Date.now() - t0;
      const allOk =
        result.steps.write.success &&
        result.steps.read.success &&
        result.steps.read.matches;
      const dataMB = (result.steps.write.sizeBytes / (1024 * 1024)).toFixed(2);
      const transferKB = (compressedSize / 1024).toFixed(0);
      const speedKBs =
        clientMs > 0
          ? ((compressedSize / 1024) / (clientMs / 1000)).toFixed(0)
          : '?';

      if (allOk) {
        const gzipInfo = gzipAvailable
          ? `gzip: ${transferKB} KB/${(rawBytes.length / 1024).toFixed(0)} KB (${ratio}%)`
          : 'bez kompresji';
        setTestRoundtripResult(
          `OK | dane: ${dataMB} MB | ${gzipInfo} | ${speedKBs} KB/s | ${clientMs}ms | dekompresja+match: OK`,
        );
        setTestRoundtripSuccess(true);
      } else {
        setTestRoundtripResult(
          `FAIL | write: ${result.steps.write.success} | read: ${result.steps.read.success} | match: ${result.steps.read.matches}`,
        );
        setTestRoundtripSuccess(false);
      }
    } catch (e) {
      setTestRoundtripResult(
        `ERROR: ${e instanceof Error ? e.message : String(e)}`,
      );
      setTestRoundtripSuccess(false);
    } finally {
      setTestingRoundtrip(false);
    }
  }, [onlineSyncSettings]);

  return {
    onlineSyncSettings,
    setOnlineSyncSettings,
    manualSyncing,
    manualSyncResult,
    manualSyncResultText,
    manualSyncResultSuccess,
    onlineSyncState,
    showOnlineSyncToken,
    lastSyncLabel,
    shortHash,
    localHashShort,
    pendingAckHashShort,
    setShowOnlineSyncToken,
    updateOnlineSyncSettings,
    handleSyncNow,
    handleForceSyncNow,
    resetManualSyncResult,
    licenseInfo,
    licenseKeyInput,
    licenseActivating,
    licenseError,
    setLicenseKeyInput,
    handleActivateLicense,
    handleDeactivateLicense,
    testingRoundtrip,
    testRoundtripResult,
    testRoundtripSuccess,
    handleTestRoundtrip,
  };
}
