export function buildMcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

export function buildClaudeCodeCommand(port: number, token: string): string {
  return `claude mcp add --transport http timeflow ${buildMcpUrl(port)} --header "Authorization: Bearer ${token}"`;
}

export function buildCodexConfig(port: number, token: string): string {
  return [
    '[mcp_servers.timeflow]',
    `url = "${buildMcpUrl(port)}"`,
    `http_headers = { "Authorization" = "Bearer ${token}" }`,
  ].join('\n');
}
