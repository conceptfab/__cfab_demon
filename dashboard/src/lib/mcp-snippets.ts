export function buildMcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

export function buildClaudeCodeCommand(port: number, token: string): string {
  return `claude mcp add --transport http timeflow ${buildMcpUrl(port)} --header "Authorization: Bearer ${token}"`;
}

/**
 * Claude Desktop / Cowork czyta `claude_desktop_config.json`. TIMEFLOW mówi
 * natywnym streamable HTTP, więc pośrednik `npx mcp-remote` jest zbędny —
 * dokłada proces Node i własne tryby transportu, w których łatwo o pomyłkę.
 */
export function buildClaudeDesktopConfig(port: number, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        timeflow: {
          type: 'http',
          url: buildMcpUrl(port),
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export function buildCodexConfig(port: number, token: string): string {
  return [
    '[mcp_servers.timeflow]',
    `url = "${buildMcpUrl(port)}"`,
    `http_headers = { "Authorization" = "Bearer ${token}" }`,
  ].join('\n');
}
