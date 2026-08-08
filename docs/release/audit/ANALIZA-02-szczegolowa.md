# ANALIZA 02 — szczegółowa

**Data:** 2026-08-08 · **Gałąź:** `stable_1.6` · **Commit:** `1aeaf32` · **Wersja:** `0.1.5760`
**Poprzedni etap:** [ANALIZA-01-globalna.md](./ANALIZA-01-globalna.md)

**Zakres:** 12 obszarów (2.0–2.11), w tym rdzeń AI. Analiza statyczna + uruchomienie narzędzi (clippy, fmt, knip, skanery własne). **Nie uruchamiano aplikacji** — obszar wydajności jest oceniony statycznie i wymaga profilowania.

**Priorytety:** `P0` utrata danych / dziura bezpieczeństwa · `P1` zły wynik pokazany użytkownikowi · `P2` brak strażnika inwariantu · `P3` wydajność/edge case · `P4` czystość.

---

## ⚠️ Korekta ustaleń z analizy globalnej

Dwie tezy z etapu 1 okazały się **błędne** po weryfikacji. Zapisuję je na samej górze, bo zmieniają kolejność priorytetów.

| Teza z etapu 1 | Weryfikacja | Nowy stan |
|---|---|---|
| **G-04:** ~1096 punktów paniki, „największe pojedyncze ryzyko wydania" | Skaner odsiewający `#[cfg(test)]` i pliki `tests.rs` → **26** punktów na ścieżce produkcyjnej, z czego **25 klasy A** (prowadnie nieosiągalne) | **Zdegradowane do P4.** Szczegóły w 2.2 |
| **G-04 pochodna:** koncentracja panik w `sync_common.rs` (252), `import_data.rs` (102), `merge.rs` (93) | Wszystkie te trafienia leżą w blokach testowych. Kod produkcyjny tych plików ma **zero** `unwrap`/`expect` | Teza nieprawdziwa |

**W zamian najwyższym ryzykiem wydania jest ustalenie [S-01](#s-01--przejęcie-sekretu-lan-dwoma-nieuwierzytelnionymi-żądaniami) — nieuwierzytelniona ścieżka do przejęcia sekretu LAN.** Nie było go widać w analizie globalnej, bo wymagało prześledzenia łańcucha trzech funkcji.

---

## 2.0 · Bramki i baseline

### Zmierzone wartości wyjściowe

| Metryka | Wartość | Komentarz |
|---|---|---|
| `cargo clippy --workspace --all-targets` | **71 ostrzeżeń**, 0 błędów | Do wyczyszczenia przed `-D warnings` |
| `cargo fmt --all -- --check` | **496 rozjazdów** | Formatowanie nigdy nie było egzekwowane |
| `npm run lint:knip` | **czysto** | Brak martwych eksportów we froncie |
| Punkty paniki na ścieżce produkcyjnej | **26** | Patrz 2.2 |
| Komendy Tauri | 206 definicji / 221 rejestracji / 220 w moście webui | Patrz 2.8 |
| Indeksy DB | **31** | Patrz 2.7 |
| Pliki testowe frontu / źródłowe | 30 / 469 | Skoncentrowane w `lib/` — właściwe miejsce |

### Ustalenia

| # | Ustalenie | Dowód | Prio |
|---|---|---|---|
| B-01 | CI nie uruchamia `cargo clippy` ani `cargo fmt --check` | `.github/workflows/ci.yml` — brak obu | P2 |
| B-02 | `npm audit --omit=dev \|\| true` — bramka nie może paść | `ci.yml`, job `audit` | P2 |
| B-03 | `cargo deny` bez `licenses` i `sources` | `ci.yml`, job `audit` | P3 |
| B-04 | Windows: tylko `cargo build -p timeflow-demon`, zero testów | `ci.yml`, job `windows-build` | P2 |
| B-05 | Brak bramki spójności `VERSION` z 5 manifestami; sync tylko w `pretauri` | `dashboard/package.json` | P3 |
| B-06 | 496 rozjazdów formatowania — pierwszy `cargo fmt` wygeneruje ogromny diff | `cargo fmt --check` | P4 |

---

## 2.1 · Obliczenia czasu

### Stan rdzenia — zweryfikowany, dobry

`dashboard/src-tauri/src/commands/time_algorithm.rs` faktycznie jest jednym źródłem prawdy dla czasu **projektu**:
- host `load_project_intervals` → strategia `WallClockStrategy` → rejestr,
- deduplikacja nakładających się przedziałów, podział czasu współbieżnego, niezmiennik „suma źródeł projektu = `total_by_project`",
- `compute_project_activity_unique` jest używane przez `dashboard.rs` (`get_dashboard_stats`), `report.rs`, `estimates.rs`, `analysis.rs` — **cztery główne ekrany idą przez rdzeń**.

Osobno `distribute_app_seconds` jest opisane jako **„single home for per-app time math"**: skaluje surowe sumy per aplikacja w dół do zdeduplikowanego totalu projektu, żeby rozbicie sumowało się do tej samej liczby.

### C-01 · `distribute_app_seconds` wołane w 1 z 3 miejsc, które produkują rozbicie per aplikacja — **P1**

| Miejsce | Co pokazuje | Skalowanie |
|---|---|---|
| `commands/projects.rs:1857` | Top apps na karcie projektu | ✅ `distribute_app_seconds` |
| `commands/dashboard.rs:38` (`build_dashboard_stats`) | Top 5 aplikacji na Dashboardzie | ❌ surowe `SUM(s.duration_seconds)` |
| `commands/dashboard.rs:493` (`get_applications`) | Cała strona Applications | ❌ surowe `SUM(s.duration_seconds)` |

**Skutek:** na Dashboardzie total (`project_totals` — zdeduplikowany) i lista top aplikacji (surowe sumy) pochodzą z **różnej matematyki**. Gdy dwie aplikacje działały równolegle, suma pozycji listy przekracza total wyświetlony nad nią. Wewnątrz karty projektu ten sam problem został rozwiązany i opatrzony komentarzem — na Dashboardzie i w Applications nie.

**To jest dokładnie przypadek „dwa różne algorytmy do liczenia tej samej rzeczy".**

**Dowód rozbieżności intencji** — komentarz z `projects.rs:1839`:
> „Per-app seconds above are raw sums of duration_seconds; concurrently running apps overlap and add up to more than the project's clock total. distribute_app_seconds (**the single home for per-app time math**) scales them down so the breakdown sums to the SAME clock total used by the card, estimates, projects list, and report."

Ten sam problem, ta sama funkcja — nie wywołana w dwóch pozostałych miejscach.

### C-02 · Brak testu międzymodułowego dla inwariantu „ta sama liczba wszędzie" — **P2**

Testy jednostkowe pilnują modułów osobno. `time_algorithm.rs` ma test `distribute_app_seconds_scales_down_to_clock_total`, ale nikt nie sprawdza, że Dashboard i Applications zwracają zgodne liczby. Gdyby taki test istniał, C-01 zostałby wykryty przy pisaniu.

### Zweryfikowane i poprawne

| Miejsce | Dlaczego to nie jest drugi algorytm |
|---|---|
| `daily_seconds_by_series`, `daily_buckets_by_series`, `grand_daily_seconds` | Rozbicia tej samej mapy `BucketDurations`, nie osobne liczenie |
| `import_data.rs:1352, 2222–2225` | Diagnostyka importu i `println!` debugowe, nie liczby dla użytkownika |
| `estimates.rs:177` (`SUM(extra_seconds)`) | Sumuje nadwyżkę z mnożników, nie czas bazowy |
| `lib/rounding.ts` | Warstwa prezentacyjna z jawnym kontraktem „nigdy nie modyfikujemy danych źródłowych" |

---

## 2.2 · Punkty paniki — **teza z etapu 1 obalona**

Skaner odsiewający `#[cfg(test)]` (zagnieżdżenie klamr) i pliki `*/tests.rs`: **26 trafień na ścieżce produkcyjnej** (nie ~1096).

### Klasyfikacja

| Klasa | Liczba | Uzasadnienie |
|---|---|---|
| **A — nieosiągalne** | 25 | patrz niżej |
| **B — możliwe na danych zewnętrznych** | **0** | brak |
| **C — możliwe przy błędzie programisty** | 1 | `webui/auth.rs` — do potwierdzenia |

**Klasa A, rozbicie:**

| Wzorzec | Liczba | Dlaczego nieosiągalne |
|---|---|---|
| `Mutex::lock().expect("...poisoned")` | 19 | Mutex zatruwa się tylko po panice innego wątku. Przy `panic = "abort"` panika kończy proces — zatrucie nie może wystąpić w release |
| `HMAC accepts any key length` | 2 | `sync_encryption.rs:73,78` — twierdzenie prawdziwe z konstrukcji HMAC |
| `pooled database connection missing` | 2 | `db/pool.rs:88,96` — `Option` jest `take()`owany wyłącznie w `Drop`; `Deref` po `Drop` jest w Rust niemożliwe |
| `Regex::new(...).expect` na literale | 1 | `sessions/split.rs:247` |
| `valid MIME literal` | 1 | `bughunter.rs:66` |
| `error while building tauri application` | 1 | `lib.rs:398` — start aplikacji, nie ma do czego wracać |
| `APP_ICON must exist` | 1 | `platform/windows/tray.rs:529` — załadowane wcześniej. **Niezweryfikowane na realnym Windows** |

**Wniosek:** kod jest pod tym względem zdyscyplinowany. Ryzyko przeszacowałem w etapie 1 o dwa rzędy wielkości.

### P-01 · `catch_unwind` w 9 miejscach jest martwy w buildzie release — **P1**

`Cargo.toml`: `[profile.release] panic = "abort"`. Przy `abort` panika **nie rozwija stosu**, więc `catch_unwind` nigdy nie łapie.

| Plik:linia | Co miało chronić |
|---|---|
| `src/lan_server.rs:422` | wątek serwera LAN — log „LAN server thread PANICKED" |
| `src/lan_server.rs:1358` | handler |
| `src/lan_discovery.rs:205` | pętla discovery |
| `src/tracker.rs:226` | pętla trackera |
| `src/lan_sync_orchestrator.rs:847` | **`guarded_then_cleanup` — „runs the panic-prone body under catch_unwind, then ALWAYS call cleanup(succeeded)"** |
| `assignment_model/training.rs:810` | trening modelu |

**Najgroźniejszy:** `guarded_then_cleanup` istnieje po to, by po panice **na pewno** zdjąć flagi synchronizacji (test w linii 989: „After catch_unwind + cleanup, both flags must be cleared regardless of panic"). W release cleanup nigdy się nie wykona — proces ginie z **zamrożoną bazą** (`freeze`), a `AUTO_UNFREEZE_TIMEOUT` działa tylko dopóki proces żyje.

**To jest realne ryzyko P1:** nie samo wystąpienie paniki (klasa B = 0), lecz **fałszywe poczucie zabezpieczenia** — kod i testy sugerują odporność, której produkcyjny build nie ma.

Decyzja do podjęcia: albo `panic = "unwind"` w release (koszt: rozmiar binarki), albo usunięcie martwych `catch_unwind` i zastąpienie ich mechanizmem działającym przy `abort` (np. znacznik na dysku sprzątany przy starcie).

---

## 2.3 · Definicje danych i schemat

### Macierz encji

| Encja | Migracja | Schemat demona | Kolumny scentralizowane | Eksport dashboardu | Eksport demona | Checksum | Merge | Trigger tombstone |
|---|---|---|---|---|---|---|---|---|
| projects | m01+ | `sync_common.rs:1439` | ✅ `columns.rs` | ✅ | ✅ | ✅ | ✅ | ✅ |
| clients | m24 | `sync_common.rs:277` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| applications | m01 | `sync_common.rs:1468` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| sessions | m07 | `sync_common.rs:1477` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| manual_sessions | m03 | `sync_common.rs:1493` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| assignment_feedback | H-1 | `sync_common.rs:1540` | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| assignment_auto_runs | H-1 | `sync_common.rs:1551` | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| project_costs | m26 | `sync_common.rs:304` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| todos | m26/m27 | `sync_common.rs:319` | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| file_activities | m06/m16 | — | ❌ | ✅ (od `Unreleased`) | ❓ | ❌ | ❓ | ❌ |

### D-01 · Centralizacja kolumn zastosowana w 1 z 9 encji — **P2**

`shared/sync/columns.rs` zawiera wyłącznie `PROJECT_COLUMNS` + `PROJECT_SELECT` z testem strażniczym i komentarzem „finding #10 — 5 miejsc na kolumnę". Pozostałe osiem encji nie ma odpowiednika. `FROM sessions` występuje w **32 plikach**.

### D-02 · Eksport demona i dashboardu dla `projects` różnią się treścią — **P3, zweryfikowane jako nieszkodliwe**

| | Dashboard (`PROJECT_SELECT`) | Demon (`lan_server.rs:1677`) |
|---|---|---|
| `is_imported` | ✅ eksportowane | ❌ **pominięte** |
| `status` | `COALESCE(status,'active')` | surowe `status` |
| kolejność kolumn | wg `PROJECT_COLUMNS` | inna |

**Weryfikacja skutku:**
- Kolejność **nie ma znaczenia** — `fetch_all_rows` (`lan_server.rs:1763`) buduje obiekty JSON z nazwami kolumn, nie tablice pozycyjne.
- `is_imported` **nie jest odczytywane przez merge**: `merge_projects` w gałęzi INSERT ustawia je na sztywno `1` (`merge.rs:485`), a w gałęzi UPDATE nie dotyka go wcale. Pominięcie jest więc bezskutkowe — ale przypadkowe, nie zamierzone.
- `status`: dla wiersza sprzed m24 z `status = NULL` archiwum dashboardu niesie `"active"`, archiwum demona `null`. W gałęzi UPDATE `merge.rs:434` traktuje jawny `null` jako „zachowaj lokalne", a `"active"` jako „ustaw active". **Ten sam projekt zsynchronizowany z demona i z dashboardu może skończyć z innym `status`.** Edge case (m24 jest stare), ale to realna asymetria dwóch ścieżek eksportu.

### D-03 · Schemat demona jest rozłączny z migracjami dashboardu — **P2**

Demon nie uruchamia migracji; ma własne `CREATE TABLE`. Obejściem dla m26 jest `ensure_m26_entity_tables` wołane przed pętlą triggerów tombstone. Obejście jest **punktowe** — nazwane po konkretnej migracji. Następna migracja dodająca tabelę synchronizowaną powtórzy błąd, a objawem będzie padnięcie **całego** merge na `no such table`, nie tylko nowej encji.

### D-04 · `TableHashes` — trzy definicje, jedna z niepełnym porównaniem — **P2**

- `src/lan_server.rs:43` (demon, 9 pól), `commands/delta_export.rs:11` (dashboard, 9 pól, `#[derive(Default)]`), `lib/online-sync-types.ts` (front).
- `src/lan_server.rs:1804` — **ręczny** `impl PartialEq` porównuje 7 z 9 pól; pomija `assignment_feedback` i `assignment_auto_runs`.

**Weryfikacja skutku:** wyszukiwanie wszystkich wystąpień `TableHashes` w `src/`, `shared/`, `dashboard/src-tauri/src/` daje wyłącznie definicję, `build_table_hashes` i sam `impl`. **Nie ma dziś żadnego wywołania tego porównania** — skutek jest zerowy. Pozostaje bombą z opóźnionym zapłonem: pierwszy kod, który porówna `TableHashes`, odziedziczy błąd bez ostrzeżenia. `PARITY.md` sam nazywa ten typ pominięcia najgroźniejszym.

**Poprawka jest jednolinijkowa:** skasować ręczny `impl`, dopisać `PartialEq, Eq` do `#[derive(...)]`.

---

## 2.4 · Synchronizacja

### Stan — mocny, z jasno opisanymi pułapkami

Zweryfikowane jako kompletne i spójne:
- **Checksum** (`shared/sync/checksum.rs`): 9 tabel, jedna funkcja `table_hash_sql` używana przez **obie** strony (demon i dashboard) → hash nie może się rozjechać. Testy pilnują dryfu statusu, kwot i pomijania pól `gcal_*`.
- **Triggery tombstone** (`shared/sync/triggers.rs`): 7 tabel, tablice CREATE i DROP wyrównane, test `create_and_drop_arrays_are_aligned`.
- **Merge** (`shared/sync/merge.rs`): LWW po `updated_at`, `local_tombstone_covers`, obsługa „klucz nieobecny = zachowaj lokalne" vs „jawny null = wyczyszczone", jawna ochrona pól per-maszyna (`assigned_folder_path`, `gcal_*`), obejście blacklisty przed triggerami `RAISE(ABORT)`.

### SY-01 · `assignment_feedback` i `assignment_auto_runs` bez triggerów tombstone — **P2**

Obie tabele mają checksum, eksport i merge, ale **nie ma dla nich triggerów tombstone** (`triggers.rs` obejmuje 7 tabel, nie 9). Skutek: skasowanie wiersza feedbacku na maszynie A nie propaguje się na B — wiersz wraca przy następnym merge. Dla danych treningowych AI oznacza to, że **cofnięcie błędnej nauki może się nie utrwalić**.

Wymaga potwierdzenia: czy te tabele w ogóle podlegają kasowaniu w UI (`reset_model_full`, `rollback_last_auto_safe_run`). Jeśli tak — to `P1`.

### SY-02 · `file_activities` w eksporcie bez checksumu i tombstonów — **P2**

`CHANGELOG.md → Unreleased` dodaje `file_activities` do archiwum eksportu („dane AI i widok Detailed przeżywają przenosiny"). Tabela **nie występuje** w `TableHashes` ani w `triggers.rs`. Skutek: rozjazd tych danych między maszynami jest **niewykrywalny** przez mechanizm hashy, a kasowanie nie propaguje się.

### SY-03 · Brak testu idempotencji merge dla pełnego zestawu encji — **P2**

Istnieje asercja zbieżności `table_hashes` po konwergencji (`sync_common.rs:1754`) i testy roundtrip dla `project_costs` i `todos`. Nie ma testu: „dwukrotny merge tego samego archiwum nie zmienia bazy" dla wszystkich dziewięciu encji. Brak idempotencji objawia się wiecznym re-syncem.

---

## 2.5 · Pieniądze, stawki i raporty

### Kanoniczna reguła — odtworzona z kodu

Z `commands/estimates.rs:258–266`:

```
seconds            = round(seconds_f64)                    // z time_algorithm
hours              = seconds_f64 / 3600                    // z surowych, NIE z round
extra_secs         = SUM(extra_seconds) z mnożników sesji
weighted_hours     = hours + extra_secs/3600
effective_rate     = project.hourly_rate  (jeśli skończona i > 0)
                     ELSE global_hourly_rate
estimated_value    = weighted_hours * effective_rate
costs_value        = SUM(project_costs.amount)  — dolinkowane po NAZWIE projektu
```

Zaokrąglenie prezentacyjne nakłada front i **skaluje kwotę proporcjonalnie** — `lib/estimate-report.ts:81–94`, funkcja `scaleValueToRounded`, z komentarzem: „Baza WARTOŚCI musi być spójna z backendowym `estimated_value`". **To jest poprawnie rozwiązane** — kwota i czas nie rozjeżdżają się przy zaokrąglaniu.

### M-01 · Stawka klienta (`clients.default_hourly_rate`) nie wpływa na żadną kwotę — **P1**

Pole jest:
- w schemacie (m24, `sync_common.rs:284`),
- edytowalne w UI (`ClientsManageSection.tsx:129`),
- zapisywane (`clients.rs:265, 314`), eksportowane, synchronizowane, obecne w moście webui.

**Nie występuje w żadnym wyliczeniu kwoty.** `estimates.rs:260` bierze wyłącznie `project_hourly_rate` z fallbackiem na `global_hourly_rate`. Klient jest pomijany całkowicie.

**Skutek:** użytkownik ustawia stawkę klienta, widzi ją w interfejsie i rozsądnie zakłada, że projekty tego klienta będą po niej liczone. Nie będą — dostaną stawkę globalną. To cicha, systematyczna pomyłka na fakturze.

Do rozstrzygnięcia: czy to niedokończona funkcja, czy pole informacyjne. Jeśli informacyjne — musi to być widoczne w UI i opisane w `Help.tsx`.

### M-02 · Brak testu „suma pozycji = suma raportu" — **P2**

`report-consistency.test.ts` pilnuje zgodności **czasu** (dni vs total) przy zaokrąglaniu. Nie ma odpowiednika dla **kwot**. Przy `scaleValueToRounded` działającym na proporcjach błąd zaokrągleń groszowych może się kumulować na wielu pozycjach.

### M-03 · Koszty linkowane po nazwie projektu, nie po `id` — **P3**

`estimates.rs:270`: `costs_by_project.get(mapped_name)`. Komentarz w kodzie potwierdza świadomość. To wynika z modelu sync (nazwa jest stabilnym kluczem międzymaszynowym), ale oznacza, że kaskadę zmiany nazwy musi obsłużyć trigger `trg_projects_rename_cascade_costs` (m26) — i że kasowanie projektu wymaga ręcznego `delete_costs_of_project` w obu ścieżkach kasowania. Konstrukcja poprawna, ale krucha: trzecia ścieżka kasowania osieroci koszty.

---

## 2.6 · Bezpieczeństwo

### S-01 · Przejęcie sekretu LAN dwoma nieuwierzytelnionymi żądaniami — **P0**

**Najpoważniejsze ustalenie całego audytu.**

Serwer demona nasłuchuje na `0.0.0.0:<DEFAULT_LAN_PORT>` (`lan_server.rs:434`). Bramka uwierzytelnienia (`lan_server.rs:561`) zwalnia z autoryzacji 14 ścieżek. Cztery z nich mają dodatkowy warunek `is_loopback` — **trzy nie mają go wcale**:

| Endpoint | Auth | `is_loopback` | Handler |
|---|---|---|---|
| `POST /lan/generate-pairing-code` | ❌ | ❌ **brak** | `handle_generate_pairing_code()` — nie przyjmuje IP |
| `POST /lan/store-paired-device` | ❌ | ❌ **brak** | `handle_store_paired_device(&body)` |
| `POST /lan/remove-paired-device` | ❌ | ❌ **brak** | `handle_remove_paired_device(&body)` |
| `POST /lan/trigger-sync` | ❌ | ✅ `:1174` | — |
| `POST /online/trigger-sync` | ❌ | ✅ `:1274` | — |
| `POST /online/cancel-sync` | ❌ | ✅ `:1372` | — |
| `POST /lan/initiate-pair` | ❌ | ✅ `:1460` | — |

**Łańcuch ataku (dowolny host w tej samej sieci):**

1. `POST /lan/generate-pairing-code` → `lan_pairing::generate_code()` **mintuje nowy, ważny kod** i **zwraca go w odpowiedzi HTTP** (`lan_pairing.rs:25–39`).
2. `POST /lan/pair` z tym kodem + własną tożsamością → `validate_code` przechodzi (kod jest poprawny), handler zwraca `"secret": get_or_create_lan_secret()` (`lan_server.rs:1434–1441`).
3. Z sekretem atakujący przechodzi bramkę `constant_time_eq` i może wołać **każdy** uwierzytelniony endpoint — w tym `POST /lan/pull`, który eksportuje całą bazę.

**Dlaczego istniejące zabezpieczenia nie pomagają:**
- Throttle per-IP na `/lan/pair` (`lan_pair_throttle.rs`) chroni przed zgadywaniem kodu. Tu **kod jest znany** — trafienie następuje za pierwszym razem.
- TTL kodu (5 min) i limit prób nie mają znaczenia — atakujący sam mintuje świeży kod.
- `constant_time_eq` chroni przed atakiem czasowym na sekret, nie przed jego wydaniem.

**Eskalacja przez CORS:** każda odpowiedź serwera niesie `Access-Control-Allow-Origin: *` (`lan_server.rs:~641`). Dowolna strona WWW otwarta przez użytkownika może wysłać te żądania na adres LAN i **odczytać odpowiedź**, bo wildcard CORS na to pozwala. To przenosi wektor z „napastnik w sieci" na „dowolna odwiedzona strona".

**Dodatkowo, ta sama klasa:**
- `POST /lan/store-paired-device` — dowolny host w LAN wstrzykuje wpis do listy sparowanych urządzeń.
- `POST /lan/remove-paired-device` — dowolny host w LAN kasuje cudze parowania (odmowa usługi dla synchronizacji).
- `GET /lan/paired-devices` — nieuwierzytelniony listing `device_id`, nazw maszyn i znaczników błędów autoryzacji (ujawnienie informacji).

**Rekomendacja kierunkowa (do rozpisania w etapie 3):** te trzy endpointy są używane przez lokalny dashboard, nie przez peera — powinny dostać `is_loopback` dokładnie tak jak `/lan/initiate-pair`, który już to robi. Osobno: `Access-Control-Allow-Origin: *` należy zawęzić albo usunąć.

**Nie weryfikowałem tego eksploitem** — ustalenie opiera się na lekturze routingu, bramki auth i trzech handlerów. Przed poprawką warto potwierdzić `curl`em na własnej maszynie.

### S-02 · Macierz `SECURITY_AUDIT.md` niewypełniona — **P2**

21 endpointów, kolumna „Reviewed?" pusta we wszystkich wierszach. Metodyka (7 kryteriów) jest dobra — nigdy jej nie wykonano. S-01 jest bezpośrednim skutkiem tego zaniechania.

### Zweryfikowane jako poprawne

| Mechanizm | Stan |
|---|---|
| Porównanie sekretu | `constant_time_eq` ✅ |
| Limit rozmiaru ciała | `MAX_REQUEST_BODY`, odrzucenie **przed** routingiem, HTTP 413 ✅ |
| Throttle parowania | per-IP, TTL 5 min, limit prób, kod konsumowany po użyciu ✅ |
| Ochrona przed pustym sekretem | `handle_pair` odrzuca niekompletną tożsamość z uzasadnieniem w komentarzu ✅ |
| Limit połączeń | `MAX_CONNECTIONS` ✅ |
| Brak sekretów w repo | `git ls-files` — `.env` nieśledzony ✅ |

### Nie zbadane w tym etapie

- `webui/auth.rs` — sesje, hashowanie hasła, atrybuty ciasteczek, tryb `lan_exposure`.
- `mcp/tools.rs` — 743 linie narzędzi sterujących danymi; czy operacje destrukcyjne wołają `mcp/backup.rs`.
- `tauri.conf.json` / `capabilities/default.json` — CSP, zawężenie uprawnień.

---

## 2.7 · Wydajność (ocena statyczna)

### Indeksy — pokrycie dobre

**31 indeksów.** Ścieżki zapytań ekranowych są pokryte:

| Zapytanie | Indeks |
|---|---|
| sesje po dacie + ukryte | `idx_sessions_date_hidden(date, is_hidden)` |
| sesje po aplikacji i dacie | `idx_sessions_app_date(app_id, date, start_time)` |
| cache projektów sesji | `idx_session_project_cache_date`, `idx_session_project_cache_project_date` |
| delta sync | `idx_sessions_updated_at`, `idx_manual_sessions_updated_at`, `idx_project_costs_updated_at`, `idx_todos_updated_at` |
| aktywność plików | 5 indeksów, w tym `(app_id, date, last_seen, first_seen)` pod zapytania overlap |
| AI | `idx_assignment_feedback_session(session_id, created_at DESC)` |

**Wniosek:** nie widzę oczywistej luki indeksowej. Hipoteza wymaga potwierdzenia profilerem.

### Obserwacje wymagające pomiaru

| # | Obserwacja | Do sprawdzenia |
|---|---|---|
| W-01 | `commands/projects.rs:1813–1880` wykonuje **trzy** osobne zapytania na kartę projektu (top apps, raw_sum_all, daily) | Czy skalują się przy 50+ projektach na liście |
| W-02 | `prepare` (nie `prepare_cached`) w gorących ścieżkach `projects.rs` | `prepare_cached` używane w `dashboard.rs`, w `projects.rs` nie zawsze |
| W-03 | 135 `useEffect` we froncie | Ile strzela zapytaniem przy każdym renderze |
| W-04 | Bundel 2.4 MB, kod dzielony per strona | Czy `recharts` ładuje się leniwie |
| W-05 | Zużycie pamięci demona w długim biegu | Wymaga 8 h obserwacji |

**Cała ta sekcja jest hipotezą.** Bez profilowania nie stawiam ustaleń.

---

## 2.8 · Parity i tryb webui

### PW-01 · Most webui cicho pomija komendy z parametrem `Window` — **P1**

`gen_webrpc.cjs:96–108` pomija komendy przyjmujące `Window`/`WebviewWindow`/`State`, wypisuje `Skipped:` i **generuje poprawny plik** — więc `--check` przechodzi i CI jest zielone.

Zweryfikowana różnica rejestracji: **dokładnie jedna** komenda — `print_report` — jest w `invoke_handler`, nie ma jej w moście webui (221 vs 220).

**Skutek:** na telefonie/webui przycisk drukowania raportu istnieje w interfejsie i nie ma jak zadziałać. Front nie ma widocznego mechanizmu rozpoznawania trybu (`lib/platform.ts` nie zawiera detekcji webui), więc nic tej funkcji nie ukrywa ani nie wyjaśnia.

**Ryzyko systemowe:** mechanizm jest cichy z założenia. Każda przyszła komenda z `Window` powtórzy problem, a bramka `--check` nadal będzie zielona.

### PW-02 · Rozjazd dokumentacji powierzchni API — **P4**

`commands/mod.rs` deklaruje „Total: 171 registered tauri commands across 29 modules". Faktycznie: **206** definicji `#[tauri::command]`, **221** rejestracji, a moduły `costs`, `todos` i `mcp_server` są w `pub use`, lecz **nie mają wpisu w spisie**. Spis jest w kodzie opisany jako „EXPLICIT command surface" — czyli pełni rolę dokumentacji, na której ktoś polega.

### PW-03 · Windows: kod kompilowany, nigdy nie wykonywany — **P2**

CI: `cargo build -p timeflow-demon`, zero testów. `PARITY.md` ma dwa TODO z adnotacją „NIEZWERYFIKOWANE na realnym Windows (cross-compile pada na `libsqlite3-sys`)". Jedyny punkt paniki klasy A, którego nie mogłem zweryfikować (`platform/windows/tray.rs:529`), leży dokładnie na tej platformie.

---

## 2.9 · Nadmiarowość i over-engineering

| # | Ustalenie | Dowód | Prio |
|---|---|---|---|
| N-01 | 71 ostrzeżeń clippy | `cargo clippy --workspace --all-targets` | P4 |
| N-02 | Martwy `impl PartialEq for TableHashes` — bez wywołań, z błędem | `lan_server.rs:1804` | P2 (= D-04) |
| N-03 | `PROJECT_SELECT` eksportuje `is_imported` i `assigned_folder_path`, których merge nigdy nie czyta | `merge.rs:485` (hardcode `1`), `merge.rs:~450` (komentarz „never overwrite from remote") | P4 |
| N-04 | 614 × `map_err(\|e\| e.to_string())` przy w pełni spójnej granicy `CommandError` | grep | P4 |
| N-05 | 49 × `eslint-disable`, 37 × `#[allow(...)]` — do przeglądu | grep | P4 |
| N-06 | 26 `println!/eprintln!` poza testami przy 445 `log::*` | grep; część to diagnostyka importu (`import_data.rs:2222+`) | P4 |

### Abstrakcje — werdykt

| Abstrakcja | Implementacje | Werdykt |
|---|---|---|
| `TimeStrategy` (`time_algorithm.rs`) | 1 (`WallClockStrategy`) | **Zostaje.** Wystawiona użytkownikowi przez `list_time_algorithms` w Preferences; jest częścią kontraktu UI, nie spekulacją |
| `MergeHooks` (`merge.rs`) | używane do logowania i diagnostyki | **Zostaje.** Realny drugi konsument (diag) |
| Pula połączeń (`db/pool.rs`) | 1 | **Zostaje.** Rozwiązuje mierzalny problem (koszt otwarcia SQLite) |

**Nie znalazłem abstrakcji do usunięcia.** `knip` czysty, martwych eksportów brak. Ocena over-engineeringu: **niska** — kod jest raczej gęsty niż przeabstrahowany.

### Wielkie pliki — do inwentarza, nie do podziału przed wydaniem

`sync_common.rs` 3668 · `projects.rs` 2765 · `import_data.rs` 2397 · `lan_server.rs` 2060 · `merge.rs` 1653 · `assignment_model/` 4408 (7 plików).

Ponieważ klasa B punktów paniki wynosi 0, główny argument za pilnym podziałem odpadł. Rekomendacja: **nie dzielić przed wydaniem.**

---

## 2.10 · UI, i18n, Help

**Nie zbadane w tym etapie** — wymaga uruchomienia aplikacji i przejścia ekranów. Zebrane sygnały statyczne:

| Sygnał | Stan |
|---|---|
| Bramki i18n (3 skrypty) | W CI, zielone |
| Locale | `en/common.json`, `pl/common.json` |
| `any` w TypeScript | **0** |
| `console.*` we froncie | 10 wystąpień — do sprawdzenia, czy trafiają do builda produkcyjnego |
| Pokrycie `Help.tsx` | Niesprawdzone. Funkcje z `CHANGELOG → Unreleased` (koszty dodatkowe, zadania, `file_activities` w eksporcie, zmiany AI) wymagają weryfikacji wobec reguły z `CLAUDE.md` §3 |
| Stany ekranów (loading/empty/error) | Niesprawdzone |

---

## 2.11 · Rdzeń AI

**Kontekst:** `docs/TODO.md` notuje wątpliwości autora co do poprawności rdzenia i założeń modelu przypisań.

### Architektura — warstwowy scoring

`assignment_model/scoring.rs` implementuje cztery warstwy dowodów:

| Warstwa | Źródło | Waga |
|---|---|---|
| 0 | **Fakty** — ścieżka pliku wskazuje folder projektu | 1.5 ponad historią; przy jednym niekwestionowanym kandydacie waga 1.0 i `evidence +4`, by samotny fakt przebił próg auto |
| 1 | Pamięć aplikacja→projekt | `evidence_weight` = 2 dla aplikacji bez plików („background app"), 1 dla pozostałych |
| 3 | Tokeny tytułu okna — **ważone IDF** (`1/(1+ln(df))`) | token obecny w wielu projektach waży mniej |
| 4 | Tokeny ścieżek — IDF tak samo | |

Pewność: `confidence = sigmoid_margin × evidence_factor`, gdzie `evidence_factor = 1 − e^(−evidence/2)` (`scoring.rs:372–376`). Czyli **pewność rośnie z liczbą niezależnych dowodów, nie tylko z przewagi nad drugim kandydatem** — to poprawna konstrukcja: chroni przed wysoką pewnością wyliczoną z jednej obserwacji.

### AI-01 · Model nie uczy się z własnych auto-przypisań — **zweryfikowane, poprawne**

`training.rs` filtruje `assignment_feedback` jawną białą listą `source`:

```
'manual_session_assign', 'manual_session_change', 'manual_project_card_change',
'manual_session_unassign', 'bulk_unassign', 'manual_app_assign',
'ai_suggestion_accept', 'ai_suggestion_reject'
```

Wszystkie pozycje są **pochodzenia ludzkiego**. Auto-przypisania nie wchodzą do treningu, więc nie ma sprzężenia zwrotnego „model utwierdza się we własnych decyzjach". Filtr występuje spójnie w trzech miejscach (`training.rs:270, 327, 539`). Zgadza się z deklaracją z `CHANGELOG`.

### AI-02 · Intencje projektowe udokumentowane testami — dobry znak

Testy w `scoring.rs` nie sprawdzają liczb, tylko **zasady**:
- `path_fact_beats_heavy_app_memory` — fakt bije nawet ciężką historię,
- `ubiquitous_tokens_are_dampened_by_idf` — token wszechobecny nie decyduje,
- komentarz przy progu: „a clean, uncontested path fact must be able to pass the default auto threshold".

To jest właściwy sposób pilnowania modelu: test opisuje **zamiar**, nie wynik.

### AI-03 · Bezpieczna ścieżka auto z rollbackiem — istnieje

`auto_safe.rs` (772 linie) + `AUTO_SAFE_MIN_MARGIN` + `rollback_last_auto_safe_run` + tabela `assignment_auto_runs` z polami `rollback_reverted`, `rollback_skipped`.

### AI-04 · Cofnięcie nauki może nie utrwalić się po synchronizacji — **P2, do potwierdzenia**

Tabele `assignment_feedback` i `assignment_auto_runs` mają checksum, eksport i merge, ale **nie mają triggerów tombstone** (patrz SY-01). Jeśli `reset_model_full` lub `rollback_last_auto_safe_run` kasują wiersze, to po synchronizacji z peerem skasowane wiersze **wrócą** — użytkownik cofnie błędną naukę, a ta odtworzy się po syncu. Wymaga sprawdzenia, czy te komendy faktycznie kasują (`DELETE`), czy oznaczają.

### AI-05 · Komunikowanie zachowań użytkownikowi — nie zweryfikowane

Wymaganie z `docs/TODO.md` („wszystkie zachowania AI muszą być precyzyjnie komunikowane, by zachowanie użytkownika było elementem treningu") wymaga przejścia UI. Istnieją `get_session_score_breakdown` i `ScoreBreakdown`/`SuggestionBreakdown`, więc **infrastruktura do wyjaśniania decyzji jest** — nie sprawdziłem, czy i jak jest pokazana.

### Ocena rdzenia AI

**Nie znalazłem błędu w rdzeniu.** Konstrukcja jest przemyślana: fakty ponad pamięcią, IDF przeciw tokenom wszechobecnym, pewność zależna od liczby dowodów, brak sprzężenia zwrotnego z auto-przypisań, ścieżka bezpieczna z rollbackiem, testy opisujące zamiar. Jedyne konkretne ustalenie (AI-04) dotyczy synchronizacji, nie algorytmu.

**Zastrzeżenie:** to przegląd konstrukcji, nie walidacja skuteczności. Ocena „czy model dobrze zgaduje" wymaga danych i pomiaru (precision/recall na oznaczonym zbiorze) — tego nie da się zrobić czytaniem kodu i **nie ma tego w niniejszej analizie**.

---

## Zbiorcza tabela ustaleń

| # | Obszar | Ustalenie | Prio |
|---|---|---|---|
| **S-01** | Bezpieczeństwo | Sekret LAN do przejęcia dwoma nieuwierzytelnionymi żądaniami; eskalacja przez `Access-Control-Allow-Origin: *` | **P0** |
| **C-01** | Czas | `distribute_app_seconds` wołane w 1 z 3 miejsc → Dashboard i Applications pokazują niezdeduplikowane sumy per aplikacja | **P1** |
| **M-01** | Pieniądze | `clients.default_hourly_rate` edytowalne, zapisywane, synchronizowane — i nieużywane w żadnym wyliczeniu | **P1** |
| **P-01** | Odporność | 9 × `catch_unwind` martwe przy `panic = "abort"`; `guarded_then_cleanup` nie zdejmie freeze bazy | **P1** |
| **PW-01** | webui | Most cicho pomija komendy z `Window`; `print_report` niedostępne w webui bez sygnału dla użytkownika | **P1** |
| **D-04 / N-02** | Dane | `TableHashes` — 3 definicje, ręczny `PartialEq` pomija 2 pola (dziś bez wywołań) | P2 |
| **D-01** | Dane | Centralizacja kolumn w 1 z 9 encji | P2 |
| **D-03** | Dane | Schemat demona rozłączny z migracjami; obejście punktowe dla m26 | P2 |
| **SY-01** | Sync | `assignment_feedback` / `assignment_auto_runs` bez triggerów tombstone | P2 |
| **SY-02** | Sync | `file_activities` w eksporcie bez checksumu i tombstonów | P2 |
| **SY-03** | Sync | Brak testu idempotencji merge dla pełnego zestawu encji | P2 |
| **AI-04** | AI | Cofnięcie nauki może wrócić po syncu (pochodna SY-01) | P2 |
| **C-02** | Czas | Brak testu międzymodułowego „ta sama liczba wszędzie" | P2 |
| **M-02** | Pieniądze | Brak testu „suma pozycji = suma raportu" dla kwot | P2 |
| **S-02** | Bezpieczeństwo | Macierz `SECURITY_AUDIT.md` niewypełniona (21 endpointów) | P2 |
| **B-01** | Bramki | CI bez `cargo clippy` i `cargo fmt --check` | P2 |
| **B-02** | Bramki | `npm audit \|\| true` — bramka nie może paść | P2 |
| **B-04 / PW-03** | Bramki | Windows: kompilacja bez testów; 2 TODO „NIEZWERYFIKOWANE" w `PARITY.md` | P2 |
| **D-02** | Dane | Asymetria eksportu `projects` demon vs dashboard (`status` NULL) | P3 |
| **M-03** | Pieniądze | Koszty linkowane po nazwie — trzecia ścieżka kasowania osieroci je | P3 |
| **B-03** | Bramki | `cargo deny` bez `licenses`/`sources` | P3 |
| **B-05** | Bramki | Brak bramki spójności `VERSION` | P3 |
| **N-01** | Nadmiar | 71 ostrzeżeń clippy | P4 |
| **N-03** | Nadmiar | Eksport kolumn, których merge nie czyta | P4 |
| **N-04** | Nadmiar | 614 × erozja typu błędu do `String` | P4 |
| **PW-02** | Dokumentacja | Spis komend w `mod.rs` rozjechany o ~35 pozycji, 3 moduły pominięte | P4 |
| **B-06** | Bramki | 496 rozjazdów formatowania | P4 |

**Razem: 27 ustaleń — 1 × P0, 4 × P1, 12 × P2, 4 × P3, 6 × P4.**

---

## Białe plamy — czego ta analiza nie sprawdziła

| Obszar | Dlaczego | Kiedy zamknąć |
|---|---|---|
| Wydajność zmierzona (2.7) | Wymaga uruchomienia aplikacji i profilera SQL | Przed wydaniem |
| `webui/auth.rs`, `mcp/tools.rs`, `tauri.conf.json` | Zabrakło zakresu po odkryciu S-01 | Razem z naprawą S-01 |
| UI / i18n / Help (2.10) | Wymaga przejścia ekranów | Przed wydaniem |
| Skuteczność modelu AI (nie konstrukcja) | Wymaga oznaczonego zbioru i pomiaru precision/recall | Osobne zadanie, po wydaniu |
| Zachowanie na realnym Windows | Cross-compile pada na `libsqlite3-sys` | Wymaga maszyny Windows |
| Weryfikacja S-01 eksploitem | Analiza statyczna łańcucha trzech funkcji | Potwierdzić `curl`em przed poprawką |
| Czy `assignment_feedback` jest w ogóle kasowane w UI (AI-04, SY-01) | Wymaga prześledzenia `reset_model_full` | Na starcie etapu 3 |
