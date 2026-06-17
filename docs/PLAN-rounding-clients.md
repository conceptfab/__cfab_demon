# PLAN — Zaokrąglanie czasu + Panel klientów

> Status: zaplanowane (do akceptacji). Dwie niezależne funkcjonalności; mogą iść osobno.
> TIMEFLOW = desktop (Rust daemon + React/TS dashboard). Branding w UI/logach: `TIMEFLOW`.

---

## FUNKCJONALNOŚĆ 1 — Zaokrąglanie czasu (rounding)

> **Status: Faza 1 + 2 + 3 ZAIMPLEMENTOWANE i zweryfikowane (2026-06-13).**
> **Zaokrąglanie jest globalne — pokazywane WSZĘDZIE.** `formatDuration`/`formatDurationSlim`
> ([lib/utils.ts](../dashboard/src/lib/utils.ts)) są świadome ustawień zaokrąglania (czytają
> cache, no-op gdy wyłączone), więc wszystkie ~50 miejsc wyświetlania czasu (listy, tabele,
> wykresy, tooltips, oś czasu, Time Analysis, Aplikacje, karty projektu) zaokrąglają automatycznie.
> Reaktywność przez `triggerRefresh('settings_saved')` — jak przełącznik algorytmu czasu.
> Surowe warianty `formatDurationRaw`/`formatDurationSlimRaw` dla miejsc sterujących trybem same
> (RoundedDuration na Dashboardzie = realny + „≈" zaokrąglony z tooltipem; ReportView = własny
> przełącznik Pełny/Zaokrąglony, czas + skalowana wartość, druk/PDF).
> Poza zakresem: `PmProjectsList` ma własny lokalny formatter nad danymi z solidtime (dane
> zewnętrzne, nie czas śledzony TIMEFLOW) — celowo nietknięty.
> Decyzje: osobna zakładka w Settings; tryb jako **rozszerzalny rejestr wariantów** (`ROUNDING_VARIANTS`,
> teraz 3: per-suma / per-sesja / per-dzień (pełna godzina)); kierunek stały (w górę).
> Weryfikacja: `rounding.test.ts` 12/12 zielone (39/39 cały suite), eslint czysty na nowych plikach,
> `lint:locales` OK, typecheck bez błędów w nowych plikach.

**Co i po co:** Konfigurowalny mechanizm zaokrąglania czasu (zawsze w górę, do wybranego
interwału) z własną zakładką w Ustawieniach. Na dashboardzie czas realny + zaokrąglony obok
(tooltip, gdy się nie mieści), w raportach przełącznik pełny/zaokrąglony. Zaokrąglony czas
wpływa też na wycenę ($). **Implementacja wyłącznie po stronie frontu** — daemon Rust bez zmian
(trzyma surowy czas, zaokrąglamy przy prezentacji).

**Decyzje (ustalone):**
- Tryb przełączalny: per-sesja / per-suma.
- Tylko interwał; kierunek zawsze w górę (ceil).
- Zaokrąglenie wpływa na czas **i** wycenę.

### Algorytm (jedno źródło prawdy)
Nowy plik `dashboard/src/lib/rounding.ts`:

```
roundSeconds(sec, intervalMin):  sec <= 0 ? 0 : ceil(sec / (intervalMin*60)) * intervalMin*60
mode 'per_total'   → suma realnego, potem roundSeconds(suma)
mode 'per_session' → roundSeconds(każdej sesji), potem suma
```

- `RoundingSettings = { enabled, intervalMinutes, mode }`,
  default `{ enabled:false, intervalMinutes:15, mode:'per_total' }`.
- Manager przez istniejący `createSettingsManager` (localStorage) — wzorzec jak `splitSettings`
  w `dashboard/src/lib/user-settings.ts`.
- Stan w `dashboard/src/store/settings-store.ts` (setter `setRoundingSettings`, jak
  `setSplitSettings`) — by komponenty reagowały na żywo.

### Fazy i pliki

**Faza 1 — Rdzeń + Ustawienia** (niskie ryzyko)
- `dashboard/src/lib/rounding.ts` *(nowy)* — algorytm + manager.
- `dashboard/src/store/settings-store.ts` — stan + setter.
- `dashboard/src/components/settings/RoundingCard.tsx` *(nowy)* — toggle on/off,
  select interwału (1/5/6/10/15/30/60 min), radio trybu (per-sesja/per-suma).
- `dashboard/src/pages/Settings.tsx` — nowa zakładka `'rounding'` (rozszerzyć typ `SettingsTab`
  + render karty). [Settings ma już system zakładek: general/sessions/algorithm/sync/pm/advanced.]
- `dashboard/src/pages/Help.tsx` — sekcja „Zaokrąglanie czasu" (co robi / kiedy użyć / że dotyczy
  też wyceny). **Wymagane przez CLAUDE.md.**
- Tłumaczenia (i18n) dla nowych etykiet.

**Faza 2 — Dashboard** (niskie ryzyko)
- `dashboard/src/components/ui/RoundedDuration.tsx` *(nowy)* — realny czas + zaokrąglony obok;
  przy braku miejsca zaokrąglony do tooltipa. Bazuje na `formatDuration` z `dashboard/src/lib/utils.ts`.
- `dashboard/src/pages/Dashboard.tsx` — podmiana wyświetlania `total_seconds`/`avg_daily_seconds`
  (~linie 524/544) na `RoundedDuration`. Gdy `enabled=false` → zachowanie bez zmian.

**Faza 3 — Raporty + wycena** (średnie ryzyko — dotyka Estimates)
- `dashboard/src/pages/Reports.tsx` + `dashboard/src/pages/ReportView.tsx` — przełącznik
  „Pełny / Zaokrąglony"; sekcje czasu i finansów liczone z zaokrąglonych sekund w trybie zaokrąglonym.
- `dashboard/src/lib/report-templates.ts` — zapis wyboru trybu w szablonie (opcjonalnie).
- **Wycena:** zidentyfikować pojedynczy choke-point `seconds → value` (dziś rozproszony;
  `rate-utils.ts` ma tylko parsery). Wprowadzić `computeValue(seconds, rate, multiplier)` i przepuścić
  przez niego wycenę w raporcie i Estimates, podając zaokrąglone sekundy w trybie zaokrąglonym.
  **Główny punkt ryzyka regresji** — Estimates ma roundtrip-testy.

### Testy
- Jednostkowe (`dashboard/src/lib/rounding.test.ts`): `roundSeconds(0)=0`, `roundSeconds(1s,15)=900`,
  `roundSeconds(900,15)=900` (brak nadbicia na granicy), per-session vs per-total dają różne wyniki.
- Manualne: Settings→Zaokrąglanie 15 min/per-suma → Dashboard real + zaokrąglony; tooltip przy wąskiej
  karcie; Reports przełącznik zmienia czas i wartość $; `enabled=false` = zero zmian względem dziś.

### Założenie do potwierdzenia
„Osobna zakładka" = nowa zakładka w istniejącym pasku Settings (`'rounding'`), nie osobny ekran w menu.

---

## FUNKCJONALNOŚĆ 2 — Panel klientów (clients)

> **Status: C1a ZAIMPLEMENTOWANE (2026-06-13)** — działający panel, bez sync (lokalnie).
> Backend: migracja `m24_clients` (tabela `clients` + `projects.client_name` + `projects.status`),
> komendy Tauri: clients_list/create/update/archive/delete, project_set_client, project_set_status,
> projects_with_client, get_clients_summary (reużywa `build_estimate_rows` — wartość z kaskadą stawek).
> UI: `pages/Clients.tsx` + nav „Klienci" — CRUD, przypisywanie projektów (klient + status
> aktywny/zakończony/rozliczony), podsumowania per klient (projekty/czas/wartość, zrealizowane/
> do rozliczenia/w toku) + KPI. Weryfikacja: `cargo check` czysto, `npm run build` ✓, 45 testów.
> **C1b (TODO, sync):** merge `clients` w `sync_common.rs` + tombstone `trg_clients_tombstone`
> w obu lustrach + backup/import + test 2-maszynowy. Do czasu C1b klienci są LOKALNI.

**Co i po co:** Zarządzanie klientami jako pełną encją oraz panel podsumowań: projekty danego klienta
(z kwotami), suma zrealizowanych zleceń, wartość do rozliczenia. Domyka use-case freelancera
(klient → projekty → wycena → rozliczenie).

**Decyzje (ustalone):**
- **Pełna encja Client** w SQLite (nie atrybut, nie front-only) → udział w LAN/online sync + tombstony.
- **Nowy status projektu**: aktywny / zakończony / rozliczony. „Suma zrealizowanych" = projekty rozliczone.

### ⚠️ Ostrzeżenie architektoniczne (sync)
Schema i triggery tombstone mają **lustra daemon ↔ dashboard**, które `merge_incoming_data` DROPuje i
odtwarza przy każdym merge'u. Stała desynchronizacja luster = **cicha utrata danych** (patrz historia
incydentów sync w repo). Każda zmiana schematu/triggera dla `clients` MUSI trafić do obu kopii w tym
samym commicie:
- `src/sync_common.rs` (schema + merge) ↔ mirror schematu po stronie dashboard `src-tauri`.
- `src/tombstone_triggers.rs` ↔ `dashboard/src-tauri/src/db_migrations/tombstone_triggers.rs`.

### Model danych
Nowa tabela `clients` (wzorzec jak `projects` — `name TEXT UNIQUE` jako stabilny klucz sync,
`updated_at` do LWW):

```
CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,        -- klucz sync (jak projects.name)
    contact TEXT,                     -- osoba/e-mail/telefon
    address TEXT,                     -- adres do faktury
    tax_id TEXT,                      -- NIP / VAT id
    currency TEXT,                    -- waluta klienta (fallback: globalna)
    default_hourly_rate REAL,         -- domyślna stawka (kaskada: klient → projekt)
    color TEXT DEFAULT '#38bdf8',
    archived_at TEXT,                 -- soft-archive (NIE delete — projekty trzymają historię)
    created_at TEXT,
    updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
);
```

Zmiany w `projects` (migracja `ALTER TABLE`):
- `client_name TEXT` — powiązanie po nazwie (portable cross-machine, spójne ze wzorcem
  `sessions.project_name`; FK po `id` NIE jest sync-bezpieczny — id różni się per maszyna).
- `status TEXT NOT NULL DEFAULT 'active'` — `active | done | paid`.

Linkowanie po **nazwie** (nie integer id): merge sync reconcile'uje encje po nazwie, jak projekty/aplikacje.

### Powiązanie z Funkcjonalnością 1 (wycena)
Kwoty w panelu klienta liczone przez ten sam `computeValue(seconds, rate, multiplier)` co raporty —
więc gdy zaokrąglanie aktywne, kwoty klienta też respektują zaokrąglony czas. Stawka wg kaskady:
`project.hourly_rate` → `client.default_hourly_rate` → globalna.

### Fazy i pliki

**Faza C1 — Warstwa danych (Rust + mirror)** (wysokie ryzyko — sync)
- `src/sync_common.rs` — `CREATE TABLE clients`, migracja `projects.client_name` + `projects.status`,
  rozszerzenie `merge_incoming_data` o tabelę `clients` (LWW po `updated_at`, dedup po `name`).
- `src/tombstone_triggers.rs` + `dashboard/src-tauri/src/db_migrations/tombstone_triggers.rs` —
  `trg_clients_tombstone` (AFTER DELETE ON clients → tombstone z `OLD.name`). **W obu lustrach.**
- Mirror schematu po stronie dashboard `src-tauri` — identyczny `CREATE TABLE clients` + migracje.
- Tauri commands: `clients_list / clients_create / clients_update / clients_archive / clients_delete`
  oraz `project_set_client / project_set_status`.

**Faza C2 — Backup/Import + sync end-to-end** (wysokie ryzyko)
- Export/import JSON (`/data`) — dodać `clients` i nowe pola projektu do archiwum (+ tombstony klientów).
- Test roundtrip + test merge dwustronny (2 maszyny) — **obowiązkowo przed mergem**, zgodnie z historią
  incydentów utraty danych przy sync.

**Faza C3 — UI: zarządzanie klientami** (niskie/średnie ryzyko)
- `dashboard/src/pages/Clients.tsx` *(nowy)* + wpis w nawigacji/routerze.
- `dashboard/src/components/clients/ClientList.tsx`, `ClientForm.tsx`, `ClientCard.tsx` *(nowe)* —
  CRUD, archiwizacja, dane do faktury, stawka domyślna, waluta, kolor.
- `dashboard/src/lib/clients.ts` *(nowy)* — typy + wywołania Tauri.
- Przypisanie klienta + status na karcie projektu: `dashboard/src/pages/ProjectPage.tsx`,
  `dashboard/src/components/project/*` (selektor klienta, selektor statusu aktywny/zakończony/rozliczony).

**Faza C4 — Podsumowania klienta** (niskie/średnie ryzyko)
- Widok szczegółów klienta (`ClientOverview`): lista projektów klienta z kwotami; KPI:
  - liczba projektów (wg statusu),
  - suma godzin (respektuje zaokrąglanie z Funkcjonalności 1),
  - wartość: **zrealizowana (paid)** / **do rozliczenia (done, nie-paid)** / **w toku (active)**,
  - % rozliczenia.
- Filtr „klient" jako nowy wymiar w `Reports.tsx` (grupowanie/filtrowanie po kliencie).

**Faza C5 — Eksport per klient** (opcjonalne, średnie ryzyko)
- Generowanie zestawienia/„faktury roboczej" per klient (PDF/XLSX) — reuse istniejącego eksportu raportów;
  dane nagłówka z encji klienta (nazwa, adres, NIP, waluta).

### Co jeszcze istotne (rekomendacje wbudowane wyżej)
- **Kaskada stawek** klient → projekt (mini-wersja wzorca z solidtime) — naturalne miejsce na domyślną
  stawkę klienta; spina się z wyceną z Funkcjonalności 1.
- **Waluta per klient** — agencja z klientami w różnych walutach.
- **Soft-archive zamiast delete** — usunięcie klienta nie może osierocić historii projektów.
- **Dane do faktury** (adres, NIP) — bez nich „panel klientów" nie domyka rozliczeń.
- **Klient jako wymiar raportu** — największa wartość analityczna małym kosztem (po C1).

### Testy
- Rust: test schematu + migracji `projects`, test merge `clients` (LWW, tombstone delete),
  test roundtrip backup z klientami.
- Sync dwustronny na 2 maszynach (manualnie) — brak utraty danych po sync w obie strony.
- UI: CRUD klienta, przypisanie do projektu, zmiana statusu, KPI podsumowania zgodne z ręcznym wyliczeniem.
- `Help.tsx` zaktualizowany (panel klientów, statusy projektu).

---

## Sekwencja i ryzyko (rekomendacja)

1. **Funkcjonalność 1 (Faza 1–2)** — szybkie, frontowe, zero ryzyka sync. Dobry start.
2. **Funkcjonalność 1 (Faza 3, wycena)** — wprowadza `computeValue` (potrzebny też klientom).
3. **Funkcjonalność 2 (C1–C2)** — najcięższe i sync-wrażliwe; robić ostrożnie, z testami merge,
   zanim dotknie się UI. Nie mergować bez testu dwustronnego.
4. **Funkcjonalność 2 (C3–C5)** — UI i podsumowania na gotowej, przetestowanej warstwie danych.

Funkcjonalność 1 jest niezależna i może wejść w całości przed rozpoczęciem Funkcjonalności 2.
