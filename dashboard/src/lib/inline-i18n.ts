import type { TFunction } from 'i18next';
import { normalizeLanguageCode } from '@/lib/user-settings';

export type InlineInterpolationValue =
  | string
  | number
  | boolean
  | null
  | undefined;
export type InlineInterpolationMap = Record<string, InlineInterpolationValue>;
export type InlineTranslator = (
  pl: string,
  en: string,
  interpolation?: InlineInterpolationMap,
) => string;

function hashInlinePair(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }

  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

export function buildInlineI18nKey(pl: string, en: string): string {
  return `inline.${hashInlinePair(`${pl}\u0000${en}`)}`;
}

export function createInlineTranslator(
  t: TFunction,
  language: unknown,
): InlineTranslator {
  const lang = normalizeLanguageCode(language);
  return (pl: string, en: string, interpolation?: InlineInterpolationMap) =>
    t(buildInlineI18nKey(pl, en), {
      ...interpolation,
      defaultValue: lang === 'pl' ? pl : en,
    });
}
