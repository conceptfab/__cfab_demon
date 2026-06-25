import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock @/lib/tauri so loadOnlineSyncSettings does not attempt real IPC calls.
vi.mock("@/lib/tauri", () => ({
  getSecureToken: vi.fn().mockResolvedValue(""),
  setSecureToken: vi.fn().mockResolvedValue(undefined),
}));

import { saveOnlineSyncLastResult, loadOnlineSyncState } from "./sync-state";

function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    getItem: (k: string): string | null => (k in store ? store[k] : null),
    setItem: (k: string, v: string): void => { store[k] = String(v); },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
    key: (i: number): string | null => Object.keys(store)[i] ?? null,
  };
}

describe("saveOnlineSyncLastResult", () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = makeLocalStorageMock();
    vi.stubGlobal("window", { localStorage: mockStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists lastSyncAt and hash so the panel reflects real status", () => {
    saveOnlineSyncLastResult({ ok: true, syncedHash: "deadbeef", finishedAt: 1000 });
    const st = loadOnlineSyncState();
    expect(st.lastSyncAt).not.toBeNull();
    expect(st.localHash).toBe("deadbeef");
  });

  it("sets lastSyncAt to ISO string derived from finishedAt seconds", () => {
    saveOnlineSyncLastResult({ ok: true, syncedHash: "abc123", finishedAt: 1_700_000_000 });
    const st = loadOnlineSyncState();
    expect(st.lastSyncAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("falls back to current time when finishedAt is absent", () => {
    const before = Date.now();
    saveOnlineSyncLastResult({ ok: false });
    const after = Date.now();
    const st = loadOnlineSyncState();
    const ts = st.lastSyncAt ? new Date(st.lastSyncAt).getTime() : 0;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("preserves previous hash when syncedHash is not provided", () => {
    // First write establishes a hash
    saveOnlineSyncLastResult({ ok: true, syncedHash: "first-hash", finishedAt: 1000 });
    // Second write without hash should keep previous
    saveOnlineSyncLastResult({ ok: true, finishedAt: 2000 });
    const st = loadOnlineSyncState();
    expect(st.localHash).toBe("first-hash");
    expect(st.lastSyncAt).toBe(new Date(2000 * 1000).toISOString());
  });

  it("persists ok=false and error so a failure is no longer invisible", () => {
    saveOnlineSyncLastResult({ ok: false, error: "FTP timeout", finishedAt: 3000 });
    const st = loadOnlineSyncState();
    expect(st.lastOk).toBe(false);
    expect(st.lastError).toBe("FTP timeout");
  });

  it("clears lastError when a later sync succeeds", () => {
    saveOnlineSyncLastResult({ ok: false, error: "boom", finishedAt: 3000 });
    saveOnlineSyncLastResult({ ok: true, syncedHash: "h", finishedAt: 4000 });
    const st = loadOnlineSyncState();
    expect(st.lastOk).toBe(true);
    expect(st.lastError).toBeNull();
  });
});
