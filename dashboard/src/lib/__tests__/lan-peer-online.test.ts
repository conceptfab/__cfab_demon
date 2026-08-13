import { afterEach, describe, expect, it, vi } from 'vitest';

import { isLanPeerOnline } from '@/lib/lan-sync';
import type { LanPeer } from '@/lib/lan-sync-types';

const NOW = new Date('2026-08-13T12:00:00Z');

function peer(overrides: Partial<LanPeer> = {}): LanPeer {
  return {
    device_id: 'dev-1',
    machine_name: 'STUDIO-PC',
    ip: '192.168.1.20',
    dashboard_port: 47891,
    last_seen: NOW.toISOString(),
    dashboard_running: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('isLanPeerOnline', () => {
  it('świeży peer jest online', () => {
    vi.useFakeTimers({ now: NOW });
    expect(isLanPeerOnline(peer())).toBe(true);
  });

  it('peer z martwym heartbeatem demona jest nadal online — liczy się last_seen', () => {
    // Regresja: `dashboard_running` płynęło z heartbeat.txt peera i gasło przy
    // jednym zamulonym ticku, przez co przyciski Sync robiły się nieaktywne,
    // a master pokazywał „brak peerów" mimo działającej synchronizacji.
    vi.useFakeTimers({ now: NOW });
    expect(isLanPeerOnline(peer({ dashboard_running: false }))).toBe(true);
  });

  it('peer widziany 4 minuty temu jest offline', () => {
    vi.useFakeTimers({ now: NOW });
    expect(
      isLanPeerOnline(
        peer({ last_seen: new Date(NOW.getTime() - 240_000).toISOString() }),
      ),
    ).toBe(false);
  });

  it('peer widziany 2 minuty temu jest wciąż online (zapis pliku jest okresowy)', () => {
    vi.useFakeTimers({ now: NOW });
    expect(
      isLanPeerOnline(
        peer({ last_seen: new Date(NOW.getTime() - 120_000).toISOString() }),
      ),
    ).toBe(true);
  });

  it('nieparsowalny last_seen nie blokuje synchronizacji', () => {
    expect(isLanPeerOnline(peer({ last_seen: 'nonsens' }))).toBe(true);
  });
});
