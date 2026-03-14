export function parseRateInput(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return value;
}

export function formatRateInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function parsePositiveRateMultiplierInput(raw: string): number | null {
  const parsed = parseRateInput(raw);
  if (parsed === null || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function formatMultiplierLabel(multiplier?: number): string {
  const value =
    typeof multiplier === 'number' &&
    Number.isFinite(multiplier) &&
    multiplier > 0
      ? multiplier
      : 1;
  return Number.isInteger(value)
    ? `x${value.toFixed(0)}`
    : `x${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
}
