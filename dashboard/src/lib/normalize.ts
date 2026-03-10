export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

export function isValidHexColor(value: string): boolean {
  return /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.test(value);
}

export function normalizeHexColor(
  value: string,
  fallback = '#10b981',
): string {
  return isValidHexColor(value) ? value : fallback;
}
