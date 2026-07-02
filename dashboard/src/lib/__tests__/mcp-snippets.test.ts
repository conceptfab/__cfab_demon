import { describe, expect, it } from 'vitest';

import {
  buildClaudeCodeCommand,
  buildCodexConfig,
  buildMcpUrl,
} from '@/lib/mcp-snippets';

describe('mcp-snippets', () => {
  it('builds the MCP endpoint url from port', () => {
    expect(buildMcpUrl(47892)).toBe('http://127.0.0.1:47892/mcp');
  });

  it('builds a claude mcp add command with bearer header', () => {
    const cmd = buildClaudeCodeCommand(47892, 'tok123');
    expect(cmd).toBe(
      'claude mcp add --transport http timeflow http://127.0.0.1:47892/mcp --header "Authorization: Bearer tok123"',
    );
  });

  it('builds a codex config.toml block', () => {
    const cfg = buildCodexConfig(47892, 'tok123');
    expect(cfg).toContain('[mcp_servers.timeflow]');
    expect(cfg).toContain('url = "http://127.0.0.1:47892/mcp"');
    expect(cfg).toContain('Bearer tok123');
  });
});
