import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useInlineT } from '@/lib/inline-i18n';

interface ConfirmState {
  open: boolean;
  message: string;
  resolve: ((ok: boolean) => void) | null;
}

export function useConfirm() {
  const t = useInlineT();
  const [state, setState] = useState<ConfirmState>({
    open: false,
    message: '',
    resolve: null,
  });
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ open: true, message, resolve });
    });
  }, []);

  const handleClose = useCallback((ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  const ConfirmDialog = useCallback(
    () => (
      <Dialog open={state.open} onOpenChange={(open) => { if (!open) handleClose(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('Potwierdzenie', 'Confirm')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
              {t('Anuluj', 'Cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => handleClose(true)}>
              {t('Potwierdź', 'Confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    ),
    [state.open, state.message, handleClose, t],
  );

  return { confirm, ConfirmDialog };
}
