import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

function readStoredValue<T>(key: string, initialValue: T): T {
  if (typeof window === 'undefined') return initialValue;

  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return initialValue;

    if (typeof initialValue === 'string') return raw as T;
    if (typeof initialValue === 'boolean') return (raw === 'true') as T;
    if (typeof initialValue === 'number') return Number(raw) as T;
    return JSON.parse(raw) as T;
  } catch {
    return initialValue;
  }
}

function serializeStoredValue<T>(value: T): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function usePersistedState<T>(
  key: string,
  initialValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readStoredValue(key, initialValue));

  const setPersistedValue = useCallback<Dispatch<SetStateAction<T>>>(
    (nextValue) => {
      setValue((current) => {
        const resolved =
          typeof nextValue === 'function'
            ? (nextValue as (prev: T) => T)(current)
            : nextValue;
        try {
          window.localStorage.setItem(key, serializeStoredValue(resolved));
        } catch {
          // Ignore storage failures; React state still updates.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, setPersistedValue];
}
