import { useEffect, useRef, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DateRange } from '@/lib/db-types';

interface DateRangePickerProps {
  start: string;
  end: string;
  onApply: (range: DateRange) => void;
}

/**
 * Współdzielony wybór własnego zakresu dat (od–do). Po zatwierdzeniu woła `onApply`
 * z wybranym zakresem; strona sama decyduje, jak go zastosować (preset 'custom',
 * override itp.). Daty w formacie ISO YYYY-MM-DD porównują się leksykograficznie =
 * chronologicznie, więc walidacja `from <= to` jest poprawna.
 */
export function DateRangePicker({ start, end, onApply }: DateRangePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const ref = useRef<HTMLDivElement>(null);

  const openPanel = () => {
    setFrom(start);
    setTo(end);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const valid = Boolean(from) && Boolean(to) && from <= to;

  const apply = () => {
    if (!valid) return;
    onApply({ start: from, end: to });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <Button
        variant="outline"
        size="sm"
        className="h-8"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <CalendarRange className="mr-1.5 size-4" />
        {t('date_range_picker.button')}
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-64 space-y-3 rounded-lg border border-border bg-popover p-3 shadow-xl">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted-foreground">
              {t('date_range_picker.from')}
            </span>
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted-foreground">
              {t('date_range_picker.to')}
            </span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            className="w-full bg-sky-600 text-white hover:bg-sky-700"
            disabled={!valid}
            onClick={apply}
          >
            {t('date_range_picker.apply')}
          </Button>
        </div>
      )}
    </div>
  );
}
