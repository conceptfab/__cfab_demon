import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { emitLocalDataChanged } from '@/lib/sync-events';
import { httpInvoke } from '@/lib/webui/http-transport';

export function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

/**
 * Tauri commands returning `Result<T, CommandError>` reject with the serialized
 * error object `{ code, message }` — NOT an `Error` instance. Call sites that do
 * `e instanceof Error ? e.message : String(e)` then render `String(obj)` =
 * "[object Object]", masking the real reason (peer offline, connection refused,
 * validation, …). Normalize the rejection into a real `Error` at this single
 * boundary so every caller sees the human-readable message. `code` is preserved
 * as a property for callers that branch on it.
 */
function normalizeTauriError(raw: unknown): unknown {
  if (raw instanceof Error) return raw;
  if (typeof raw === 'string') return new Error(raw);
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'message' in raw &&
    typeof (raw as { message: unknown }).message === 'string'
  ) {
    const err = new Error((raw as { message: string }).message);
    const code = (raw as { code?: unknown }).code;
    if (typeof code === 'string') (err as Error & { code?: string }).code = code;
    return err;
  }
  return raw;
}

function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return tauriInvoke<T>(command, args).catch((e: unknown) => {
    throw normalizeTauriError(e);
  });
}

type MutationNotify<T> = boolean | ((result: T) => boolean);

function shouldNotifyMutation<T>(
  notify: MutationNotify<T> | undefined,
  result: T,
): boolean {
  if (typeof notify === 'function') {
    return notify(result);
  }
  return notify ?? true;
}

export function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!hasTauriRuntime()) {
    return httpInvoke<T>(command, args);
  }
  return invokeTauri<T>(command, args);
}

export function invokeMutation<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: {
    notify?: MutationNotify<T>;
  },
): Promise<T> {
  const call = hasTauriRuntime()
    ? invokeTauri<T>(command, args)
    : httpInvoke<T>(command, args);
  return call.then((res) => {
    try {
      if (shouldNotifyMutation(options?.notify, res)) {
        emitLocalDataChanged(command);
      }
    } catch (err) {
      console.error('[invokeMutation] emitLocalDataChanged threw:', err);
    }
    return res;
  });
}

export const runtimeApi = {
  hasTauriRuntime,
} as const;
