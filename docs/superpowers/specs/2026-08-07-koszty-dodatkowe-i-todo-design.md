# Koszty dodatkowe + TODO — design

Data: 2026-08-07
Status: zaakceptowany (do rozpisania planu implementacji)

## 1. Cel

Dwie funkcje w TIMEFLOW:

1. **Koszty dodatkowe** — kwota z konkretną datą i komentarzem, przypięta do projektu,
   uwzględniana w rozliczeniach, estymacjach i raportach z respektowaniem wybranego okresu.
2. **TODO** — lista zadań z podziałem na zakresy globalny / klient / projekt, jako drugi
   pod względem ważności ekran dashboardu.

Obie encje muszą przechodzić przez istniejącą synchronizację LAN i online.
Opcjonalnie: jednokierunkowy push zadań do Google Calendar.

## 2. Ustalenia (rozstrzygnięcia z brainstormingu)

| Pytanie | Decyzja |
|---|---|
| Semantyka kosztu | **Zawsze doliczany klientowi** — powiększa wartość rozliczenia. Bez trybu „koszt własny". |
| Przypięcie kosztu | **Zawsze do projektu.** Poziom klienta wynika z rollupu po `projects.client_name`. |
| Zakres TODO | **Czysta lista zadań.** Bez powiązania z sesjami, bez liczenia czasu per zadanie. |
| Google Calendar | **Jednokierunkowo TODO → GCal**, opcjonalny moduł w osobnej fazie. |

Odrzucone warianty:

- Koszt jako `manual_session` z kwotą — miesza pieniądze z czasem, psuje wykresy,
  liczniki sesji i `time_algorithm`.
- Koszt jako stałe pole w `projects` — nie spełnia wymogu „konkretny termin" ani
  filtrowania po okresach.
- Osobny ekran „Koszty" — nawigacja ma już 11 pozycji, a koszt bez kontekstu projektu
  jest bezużyteczny.
- Feed ICS zamiast OAuth — Google odświeża zewnętrzne kalendarze ICS nawet do 24 h,
  co dla zadań z terminem jest bezużyteczne.
- Powiązanie zadań z sesjami — dotykałoby `time_algorithm`, `session_project_cache`
  i sync sesji. Osobny projekt, poza tym specem.

## 3. Model danych — migracja `m26`

Jedna migracja tworzy obie tabele, oba triggery tombstone (§4) i dwa triggery
kaskady zmiany nazwy projektu (§5). Lustro w
`dashboard/src-tauri/resources/sql/schema.sql`.

```sql
CREATE TABLE IF NOT EXISTS project_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  cost_date TEXT NOT NULL,
  amount REAL NOT NULL,
  comment TEXT,
  created_at TEXT,
  updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
);
CREATE INDEX IF NOT EXISTS idx_project_costs_project_date
  ON project_costs(project_name, cost_date);
CREATE INDEX IF NOT EXISTS idx_project_costs_updated_at
  ON project_costs(updated_at);

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  project_name TEXT,
  client_name TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  due_date TEXT,
  due_time TEXT,
  priority INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  completed_at TEXT,
  sort_order REAL,
  gcal_event_id TEXT,
  gcal_synced_at TEXT,
  created_at TEXT,
  updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
);
CREATE INDEX IF NOT EXISTS idx_todos_status_due ON todos(status, due_date);
CREATE INDEX IF NOT EXISTS idx_todos_updated_at ON todos(updated_at);
```

### Reguły pól

- `uid` — UUID v4 generowany przy tworzeniu rekordu; **klucz synchronizacji**.
  Klucz naturalny nie istnieje: dwa koszty tego samego dnia o tej samej kwocie
  muszą być rozróżnialne, dwa zadania mogą mieć identyczny tytuł.
- `project_name` / `client_name` — link po **nazwie**, nie po `id`. `id` różni się
  między maszynami; ten sam wybór zrobiono dla `projects.client_name` w m24.
- Brak `FOREIGN KEY` na `projects` — link jest po nazwie, więc kaskada nie zadziała.
  Konsekwencja: usunięcie projektu musi jawnie sprzątać powiązane rekordy
  (patrz §5, „Sprzątanie sierot").
- `amount` — wymagane, `>= 0`, walidowane w komendzie. Waluta **nie jest przechowywana
  na wpisie**: backend zwraca gołe `f64`, a formatowanie walutowe robi wspólny
  formatter w `dashboard/src/lib/utils.ts` na podstawie `loadCurrencySettings`
  (`user-settings.ts`, PLN/EUR/USD). Dokładnie ten sam model, co dla wartości
  estymacji — koszt nie wprowadza własnej ścieżki walutowej.
- `cost_date` — `YYYY-MM-DD`. Format zgodny z `session_date`, więc wpada w istniejący
  filtr okresu bez zmian w API.
- `scope` — `'global' | 'client' | 'project'`. Dla `'project'` wymagane `project_name`,
  dla `'client'` wymagane `client_name`, dla `'global'` oba `NULL`. Walidacja w komendzie.
- `priority` — `0` niski, `1` normalny, `2` wysoki.
- `status` — `'open' | 'done'`; przejście na `'done'` ustawia `completed_at`.
- `sort_order` — `REAL`, do ręcznej kolejności w obrębie grupy (wstawianie między
  sąsiadów bez przenumerowania całej listy).
- `gcal_event_id`, `gcal_synced_at` — obecne w schemacie od m26, żeby faza 3 nie
  wymagała kolejnej migracji. Puste dopóki moduł GCal nie jest włączony.

## 4. Synchronizacja

Obie tabele idą wzorcem encji `clients` (m24 + m25). Migracja m24 wprowadziła
regresję opisaną w `PARITY.md` — dodała tabelę, ale nie wpięła jej w sync, przez co
po synchronizacji ginęły przypisania klientów, a usunięci klienci wracali. Poniższa
lista to komplet punktów wpięcia; pominięcie któregokolwiek powtarza tamten błąd.

1. **Migracja + lustro** — `m26` w `dashboard/src-tauri/src/db_migrations/`,
   ten sam DDL w `resources/sql/schema.sql`.
2. **Triggery tombstone** — `PROJECT_COSTS_TOMBSTONE_TRIGGER_SQL` i
   `TODOS_TOMBSTONE_TRIGGER_SQL` w `shared/sync/triggers.rs`, `sync_key = OLD.uid`.
   Tablice `DROP_ALL_TOMBSTONE_TRIGGERS_SQL` i `CREATE_ALL_TOMBSTONE_TRIGGERS_SQL`
   rosną z `[&str; 5]` do `[&str; 7]`; test `create_and_drop_arrays_are_aligned`
   pilnuje spójności. Lustro w `src/tombstone_triggers.rs`.
   Uwaga: `merge_incoming_data` DROP-uje i CREATE-uje triggery przy każdym merge,
   więc rozjazd kopii cicho downgrade'uje trigger.
3. **Merge** — `merge_project_costs` i `merge_todos` w `shared/sync/merge.rs`.
   Last-writer-wins po `updated_at`, identyfikacja po `uid`, `local_tombstone_covers`
   blokuje wskrzeszenie skasowanego rekordu. Wzorzec: `merge_clients`.
4. **Eksport delty** — `project_costs` i `todos` w `DeltaArchive` w
   `dashboard/src-tauri/src/commands/delta_export.rs`, wraz z licznikami w logu.
5. **Lista tabel** — `"project_costs"`, `"todos"` w `src/lan_common.rs:206`.
6. **Obrona demona** — `ensure_project_costs_table` / `ensure_todos_table`
   w `src/sync_common.rs`. Demon może wystartować przed migracją dashboardu.
7. **Checksum** — obie tabele w `shared/sync/checksum.rs` jako content-hash, żeby
   rozjazd był wykrywany i leczył się sam, zamiast wyglądać na „zsynchronizowane".
8. **Backup** — `import_data` obsługuje obie tabele; brak klucza w archiwum
   (starsza wersja) nie kasuje lokalnych rekordów.

### Mieszane wersje

Peer ze starszą wersją TIMEFLOW nie zna obu tabel: jego archiwum ich nie zawiera,
a nasze klucze ignoruje. Skutek — koszty i zadania nie propagują się, dopóki obie
maszyny nie zostaną zaktualizowane. Nie ma ryzyka utraty danych: nieznane klucze są
pomijane, nie nadpisują lokalnych rekordów. Do udokumentowania w `PARITY.md`.

`gcal_event_id` i `gcal_synced_at` **nie wchodzą** do eksportu delty ani do merge —
są per-maszyna. Gdyby się synchronizowały, dwa urządzenia z włączonym GCal biłyby
się o to samo wydarzenie.

## 5. Backend

Nowe moduły komend: `commands/costs.rs`, `commands/todos.rs` (rejestracja w `mod.rs`
i w `lib.rs` na liście `invoke_handler`).

### Komendy

- `costs_list(project_name, date_range) -> Vec<CostRow>`
- `costs_create(project_name, cost_date, amount, comment) -> CostRow`
- `costs_update(uid, cost_date, amount, comment) -> CostRow`
- `costs_delete(uid)`
- `todos_list(filters) -> Vec<TodoRow>` — filtry: `scope`, `project_name`,
  `client_name`, `status`, `search`
- `todos_create(...) -> TodoRow`
- `todos_update(uid, ...) -> TodoRow`
- `todos_set_status(uid, status)`
- `todos_reorder(uid, sort_order)`
- `todos_delete(uid)`

Każdy zapis ustawia `updated_at` na bieżący UTC w formacie SQLite (`YYYY-MM-DD HH:MM:SS`),
zgodnie z `shared/sync/timestamp.rs` — inaczej LWW nie zadziała.

### Wpięcie w rozliczenia

Rozszerzenia typów w `commands/types.rs`, wszystkie addytywne:

- `EstimateProjectRow` += `costs_value: f64`, `costs_count: i64`.
  `estimated_value` **bez zmian** — nadal wyłącznie czas × stawka.
- `EstimateSummary` += `total_costs: f64`, `grand_total: f64`
  (`grand_total = total_value + total_costs`).
- `ProjectReportData` += `costs: Vec<CostRow>`, `costs_total: f64`.

Rozdzielenie `estimated_value` od `costs_value` jest celowe: zaokrąglanie czasu
w trybie `per_day` operuje na sekundach i nie może dotykać kwot, a wykresy oraz
`daily_seconds` zostają nietknięte. Stare raporty i archiwa dają `costs_value = 0`,
więc zmiana jest w pełni wstecznie kompatybilna.

Filtr okresu: `cost_date BETWEEN ?start AND ?end`, obie granice włącznie — dokładnie
jak `session_date`. Preset `all_time` pomija warunek. `dashboard/src/lib/report-period.ts`
i presety `all_time / this_month / last_month / custom` zostają bez zmian.

Rollup na klienta: koszty projektów danego klienta sumują się w raporcie klienta
przez `projects.client_name`, tą samą ścieżką co godziny w Estymacjach.

### Sprzątanie sierot i kaskada zmiany nazwy

Link po nazwie zamiast po `id` oznacza, że kasowanie i zmiana nazwy muszą być
obsłużone jawnie. Repo ma na to dwa różne, ustalone wzorce i spec trzyma się obu:

**Zmiana nazwy projektu → trigger.** m20 i m23 kaskadują rename projektu triggerami
(`trg_projects_rename_cascade_sessions`, `trg_projects_rename_cascade_merged`). m26
dokłada analogiczne `trg_projects_rename_cascade_costs` i
`trg_projects_rename_cascade_todos`:

```sql
CREATE TRIGGER trg_projects_rename_cascade_costs
AFTER UPDATE OF name ON projects
FOR EACH ROW WHEN OLD.name <> NEW.name
BEGIN
    UPDATE project_costs
    SET project_name = NEW.name, updated_at = datetime('now')
    WHERE project_name = OLD.name;
END;
```

Aktualizacja `updated_at` jest konieczna, żeby zmiana rozeszła się przez LWW.
Triggery rename są niezależne od tombstone'ów, więc cykl DROP/CREATE w
`merge_incoming_data` ich nie dotyka.

**Zmiana nazwy klienta → komenda.** `clients_update` w `commands/clients.rs` już
kaskaduje rename na `projects.client_name` w kodzie komendy (nie triggerem).
Dokładamy tam analogiczny `UPDATE todos SET client_name = ... WHERE client_name = ...`
z odświeżeniem `updated_at`.

**Usuwanie.** Komenda usuwania projektu kasuje jego `project_costs` i `todos`
o `scope='project'`; komenda usuwania klienta kasuje `todos` o `scope='client'`.
Kasowanie idzie przez `DELETE`, więc triggery tombstone zapiszą usunięcie i sync je
rozniesie do pozostałych maszyn.

## 6. UI — koszty dodatkowe

Bez nowego ekranu w nawigacji.

- **Karta projektu** (`pages/ProjectPage.tsx` / `ProjectPageView.tsx`) — sekcja
  „Koszty dodatkowe": tabela (data, kwota, komentarz, akcje) + przycisk dodawania.
  Dialog dodawania/edycji wzorowany na `components/ManualSessionDialog.tsx`, ze stanem
  wyniesionym do `*-state.ts` zgodnie z konwencją repo.
- **Estymacje** (`pages/Estimates.tsx` + `estimates-page-state.ts`) — kolumna „Koszty"
  w tabeli projektów i wiersz podsumowania `Czas … + Koszty … = Razem …`.
- **Raport projektu** (`pages/ReportView.tsx`) — blok pozycji kosztowych z okresu
  wraz z sumą, w sekcji rozliczenia.
- **Raport klienta** — suma kosztów projektów klienta w tym samym okresie.

Stany loading / empty / error w każdym z tych miejsc. Warianty desktop i mobile wg
wzorca `*DesktopTable` + `*MobileList` znanego z `components/pm/` — ten sam kod jest
serwowany przez webui na telefon.

## 7. UI — ekran TODO

Nowa pozycja `todo` w `dashboard/src/lib/sidebar-nav-items.ts` **na pozycji 2**,
między `dashboard` a `sessions`. Nowy `case 'todo'` w `PageRouter` w `App.tsx`
z lazy importem, jak pozostałe strony.

Struktura plików wg konwencji repo:

- `pages/Todo.tsx` — cienki komponent spinający kontroler z widokiem
- `pages/todo/TodoPageView.tsx`, `pages/todo/todo-page-state.ts`
- `hooks/useTodoPageController.ts`
- `components/todo/` — lista, wiersz zadania, dialog edycji, panel zakresów,
  toolbar, warianty desktop/mobile

Układ kopiuje parę Clients → ClientPage: lewy panel zakresów
(Wszystkie / Globalne / Klienci ▸ / Projekty ▸), prawa lista zadań pogrupowana
wg terminu: **Zaległe / Dziś / Ten tydzień / Później / Bez terminu**. W obrębie grupy
sortowanie po `priority` malejąco, potem po `sort_order`. Toolbar: szukajka po tytule,
filtr statusu, przełącznik „pokaż zrobione".

Grupowanie po terminie jest czystą funkcją (`lib/todo-grouping.ts`) — testowalną
bez renderowania.

Spójność poza ekranem:

- widżet „najbliższe terminy" na Dashboardzie (zadania otwarte z terminem ≤ 7 dni
  plus zaległe),
- sekcja zadań w karcie projektu (`scope='project'`) i w karcie klienta
  (`scope='client'`).

## 8. Google Calendar (faza 3, opcjonalna)

Jednokierunkowo: zadanie → wydarzenie. Zadanie bez `due_date` nie jest wysyłane.

- Zakres OAuth: `https://www.googleapis.com/auth/calendar.events`.
- Flow: OAuth2 z przekierowaniem na loopback (lokalny port).
- **Client ID i Client Secret podaje użytkownik** w Ustawieniach. Repo nie może
  nieść sekretów (CLAUDE.md §4). Refresh token trafia do `commands/secure_store.rs`.
- Zapis zadania → `insert` gdy `gcal_event_id` puste, `patch` gdy wypełnione.
  `status='done'` lub usunięcie zadania → `delete` wydarzenia.
- `due_time` puste → wydarzenie całodniowe; wypełnione → wydarzenie o stałej
  długości (domyślnie 30 min).
- Błąd sieci nie blokuje zapisu lokalnego: rekord zapisuje się z pustym
  `gcal_synced_at`, a wysyłka ponawia się przy następnej okazji.
- Moduł wyłączony domyślnie; TODO działa w pełni offline bez niego.

## 9. Testy

Rust:

- merge LWW + tombstone dla `project_costs` i `todos` — wzorzec
  `merge_syncs_clients_entity_lww_and_tombstone` z `src/sync_common.rs`
- odporność merge na rekord bez `uid` (pomijany, nie wywraca transakcji)
- filtr okresu dla kosztów: granice włącznie, `all_time` bez filtra
- `costs_value` i `grand_total` w podsumowaniu estymacji
- walidacja `scope` ↔ wymagane pola w `todos_create`
- sprzątanie sierot przy usuwaniu projektu i klienta
- kaskada zmiany nazwy projektu przez trigger (wzorzec testu
  `rename_parent_cascades_to_merged_children` z `commands/projects.rs`)
- kaskada zmiany nazwy klienta na `todos.client_name` w `clients_update`

TypeScript (vitest):

- `lib/todo-grouping.ts` — przypisanie do grup na granicach (dziś, koniec tygodnia,
  zadanie zaległe, brak terminu)
- formatowanie i sumowanie kosztów w widoku estymacji

## 10. Dokumentacja

- `Help.tsx` — nowa `components/help/sections/HelpTodoSection.tsx`; rozbudowa
  `HelpProjectsSection` i `HelpReportsSection` o koszty dodatkowe. Teksty krótkie,
  zorientowane na użytkownika: co robi, kiedy użyć, jakie ma ograniczenia.
- `PARITY.md` — wpis o zachowaniu przy mieszanych wersjach (§4).
- Klucze i18n w `dashboard/src/locales/pl` i `.../en`; `compare_locales.py`
  weryfikuje komplet.
- `react-doctor` z roota repo ma nadal dawać 100/100.

## 11. Fazowanie

| Faza | Zakres | Zależności |
|---|---|---|
| 1 | Koszty dodatkowe: m26 (tabela `project_costs`), sync, komendy, estymacje, raporty, UI, Help | — |
| 2 | TODO: m26 (tabela `todos`), sync, ekran, widżety, Help | — |
| 3 | Google Calendar: OAuth, push, ustawienia, Help | Faza 2 |

Fazy 1 i 2 są niezależne i każda jest samodzielnie wydawalna. Migracja `m26` tworzy
obie tabele naraz — jeśli fazy trafią do osobnych wydań, tabela `todos` po fazie 1
po prostu stoi pusta, co jest tańsze niż dwie migracje i dwa przebiegi wpinania w sync.
