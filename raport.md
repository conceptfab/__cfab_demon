# TIMEFLOW — Raport z audytu kodu

**Data:** 2026-03-09
**Wersja:** 0.1.511 (branch: next)
**Zakres:** logika, wydajność, optymalizacje, nadmiarowy kod, tłumaczenia, Help/Pomoc

---

## Podsumowanie

| Obszar | Ocena | Uwagi |
|--------|-------|-------|
| Jakość kodu (dashboard) | 8.5/10 | Doskonała organizacja, memoizacja, lazy loading |
| Jakość kodu (Rust daemon) | 7.5/10 | Solidny, ale z krytycznymi problemami w tracker.rs |
| Tłumaczenia (i18n) | 9/10 | 1615 kluczy PL/EN, 1 naruszenie w Help.tsx |
| Dokumentacja Help | 8/10 | 12 sekcji, kilka brakujących opisów |
| Wydajność | 7/10 | Problemy z I/O w pętlach, zbędne alokacje |
| Bezpieczeństwo | 9.5/10 | Brak luk, lokalne dane, brak sekretów |

**Znaleziono:** 3 problemy krytyczne, 6 wysokich, 10 średnich, 8 niskich.

---

## 1. PROBLEMY KRYTYCZNE

### 1.1 Podwójne naliczanie czasu (tracker.rs)

**Pliki:** `src/tracker.rs` (linie ~305-328, ~363-375)

**Problem:** Gdy aplikacja jest jednocześnie na pierwszym planie (foreground) i ma wysokie zużycie CPU, czas jest naliczany podwójnie — raz jako aktywność foreground, raz jako aktywność background.

**Przykład:**
- VS Code na pierwszym planie przez 10s, CPU > próg
- Foreground: `total_seconds += 10`
- Background (CPU): `total_seconds += 10`
- Dashboard pokazuje 20s zamiast 10s

**Sugerowane rozwiązanie:** Śledzić które aplikacje zostały policzone jako foreground i pomijać je w pętli background.

```rust
// Dodać HashSet<String> foreground_recorded przed pętlą background
let mut foreground_recorded = HashSet::new();
// Po record_app_activity w foreground:
foreground_recorded.insert(exe_name.clone());
// W pętli background:
if !foreground_recorded.contains(&exe_name) && cpu_fraction > cpu_thresh {
    record_app_activity(...);
}
```

---

### 1.2 Obcinanie czasu ukrywa luki (tracker.rs)

**Plik:** `src/tracker.rs` (linie ~283-284)

**Problem:** Czas między tickami jest ograniczany do `3 × poll_interval` (30s przy poll=10s). Jeśli monitoring zatrzyma się na >30s (np. przez blokujący DB timeout w config.rs), luka czasowa jest ukryta — sesja wygląda na ciągłą, ale `total_seconds` jest zaniżone.

**Sugerowane rozwiązanie:** Nie obcinać elapsed, zamiast tego wykrywać luki i tworzyć przerwę w sesji:
```rust
if actual_elapsed > session_gap {
    // zakończ bieżącą sesję, rozpocznij nową
}
```

---

### 1.3 2000ms timeout DB blokuje wątek trackera (config.rs)

**Plik:** `src/config.rs` (linie ~131-137)

**Problem:** `config::load()` otwiera bazę dashboard z `busy_timeout(2000ms)`. Jest wywoływane co 30s z wątku trackera. Jeśli dashboard pisze do bazy w tym samym czasie, tracker blokuje się na do 2 sekund — powodując utratę próbek aktywności.

**Sugerowane rozwiązanie:**
- Zmniejszyć timeout do 100-200ms
- Lub ładować konfigurację asynchronicznie w osobnym wątku
- Fallback do ostatniej prawidłowej konfiguracji przy timeoucie

---

## 2. PROBLEMY WYSOKIE

### 2.1 Brak cache'a attention.txt w tray.rs

**Plik:** `src/tray.rs` (linia ~214)

Plik `attention.txt` jest czytany z dysku co 5 sekund (17 280 odczytów/dobę). Brak cache'owania — powinien sprawdzać czas modyfikacji pliku i czytać tylko gdy się zmieni.

### 2.2 Process snapshot w tray timer (tray.rs)

**Plik:** `src/tray.rs` (linia ~267)

`build_process_snapshot()` (kosztowna operacja WMI) jest wywoływany co 5s w timerze tray, nawet gdy dashboard już działa. Powinien być cache'owany z TTL 10-15s.

### 2.3 Nieefektywna alokacja w truncate_middle() (storage.rs)

**Plik:** `src/storage.rs` (linie ~79-95)

Każde wywołanie alokuje `Vec<char>` nawet jeśli tekst nie wymaga skracania. Wywoływana dla każdego file entry (nazwy, ścieżki, tytuły okien) — tysiące alokacji na każdy zapis.

**Fix:** Sprawdzić `value.chars().count()` przed alokacją Vec, lub użyć indeksów bajtowych.

### 2.4 O(n²) w wyszukiwaniu potomków procesów (monitor.rs)

**Plik:** `src/monitor.rs` (linie ~670-676)

- `visited` HashSet jest czyszczony dla KAŻDEJ aplikacji (zamiast raz po pętli)
- `root_pids.contains()` na Vec to O(n) per call — powinien być HashSet
- Razem daje O(n·m) zamiast O(n+m)

### 2.5 Duże pliki komponentów (Sessions.tsx, Projects.tsx)

**Pliki:** `dashboard/src/pages/Sessions.tsx` (~87KB), `dashboard/src/pages/Projects.tsx` (~87KB)

Oba pliki są bardzo duże, co utrudnia utrzymanie i testowanie. Powinny być podzielone na 4-6 mniejszych komponentów.

### 2.6 Stale refs w AI.tsx

**Plik:** `dashboard/src/pages/AI.tsx`

```typescript
const showErrorRef = useRef(showError);    // nie aktualizuje się przy zmianie języka
const translateRef = useRef(tr);           // nie aktualizuje się przy zmianie języka
```

Gdy użytkownik zmieni język, komunikaty błędów nadal używają starego tłumaczenia. Fix: użyć bezpośrednio `showError`/`tr` z proper dependency w useEffect.

---

## 3. PROBLEMY ŚREDNIE

### 3.1 Brak logowania błędów zapisu przy zamykaniu (tracker.rs ~248)
```rust
let _ = storage::save_daily(&mut daily_data); // cichy błąd
```
Powinno logować `log::error!` przy nieudanym zapisie.

### 3.2 WMI reconnect bez backoff (monitor.rs ~233-254)
Reconnect przy każdym błędzie bez cooldownu — może powodować thrashing.

### 3.3 Brak cache'a języka w i18n.rs
`load_language()` czyta plik z dysku przy każdym wywołaniu. Powinien cache'ować wynik.

### 3.4 Powtórzony wzorzec walidacji interwałów (config.rs ~286-350)
`clamp_interval_secs()` wywoływany 6× z tym samym wzorcem. Można zastąpić tablicą danych + pętlą.

### 3.5 Klonowanie całej struktury w to_stored_daily() (storage.rs ~153-193)
Każdy zapis (co 5 min) klonuje wszystkie pola AppDailyData. Przy dużej liczbie plików/sesji to sporo alokacji.

### 3.6 Brak powiadomień użytkownika o błędach (~45 instancji w dashboard)
Wiele `catch` bloków loguje do `console.error` bez `showError()` — użytkownik nie wie że operacja się nie powiodła.

### 3.7 Brak memoizacji komponentów wykresów
`TimelineChart`, `TopAppsChart`, `AllProjectsChart`, `ProjectDayTimeline` — nie opakowane w `React.memo()`.

### 3.8 Brak logowania źródła konfiguracji (config.rs)
Nie loguje czy konfiguracja pochodzi z DB czy JSON fallback.

### 3.9 actual_elapsed może być zero (tracker.rs ~284)
Jeśli `actual_elapsed.is_zero()`, aktywność nadal jest rejestrowana — mogą powstać sesje z zerowym czasem trwania.

### 3.10 Cichy błąd uruchamiania dashboard (tray.rs ~357)
Gdy `cmd.spawn()` w tray się nie powiedzie, error path jest pusty — brak logowania.

---

## 4. PROBLEMY NISKIE

| # | Problem | Plik | Opis |
|---|---------|------|------|
| 4.1 | `has_utf16_replacement_char()` do inlinowania | monitor.rs ~105-109 | 3-liniowa funkcja mogłaby być `.contains('\u{FFFD}')` |
| 4.2 | Brak walidacji formatu daty w DailyData | storage.rs | Nie sprawdza formatu YYYY-MM-DD |
| 4.3 | Niespójne komentarze (PL vs EN) | single_instance.rs | Angielskie komentarze, reszta po polsku |
| 4.4 | Brak per-page Error Boundary | dashboard/src/pages/ | Tylko globalna obsługa błędów |
| 4.5 | Niespójny format logowania błędów | dashboard (~85 instancji) | Różne formaty console.error |
| 4.6 | Niezwiązane arrow functions w JSX | różne strony (~20 instancji) | Nowa funkcja przy każdym renderze |
| 4.7 | Brak aria-label na icon buttons | ~30 instancji | Dostępność |
| 4.8 | Prisma w root package.json nieużywana | package.json | `@prisma/client` i `prisma` — dashboard używa Tauri/SQLite |

---

## 5. TŁUMACZENIA (i18n)

### Status ogólny: BARDZO DOBRY

| Metryka | Wartość |
|---------|---------|
| Klucze EN | 1 615 |
| Klucze PL | 1 615 |
| Balans | 100% (identyczna struktura) |
| Skrypty walidacji | `lint:i18n-hardcoded`, `lint:inline-i18n-bridge`, `sync:inline-i18n` |

### Naruszenie: Hardcoded polski tekst w Help.tsx

**Plik:** `dashboard/src/pages/Help.tsx` (linie ~597-620)

**Problem:** W sekcji "Optimal Learning Settings" (AI & Model) znajdują się hardcoded polskie teksty widoczne w trybie angielskim:

```
"2. Suggest Min Confidence: 0.4 - 0.5 (Zmniejsz obecne 0.6)"
```

To narusza regułę projektu: *"Help (EN) i Pomoc (PL) muszą mieć identyczną treść — każdy opis musi mieć parę PL + EN."*

**Fix:** Wyciągnąć ~20 hardcoded stringów do kluczy tłumaczeń w `locales/en/common.json` i `locales/pl/common.json`, zastąpić wywołaniami `t18n('klucz')`.

### Brakujące/niekompletne tłumaczenia

Nie znaleziono brakujących kluczy w plikach `common.json`. Jedyny problem to hardcoded tekst w Help.tsx opisany powyżej.

---

## 6. FUNKCJONALNOŚCI BRAKUJĄCE W HELP

Porównanie faktycznych funkcji aplikacji z opisami w Help.tsx:

### Obecne w aplikacji, brakujące lub niepełne w Help:

| # | Funkcja | Strona | Status w Help |
|---|---------|--------|---------------|
| 1 | **BugHunter** — szybkie zgłaszanie błędów z załącznikami | Sidebar (BugHunter.tsx) | Tylko wzmianka w Settings jako "BugHunter quick reporting" — brak opisu jak używać, co zawiera raport, limity plików |
| 2 | **Import z drag & drop** — FileDropzone z walidacją | ImportPage.tsx | Brak opisu w sekcji Data — Help opisuje import ogólnie, nie wspomina o drag & drop, formatach walidacji ani limitach |
| 3 | **Demo Mode** — osobna baza SQLite, zachowanie sync | Settings → DemoModeCard | Wspomniany w Settings features, ale brak wyjaśnienia: co robi, kiedy użyć, jak wpływa na sync, czy dane demo są trwałe |
| 4 | **Online Sync** — szczegóły mechanizmu | Settings → OnlineSyncCard | Help wymienia 7 features, ale brak opisu: co dzieje się przy konflikcie, format danych, jak wygenerować token, co to ACK, scenariusz "pruned snapshot" |
| 5 | **Session Split (Multi)** — zaawansowany podział sesji | Sessions → MultiSplitSessionModal | Help wspomina o split i nożyczkach, ale brak opisu multi-split: jak działa AI suggestion, czym jest "leader", co oznacza "custom part" i "sum" |
| 6 | **Project Compaction** — kompresja danych projektu | ProjectPage.tsx | Wspomniany w Help "Project data compaction", ale brak opisu co dokładnie robi, kiedy używać, czy jest odwracalny |
| 7 | **Highlight Color** — personalizacja koloru podświetlenia | Settings → AppearanceCard | Wspomniany jako feature "Highlight color selection" ale bez opisu co podświetla i gdzie jest widoczny |
| 8 | **Chart context menu** w ProjectPage | ProjectPage.tsx | Wspomniany w Projects "Chart context menu" ale brak opisu jakie akcje zawiera |
| 9 | **Auto-optimize DB scheduling** | Settings → DatabaseManagement | Feature wymieniony, brak opisu co optymalizuje, jak często, czy wpływa na wydajność |
| 10 | **QuickStart — auto-clear first-run hint** | QuickStart.tsx | Wspomniany w Help, ale użytkownik nie wie jak ponownie uruchomić tutorial |

### Sekcje Help z niekompletnymi opisami:

| Sekcja | Brak |
|--------|------|
| AI & Model | Sekcja K.4 "Optimal Learning Settings" ma hardcoded tekst (nie tłumaczony) |
| Sessions | Brak opisu widoku "compact" vs "detailed" vs "AI data" — czym się różnią |
| Reports | Brak opisu jakie dane zawiera każda sekcja raportu (header, stats, financials, apps) |
| Data | Brak informacji o formacie eksportu ZIP, co zawiera, jak importować z powrotem |

---

## 7. NADMIAROWY KOD

### Dashboard (React)

| Stwierdzenie | Wynik |
|--------------|-------|
| Dead code (nieużywane funkcje/zmienne) | **Brak** ✓ |
| Nieużywane importy | **Brak** ✓ |
| Zakomentowany kod | **Brak** ✓ |
| Zduplikowane komponenty | **Brak** ✓ |

Dashboard jest czysty — brak nadmiarowego kodu.

### Rust Daemon

| Element | Plik | Opis |
|---------|------|------|
| `has_utf16_replacement_char()` | monitor.rs | Można zinlineować jako `.contains('\u{FFFD}')` |
| 6× powtórzony wzorzec `clamp_interval_secs` | config.rs | Można zastąpić data-driven podejściem |
| Podwójne sprawdzanie istnienia tabeli + fetch | config.rs | Można połączyć w jedno zapytanie z obsługą błędu |
| Zbędne klonowanie `root_pids` | monitor.rs ~663 | `initial_pids.clone()` — wystarczy referencja |
| Powtórzony wzorzec `sanitize_optional_path` | tracker.rs | Identyczny kod w 2-3 miejscach |

### Root: Nieużywane zależności

**`package.json` (root):**
```json
"@prisma/client": "^7.4.1",
"prisma": "^7.4.1"
```
Dashboard korzysta z Tauri/SQLite bezpośrednio. Prisma wydaje się nieużywana — do weryfikacji i ewentualnego usunięcia.

---

## 8. SUGEROWANE OPTYMALIZACJE (priorytetyzowane)

### Natychmiast (krytyczne)

| # | Optymalizacja | Plik | Oczekiwany efekt |
|---|---------------|------|------------------|
| 1 | Naprawić podwójne naliczanie czasu | tracker.rs | Poprawność danych — eliminacja inflacji czasu |
| 2 | Naprawić obcinanie elapsed → wykrywanie luk | tracker.rs | Poprawne sesje, brak ukrytych przerw |
| 3 | Zmniejszyć DB timeout do 100-200ms | config.rs | Brak blokowania trackera |

### Następny sprint (wysokie)

| # | Optymalizacja | Plik | Oczekiwany efekt |
|---|---------------|------|------------------|
| 4 | Cache attention.txt (mtime check) | tray.rs | -17K odczytów dysku/dobę |
| 5 | Cache process snapshot w tray (TTL 10s) | tray.rs | Mniej kosztownych WMI calls |
| 6 | Optymalizacja truncate_middle() | storage.rs | Tysiące mniej alokacji/zapis |
| 7 | HashSet zamiast Vec w descendant filter | monitor.rs | O(n+m) zamiast O(n²) |
| 8 | Podział Sessions.tsx i Projects.tsx | dashboard | Łatwiejsze utrzymanie |

### Średni priorytet

| # | Optymalizacja | Plik | Oczekiwany efekt |
|---|---------------|------|------------------|
| 9 | React.memo na komponentach wykresów | dashboard | ~5-10% mniej renderów |
| 10 | showError() w catch blokach | dashboard (~45 miejsc) | Lepsze UX |
| 11 | Cache języka w i18n.rs | i18n.rs | Mniej I/O |
| 12 | WMI reconnect z backoff | monitor.rs | Stabilność |
| 13 | Logowanie źródła konfiguracji | config.rs | Łatwiejszy debugging |

---

## 9. TESTY

### Stan obecny

| Obszar | Testy |
|--------|-------|
| Rust daemon | 2 testy w storage.rs (`truncate_middle`, `prepare_daily_for_storage`) |
| Dashboard | Brak (vitest skonfigurowany, ale brak plików testowych poza `projects-all-time.test.ts`) |

### Rekomendacja

Priorytetowo dodać testy dla:
1. `tracker.rs` — logika sesji, foreground/background, gap detection
2. `config.rs` — ładowanie z DB, fallback do JSON, walidacja
3. `storage.rs` — zapis/odczyt, migracja, truncation
4. Stores (Zustand) — data-store throttling, settings persistence

---

## 10. PODSUMOWANIE PRIORYTETÓW

```
KRYTYCZNE (naprawić natychmiast):
├── [K1] Podwójne naliczanie czasu foreground+CPU (tracker.rs)
├── [K2] Obcinanie elapsed ukrywa luki monitoringu (tracker.rs)
└── [K3] 2000ms DB timeout blokuje tracker (config.rs)

WYSOKIE (przed produkcją):
├── [W1] Cache attention.txt w tray.rs
├── [W2] Cache process snapshot w tray timer
├── [W3] Optymalizacja truncate_middle() (storage.rs)
├── [W4] O(n²) → O(n) w descendant filter (monitor.rs)
├── [W5] Podział Sessions.tsx i Projects.tsx
└── [W6] Fix stale refs w AI.tsx

ŚREDNIE (jakość):
├── [S1] Hardcoded PL tekst w Help.tsx → klucze i18n
├── [S2] showError() w ~45 catch blokach
├── [S3] React.memo na chart components
├── [S4] Uzupełnić opisy w Help (10 brakujących)
├── [S5] WMI backoff w monitor.rs
└── [S6] Testy jednostkowe dla tracker.rs, config.rs

NISKIE (polish):
├── [N1] Inline has_utf16_replacement_char()
├── [N2] Usunąć Prisma z root package.json (jeśli nieużywana)
├── [N3] aria-label na icon buttons
└── [N4] Ujednolicić format logowania błędów
```

---

*Raport wygenerowany automatycznie na podstawie analizy kodu źródłowego.*
