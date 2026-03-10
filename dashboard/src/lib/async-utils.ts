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

export function useCancellableAsync() {
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
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
