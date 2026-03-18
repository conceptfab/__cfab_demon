Aplikacja TIMEFLOW działa poprawnie, ale przeanalizuj kod projektu pod kątem jakości,
optymalizacji i przygotowania do dalszego rozwoju.
Analiza wyłącznie statyczna — na podstawie kodu źródłowego, bez uruchamiania aplikacji.
Nie generuj gotowego kodu refaktoryzacji — opisz co i dlaczego zmienić.

## Stack technologiczny

- Rust daemon: `src/` (main.rs, monitor.rs, tracker.rs, storage.rs, config.rs, tray.rs, i18n.rs)
- Dashboard: React + TypeScript + Tauri: `dashboard/src/`
- Strony: Dashboard, Sessions, Projects, Estimates, Applications, TimeAnalysis, AI, Data,
  Reports, DaemonControl, Settings, Help, QuickStart, ProjectPage, ReportView, ImportPage
- i18n: `dashboard/src/locales/{en,pl}/common.json`
- Dane użytkownika: pliki lokalne — zidentyfikuj format (SQLite / JSON / inne) i opisz strukturę

## Zakres analizy

### 1. Procesy i logika

- Zidentyfikuj wszystkie procesy (tracking, monitoring, storage, sync daemon↔dashboard).
- Sprawdź poprawność logiki, identyfikuj dublujące się funkcje i błędy logiczne.
- Przeanalizuj spójność stanu między daemonem Rust a dashboardem React (Tauri commands) —
  szukaj race conditions.

### 2. Wydajność i wielowątkowość

- Oceń wydajność i zaproponuj optymalizacje.
- Przeanalizuj wielowątkowość w Rust (użycie `tokio`, `Arc`, `Mutex` — czy poprawne).
- W React: sprawdź wycieki pamięci (brakujące cleanup w useEffect, nieoczyszczane
  interwały/timery, event listenery).

### 3. Obsługa błędów i bezpieczeństwo danych

- W Rust: sprawdź czy `unwrap()`/`expect()` nie grożą panicami w runtime — czy aplikacja
  gracefully obsługuje awarie (brak połączenia, pełny dysk, uszkodzony plik danych).
- Zidentyfikuj wszystkie miejsca zapisu/odczytu danych użytkownika. Opisz ryzyko migracji dla
  każdej sugerowanej zmiany struktury danych.
- Sprawdź czy backup/export działa poprawnie.

### 4. Refaktoryzacja i modularyzacja

- Wskaż nadmiarowy kod (nie generuj kodu — tylko opis co i dlaczego).
- Zaproponuj podział na moduły przygotowujący do dynamicznego rozwoju.
- Każda sugestia musi mieć konkretne uzasadnienie.

### 5. Tłumaczenia i Help

- Znajdź braki i błędy w tłumaczeniach (PL/EN) — zarówno w plikach `common.json` jak i inline `t()`.
- Sprawdź czy Help (EN) i Pomoc (PL) mają identyczną treść — każdy opis musi mieć parę PL + EN.
- Wskaż braki w zakładce Help/Pomoc względem faktycznych funkcji aplikacji.

### 6. Wykryte problemy — priorytet krytyczny 🔴

Zbadaj poniższe bugi. Dla każdego wskaż dokładny plik i fragment kodu który jest przyczyną:

1. **Unique Files liczone niepoprawnie** — sprawdź logikę deduplikacji plików w `storage.rs`
   i/lub `tracker.rs`. Zidentyfikuj gdzie jest błąd zliczania. Jeśli nie da sie go naprawic usun tą kurwa funkcę!

### 7. Bezpieczeństwo i prywatność

- Czy dane użytkownika są przechowywane lokalnie bez żadnej transmisji sieciowej?
- Czy Tauri permissions w `tauri.conf.json` są odpowiednio ograniczone (principle of least privilege)?
- Czy nie ma nieużywanych uprawnień (fs, shell, http)?

### 8. Sugestie funkcjonalne

- Zaproponuj ulepszenia UX/funkcjonalności, które wynikają z analizy kodu (nie wymyślaj na siłę).
- Podstawa: tylko to co wynika z istniejącego kodu lub zidentyfikowanych luk.

## Priorytet absolutny

**Zachowanie dotychczasowych danych użytkownika.** Żadna sugerowana zmiana nie może usunąć ani
zmodyfikować istniejących plików danych bez mechanizmu migracji.

## Format wyjścia

Zapisz wyniki i plan implementacji w pliku `plan_refactoryzacji.md`:

- Oznacz priorytet: 🔴 krytyczny (bug/utrata danych), 🟡 ważny (wydajność/UX), 🟢 nice-to-have
- Plan prac z kolejnością i możliwością realizacji równoległej
- Na początku pliku umieść tabelę statusu — aktualizuj ją przy każdej ukończonej sekcji:

```markdown
## Status analizy
| Sekcja | Status | Uwagi |
|--------|--------|-------|
| §1 Procesy i logika | ⏳ | |
| §2 Wydajność | ⏳ | |
| §3 Błędy i dane | ⏳ | |
| §4 Refaktoryzacja | ⏳ | |
| §5 Tłumaczenia | ⏳ | |
| §6 Bugi krytyczne | ⏳ | |
| §7 Bezpieczeństwo | ⏳ | |
| §8 Sugestie | ⏳ | |
