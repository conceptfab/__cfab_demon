# Plan Wdrożenia Nowych Funkcjonalności TIMEFLOW

Celem tego planu jest zaplanowanie krok po kroku implementacji pięciu uzgodnionych poprawek podnoszących "quality feel" ("charyzmę") aplikacji i poprawiających kluczowe mechaniki przydzielania sesji (AI). Zachowujemy dotychczasową lekkość (KISS, YAGNI).

## 1. Ulepszenie modułu AI i UI (Zrozumienie Intencji)
**Backend (Rust [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs)):**
- **Wydłużenie pamięci logiki historycznej:** Wydłużenie zakresu wczytywania reguł bazowych z tabel bazowych `assignment_model_time` ze sztywnego limitu 180 dni na np. `730 days` (2 lata).
- **Zwiększenie wag dla kar (Feedback Weight):** Obecny model dopisuje w locie nowe wartości. Dodamy mechanizm, który w przypadku sygnału "Kciuk w dół" lub manualnej re-asignacji aplikuje ujemne wartości statystyczne zapobiegające powtórnemu wskazywaniu tego samego wyboru.

**Frontend (React [Sessions.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Sessions.tsx) i inne):**
- Zbudowanie tooltipa lub małego okienka "Dlaczego to AI?". Z endpointu zwracany będzie breakdown (wynik procentowy, rozbite 4 warstwy na powody logiczne m.in. "Aktywność plikowa wpłynęła na: 80% wyniku").
- UI dodające Thumbs Up (👍) i Thumbs Down (👎) przy sugestii AI.

## 2. Ręczny podział sesji (Session Splitting)
**Backend (Rust [sessions.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/sessions.rs)):**
- Nowa komenda Tauri np. `split_session(session_id, ratio)`.
- Logika SQL: Pobranie oryginalnej sesji, oznaczenie jej bezpiecznie `is_hidden = 1` (chronologiczny dowód). Zbudowanie i wstawienie dwóch nowych rekordów potomnych z wyliczonym czasem trwania na podstawie wysłanej proporcji (np. 40/60). Opcjonalnie podział statystyk plikowych.

**Frontend (React [Sessions.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Sessions.tsx) - Context Menu):**
- Opcja w menu Mysz-PPM: "Podziel Sesję".
- Modal (okienko na wierzchu) renderujący poziomy slider pozwalający suwakiem na żywo zdecydować jaki stosunek % przydzielić dla Nowej Sesji A i Nowej Sesji B, wraz z opcją na przypisanie od razu innych projektów do danej "połowy".

## 3. Generowanie Raportów Projektu (React UI & window.print())
**Frontend (React [Projects.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Projects.tsx) lub `Reports.tsx`):**
- Zbudowanie zupełnie nowego, wektorowego, białego ekranu-widoku "Report Designer" (Szablony Raportów), przeznaczonego specyficznie dla wydruków (obsługiwanego przez CSS `@media print`).
- Mechanizm renderujący ustatyfikowane tabele i wykresy dla danego projektu (Dni/Sesje/Cena).
- Zastosowanie natywnego wywołania DOM `window.print()`, co powierzy zadanie wygenerowania idealnego PDF-a wbudowanej w silnik Chromium maszynie drukarskiej.

## 4. Bezpieczna Archiwizacja Plików JSON
**Backend (Rust [import.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/import.rs)):**
- Zaktualizowanie zapytań o pliki wejściowe tak, by ładowany z powodzeniem JSON nie był po prostu kasowany, tylko najpierw przenoszony (`fs::rename`) do katalogu `%APPDATA%/TimeFlow/archive`.
- Nadanie mu opcjonalnego przyrostka daty (timestamp) w calu chronienia nazw (np. `export-123_2026-03-06.json`).

## 5. Desktopowa Charyzma (Native Menu & Splash Screen)
**Tauri ([src-tauri/tauri.conf.json](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/tauri.conf.json) / [main.rs](file:///c:/_cloud/__cfab_demon/__client/src/main.rs)):**
- **Natywne Menu:** Inicjalizacja klasycznego paska głównego "Plik", "Edycja", "Widok". Wdroży to poczucie klasycznego klienta desktopowego.
- **Splash Screen:** Zmiana architektury zapytań rozruchowych. Utworzenie malutkiego, statycznego okna pobocznego z logo i napisem "Wczytywanie...". Główne okno Reacta uruchamia się niewidocznie w tle (`visible: false`), a po zbudowaniu renderera wysyła sygnał wymuszony poleceniem Tauri `close_splash()`, co ukryje graficzny Splasher i pokaże główną apkę po idealnie gładkim przejściu. Czysta inżynieria desktopu.
