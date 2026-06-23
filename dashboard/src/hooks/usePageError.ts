import { useCallback } from 'react';
import { useToast } from '@/components/ui/toast-notification';
import { getErrorMessage, logTauriError } from '@/lib/utils';

/**
 * Ujednolicona obsługa błędów stron/kontrolerów (finding #13).
 *
 * Loguje błąd przez logTauriError i pokazuje toast użytkownikowi.
 * Używaj TYLKO dla błędów inicjowanych przez użytkownika (save/load/delete),
 * które bez tego byłyby cicho połknięte. Nie dodawaj toastu na błędy
 * tła (np. abort przy odmontowaniu, polling z ponowieniem).
 *
 * @returns reportError(action, error, fallback)
 *   action   – opis operacji (widoczny w logu konsoli)
 *   error    – złapany wyjątek
 *   fallback – komunikat wyświetlany, gdy błąd nie zawiera treści
 */
export function usePageError() {
  const { showError } = useToast();
  return useCallback(
    (action: string, err: unknown, fallback: string) => {
      logTauriError(action, err);
      showError(getErrorMessage(err, fallback));
    },
    [showError],
  );
}
