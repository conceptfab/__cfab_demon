import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpInvoke } from './http-transport';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('httpInvoke', () => {
  it('on LAN (non-loopback) rejects when no token is stored', async () => {
    vi.stubGlobal('window', { location: { hostname: '192.168.1.50' } });
    await expect(httpInvoke('clients_list')).rejects.toThrow();
  });

  it('on loopback sends the request without a token (X-Timeflow-Rpc only)', async () => {
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await httpInvoke('clients_list');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-Timeflow-Rpc']).toBe('1');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('sends bearer token and X-Timeflow-Rpc header when a token is stored', async () => {
    vi.stubGlobal('window', { location: { hostname: '192.168.1.50' } });
    localStorage.setItem('timeflow.webui.token', 'tok123');
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await httpInvoke('clients_list');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok123');
    expect(init.headers['X-Timeflow-Rpc']).toBe('1');
  });
});
