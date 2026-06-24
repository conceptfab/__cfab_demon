// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type { SyncProgress } from '@/lib/lan-sync-types';

export interface DaemonOnlineSyncSettings {
  enabled: boolean;
  server_url: string;
  auth_token: string;
  device_id: string;
  encryption_key: string;
  sync_interval_minutes: number;
  auto_sync_on_startup: boolean;
  /** "session" | "async" (=pliki na FTP). Ustawiane na "async" gdy licencja aktywna. */
  sync_mode?: string;
  /** Grupa licencyjna — wymagana przez ścieżkę async-delta (kluczowanie paczek +
   *  klucz creds FTP liczony z grupy). Wysyłane gdy licencja aktywna. */
  group_id?: string;
}

/**
 * Domain separator dla derivacji E2E klucza. Wersjonowany — gdyby kiedyś trzeba
 * było zmienić schemat, bump `-v2` rozdziela stare i nowe klucze.
 */
const E2E_KDF_DOMAIN = 'timeflow-online-sync-e2e-v1';

/**
 * Wyprowadza E2E passphrase z `groupId` licencji: `SHA-256(domain | groupId)` → hex.
 * Wszystkie urządzenia w tej samej grupie licencyjnej liczą identyczny klucz, więc
 * snapshot zaszyfrowany na jednym odszyfruje się na drugim. Serwer nie widzi klucza
 * (widzi tylko szyfrogram), choć zna `groupId` — to świadomy trade-off auto-derivacji.
 * Pusty/whitespace `groupId` → `''` (brak grupy = brak klucza, demon padnie fail-loud).
 */
export async function deriveGroupEncryptionKey(groupId: string): Promise<string> {
  const gid = groupId.trim();
  if (!gid) return '';
  const data = new TextEncoder().encode(`${E2E_KDF_DOMAIN}|${gid}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Efektywny `encryption_key` zapisywany dla demona: jawny klucz (jeśli kiedyś
 * pojawi się pole ręczne) ma priorytet; inaczej derivacja z `groupId`; inaczej ''.
 */
export async function resolveDaemonEncryptionKey(
  explicitKey: string | undefined,
  groupId: string | undefined,
): Promise<string> {
  if (explicitKey && explicitKey.length > 0) return explicitKey;
  return deriveGroupEncryptionKey(groupId ?? '');
}

export const getDaemonOnlineSyncSettings = () =>
  invoke<DaemonOnlineSyncSettings>('get_online_sync_settings');

export const saveDaemonOnlineSyncSettings = (settings: DaemonOnlineSyncSettings) =>
  invokeMutation<void>('save_online_sync_settings', { settings });

/**
 * Wyzwól online sync przez demona.
 * - `background` (sync po starcie) → demon respektuje interwał (429 jeśli nie minął).
 * - `force` (manualny sync z UI: przycisk w panelu, „Sync now", retry) → omija interwał
 *   ORAZ cooldown po nieudanych próbach. Auto-wyzwalacze zostawiają `force=false`,
 *   żeby padający serwer nie wywołał retry stormu.
 */
export const triggerDaemonOnlineSync = (opts: { background?: boolean; force?: boolean } = {}) =>
  invokeMutation<string>('run_online_sync', {
    background: opts.background ?? false,
    force: opts.force ?? false,
  });

export const getDaemonOnlineSyncProgress = () =>
  invoke<SyncProgress>('get_online_sync_progress');

export interface DaemonOnlineSyncResult {
  ok: boolean;
  phase: string;
  error: string | null;
  syncedHash: string | null;
  finishedAt: number;
}

export const getDaemonOnlineSyncResult = () =>
  invoke<DaemonOnlineSyncResult>('get_online_sync_result');

export const cancelDaemonOnlineSync = () =>
  invokeMutation<void>('cancel_online_sync');

export const daemonOnlineSyncApi = {
  getDaemonOnlineSyncSettings,
  saveDaemonOnlineSyncSettings,
  triggerDaemonOnlineSync,
  getDaemonOnlineSyncProgress,
  getDaemonOnlineSyncResult,
  cancelDaemonOnlineSync,
} as const;
