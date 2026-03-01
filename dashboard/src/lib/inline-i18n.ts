import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeLanguageCode } from '@/lib/user-settings';

type InlineTranslator = (pl: string, en: string) => string;

export function useInlineT(): InlineTranslator {
  const { i18n } = useTranslation();
  const lang = normalizeLanguageCode(i18n.resolvedLanguage ?? i18n.language);

  return useMemo(
    () => (pl: string, en: string) => (lang === 'pl' ? pl : en),
    [lang],
  );
}
