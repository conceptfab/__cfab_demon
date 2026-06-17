import { hasTauriRuntime, invoke } from '@/lib/tauri/core';

/**
 * Drukuje bieżący widok (raport) do PDF / na drukarkę.
 *
 * W aplikacji desktop (Tauri/WKWebView na macOS) `window.print()` z JS jest no-op —
 * dlatego wołamy natywny print przez komendę Tauri `print_report` (WRY otwiera systemowy
 * panel druku per platforma). W przeglądarce (Web UI) `window.print()` działa natywnie.
 */
export async function printCurrentView(): Promise<void> {
  if (hasTauriRuntime()) {
    await invoke<void>('print_report');
    return;
  }
  window.print();
}
