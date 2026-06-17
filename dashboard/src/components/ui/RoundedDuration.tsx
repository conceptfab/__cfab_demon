import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/store/settings-store';
import { roundAggregate, roundDailyTotals } from '@/lib/rounding';
import { cn, formatDurationRaw } from '@/lib/utils';
import { AppTooltip } from '@/components/ui/app-tooltip';

interface RoundedDurationProps {
  /** Czas rzeczywisty (surowy) w sekundach. */
  seconds: number;
  /**
   * Sekundy per kalendarzowy dzień. Gdy podane i aktywny tryb `per_day`, każdy
   * dzień jest zaokrąglany do pełnej godziny i sumowany (zamiast zaokrąglać
   * pojedynczy total). Pomiń dla wartości jednodniowych.
   */
  dailySeconds?: readonly number[];
  className?: string;
}

const GAP_PX = 6; // gap between real and rounded (gap-1.5)

/**
 * Pokazuje czas rzeczywisty, a obok — gdy zaokrąglanie jest włączone — czas
 * zaokrąglony („≈ …"). Jeśli zaokrąglony nie mieści się obok, trafia do tooltipa.
 * Gdy zaokrąglanie wyłączone, renderuje wyłącznie czas rzeczywisty (zero zmian
 * względem dotychczasowego zachowania).
 */
export function RoundedDuration({
  seconds,
  dailySeconds,
  className,
}: RoundedDurationProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.roundingSettings);

  const containerRef = useRef<HTMLSpanElement>(null);
  const realRef = useRef<HTMLSpanElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);

  const real = formatDurationRaw(seconds);
  const useDaily =
    settings.mode === 'per_day' && !!dailySeconds && dailySeconds.length > 0;
  const rounded = settings.enabled
    ? formatDurationRaw(
        useDaily
          ? roundDailyTotals(dailySeconds!, settings)
          : roundAggregate(seconds, settings),
      )
    : null;

  useLayoutEffect(() => {
    if (rounded === null) return;
    const measure = () => {
      const container = containerRef.current;
      const realEl = realRef.current;
      const badgeEl = badgeRef.current;
      if (!container || !realEl || !badgeEl) return;
      const available =
        container.clientWidth - realEl.getBoundingClientRect().width - GAP_PX;
      const needed = badgeEl.getBoundingClientRect().width;
      setFits(needed <= available);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [rounded, real, seconds]);

  if (rounded === null) {
    return <span className={className}>{real}</span>;
  }

  const tooltip = `${t('rounding.tooltip_real')}: ${real} · ${t('rounding.tooltip_rounded')}: ${rounded}`;

  return (
    <AppTooltip content={tooltip}>
      <span
        ref={containerRef}
        className={cn(
          'relative inline-flex min-w-0 items-baseline gap-1.5 overflow-hidden',
          className,
        )}
      >
        <span ref={realRef} className="shrink-0">
          {real}
        </span>
        <span
          ref={badgeRef}
          aria-hidden={!fits}
          className={cn(
            'text-xs font-normal whitespace-nowrap text-muted-foreground',
            fits ? '' : 'invisible absolute',
          )}
        >
          ≈ {rounded}
        </span>
      </span>
    </AppTooltip>
  );
}
