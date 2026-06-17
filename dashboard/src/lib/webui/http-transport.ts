const TOKEN_KEY = 'timeflow.webui.token';

export function getWebToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setWebToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Ignore storage errors in private/restricted browser modes.
  }
}

function clearWebToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore storage errors in private/restricted browser modes.
  }
}

class WebUnauthorizedError extends Error {}

export async function pairWithCode(code: string): Promise<void> {
  const res = await fetch('/auth/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, label: navigator.userAgent.slice(0, 60) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(data.error ?? 'pairing_failed');
  }
  setWebToken(data.token as string);
}

export async function httpInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  // Token is mandatory — there is no loopback "trusted host" path anymore
  // (that was the CSRF vector). Every browser must pair to obtain a token.
  const token = getWebToken();
  if (!token) throw new WebUnauthorizedError('no_token');
  const res = await fetch('/rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Custom header — unsettable cross-origin without a CORS preflight, so the
      // server can require it as an anti-CSRF gate (see webui/server.rs).
      'X-Timeflow-Rpc': '1',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ command, args: args ?? {} }),
  });
  if (res.status === 401) {
    clearWebToken();
    throw new WebUnauthorizedError('unauthorized');
  }
  const payload = await res.json();
  if (!payload.ok) throw new Error(payload.error ?? 'rpc_error');
  return payload.data as T;
}
