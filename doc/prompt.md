Aplikacja TIMEFLOW działa poprawnie, ale przeanalizuj kod projektu pod kątem jakości,
  optymalizacji i przygotowania do dalszego rozwoju.                                                                                                                                            
  ## Stack technologiczny
  - Rust daemon: `src/` (main.rs, monitor.rs, tracker.rs, storage.rs, config.rs, tray.rs,       
  i18n.rs)
  - Dashboard: React + TypeScript + Tauri: `dashboard/src/`
  - Strony: Dashboard, Sessions, Projects, Estimates, Applications, TimeAnalysis, AI, Data,     
  Reports, DaemonControl, Settings, Help, QuickStart, ProjectPage, ReportView, ImportPage       
  - i18n: `dashboard/src/locales/{en,pl}/common.json`
  - Dane użytkownika: pliki lokalne (SQLite/JSON — zidentyfikuj format)

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
  - Wskaż nadmiarowy kod.
  - Zaproponuj podział na moduły przygotowujący do dynamicznego rozwoju.
  - Nie refaktoruj bez uzasadnienia — każda zmiana musi mieć konkretny powód.

  ### 5. Tłumaczenia i Help
  - Znajdź braki i błędy w tłumaczeniach (PL/EN) — zarówno w plikach `common.json` jak i inline 
  `t()`.
  - Sprawdź czy Help (EN) i Pomoc (PL) mają identyczną treść — każdy opis musi mieć parę PL +   
  EN.
  - Wskaż braki w zakładce Help/Pomoc względem faktycznych funkcji aplikacji.

  ### 6. Unique Files — weryfikacja mechanizmu
  - Mam wątpliwości co do poprawności liczenia Unique Files. Prześledź cały flow: skąd dane są  
  zbierane, jak agregowane, co wyświetlane. Potwierdź poprawność lub opisz dokładnie co jest nie
   tak.

  ### 7. Raport PDF — poprawki
  - Raport PDF obcina treść do jednej strony zamiast generować wielostronicowy dokument.        
  Zdiagnozuj przyczynę (np. fixed height, brak page break, ograniczenie biblioteki).
  - Przy zapisywaniu raportu do PDF nazwa pliku powinna mieć format:
  `timeflow_raport_NAZWAPROJEKTU.pdf`
  - Sprawdź jak obecnie generowana jest nazwa i co trzeba zmienić.

  ### 8. Sugestie funkcjonalne
  - Zaproponuj ulepszenia UX/funkcjonalności, które wynikają z analizy kodu (nie wymyślaj na    
  siłę).

  ## Priorytet absolutny
  **Zachowanie dotychczasowych danych użytkownika.** Żadna sugerowana zmiana nie może usunąć ani
   zmodyfikować istniejących plików danych bez mechanizmu migracji.

  ## Format wyjścia
  Zapisz wyniki w pliku `refactor.md` z następującą strukturą:

  ```markdown
  # TIMEFLOW — Analiza kodu i plan refaktoryzacji

  ## 1. Procesy i logika
  ## 2. Wydajność i wielowątkowość
  ## 3. Obsługa błędów i bezpieczeństwo danych
  ## 4. Refaktoryzacja i modularyzacja
  ## 5. Tłumaczenia i Help
  ## 6. Unique Files — analiza mechanizmu
  ## 7. Raport PDF — diagnoza i poprawki
  ## 8. Sugestie funkcjonalne
  ## 9. Plan prac (priorytetyzowany)
  ## 10. Wskazówki dla kolejnego modelu

  W każdej sekcji:
  - Oznacz priorytet: 🔴 krytyczny (bug/utrata danych), 🟡 ważny (wydajność/UX), 🟢 nice-to-have
   (czystość kodu).
  - Podaj konkretne pliki i numery linii.
  - Opisz co jest źle i co zaproponujesz.

  Sekcja "Plan prac" (§9)

  - Uporządkuj zmiany od najważniejszych do opcjonalnych.
  - Opisz zależności między zmianami — co musi być zrobione przed czym.

  Sekcja "Wskazówki dla kolejnego modelu" (§10)

  Szczegółowe poprawki mają powstać w kolejnym kroku — przeprowadzi je inny model. Zostaw mu:   
  - Opis architektury i kluczowych decyzji projektowych.
  - Listę zmian z konkretnymi plikami, liniami i proponowanym kodem (pseudokod lub opis).       
  - Ostrzeżenia: co może się zepsuć, na co uważać.
  - Jasną instrukcję, by na podstawie refactor.md sporządził szczegółowy plan_implementacji.md z
   krokami do wykonania.