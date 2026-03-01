import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PromptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initialValue: string;
  onConfirm: (value: string) => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function PromptModal({
  open,
  onOpenChange,
  title,
  description,
  initialValue,
  onConfirm,
  confirmLabel,
  cancelLabel,
}: PromptModalProps) {
  const { t } = useTranslation();
  const effectiveConfirmLabel =
    confirmLabel ?? t('components.prompt_modal.confirm_default');
  const effectiveCancelLabel =
    cancelLabel ?? t('components.prompt_modal.cancel_default');
  const [value, setValue] = React.useState(initialValue);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setValue(initialValue);
      // Timeout to ensure focus after animation
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, initialValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(value);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <Input
            ref={inputRef}
            className="bg-secondary/30 border-secondary focus:border-primary/50"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {effectiveCancelLabel}
            </Button>
            <Button type="submit" size="sm" className="min-w-[70px]">
              {effectiveConfirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
