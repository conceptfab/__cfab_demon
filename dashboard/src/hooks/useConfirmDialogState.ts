import { useCallback, useMemo, useRef, useState } from 'react';

interface ConfirmState {
  open: boolean;
  message: string;
}

export function useConfirmDialogState() {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    message: '',
  });
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ open: true, message });
    });
  }, []);

  const handleClose = useCallback((ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  const dialogProps = useMemo(
    () => ({
      open: state.open,
      message: state.message,
      onConfirm: () => handleClose(true),
      onCancel: () => handleClose(false),
    }),
    [state.open, state.message, handleClose],
  );

  return { confirm, dialogProps };
}
