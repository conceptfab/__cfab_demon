import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpInvoke } from './http-transport';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('httpInvoke', () => {
  it('rejects when no token is stored (no loopback trust)', async () => {
    await expect(httpInvoke('clients_list')).rejects.toThrow();
  });

  it('sends bearer token and X-Timeflow-Rpc header', async () => {
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
