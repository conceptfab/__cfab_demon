import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';
import {
  FULL_HOUR_MINUTES,
  ROUNDING_INTERVALS,
  ROUNDING_VARIANTS,
  type RoundingMode,
  type RoundingSettings,
} from '@/lib/rounding';

interface RoundingCardProps {
  settings: RoundingSettings;
  onChange: (next: RoundingSettings) => void;
}

/**
 * Karta ustawień zaokrąglania czasu. Kierunek jest stały (w górę) — użytkownik
 * wybiera tylko interwał oraz wariant. Warianty pochodzą z rejestru
 * `ROUNDING_VARIANTS`, więc dodanie kolejnego nie wymaga zmian w tym pliku.
 */
export function RoundingCard({ settings, onChange }: RoundingCardProps) {
  const { t } = useTranslation();
  const { enabled, intervalMinutes, mode } = settings;
  // Tryb dzienny wymusza pełną godzinę — interwał jest wtedy nieedytowalny.
  const intervalLocked = mode === 'per_day';
  const intervalDisabled = !enabled || intervalLocked;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">
          {t('rounding.title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('rounding.description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enable toggle */}
        <label
          htmlFor="roundingEnabled"
          className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center hover:bg-secondary/5 transition-colors"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-sky-400">
              {t('rounding.enable')}
            </p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {t('rounding.enable_hint')}
            </p>
          </div>
          <button
            id="roundingEnabled"
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => onChange({ ...settings, enabled: !enabled })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              enabled ? 'bg-sky-600' : 'bg-secondary'
            }`}
          >
            <span
              className={`inline-block size-3.5 rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>

        {/* Interval */}
        <div
          className={`grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center ${
            intervalDisabled ? 'opacity-50' : ''
          }`}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('rounding.interval')}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {intervalLocked
                ? t('rounding.interval_locked_hint')
                : t('rounding.interval_hint')}
            </p>
          </div>
          <select
            value={intervalLocked ? FULL_HOUR_MINUTES : intervalMinutes}
            disabled={intervalDisabled}
            onChange={(e) =>
              onChange({ ...settings, intervalMinutes: Number(e.target.value) })
            }
            className="rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 text-foreground disabled:cursor-not-allowed"
          >
            {ROUNDING_INTERVALS.map((n) => (
              <option key={n} value={n} className="bg-background text-foreground">
                {t('rounding.minutes', { value: n })}
              </option>
            ))}
          </select>
        </div>

        {/* Variant (mode) */}
        <div className={`space-y-2 ${enabled ? '' : 'opacity-50'}`}>
          <p className="text-sm font-medium">{t('rounding.mode')}</p>
          {ROUNDING_VARIANTS.map((variant) => {
            const selected = variant.id === mode;
            return (
              <label
                key={variant.id}
                className={`grid cursor-pointer gap-3 rounded-md border p-3 transition-colors sm:grid-cols-[auto_1fr] sm:items-start ${
                  selected
                    ? 'border-sky-400/60 bg-sky-400/5'
                    : 'border-border/70 bg-background/35 hover:bg-secondary/20'
                } ${enabled ? '' : 'cursor-not-allowed'}`}
              >
                <input
                  type="radio"
                  name="roundingMode"
                  className="mt-1 size-4 accent-primary"
                  value={variant.id}
                  checked={selected}
                  disabled={!enabled}
                  onChange={() =>
                    onChange({ ...settings, mode: variant.id as RoundingMode })
                  }
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(variant.nameKey)}</p>
                  <p className="text-xs leading-5 break-words text-muted-foreground">
                    {t(variant.descriptionKey)}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
