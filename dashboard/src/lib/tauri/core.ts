import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { emitLocalDataChanged } from '@/lib/sync-events';

export function hasTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
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
    return Promise.reject(new Error('Tauri runtime not available'));
  }
  return tauriInvoke<T>(command, args);
}

export function invokeMutation<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: {
    notify?: MutationNotify<T>;
  },
): Promise<T> {
  if (!hasTauriRuntime()) {
    return Promise.reject(new Error('Tauri runtime not available'));
  }
  return tauriInvoke<T>(command, args).then((res) => {
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
