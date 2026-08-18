import { describe, expect, it } from 'vitest';

import { describeMcpError } from '@/lib/mcp-errors';

describe('describeMcpError', () => {
  it('maps a port conflict to the dedicated message with the port', () => {
    const err = new Error(
      'port_in_use: bind 0.0.0.0:47892 failed: address already in use (os error 10048)',
    );
    expect(describeMcpError(err, 47892)).toEqual({
      key: 'settings.mcp.port_in_use',
      params: { port: 47892 },
    });
  });

  it('detects a port conflict over the http transport (plain string, no code)', () => {
    const raw = 'port_in_use: bind 127.0.0.1:47892 failed: address in use';
    expect(describeMcpError(raw, 47892).key).toBe('settings.mcp.port_in_use');
  });

  it('surfaces any other backend reason instead of a generic failure', () => {
    const err = new Error('permission denied');
    expect(describeMcpError(err, 47892)).toEqual({
      key: 'settings.mcp.save_failed_reason',
      params: { reason: 'permission denied' },
    });
  });

  it('falls back to the generic message when there is no reason at all', () => {
    expect(describeMcpError({}, 47892)).toEqual({
      key: 'settings.mcp.save_failed',
    });
    expect(describeMcpError(new Error('   '), 47892)).toEqual({
      key: 'settings.mcp.save_failed',
    });
  });
});
