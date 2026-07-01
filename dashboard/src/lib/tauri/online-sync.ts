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
  /** E2E v2: klucz DANYCH (hex, PBKDF2 z passphrase). Pusty = v1. Patrz
   *  `resolveDaemonDataKey`. Demon używa go do `delta.enc` w schemacie v2. */
  data_encryption_key?: string;
  /** Schemat, którym to urządzenie PUBLIKUJE paczki: "v1-groupid" | "v2-passphrase". */
  key_scheme?: string;
}

/**
 * Domain separator dla derivacji E2E klucza. Wersjonowany — gdyby kiedyś trzeba
 * było zmienić schemat, bump `-v2` rozdziela stare i nowe klucze.
 */
const E2E_KDF_DOMAIN = 'timeflow-online-sync-e2e-v1';

/** Domain separator dla klucza DANYCH v2 (E2E oparty o passphrase; serwer go nie zna). */
const E2E_KDF_DOMAIN_V2 = 'timeflow-online-sync-e2e-v2';

// PBKDF2-HMAC-SHA256 — parametry MUSZĄ być identyczne z serwerem
// (__cfab_server storage-encryption.ts deriveGroupKeyV2) i Rust-demonem.
const PBKDF2_V2_ITERATIONS = 600_000;
const PBKDF2_V2_DKLEN_BYTES = 32;

/**
 * Generuje losowy sekret grupy (passphrase) dla E2E v2 — model „b": pierwszy
 * device losuje, pozostałe importują (eksport/QR). 32 losowe bajty → base64url
 * (~43 znaki, brak `+/=`, bezpieczne w URL/QR). Wysoka entropia (256 bit), więc
 * PBKDF2 jest tylko wzmocnieniem, nie jedyną obroną. NIGDY nie trafia na serwer.
 */
export function generateGroupPassphrase(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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
 * E2E v2 — klucz DANYCH wyprowadzany z `passphrase` grupy (sekret znany tylko
 * klientom, NIGDY niewysyłany na serwer). PBKDF2-HMAC-SHA256(passphrase,
 * salt="timeflow-online-sync-e2e-v2|"+groupId, 600k, 32B) → hex.
 *
 * Parytet: parametry identyczne z serwerem (`deriveGroupKeyV2`) i Rust-demonem.
 * W przeciwieństwie do v1 serwer NIE potrafi odtworzyć tego klucza (brak passphrase),
 * więc `delta.enc` szyfrowany tym kluczem jest realnie E2E względem serwera.
 *
 * UWAGA: to klucz DANYCH. Koperta creds FTP nadal jest odszyfrowywana kluczem v1
 * (groupId), którym serwer szyfruje creds — patrz model dwóch kluczy w design.md.
 * Niewpięte jeszcze w przepływ sync (zad. 11) — czeka na rozdzielenie kluczy w Rust.
 */
export async function deriveGroupDataKeyV2(passphrase: string, groupId: string): Promise<string> {
  const gid = groupId.trim();
  if (!passphrase || !gid) return '';
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(`${E2E_KDF_DOMAIN_V2}|${gid}`),
      iterations: PBKDF2_V2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    PBKDF2_V2_DKLEN_BYTES * 8,
  );
  return Array.from(new Uint8Array(bits))
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

export interface DaemonDataKeyResult {
  /** Hex klucza danych v2 (pusty = brak passphrase → v1). */
  dataEncryptionKey: string;
  /** Schemat wynikający z obecności passphrase. */
  keyScheme: 'v1-groupid' | 'v2-passphrase';
}

/**
 * Materiał klucza DANYCH dla demona (E2E v2). Gdy podano `passphrase` (sekret
 * grupy znany tylko klientom), liczy `data_encryption_key = deriveGroupDataKeyV2`
 * i zwraca schemat `v2-passphrase`. Bez passphrase → v1 (klucz danych = klucz
 * grupy z groupId, obsługiwany po stronie demona jako pusty `data_encryption_key`).
 *
 * WAŻNE: `encryption_key` (koperta creds FTP) pozostaje ZAWSZE kluczem v1
 * (groupId) — serwer szyfruje creds tym kluczem. Ta funkcja dotyczy wyłącznie
 * klucza DANYCH, rozdzielonego od klucza creds (model dwóch kluczy).
 */
export async function resolveDaemonDataKey(
  passphrase: string | undefined,
  groupId: string | undefined,
): Promise<DaemonDataKeyResult> {
  const pass = passphrase?.trim() ?? '';
  const gid = groupId?.trim() ?? '';
  if (!pass || !gid) {
    return { dataEncryptionKey: '', keyScheme: 'v1-groupid' };
  }
  const dataEncryptionKey = await deriveGroupDataKeyV2(pass, gid);
  return { dataEncryptionKey, keyScheme: 'v2-passphrase' };
}

export interface BuildDaemonSettingsInput {
  enabled: boolean;
  serverUrl: string;
  authToken: string;
  deviceId: string;
  autoSyncIntervalMinutes: number;
  autoSyncOnStartup: boolean;
  /** Grupa licencji; gdy obecna → sync_mode=async + klucze E2E. */
  groupId: string | undefined;
  /** Sekret grupy v2 (model B); gdy obecny → data_encryption_key + key_scheme=v2. */
  passphrase?: string;
}

/**
 * Buduje payload ustawień demona z jednego źródła prawdy (model dwóch kluczy):
 * - `encryption_key` = ZAWSZE klucz grupy v1 (`deriveGroupEncryptionKey(groupId)`),
 *   bo serwer szyfruje nim kopertę creds FTP;
 * - `data_encryption_key`/`key_scheme` = z passphrase (v2) gdy podany, inaczej v1.
 * Bez `groupId` (brak licencji) zwraca minimalny payload bez trybu async.
 */
export async function buildDaemonSettingsPayload(
  input: BuildDaemonSettingsInput,
): Promise<DaemonOnlineSyncSettings> {
  const groupId = input.groupId?.trim() ?? '';
  const settings: DaemonOnlineSyncSettings = {
    enabled: input.enabled,
    server_url: input.serverUrl,
    auth_token: input.authToken,
    device_id: input.deviceId,
    encryption_key: await deriveGroupEncryptionKey(groupId),
    sync_interval_minutes: input.autoSyncIntervalMinutes,
    auto_sync_on_startup: input.autoSyncOnStartup,
  };
  if (groupId) {
    settings.group_id = groupId;
    settings.sync_mode = 'async';
    const { dataEncryptionKey, keyScheme } = await resolveDaemonDataKey(input.passphrase, groupId);
    if (dataEncryptionKey) {
      settings.data_encryption_key = dataEncryptionKey;
      settings.key_scheme = keyScheme;
    }
  }
  return settings;
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
