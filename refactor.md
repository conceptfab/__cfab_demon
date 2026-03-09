# Raport z Analizy i Propozycja Refaktoryzacji (TIMEFLOW)

Zgodnie z poleceniem przeanalizowałem kod projektu pod kątem: logiki AI i podziału sesji, wydajności, refaktoryzacji, UI/tłumaczeń oraz funkcjonalności. Priorytetem pozostaje zachowanie dotychczasowych danych. Poniższy dokument zawiera wnioski i rekomendacje dla modelu implementującego zmiany.

## 1. Analiza Logiki: AI i Podział Sesji

### Wnioski
AI w obecnym kształcie ([assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs)) nie jest modelem samouczącym się (np. siecią neuronową), a deterministycznym systemem punktacyjnym opartym o 4 warstwy (aktywność na plikach, powiązania aplikacji, czas w ciągu dnia, słowa kluczowe).
**Główny problem z podziałem sesji:** 
Logika podziału ([analyze_session_projects](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/sessions.rs#1528-1665) i [suggest_session_split](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/sessions.rs#1430-1527) w [sessions.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/sessions.rs)) niemal w 100% polega na czasie zarejestrowanym w tabeli `file_activities`. Jeśli dla danej sesji nie ma przypisanych plików z poprawnym projektem, system uderza w kod zapasowy (fallback), który proponuje "ślepy" podział 50/50 między aktualnym projektem a projektem rekomendowanym przez AI.
Ponadto, mechanikę uczenia i walidacji [analyze_session_projects](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/sessions.rs#1528-1665) warto oprzeć na solidnych punktach obliczanych z czterowarstwowego modelu, a nie tylko agregować `SUM(fa.total_seconds)`.

### Wskazówki do implementacji
- **Poprawa funkcji split:** W [suggest_session_split](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/sessions.rs#1430-1527) zoptymalizuj fallback - jeśli brakuje danych w `file_activities`, przelicz udziały czasowe na podstawie siły powiązań z warstwy 2 (historyczne app-to-project) i warstwy 3 (czas-dni).
- **Feedback Loop dla AI w podziałach:** Gdy użytkownik ręcznie przesuwa suwaki podziału w [MultiSplitSessionModal.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/components/sessions/MultiSplitSessionModal.tsx), system powinien zapisać ten fakt jako silny sygnał treningowy (feedback weights) dla wytypowanych projektów proporcjonalnie do procentowego przydziału.
- **Odseparowanie modułu AI:** Należy wydzielić deterministyczną logikę oceniania ([compute_raw_suggestion](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#620-769)) z potężnego monoilita [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs) do mniejszych modułów organizujących warstwy uczenia (np. `ai/layers/file.rs`, `ai/layers/token.rs`).

## 2. Wydajność, Optymalizacje, Wielowątkowość

### Wnioski
**Wąskie gardło (Bottleneck):**
Komendy Tauri (np. te w [sessions.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/sessions.rs) i [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs)) są zadeklarowane jako asynchroniczne (`#[tauri::command] pub async fn`), ale w ich wnętrzu używany jest synchroniczny sterownik [rusqlite](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/db.rs#1483-1494) bez odpowiedniej izolacji w postaci `tokio::task::spawn_blocking`.
Oznacza to, że asynchroniczny "worker thread" w Tauri zostaje zablokowany podczas oczekiwania na wykonanie ciężkich zapytań SQL (np. zawiłych użyć `SESSION_PROJECT_CTE_ALL_TIME`). Może to powodować mikro-zacięcia interfejsu przy dużych bazach danych.

### Wskazówki do implementacji
- Owiń długo trwające i blokujące zapytania SQL w rustowym backendzie używając `tokio::task::spawn_blocking(move || { ... })`.
- Zamiast ciągłego otwierania nowych transakcji, rozważ użycie prostej puli połączeń dla odczytów (connection pooling, np. przez pule zarządzane asynchronicznie) albo upewnij się, że blokowanie występuje wyłącznie poza pulą wątków asynchronicznych frontu (`actix-web`/`tauri`).

## 3. Nadmiarowy kod i Refaktoryzacja (Zabiegi KISS)

### Wnioski
Monolity plikowe. Pliki takie jak [sessions.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/sessions.rs) (ponad 2200 linii) i [db.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/db.rs) (ponad 1500 linii) zawierają zbyt wiele na raz – od definicji schematów po triggery, logikę i modele zapytań.
Zgodnie z zasadą KISS należy unikać wielkich klas i wielkich plików logicznych, ułatwiając tym samym testowanie konkretnych funkcji wyodrębnionych biznesowo.

### Wskazówki do implementacji
- **Podział pliku schematu:** Przenieś instrukcje z wbudowanego SQL w [db.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/db.rs) (zmienna `SCHEMA`) do zewnętrznego pliku tekstowego w `resources/` lub podziel go na małe obiekty migracyjne.
- **Wydzielenie zapytań:** Rozdziel [sessions.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/sessions.rs) na mniejsze moduły robocze, np. `sessions/query.rs` (odczyty API), `sessions/split.rs` (wyłączna logika podziału) oraz `sessions/mutation.rs` (aktualizowanie/kasowanie). To znacznie uprości utrzymanie kodu przez model/inżynierów.
- **Brak over-engineeringu:** Nie dodawaj ORM (np. Diesel / SeaORM). Trzymaj się [rusqlite](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/db.rs#1483-1494) i czystego SQL, ale zadbaj o strukturę.

## 4. Braki i Błędy w Tłumaczeniu oraz Panelu Pomoc ([Help.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Help.tsx))

### Wnioski
Aplikacja z zasady musi mieć UI angielski (wyjątek to zakodowany Help/Quickstart, co wynika z Twoich uwag, np. dopuszcza się polski). Problem polega na tym, że mechanizm dynamicznego wchodzenia w konkretne tłumaczenia (`t18n`) nie pokrywa błędów z dynamicznie wgrywanymi frazami, jak statusy błędów AI po przeliczeniach, czy same okienka splitowania ([MultiSplitSessionModal.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/components/sessions/MultiSplitSessionModal.tsx) wydaje się być częściowo podatne na polsko-angielski "miss-match").
Dodatkowo sam widget "Help.tsx" nie jest aktualizowany wraz z logiką wielorakiego podziału sesji do 5 projektów (wymienia ciągle podstawowe nożyczki, a nie nowy multislider procentowy).

### Wskazówki do implementacji
- **Aktualizacja [Help.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Help.tsx):** Dodaj dedykowany podpunkt o zaawansowanym podziale (Multi-project Splitting, do 5 projektów z automatycznym wyrównywaniem procentowym).
- Przejrzyj `locales/en/translation.json` uzupełniając brakujące ciągi dla funkcji zgłaszanych przez nowe funkcje AI-batch.

## 5. Sugestie Ogólne (Funkcjonalność)

- **AI Reinforcement na froncie (Zgłaszane w TODO):** Implementacja jawnej „nauki przez wzmocnienie” w UI. Użytkownik widzi ocenę punktową. Należy dodać wyraźny widget kciuk w górę/w dół dla oceny predykcji, uderzający w nowy endpoint API typu `accept_ai_suggestion` / `penalize_ai_suggestion`, w prosty sposób modyfikujący punktację w `assignment_feedback`.
- **Większe uwiarygodnienie licznika plików:** Zamiast usunięcia, należy ograniczyć zliczanie do plików unikalnych ze sprawdzeniem statusu "modyfikacji na dysku", eliminując w ten sposób tzw. ghost-events generowane np. przez IDE indeksujące folder.

---
**Instrukcje dla kolejnego Agenta wykonującego Implementację:**
Otrzymałeś wytyczne co poprawić. 
Pamiętaj - wdrażaj kod zgodny z zasadą KISS (nie buduj wielowarstwowych abstrakcji dla Rust/Tauri). 
Jako pierwszy krok utwórz plik `plan_implementacji.md` definiując precyzyjny plan ulepszania `tokio::spawn_blocking` dla Tauri Commands oraz podziału plików takich jak [sessions.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/sessions.rs). Wtedy skonsultuj go z użytkownikiem. Wszystkie zmiany w bazie danych muszą opierać się na strukturze [rusqlite](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/db.rs#1483-1494) bez przerywania dostępu do dotychczasowych metadanych (zero drop tables bez migracji).
