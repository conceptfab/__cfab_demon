export function splitTime(value: string): [string, string] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return ['09', '00'];
  return [match[1], match[2]];
}

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
