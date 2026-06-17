import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { LanPeer } from '@/lib/lan-sync-types';

const PIN_POSITION_KEYS = [
  'pin-a',
  'pin-b',
  'pin-c',
  'pin-d',
  'pin-e',
  'pin-f',
] as const;

interface LanSyncPairCodeDialogProps {
  peer: LanPeer;
  onSubmit: (peer: LanPeer, code: string) => Promise<void>;
  buttonLabel: string;
  buttonVariant?: 'outline' | 'ghost' | 'default';
  buttonClassName?: string;
  dialogTitle: string;
  dialogDescription: string;
  submitLabel: string;
}

export function LanSyncPairCodeDialog({
  peer,
  onSubmit,
  buttonLabel,
  buttonVariant = 'outline',
  buttonClassName = '',
  dialogTitle,
  dialogDescription,
  submitLabel,
}: LanSyncPairCodeDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value.slice(-1);
    setDigits(newDigits);
    setError(null);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
  };

  const handleSubmit = async () => {
    const code = digits.join('');
    if (code.length !== 6) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(peer, code);
      setOpen(false);
      setDigits(['', '', '', '', '', '']);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size="sm"
        className={`h-7 px-2.5 text-xs ${buttonClassName}`}
        onClick={() => {
          setOpen(true);
          setDigits(['', '', '', '', '', '']);
          setError(null);
          setTimeout(() => inputRefs.current[0]?.focus(), 100);
        }}
      >
        <Shield className="size-3 mr-1" />
        {buttonLabel}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-1">{dialogTitle}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {dialogDescription}
            </p>
            <div
              className="flex justify-center gap-2 mb-4"
              onPaste={handlePaste}
            >
              {digits.map((digit, i) => (
                <input
                  key={PIN_POSITION_KEYS[i]}
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  aria-label={t('accessibility.pin_digit', {
                    position: i + 1,
                    total: digits.length,
                  })}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className="w-10 h-12 text-center text-xl font-mono font-bold bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                />
              ))}
            </div>
            {error && (
              <p className="text-sm text-destructive mb-3">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={submitting || digits.some((d) => !d)}
              >
                {submitting ? (
                  <Loader2 className="size-3 animate-spin mr-1" />
                ) : null}
                {submitLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
