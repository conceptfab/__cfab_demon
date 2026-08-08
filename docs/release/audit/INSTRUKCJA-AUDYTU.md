# INSTRUKCJA AUDYTU PRZEDWYDANIOWEGO TIMEFLOW

**Po co ten dokument:** żeby audyt dał się powtórzyć przed każdym wydaniem i żeby kolejny przebieg zaczynał się od stanu wiedzy poprzedniego, a nie od zera.

**Kiedy uruchamiać:** przed każdym wydaniem oznaczonym tagiem. Pełny przebieg (etapy 1–3) po większych zmianach w rdzeniu (czas, sync, schemat). Skrócony (etap 2, wybrane obszary + bramki) przy wydaniu poprawkowym.

**Pierwszy przebieg:** 2026-08-08, commit `1aeaf32`, wersja `0.1.5760` → [ANALIZA-01-globalna.md](./ANALIZA-01-globalna.md), [ANALIZA-02-szczegolowa.md](./ANALIZA-02-szczegolowa.md).

---

## 1. Struktura audytu — trzy etapy

| Etap | Cel | Produkt | Czas |
|---|---|---|---|
| **1. Analiza globalna** | Mapa terenu: warstwy, przepływ danych, obszary podwyższonego ryzyka | `ANALIZA-01-globalna.md` | pół dnia |
| **2. Analiza szczegółowa** | 12 obszarów, weryfikacja tez z etapu 1, tabela ustaleń z dowodami | `ANALIZA-02-szczegolowa.md` | 2–4 dni |
| **3. Plan napraw** | Uporządkowany plan wykonania — kolejność bezpieczna, nie tematyczna | `docs/superpowers/plans/YYYY-MM-DD-*.md` | pół dnia |

**Etapy są sekwencyjne i nieodwracalne w kolejności.** Etap 2 istnieje po to, żeby **obalać** tezy etapu 1 — w pierwszym przebiegu obalił dwie z trzech tez o najwyższym priorytecie. Nie przechodź do etapu 3, dopóki etap 2 nie zweryfikuje każdej tezy z etapu 1.

---

## 2. Siedem zasad prowadzenia

1. **Nie naprawiaj podczas analizy.** Znalazłeś błąd → wpisz do tabeli i idź dalej. Naprawa w trakcie analizy zaburza obraz całości i uniemożliwia priorytetyzację.
2. **Każde ustalenie ma dowód `plik:linia`.** Ustalenie bez dowodu nie istnieje.
3. **Każde ustalenie ma opisany skutek dla użytkownika**, nie tylko opis techniczny. „Ręczny `PartialEq` pomija dwa pola" to obserwacja. „Rozjazd danych AI nie zostanie wykryty, a peery zaraportują *zsynchronizowane*" to ustalenie.
4. **Weryfikuj skutek, nie tylko istnienie.** W pierwszym przebiegu ręczny `PartialEq` z błędem okazał się **bez żadnych wywołań** — skutek zerowy, priorytet spadł z P1 na P2. Bez sprawdzenia wywołań ustalenie byłoby zawyżone.
5. **Zapisuj też to, co sprawdzone i poprawne.** Inaczej następny przebieg zacznie od zera, a audyt wymieniający wyłącznie problemy jest niewiarygodny i prowadzi do przebudowy rzeczy, które działają.
6. **Białe plamy zapisuj jawnie**, z powodem i terminem zamknięcia. „Nie sprawdziłem" jest poprawnym wynikiem. „Wygląda dobrze" bez sprawdzenia — nie jest.
7. **Nie refaktoruj przy okazji.** Audyt produkuje wiedzę, nie commity w kodzie produkcyjnym (poza `scripts/audit/` i `docs/release/`).

---

## 3. Wyznaczone źródła prawdy

Rejestr do sprawdzenia na starcie każdego przebiegu — czy nadal aktualny.

| Co | Źródło prawdy | Weryfikacja |
|---|---|---|
| Czas projektu | `dashboard/src-tauri/src/commands/time_algorithm.rs` (host + `WallClockStrategy` + rejestr) | kto woła `compute_project_activity_unique` |
| Czas per aplikacja | `time_algorithm::distribute_app_seconds` | kto produkuje `TopApp` bez wywołania tej funkcji |
| Zaokrąglanie | `dashboard/src/lib/rounding.ts` — **wyłącznie prezentacja**, nigdy nie modyfikuje danych | czy backend gdziekolwiek zaokrągla przed zapisem |
| Kwota | `dashboard/src-tauri/src/commands/estimates.rs` | czy inne moduły liczą kwotę własną drogą |
| Schemat bazy | `dashboard/src-tauri/src/db_migrations/` (m01…) | czy demon zna każdą tabelę synchronizowaną |
| Kolumny synchronizowane | `shared/sync/columns.rs` | ile encji faktycznie tam jest (w 1. przebiegu: 1 z 9) |
| Checksum tabel | `shared/sync/checksum.rs::table_hash_sql` | używane przez OBIE strony — demona i dashboard |
| Tombstony | `shared/sync/triggers.rs` | ile tabel objętych vs ile synchronizowanych |
| Merge | `shared/sync/merge.rs` | LWW po `updated_at`, klucz sync per encja |
| Ścieżka danych | `shared/timeflow_paths.rs` | demon i dashboard MUSZĄ używać tej samej |
| Numer wersji | `VERSION` | 5 manifestów musi go powtarzać |
| Powierzchnia komend | `#[tauri::command]` → `lib.rs` → `webui/rpc_generated.rs` | trzy rejestry, patrz `check-command-surface.sh` |

**Pola celowo per-maszyna (NIE synchronizowane):** `projects.assigned_folder_path`, `projects.is_imported` (INSERT ustawia `1` na sztywno), `todos.gcal_event_id`, `todos.gcal_synced_at`.

---

## 4. Etap 1 — analiza globalna

**Cel:** ustalić kształt systemu i wskazać, gdzie kopać w etapie 2. **Nie** produkuje ustaleń — produkuje hipotezy oznaczone `G-xx`.

### 4.1 Skala i kształt

```bash
# linie kodu wlasnego
find . -name '*.rs' -not -path './target/*' -not -path '*/target/*' -not -path './.git/*' | xargs wc -l | tail -1
find dashboard/src \( -name '*.ts' -o -name '*.tsx' \) | xargs wc -l | tail -1

# powierzchnia i migracje
./scripts/audit/check-command-surface.sh
ls dashboard/src-tauri/src/db_migrations/

# rozklad testow
find dashboard/src \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' | wc -l
find dashboard/src -name '*.test.ts*' | wc -l
grep -rl '#\[cfg(test)\]' --include='*.rs' src shared dashboard/src-tauri/src | wc -l

# aktywnosc
git log --oneline --since='90 days ago' | wc -l
```

### 4.2 Mapa warstw i przepływ danych

Przeczytaj i narysuj w dokumencie:
- `dashboard/src-tauri/src/lib.rs` (moduły), `commands/mod.rs` (powierzchnia)
- `src/main.rs` (moduły demona), `shared/lib.rs` (co współdzielone)
- `shared/timeflow_paths.rs` (gdzie żyją dane)
- `commands/daily_store_bridge.rs` (most demon → dashboard)

Przepływ do odtworzenia: **zbieranie** (demon) → **materializacja** (sesje) → **interpretacja** (`time_algorithm`) → **prezentacja** (front) → **rozgałęzienie** (sync, dwie niezależne ścieżki eksportu).

### 4.3 Co jest mocne

Obowiązkowa sekcja. Wypisz z dowodami rzeczy, które działają dobrze — inaczej etap 3 zaproponuje przebudowę czegoś, co jest w porządku.

### 4.4 Hipotezy ryzyka `G-xx`

Format: dowód (`plik:linia`) → dlaczego to ryzyko → **co dokładnie zweryfikować w etapie 2**.

### 4.5 Zastrzeżenia

Obowiązkowa sekcja końcowa: czego nie sprawdziłeś i które twierdzenia opierają się na wyszukiwaniu tekstowym zamiast na prześledzeniu wywołań.

---

## 5. Etap 2 — analiza szczegółowa

Dwanaście obszarów. Kolejność 2.0 → 2.11 jest zalecana (2.0 daje liczby, 2.1 poprzedza 2.5), ale obszary 2.6–2.11 są niezależne i dają się rozdzielić.

**Każdy obszar zaczynasz od weryfikacji odpowiadających mu hipotez `G-xx` z etapu 1.** Jeśli hipoteza upada — zapisz to w sekcji „Korekta ustaleń z analizy globalnej" na górze dokumentu, nie zakop w treści.

### 2.0 · Bramki i baseline

```bash
cargo clippy --workspace --all-targets --message-format=short 2>&1 | grep -c "warning:"
cargo fmt --all -- --check 2>&1 | grep -c '^Diff'
cd dashboard && npm run lint:knip && npm run typecheck && npm test && cd ..
cargo test --workspace 2>&1 | grep -E '^test result:'
./scripts/audit/find-panics-in-prod.sh | head -1
grep -rhn "CREATE INDEX" dashboard/src-tauri/src/db_migrations/*.rs | sort -u | wc -l
```

Przejrzyj `.github/workflows/ci.yml` i zapisz dla **każdej** bramki, czy może paść. `|| true` i brak kroku to ta sama wada.

### 2.1 · Obliczenia czasu

```bash
./scripts/audit/find-duplicate-math.sh > /tmp/dup-math.txt
```

Sekcja 2 skanera jest najważniejsza: **różnica listy „produkuje `TopApp`" i listy „woła `distribute_app_seconds`" to gotowa lista ustaleń.**

Dla każdego trafienia z sekcji 1 i 3 zadaj trzy pytania i zapisz odpowiedzi:
1. Czy ta suma trafia na ekran jako liczba, którą użytkownik może porównać z inną liczbą w aplikacji?
2. Czy backend zwraca już tę samą liczbę innym poleceniem?
3. Czy przy włączonym zaokrągleniu obie drogi dadzą ten sam wynik?

| Odpowiedzi | Priorytet |
|---|---|
| tak / tak / nie | **P1** |
| tak / tak / tak | P2 (dziś zgodne, jutro się rozjedzie) |
| nie | wpisz do tabeli „sprawdzone i poprawne" |

**Kluczowe rozróżnienie:** `time_algorithm` **deduplikuje** nakładające się przedziały i dzieli czas współbieżny. Proste `SUM(duration_seconds)` tego nie robi. Jeśli dwa ekrany pokazują tę samą wielkość, a jeden idzie przez strategię, a drugi przez `SUM` — to jest ustalenie, nawet jeśli dziś liczby przypadkiem się zgadzają.

### 2.2 · Punkty paniki

```bash
./scripts/audit/find-panics-in-prod.sh
```

**Nie używaj gołego `grep -c '.unwrap()'`** — patrz §8, pułapka 1.

Klasyfikuj każde trafienie:

| Klasa | Definicja | Działanie |
|---|---|---|
| **A** | Dowodliwie nieosiągalne | Zostaw, dopisz komentarz `// SAFETY: <dowód>` |
| **B** | Możliwe na danych zewnętrznych (archiwum od peera, plik użytkownika, uszkodzona baza) | **Musi zniknąć przed wydaniem** — P0/P1 |
| **C** | Możliwe przy błędzie programisty (indeks tablicy, `expect` na wyniku zapytania) | Zamień na obsługę błędu — P2 |

**Wzorce klasy A występujące w tym repo** (nie klasyfikuj ich od nowa):
- `Mutex::lock().expect("...poisoned")` — mutex zatruwa się tylko po panice innego wątku; przy `panic = "abort"` panika kończy proces, więc zatrucie nie może wystąpić w release.
- `db/pool.rs` `Deref`/`DerefMut` z `expect` — `Option` jest `take()`owany wyłącznie w `Drop`, a `Deref` po `Drop` jest w Rust niemożliwe.
- `Regex::new` / MIME / HMAC na literałach — twierdzenia prawdziwe z konstrukcji.

**Osobno sprawdź `catch_unwind`:**

```bash
grep -rn "catch_unwind" --include='*.rs' src shared dashboard/src-tauri/src
grep -n 'panic *=' Cargo.toml
```

Przy `panic = "abort"` **każdy `catch_unwind` jest martwy** — nie łapie niczego. Jeśli kod polega na nim dla sprzątania (zdejmowanie flag, unfreeze bazy), to zabezpieczenie istnieje tylko w testach, nie w produkcji. To jest ustalenie P1 nawet przy zerowej liczbie panik klasy B.

### 2.3 · Definicje danych i schemat

Zbuduj macierz: wiersz = encja, kolumna = warstwa.

```bash
grep -rn "CREATE TABLE" --include='*.rs' src/sync_common.rs   # schemat demona
ls dashboard/src-tauri/src/db_migrations/                      # schemat dashboardu
cat shared/sync/columns.rs                                     # kolumny scentralizowane
grep -n "fetch_all_rows" src/lan_server.rs                     # eksport demona
grep -n "prepare(" dashboard/src-tauri/src/commands/delta_export.rs  # eksport dashboardu
grep -n "table_hash_sql" -A 5 shared/sync/checksum.rs          # checksum
grep -n "trg_.*_tombstone" shared/sync/triggers.rs             # tombstony
grep -n "pub fn merge_" shared/sync/merge.rs                   # merge
```

Komórki: ✅ / ❌ / `—` (nie dotyczy). **Nigdy nie zostawiaj pustej** — pusta znaczy „nie sprawdziłem", a to musi być widoczne.

Kolumna „Liczba miejsc" dla schematu i dla listy kolumn ma docelowo wynosić **1**.

**Porównując dwie ścieżki eksportu, sprawdź trzy rzeczy:** komplet kolumn, kolejność kolumn, wyrażenia SELECT (`COALESCE` vs surowa kolumna). Kolejność ma znaczenie tylko wtedy, gdy eksport buduje tablice pozycyjne — w tym repo `fetch_all_rows` buduje obiekty z nazwami, więc nie ma. **Sprawdź to, zanim zgłosisz ustalenie o kolejności.**

### 2.4 · Synchronizacja

Macierz wpięcia: encja × {eksport dashboardu, eksport demona, `TableHashes` demona, `TableHashes` dashboardu, merge, trigger tombstone, checksum, test end-to-end}.

**Encja wpięta poprawnie ma ✅ w każdej kolumnie.** Każde ❌ to ustalenie:
- brak w eksporcie → dane się nie propagują (P1),
- brak w checksumie → rozjazd niewykrywalny, fałszywe „zsynchronizowane" (P1),
- brak triggera tombstone → kasowanie nie propaguje się, skasowany wiersz wraca po syncu (P2, P1 jeśli UI pozwala kasować),
- brak testu end-to-end → P2.

Sprawdź też scenariusze międzywersyjne: peer starszy nie zna tabeli, peer nowszy dosyła nieznane pole, archiwum z brakującą sekcją, archiwum ponad limit, uszkodzony JSON.

### 2.5 · Pieniądze

Odtwórz **kanoniczną regułę** z kodu źródła prawdy i zapisz ją jako ciąg kroków. Potem zweryfikuj każdy moduł liczący kwoty wobec tej reguły.

Punkty krytyczne do sprawdzenia:
- **kolejność** zaokrąglenia i mnożnika (dają różne kwoty),
- **pierwszeństwo stawek** — czy każdy poziom (projekt / klient / globalna) jest faktycznie **używany**, a nie tylko zapisywany,
- czy koszty dodatkowe wchodzą do sumy **dokładnie raz** (projekt i agregat klienta),
- czy suma pozycji równa się sumie raportu do grosza.

**Pułapka:** pole stawki może być w schemacie, w UI, w eksporcie i w moście webui — i nie występować w żadnym wyliczeniu. Sprawdzaj przez `grep` w plikach liczących kwotę, nie przez obecność pola.

### 2.6 · Bezpieczeństwo

Wykonaj macierz z `docs/SECURITY_AUDIT.md` — 7 kryteriów × każdy endpoint.

**Kolejność:** najpierw endpointy mutujące stan lub zwracające sekrety.

**Zacznij od bramki uwierzytelnienia, nie od handlerów:**

```bash
grep -n "requires_auth" -A 12 src/lan_server.rs     # lista sciezek bez auth
grep -n "is_loopback" src/lan_server.rs             # ktore maja dodatkowy gate
sed -n '/=> handle_/p' src/lan_server.rs            # tablica routingu
```

**Krytyczne pytanie:** czy każdy endpoint z listy „bez auth" ma `is_loopback`? Handler, który **nie przyjmuje** `client_ip` jako parametru, z definicji nie może go sprawdzić — to sygnał alarmowy widoczny w samej sygnaturze.

Potem prześledź **łańcuchy**, nie pojedyncze endpointy. W pierwszym przebiegu ustalenie P0 wymagało złożenia trzech funkcji: `generate_code()` mintuje kod → `/lan/pair` przyjmuje kod → zwraca sekret. Żadna z nich osobno nie wygląda źle.

Sprawdź także nagłówki odpowiedzi — `Access-Control-Allow-Origin: *` na nieuwierzytelnionym endpoincie w LAN przenosi wektor z „napastnik w sieci" na „dowolna odwiedzona strona WWW".

Osobno: `webui/auth.rs` (sesje, hasła, ciasteczka, `lan_exposure`), `mcp/tools.rs` (czy destrukcyjne narzędzia robią kopię), `tauri.conf.json` + `capabilities/` (CSP, zawężenie uprawnień).

### 2.7 · Wydajność

Statycznie: przegląd indeksów wobec kolumn filtrujących w gorących zapytaniach.

```bash
grep -rhn "CREATE INDEX" dashboard/src-tauri/src/db_migrations/*.rs | sed 's/.*CREATE INDEX/CREATE INDEX/' | sort -u
```

**Analiza statyczna nie wystarcza.** Wymagany profil na bazie realnego rozmiaru — tymczasowy `conn.profile(...)` logujący zapytania >20 ms, przejście wszystkich ekranów, tabela wolnych zapytań. Bez tego wszystko w tej sekcji jest hipotezą i **musi być tak oznaczone**.

### 2.8 · Parity i webui

```bash
./scripts/audit/check-command-surface.sh
cat PARITY.md
```

Każda pozycja z listy „BRAK w webui" wymaga decyzji: front ukrywa funkcję w tym trybie albo tłumaczy jej brak. Cichy brak = P1.

`PARITY.md` nie może zawierać słowa „NIEZWERYFIKOWANE" w wydaniu — albo sprawdzasz na realnym Windows, albo jawnie akceptujesz jako znaną różnicę z uzasadnieniem.

### 2.9 · Nadmiarowość

```bash
cd dashboard && npm run lint:knip && cd ..
cargo clippy --workspace --all-targets 2>&1 | grep -E "never used|never read|never constructed" | sort -u
grep -rn "trait " --include='*.rs' src shared dashboard/src-tauri/src | grep -v 'mod tests'
```

Dla każdego traitu policz implementacje. **Jedna implementacja nie przesądza o usunięciu** — `TimeStrategy` ma jedną i zostaje, bo jest wystawiona użytkownikowi przez `list_time_algorithms` i stanowi kontrakt UI.

**Uwaga na fałszywy martwy kod:** clippy nie widzi funkcji wołanych wyłącznie przez `#[tauri::command]` albo `webui/rpc_generated.rs`. Nie usuwaj niczego, co występuje w tych plikach.

### 2.10 · UI, i18n, Help

```bash
cd dashboard && npm run lint:i18n-hardcoded && npm run lint:inline-i18n-bridge && npm run lint:locales
npx -y react-doctor@latest . --verbose   # z ROOTA repo, oczekiwane 100/100
grep -rn "Timeflow\|timeflow\b" --include='*.tsx' --include='*.json' dashboard/src | grep -v "timeflow-\|@timeflow\|timeflow_"
```

Tabela pokrycia `Help.tsx`: każdy ekran i każda karta ustawień × {opisane?, „co robi"?, „kiedy użyć"?, „ograniczenia"?} — zgodnie z `CLAUDE.md` §3.

Tabela stanów: każdy ekran × {loading, empty, error}. Ekran pokazujący przy błędzie pustą tabelę zamiast komunikatu to P2 — użytkownik nie odróżni „brak danych" od „nie udało się pobrać".

Wymaga uruchomienia aplikacji.

### 2.11 · Rdzeń AI

```bash
wc -l dashboard/src-tauri/src/commands/assignment_model/*.rs
grep -n "weight\|IDF\|idf\|evidence\|confidence" dashboard/src-tauri/src/commands/assignment_model/scoring.rs
grep -n "WHERE source IN" -A 12 dashboard/src-tauri/src/commands/assignment_model/training.rs
```

Pytania do rozstrzygnięcia:
1. Czy fakty (ścieżka pliku w folderze projektu) mają pierwszeństwo przed wyuczoną historią?
2. Czy model uczy się z **własnych** auto-przypisań? (Sprawdź białą listę `source` w treningu — musi zawierać wyłącznie zdarzenia ludzkie.)
3. Czy pewność zależy od **liczby niezależnych dowodów**, czy tylko od przewagi nad drugim kandydatem?
4. Czy tokeny wszechobecne są tłumione (IDF)?
5. Czy istnieje ścieżka bezpieczna z rollbackiem?
6. Czy tabele danych treningowych mają tombstony? (Bez nich cofnięcie nauki wraca po synchronizacji.)
7. Czy decyzje modelu są **wyjaśniane** użytkownikowi? (Infrastruktura: `get_session_score_breakdown`.)

**Rozdziel konstrukcję od skuteczności.** Czytaniem kodu oceniasz konstrukcję. Skuteczność (precision/recall) wymaga oznaczonego zbioru i pomiaru — jeśli tego nie robisz, zapisz jako białą plamę, nie jako ocenę.

---

## 6. Format ustalenia i priorytety

Każdy obszar kończy się tabelą:

| # | Ustalenie | Dowód | Skutek dla użytkownika | Prio | Test pilnujący |
|---|---|---|---|---|---|

Numeracja z prefiksem obszaru: `B-` bramki, `C-` czas, `P-` odporność, `D-` dane, `SY-` sync, `M-` pieniądze, `S-` bezpieczeństwo, `W-` wydajność, `PW-` parity/webui, `N-` nadmiar, `AI-` model.

| Prio | Kryterium | Konsekwencja |
|---|---|---|
| **P0** | Utrata lub uszkodzenie danych, dziura bezpieczeństwa | Blokuje wydanie |
| **P1** | Zły wynik pokazany użytkownikowi (czas, kwota, status) albo zabezpieczenie, którego produkcja nie ma | Blokuje wydanie |
| **P2** | Brak strażnika inwariantu; ryzyko regresji | Do backlogu z zapisaną decyzją |
| **P3** | Wydajność bez odczuwalnego wpływu, edge case | Backlog |
| **P4** | Czystość kodu, dokumentacja | Backlog |

**Do wydania muszą być zamknięte wszystkie P0 i P1.** P2–P4 mogą przejść dalej, ale każdy z zapisaną decyzją „odkładamy, bo…".

Zakończ dokument tabelą zbiorczą wszystkich ustaleń posortowaną po priorytecie oraz liczbą w rozbiciu (`n × P0, n × P1, …`).

---

## 7. Etap 3 — z ustaleń do planu napraw

1. **Kolejność wykonania ≠ kolejność obszarów analizy.** Uporządkuj wg ryzyka i zależności: P0 przed wszystkim, potem liczby widoczne dla użytkownika, potem decyzje architektoniczne, na końcu czystość.
2. **Zależności są wiążące.** Kwoty (2.5) zależą od czasu (2.1). Sync (2.4) zależy od definicji danych (2.3).
3. **Bramki idą pierwsze.** Bez działającego CI każda naprawa może zostać cofnięta niezauważenie.
4. **Każda naprawa = test przed poprawką.** Poprawka bez czerwonego testu, który wcześniej padał, nie jest ukończona.
5. **Ustalenia wymagające decyzji, nie kodu**, wydziel osobno (np. `panic = "abort"` vs `unwind`; czy stawka klienta ma działać, czy jest informacyjna). To pytania do właściciela produktu, nie zadania programistyczne.
6. **Jeden commit = jedno ustalenie.** Etapy wielotygodniowe muszą dać się przerwać w dowolnym momencie z aplikacją w stanie zdatnym do wydania.
7. Naprawa zmieniająca liczbę widzianą przez użytkownika wymaga wpisu w `CHANGELOG.md` i — jeśli dotyczy funkcji — w `Help.tsx` (`CLAUDE.md` §3).

---

## 8. Pułapki wykryte w przebiegu 2026-08-08

Czytaj **przed** rozpoczęciem. Każda z nich kosztowała błędny wniosek.

### Pułapka 1 — goły grep zawyża punkty paniki o dwa rzędy wielkości

`grep -c '.unwrap()\|.expect('` po repo dał **1096** i wniosek „największe ryzyko wydania". Po odsianiu `#[cfg(test)]` i plików `tests.rs`: **26**, z czego 25 klasy A. Trzy pliki wskazane jako „najgorsze" (`sync_common.rs`, `import_data.rs`, `merge.rs`) mają w kodzie produkcyjnym **zero** trafień.

**Reguła:** liczba z gołego grepa nigdy nie jest ustaleniem. Zawsze `find-panics-in-prod.sh`.

### Pułapka 2 — istnienie błędu ≠ jego skutek

Ręczny `impl PartialEq for TableHashes` porównuje 7 z 9 pól. Wygląda na P1. Sprawdzenie wywołań: **zero** — porównanie nie jest nigdzie używane, skutek jest zerowy, priorytet P2 (bomba z opóźnionym zapłonem).

**Reguła:** zanim nadasz priorytet, znajdź wywołania. `grep -rn "<NazwaTypu>"` po całym repo.

### Pułapka 3 — różnica w SELECT nie zawsze jest błędem

Eksport demona pomija `is_imported`, którego eksport dashboardu nie pomija. Wygląda na utratę danych. Sprawdzenie merge: `INSERT` ustawia `is_imported = 1` na sztywno, `UPDATE` nie dotyka pola wcale. **Pominięcie jest bezskutkowe.**

**Reguła:** po znalezieniu różnicy w eksporcie sprawdź, czy merge w ogóle czyta to pole.

### Pułapka 4 — zielona bramka może nic nie sprawdzać

`gen_webrpc.cjs --check` przechodzi, mimo że `print_report` nie działa w webui — generator **świadomie pomija** komendy z parametrem `Window` i generuje poprawny plik. Analogicznie `npm audit ... || true` zawsze zwraca sukces.

**Reguła:** dla każdej bramki zepsuj coś celowo i sprawdź, czy pada. Bramka, której nie widziałeś czerwonej, nie jest zweryfikowana.

### Pułapka 5 — ryzyko widoczne dopiero w łańcuchu

Ustalenie P0 (przejęcie sekretu LAN) wymagało złożenia trzech elementów z trzech miejsc: lista `requires_auth`, brak `is_loopback` w sygnaturze handlera, i to, że `generate_code()` **mintuje** kod zamiast tylko go odczytywać. Każdy element osobno wygląda niewinnie.

**Reguła:** dla powierzchni sieciowej analizuj ścieżki wejścia end-to-end, nie pojedyncze funkcje.

### Pułapka 6 — pole może istnieć wszędzie i nie działać nigdzie

`clients.default_hourly_rate` jest w schemacie, UI, eksporcie, syncu i moście webui — i w żadnym wyliczeniu kwoty.

**Reguła:** obecność pola w modelu nie dowodzi, że wpływa na wynik. Sprawdzaj przez grep w plikach liczących, nie w plikach definiujących.

### Pułapka 7 — zabezpieczenie może być wyłączone przez profil kompilacji

Dziewięć `catch_unwind`, w tym `guarded_then_cleanup` z testem „both flags must be cleared regardless of panic". Wszystkie martwe przy `panic = "abort"` w profilu release. Testy przechodzą (build testowy używa `unwind`), produkcja nie ma tej ochrony.

**Reguła:** porównaj `[profile.release]` z założeniami kodu. Sprawdź `panic`, `overflow-checks`, `debug-assertions` — mechanizmy oparte na nich działają w testach i nie działają w wydaniu.

---

## 9. Lista kontrolna przebiegu

Skopiuj do dokumentu analizy i odhaczaj.

**Etap 1**
- [ ] Skala i kształt zmierzone (nie oszacowane)
- [ ] Mapa warstw i przepływ danych narysowane
- [ ] Sekcja „co jest mocne" wypełniona z dowodami
- [ ] Hipotezy `G-xx` z dowodem i wskazaniem, co weryfikować
- [ ] Sekcja „zastrzeżenia" wypełniona

**Etap 2**
- [ ] Każda hipoteza `G-xx` zweryfikowana; obalone opisane w sekcji „Korekta" na górze
- [ ] Wszystkie 12 obszarów przejrzane lub jawnie oznaczone jako biała plama
- [ ] Każde ustalenie ma dowód `plik:linia` i opisany skutek dla użytkownika
- [ ] Każde ustalenie ma zweryfikowany skutek, nie tylko istnienie
- [ ] Tabela „sprawdzone i poprawne" wypełniona
- [ ] Tabela zbiorcza z rozbiciem liczbowym
- [ ] Sekcja „białe plamy" z powodem i terminem zamknięcia

**Etap 3**
- [ ] Kolejność wg ryzyka i zależności, nie wg obszarów
- [ ] Bramki jako pierwsze
- [ ] Ustalenia wymagające decyzji właściciela wydzielone osobno
- [ ] Każda naprawa ma test przed poprawką
- [ ] Plan da się przerwać w dowolnym momencie
