import { enUS, pl } from 'date-fns/locale';
import type { Locale } from 'date-fns';

export function resolveDateFnsLocale(language?: string | null): Locale {
  if (language?.toLowerCase().startsWith('pl')) {
    return pl;
  }
  return enUS;
}
