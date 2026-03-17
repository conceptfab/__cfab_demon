import { useCallback, useEffect, useRef } from 'react';

export function handleSettledResult<T>(
  result: PromiseSettledResult<T>,
  handlers: {
    onFulfilled: (value: T) => void;
    onRejected?: (reason: unknown) => void;
  },
): void {
  if (result.status === 'fulfilled') {
    handlers.onFulfilled(result.value);
    return;
  }
  handlers.onRejected?.(result.reason);
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise
      .then((result) => {
        window.clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

export function evictOldestEntries<K, V>(map: Map<K, V>, maxSize: number): void {
  if (map.size <= maxSize) return;
  const iter = map.keys();
  for (let i = map.size - maxSize; i > 0; i--) {
    const key = iter.next().value;
    if (key !== undefined) map.delete(key);
  }
}

export function useCancellableAsync() {
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return useCallback(
    async <T>(
      task: () => Promise<T>,
      handlers: {
        onSuccess?: (value: T) => void;
        onError?: (error: unknown) => void;
      } = {},
    ): Promise<void> => {
      const requestId = ++requestIdRef.current;
      try {
        const value = await task();
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        handlers.onSuccess?.(value);
      } catch (error) {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        handlers.onError?.(error);
      }
    },
    [],
  );
}
