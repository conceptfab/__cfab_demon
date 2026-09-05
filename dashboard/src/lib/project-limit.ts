/**
 * Czysta logika prezentacji limitu godzin projektu — bez Reacta, żeby dała się
 * przetestować i żeby próg „bursztynowy/czerwony" był JEDNYM miejscem prawdy
 * dla strony projektu, listy projektów i raportu.
 */

export type LimitTone = 'ok' | 'warn' | 'over';

/** Od tego procentu zużycia ostrzegamy, zanim limit faktycznie padnie. */
export const LIMIT_WARN_PERCENT = 80;

export function limitTone(percent: number): LimitTone {
  if (!Number.isFinite(percent)) return 'ok';
  if (percent >= 100) return 'over';
  if (percent >= LIMIT_WARN_PERCENT) return 'warn';
  return 'ok';
}

/** Szerokość paska: procent przycięty do 0..100 (ponad limit i tak sygnalizuje kolor). */
export function limitBarPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(100, percent);
}

export const LIMIT_TONE_CLASSES: Record<LimitTone, { bar: string; text: string }> = {
  ok: { bar: 'bg-emerald-500', text: 'text-emerald-400' },
  warn: { bar: 'bg-amber-500', text: 'text-amber-400' },
  over: { bar: 'bg-red-500', text: 'text-red-400' },
};

/** „65,0 h" — jedna cyfra po przecinku wystarcza do rozliczeń, a nie szumi. */
export function formatLimitHours(hours: number, locale: string): string {
  const safe = Number.isFinite(hours) ? hours : 0;
  return `${safe.toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} h`;
}

/**
 * Podstawia `{limit}` i `{period}` w szablonie komentarza — lustro `render_comment`
 * z `commands/project_limits.rs`. Front musi pokazać w podglądzie DOKŁADNIE ten tekst,
 * który backend zapisze do sesji.
 */
export function renderLimitComment(
  template: string,
  limitHours: number,
  cycleStart: string,
  cycleEnd: string,
): string {
  return template
    .replace('{limit}', String(Math.round(limitHours)))
    .replace('{period}', `${cycleStart} – ${cycleEnd}`);
}
