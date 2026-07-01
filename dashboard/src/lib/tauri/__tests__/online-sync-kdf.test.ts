import { describe, it, expect } from 'vitest';

import {
  buildDaemonSettingsPayload,
  deriveGroupDataKeyV2,
  deriveGroupEncryptionKey,
  generateGroupPassphrase,
  resolveDaemonDataKey,
} from '../online-sync';

// Golden vector computed with the SERVER params (Node pbkdf2Sync, PBKDF2-HMAC-SHA256,
// salt="timeflow-online-sync-e2e-v2|group-1", 600k iterations, 32 bytes). Locking this
// value proves cross-parity between the demon web layer, the Node server
// (__cfab_server deriveGroupKeyV2) and the Rust daemon (same params).
const GOLDEN_V2 = '8fb10097dffff9f00ca02080c3dff3fc02d80b48882390d86880aca9180e2e7e';

describe('deriveGroupDataKeyV2 (E2E v2 client KDF)', () => {
  it('matches the server PBKDF2 golden vector (cross-parity)', async () => {
    const got = await deriveGroupDataKeyV2('correct horse battery staple', 'group-1');
    expect(got).toBe(GOLDEN_V2);
    expect(got).toHaveLength(64);
  });

  it('is deterministic', async () => {
    const a = await deriveGroupDataKeyV2('pass', 'group-1');
    const b = await deriveGroupDataKeyV2('pass', 'group-1');
    expect(a).toBe(b);
  });

  it('differs by passphrase and by groupId', async () => {
    const base = await deriveGroupDataKeyV2('pass-A', 'group-1');
    expect(await deriveGroupDataKeyV2('pass-B', 'group-1')).not.toBe(base);
    expect(await deriveGroupDataKeyV2('pass-A', 'group-2')).not.toBe(base);
  });

  it('is distinct from the v1 groupId key', async () => {
    const v2 = await deriveGroupDataKeyV2('group-1', 'group-1');
    const v1 = await deriveGroupEncryptionKey('group-1');
    expect(v2).not.toBe(v1);
  });

  it('returns empty string for missing passphrase or groupId', async () => {
    expect(await deriveGroupDataKeyV2('', 'group-1')).toBe('');
    expect(await deriveGroupDataKeyV2('pass', '   ')).toBe('');
  });
});

describe('resolveDaemonDataKey (v2 material selection)', () => {
  it('returns v2 material when passphrase + groupId present', async () => {
    const r = await resolveDaemonDataKey('secret-pass', 'group-1');
    expect(r.keyScheme).toBe('v2-passphrase');
    expect(r.dataEncryptionKey).toBe(await deriveGroupDataKeyV2('secret-pass', 'group-1'));
  });

  it('falls back to v1 (empty data key) when passphrase missing', async () => {
    const r = await resolveDaemonDataKey('', 'group-1');
    expect(r).toEqual({ dataEncryptionKey: '', keyScheme: 'v1-groupid' });
  });

  it('falls back to v1 when groupId missing', async () => {
    const r = await resolveDaemonDataKey('secret-pass', '   ');
    expect(r).toEqual({ dataEncryptionKey: '', keyScheme: 'v1-groupid' });
  });
});

describe('generateGroupPassphrase (model B: random secret)', () => {
  it('produces a high-entropy url-safe base64 string', () => {
    const p = generateGroupPassphrase();
    // 32 bytes → base64url without padding = 43 chars, chars in [A-Za-z0-9-_].
    expect(p).toHaveLength(43);
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is unique across calls (random)', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateGroupPassphrase()));
    expect(seen.size).toBe(50);
  });

  it('yields a valid v2 data key via deriveGroupDataKeyV2', async () => {
    const p = generateGroupPassphrase();
    const key = await deriveGroupDataKeyV2(p, 'group-1');
    expect(key).toHaveLength(64);
  });
});

describe('buildDaemonSettingsPayload (two-key model)', () => {
  const base = {
    enabled: true,
    serverUrl: 'https://s',
    authToken: 'tok',
    deviceId: 'dev-1',
    autoSyncIntervalMinutes: 30,
    autoSyncOnStartup: false,
  };

  it('no groupId → no async mode, no data key, creds key empty', async () => {
    const s = await buildDaemonSettingsPayload({ ...base, groupId: undefined });
    expect(s.sync_mode).toBeUndefined();
    expect(s.group_id).toBeUndefined();
    expect(s.data_encryption_key).toBeUndefined();
    expect(s.key_scheme).toBeUndefined();
    expect(s.encryption_key).toBe('');
  });

  it('groupId without passphrase → async v1, creds key = group v1 key, no data key', async () => {
    const s = await buildDaemonSettingsPayload({ ...base, groupId: 'group-1' });
    expect(s.sync_mode).toBe('async');
    expect(s.group_id).toBe('group-1');
    expect(s.encryption_key).toBe(await deriveGroupEncryptionKey('group-1'));
    expect(s.data_encryption_key).toBeUndefined();
    expect(s.key_scheme).toBeUndefined();
  });

  it('groupId + passphrase → v2 data key, creds key STILL v1', async () => {
    const s = await buildDaemonSettingsPayload({
      ...base,
      groupId: 'group-1',
      passphrase: 'secret-pass',
    });
    expect(s.key_scheme).toBe('v2-passphrase');
    expect(s.data_encryption_key).toBe(await deriveGroupDataKeyV2('secret-pass', 'group-1'));
    // creds envelope key must remain v1 (server encrypts creds with it)
    expect(s.encryption_key).toBe(await deriveGroupEncryptionKey('group-1'));
    expect(s.encryption_key).not.toBe(s.data_encryption_key);
  });
});
