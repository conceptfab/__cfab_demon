export function splitTime(value: string): [string, string] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return ['09', '00'];
  // safe: regex guarantees groups 1 and 2 are present when match is non-null
  return [match[1]!, match[2]!];
}

export { parseRateInput, formatRateInput } from '@/lib/rate-utils';
