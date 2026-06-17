const TOKEN_KEY = 'timeflow.webui.token';

/**
 * True gdy strona jest serwowana z loopbacku (127.0.0.1 / localhost). Lokalny
 * dostęp nie wymaga kodu parowania — bramki Origin + X-Timeflow-Rpc po stronie
 * serwera już blokują CSRF. Kod jest potrzebny tylko z innych urządzeń (LAN).
 */
export function isLoopbackHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

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
  // Token wymagany poza loopbackiem. Lokalnie (127.0.0.1) serwer ufa połączeniu
  // bez tokenu — chroni go nagłówek X-Timeflow-Rpc + walidacja Origin, których
  // obca strona nie ustawi cross-origin. Z LAN/innego urządzenia token konieczny.
  const token = getWebToken();
  if (!token && !isLoopbackHost()) throw new WebUnauthorizedError('no_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Custom header — unsettable cross-origin without a CORS preflight, so the
    // server can require it as an anti-CSRF gate (see webui/server.rs).
    'X-Timeflow-Rpc': '1',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch('/rpc', {
    method: 'POST',
    headers,
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
