import { useEffect } from 'react';
import type { TFunction } from 'i18next';
import type { PageChangeGuard } from './useSettingsFormTypes';

interface UseSettingsGuardsOptions {
  confirm: (message: string) => Promise<boolean>;
  savedSettings: boolean;
  setPageChangeGuard: (guard: PageChangeGuard | null) => void;
  t: TFunction;
}

export function useSettingsGuards({
  confirm,
  savedSettings,
  setPageChangeGuard,
  t,
}: UseSettingsGuardsOptions) {
  useEffect(() => {
    if (savedSettings) {
      setPageChangeGuard(null);
      return;
    }

    const pageChangeGuard: PageChangeGuard = async (nextPage, currentPage) => {
      if (currentPage !== 'settings' || nextPage === 'settings') return true;
      return confirm(t('settings_page.unsaved_changes_confirm'));
    };

    setPageChangeGuard(pageChangeGuard);
    return () => setPageChangeGuard(null);
  }, [confirm, savedSettings, setPageChangeGuard, t]);

  useEffect(() => {
    if (savedSettings) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [savedSettings]);
}
