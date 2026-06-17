import { useEffect } from 'react';
import type { RefObject } from 'react';

export function useClickOutsideDismiss<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onClose: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current && !ref.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [enabled, onClose, ref]);
}

export function useEscapeKey(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, onClose]);
}
