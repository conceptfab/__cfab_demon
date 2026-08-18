/**
 * Backend zwraca błąd startu serwera MCP jako string (Tauri) albo jako
 * `{ code, message }` (transport HTTP webui gubi `code`). Mapujemy oba na klucz
 * i18n, żeby toast pokazał realny powód zamiast generycznego „nie udało się”.
 */
export const MCP_PORT_IN_USE = 'port_in_use';

export interface McpErrorMessage {
  key: string;
  params?: Record<string, string | number>;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return '';
}

export function describeMcpError(
  error: unknown,
  port: number,
): McpErrorMessage {
  const message = rawMessage(error).trim();
  if (message.includes(MCP_PORT_IN_USE)) {
    return { key: 'settings.mcp.port_in_use', params: { port } };
  }
  if (message) {
    return {
      key: 'settings.mcp.save_failed_reason',
      params: { reason: message },
    };
  }
  return { key: 'settings.mcp.save_failed' };
}
