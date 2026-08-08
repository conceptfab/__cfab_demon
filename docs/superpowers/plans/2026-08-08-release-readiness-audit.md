# TIMEFLOW — Audyt przedwydaniowy i plan naprawczy

> ## ⛔ NIEAKTUALNY — NIE WYKONUJ
>
> Ten plan powstał **przed** analizą kodu i zakładał priorytety, które analiza obaliła
> — m.in. panikę jako główne ryzyko wydania (realnie 26 punktów, 25 klasy A) oraz
> pominięcie właściwego P0 (nieuwierzytelniona ścieżka do sekretu LAN).
>
> **Aktualny plan:** [2026-08-08-plan-napraw.md](./2026-08-08-plan-napraw.md)
> **Podstawa:** [ANALIZA-02-szczegolowa.md](../../release/audit/ANALIZA-02-szczegolowa.md)
>
> Zachowany jako zapis tego, jak wyglądały założenia przed audytem — i dlaczego
> analiza musi poprzedzać planowanie.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doprowadzić TIMEFLOW do stanu wydania: jedno źródło prawdy dla każdego obliczenia i każdej definicji danych, udowodnione testami międzywarstwowymi, przy zamkniętym audycie bezpieczeństwa, wydajności i parity Windows/macOS.

**Architecture:** Audyt idzie warstwami od rdzenia na zewnątrz: najpierw obliczenia (czas → pieniądze), potem definicje danych (schemat, kolumny, kontrakty RPC), potem synchronizacja, potem bezpieczeństwo, wydajność, odporność, a na końcu sprzątanie i inżynieria wydania. Każdy etap kończy się **bramką (gate)**: zestawem testów/skryptów, które od tej pory pilnują regresji w CI. Każdy etap jest samodzielny — po jego zakończeniu aplikacja działa, testy przechodzą, można wydać.

**Tech Stack:** Rust (workspace: `timeflow-demon`, `timeflow-dashboard` (Tauri v2), `timeflow-shared`), SQLite/rusqlite, React 19 + TypeScript + Vite + Zustand + i18next, Vitest, cargo test, ESLint, knip, react-doctor, cargo-deny.

---

## Zasady realizacji (przeczytaj przed startem)

1. **Jeden etap = jedna gałąź = jeden merge.** Nazwa gałęzi: `audit/etapN-<slug>`. Nie łącz etapów.
2. **Każdy etap ma dwie fazy:** (A) **Inwentaryzacja** — produkuje dokument `docs/release/audit/etapN-<slug>.md` z tabelą ustaleń; (B) **Naprawa** — każde ustalenie dostaje osobny commit z testem.
3. **Nie naprawiaj podczas inwentaryzacji.** Znalazłeś błąd → wpisz go do tabeli i idź dalej. Faza naprawcza dopiero potem, po przejrzeniu całości i priorytetyzacji.
4. **Test przed poprawką, zawsze.** Poprawka bez czerwonego testu, który wcześniej padał, nie jest ukończona.
5. **Priorytety ustaleń:** `P0` = utrata/uszkodzenie danych lub dziura bezpieczeństwa; `P1` = zły wynik pokazany użytkownikowi (czas, kwota); `P2` = ryzyko regresji / brak testu na inwariant; `P3` = wydajność bez odczuwalnego wpływu; `P4` = czystość kodu.
6. **Zakres wydania:** do wydania muszą być zamknięte wszystkie `P0` i `P1`. `P2`–`P4` mogą przejść do backlogu, ale muszą być zapisane w dokumencie audytu z decyzją „odkładamy, bo…".
7. **Help.tsx:** jeśli naprawa zmienia zachowanie odczuwalne przez użytkownika — aktualizacja `dashboard/src/pages/Help.tsx` w tym samym commicie (reguła z `CLAUDE.md`).
8. **Nie refaktoruj przy okazji.** Etap 8 jest od sprzątania. W etapach 1–7 zmieniasz tylko to, co wynika z ustalenia.

## Definicja ukończenia etapu

Etap jest zamknięty, gdy:
- [ ] dokument `docs/release/audit/etapN-<slug>.md` ma wypełnioną tabelę ustaleń bez pustych pól,
- [ ] wszystkie `P0`/`P1` z tego etapu mają commit z testem,
- [ ] bramka etapu (skrypt/test) jest wpięta do `.github/workflows/ci.yml` i przechodzi,
- [ ] `docs/release/RELEASE_CHECKLIST.md` ma odhaczony wiersz tego etapu.

---

## Mapa plików tworzonych przez plan

| Plik | Odpowiedzialność |
|---|---|
| `docs/release/RELEASE_CHECKLIST.md` | Nadrzędna lista kontrolna wydania; jeden wiersz na etap + bramki wydaniowe |
| `docs/release/BASELINE.md` | Zmierzone wartości wyjściowe (rozmiar bundla, czas startu, pokrycie testami, liczba zapytań) — punkt odniesienia dla etapu 6 |
| `docs/release/audit/etap1-czas.md` … `etap11-wydanie.md` | Tabele ustaleń per etap |
| `docs/release/INVARIANTS.md` | Rejestr inwariantów obliczeniowych aplikacji + nazwa testu pilnującego każdego z nich |
| `scripts/audit/find-duplicate-math.sh` | Skaner miejsc liczących to samo w dwóch warstwach |
| `scripts/audit/check-version-sync.sh` | Bramka: `VERSION` == wszystkie manifesty |
| `dashboard/src-tauri/tests/consistency.rs` | Testy integracyjne międzymodułowe (czas/pieniądze na jednej bazie) |
| `dashboard/src/lib/__tests__/cross-layer.test.ts` | Testy: front nie liczy tego, co liczy backend |

---

## Etap 0 — Bramki i baseline (fundament pod resztę)

**Cel:** Zanim zaczniesz audyt, ustaw narzędzia, które pokażą regresję. Bez tego etapy 1–11 nie mają jak udowodnić poprawy.

**Files:**
- Create: `docs/release/RELEASE_CHECKLIST.md`
- Create: `docs/release/BASELINE.md`
- Create: `scripts/audit/check-version-sync.sh`
- Modify: `.github/workflows/ci.yml`

### Task 0.1: Bramka spójności wersji

Dziś numer wersji żyje w czterech miejscach (`VERSION`, `Cargo.toml`, `dashboard/src-tauri/Cargo.toml`, `shared/Cargo.toml`, `dashboard/package.json`, `dashboard/src-tauri/tauri.conf.json`). Zsynchronizowane są ręcznie przez `dashboard/scripts/sync-version.cjs` odpalany w `pretauri` — czyli tylko przy buildzie Tauri. Nic nie broni commita z rozjazdem.

- [ ] **Step 1: Napisz skrypt-bramkę**

Create `scripts/audit/check-version-sync.sh`:

```bash
#!/usr/bin/env bash
# Bramka wydaniowa: VERSION jest jedynym źródłem prawdy dla numeru wersji.
# Każdy manifest musi go powtarzać co do znaku.
set -euo pipefail
cd "$(dirname "$0")/../.."

EXPECTED="$(tr -d '[:space:]' < VERSION)"
if [ -z "$EXPECTED" ]; then
  echo "FAIL: plik VERSION jest pusty"
  exit 1
fi

fail=0
check() { # $1 = opis, $2 = wartość znaleziona
  if [ "$2" != "$EXPECTED" ]; then
    echo "FAIL: $1 = '$2', oczekiwano '$EXPECTED'"
    fail=1
  else
    echo "ok:   $1 = $2"
  fi
}

check "Cargo.toml (timeflow-demon)" \
  "$(awk '/^\[package\]/{p=1} p && /^version *=/{gsub(/[" ]/,"",$3); print $3; exit}' Cargo.toml)"
check "shared/Cargo.toml" \
  "$(awk '/^\[package\]/{p=1} p && /^version *=/{gsub(/[" ]/,"",$3); print $3; exit}' shared/Cargo.toml)"
check "dashboard/src-tauri/Cargo.toml" \
  "$(awk '/^\[package\]/{p=1} p && /^version *=/{gsub(/[" ]/,"",$3); print $3; exit}' dashboard/src-tauri/Cargo.toml)"
check "dashboard/package.json" \
  "$(node -p "require('./dashboard/package.json').version")"
check "dashboard/src-tauri/tauri.conf.json" \
  "$(node -p "require('./dashboard/src-tauri/tauri.conf.json').version")"

exit $fail
```

- [ ] **Step 2: Uruchom i zobacz wynik**

Run: `chmod +x scripts/audit/check-version-sync.sh && ./scripts/audit/check-version-sync.sh`
Expected: pięć linii `ok:` i kod wyjścia 0. Jeśli któraś linia to `FAIL`, **nie poprawiaj skryptu** — popraw manifest, żeby zgadzał się z `VERSION`, i uruchom ponownie.

- [ ] **Step 3: Wepnij bramkę do CI**

W `.github/workflows/ci.yml`, w jobie `frontend`, przed `npm run typecheck` dodaj krok (uwaga: job ma `working-directory: dashboard`, więc wołamy z `..`):

```yaml
      - run: ../scripts/audit/check-version-sync.sh
```

- [ ] **Step 4: Commit**

```bash
git add scripts/audit/check-version-sync.sh .github/workflows/ci.yml
git commit -m "ci: bramka spójności numeru wersji między VERSION a manifestami"
```

### Task 0.2: Clippy i rustfmt jako bramka

CI uruchamia `cargo test`, ale **nie** uruchamia `cargo clippy` ani `cargo fmt --check`. To znaczy, że lint Rusta nie pilnuje niczego. Wchodzimy stopniowo: najpierw bez `-D warnings`, żeby zobaczyć skalę.

- [ ] **Step 1: Zmierz skalę ostrzeżeń**

Run: `cargo clippy --workspace --all-targets 2>&1 | grep -c '^warning'`
Zapisz liczbę — trafi do `docs/release/BASELINE.md` w Task 0.4.

- [ ] **Step 2: Dodaj job do CI (na razie bez `-D warnings`)**

W `.github/workflows/ci.yml` dodaj nowy job na końcu pliku:

```yaml
  lint-rust:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
      - uses: Swatinem/rust-cache@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: dashboard/package-lock.json
      # timeflow-dashboard osadza dashboard/dist przez include_dir! — najpierw front.
      - run: cd dashboard && npm ci && npm run build
      - run: cargo fmt --all -- --check
      # Bez -D warnings do czasu zamknięcia etapu 8; wtedy zaostrzamy.
      - run: cargo clippy --workspace --all-targets
```

- [ ] **Step 3: Napraw formatowanie, jeśli `cargo fmt --check` pada**

Run: `cargo fmt --all` — a potem obejrzyj diff (`git diff --stat`). Jeżeli diff jest ogromny (>50 plików), **nie commituj go razem z resztą** — zrób osobny commit `style: cargo fmt --all` i wpisz go do `.git-blame-ignore-revs`:

```bash
cargo fmt --all
git add -A && git commit -m "style: cargo fmt --all (formatting only, no logic change)"
git rev-parse HEAD >> .git-blame-ignore-revs
git add .git-blame-ignore-revs && git commit -m "chore: ignore the fmt-only commit in git blame"
```

- [ ] **Step 4: Commit bramki**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: uruchamiaj cargo fmt --check i cargo clippy dla całego workspace"
```

### Task 0.3: Napraw bramkę audytu zależności

W jobie `audit` linia `npm audit --omit=dev || true` **zawsze zwraca sukces** — bramka nic nie pilnuje. Analogicznie `cargo deny check advisories bans` pomija `licenses` i `sources`.

- [ ] **Step 1: Zobacz, co dziś zgłasza npm audit**

Run: `cd dashboard && npm audit --omit=dev --audit-level=high`
Expected: albo `found 0 vulnerabilities`, albo lista. Zapisz wynik.

- [ ] **Step 2: Zaostrz bramkę do poziomu `high`**

W `.github/workflows/ci.yml`, w jobie `audit`, zamień:

```yaml
      - run: cd dashboard && npm audit --omit=dev || true
```

na:

```yaml
      # Bez `|| true` — bramka ma padać. Poziom `high`: krytyczne i wysokie blokują
      # wydanie, niższe trafiają do backlogu etapu 5.
      - run: cd dashboard && npm ci && npm audit --omit=dev --audit-level=high
```

- [ ] **Step 3: Rozszerz cargo-deny o licencje i źródła**

Zamień:

```yaml
      - run: cargo deny check advisories bans
```

na:

```yaml
      - run: cargo deny check advisories bans licenses sources
```

- [ ] **Step 4: Uruchom lokalnie i napraw `deny.toml`**

Run: `cargo deny check advisories bans licenses sources`
Expected: jeśli pada na `licenses`, uzupełnij sekcję `[licenses]` w `deny.toml` o listę dopuszczonych licencji (`allow = ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "Unicode-3.0", "Zlib"]`) i dopisz wyjątki (`[[licenses.exceptions]]`) tylko dla realnie użytych crate'ów. **Nie ustawiaj `allow-osi-fsf-free = "both"` jako drogi na skróty** — chodzi o świadomą listę.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml deny.toml
git commit -m "ci: audyt zależności faktycznie blokuje (npm audit --audit-level=high, cargo deny licenses+sources)"
```

### Task 0.4: Zmierz baseline

Bez liczb wyjściowych etap 6 (wydajność) nie ma jak udowodnić poprawy.

- [ ] **Step 1: Zbierz metryki**

Run kolejno i zapisz wyniki:

```bash
# 1. Rozmiar bundla frontu
cd dashboard && npm run build && du -sh dist && ls -S dist/assets/*.js | head -5 | xargs -I{} sh -c 'echo "$(du -h {})"'
# 2. Pokrycie testami frontu
npm run test:coverage 2>&1 | tail -20
# 3. Liczba testów Rusta
cd .. && cargo test --workspace 2>&1 | grep -E '^test result:'
# 4. Rozmiar binariów release
cargo build --release -p timeflow-demon && ls -lh target/release/timeflow-demon
# 5. Liczba ostrzeżeń clippy (z Task 0.2 Step 1)
cargo clippy --workspace --all-targets 2>&1 | grep -c '^warning'
# 6. Martwy kod frontu
cd dashboard && npm run lint:knip
```

- [ ] **Step 2: Zapisz do dokumentu**

Create `docs/release/BASELINE.md` — wypełnij realnymi liczbami z kroku 1:

```markdown
# BASELINE — stan wyjściowy przed audytem przedwydaniowym

Zmierzone na commicie `<sha>`, dnia `<data>`, na `<macOS 27 / M-seria>`.
Wszystkie liczby w etapie 6 porównujemy do tej tabeli.

| Metryka | Wartość | Jak zmierzone |
|---|---|---|
| `dashboard/dist` łącznie | | `du -sh dist` |
| Największy chunk JS | | `ls -S dist/assets/*.js \| head -1` |
| Pokrycie testami (statements) | | `npm run test:coverage` |
| Liczba testów Vitest | | `npm test` |
| Liczba testów cargo (workspace) | | `cargo test --workspace` |
| `target/release/timeflow-demon` | | `ls -lh` |
| Ostrzeżenia clippy | | `cargo clippy --workspace --all-targets` |
| Nieużywane eksporty (knip) | | `npm run lint:knip` |
| Czas zimnego startu dashboardu | | stoper: uruchomienie → widoczny Dashboard |
| RAM demona po 1 h pracy | | Activity Monitor / `ps -o rss= -p $(pgrep -f timeflow-demon)` |
```

- [ ] **Step 3: Commit**

```bash
git add docs/release/BASELINE.md
git commit -m "docs: baseline metryk przed audytem przedwydaniowym"
```

### Task 0.5: Utwórz nadrzędną listę kontrolną wydania

- [ ] **Step 1: Napisz checklistę**

Create `docs/release/RELEASE_CHECKLIST.md`:

```markdown
# TIMEFLOW — lista kontrolna wydania

Wydanie jest gotowe, gdy każdy wiersz ma ✅ **albo** świadomą, zapisaną decyzję
o odłożeniu. Szczegóły każdego etapu: `docs/superpowers/plans/2026-08-08-release-readiness-audit.md`.

## Etapy audytu

| # | Etap | Dokument ustaleń | P0/P1 zamknięte | Bramka w CI | Status |
|---|---|---|---|---|---|
| 0 | Bramki i baseline | `BASELINE.md` | — | ✅ | |
| 1 | Jedno źródło prawdy — czas | `audit/etap1-czas.md` | | | |
| 2 | Jedno źródło prawdy — dane i kontrakty | `audit/etap2-dane.md` | | | |
| 3 | Spójność synchronizacji (LAN + online) | `audit/etap3-sync.md` | | | |
| 4 | Pieniądze, stawki, raporty | `audit/etap4-pieniadze.md` | | | |
| 5 | Bezpieczeństwo | `audit/etap5-bezpieczenstwo.md` | | | |
| 6 | Wydajność | `audit/etap6-wydajnosc.md` | | | |
| 7 | Odporność na błędy i awarie | `audit/etap7-odpornosc.md` | | | |
| 8 | Nadmiarowość i over-engineering | `audit/etap8-nadmiar.md` | | | |
| 9 | Parity Windows ⇄ macOS | `audit/etap9-parity.md` | | | |
| 10 | UI, i18n, Help, terminologia | `audit/etap10-ui.md` | | | |
| 11 | Inżynieria wydania | `audit/etap11-wydanie.md` | | | |

## Bramki wydaniowe (odhacz tuż przed wydaniem)

- [ ] `VERSION` podbity, `CHANGELOG.md` ma sekcję dla tej wersji zamiast `Unreleased`
- [ ] `./scripts/audit/check-version-sync.sh` → 0
- [ ] `cargo test --workspace` → 0 failed
- [ ] `cd dashboard && npm run typecheck && npm run lint && npm run lint:knip && npm test` → 0
- [ ] `npx -y react-doctor@latest . --verbose` → 100/100
- [ ] `cargo deny check advisories bans licenses sources` → 0
- [ ] `cd dashboard && npm audit --omit=dev --audit-level=high` → 0
- [ ] Build macOS podpisany i notaryzowany, otwiera się na czystej maszynie
- [ ] Build Windows powstaje i uruchamia się na czystej maszynie
- [ ] Smoke test na **czystym profilu** (pusta baza): monitorowanie → sesja → przypisanie → raport
- [ ] Smoke test **migracji**: kopia bazy z poprzedniej wersji otwiera się i pokazuje te same sumy
- [ ] Sync LAN między dwiema maszynami: zbieżność, `table_hashes` równe po obu stronach
- [ ] Ścieżka wycofania (rollback) opisana i przetestowana — patrz etap 11
```

- [ ] **Step 2: Commit**

```bash
git add docs/release/RELEASE_CHECKLIST.md
git commit -m "docs: nadrzędna lista kontrolna wydania TIMEFLOW"
```

**Bramka etapu 0:** CI zielone z nowymi jobami `lint-rust` i zaostrzonym `audit`; `BASELINE.md` i `RELEASE_CHECKLIST.md` w repo.

---

## Etap 1 — Jedno źródło prawdy: obliczenia czasu

**Cel:** Udowodnić, że w całej aplikacji istnieje **dokładnie jeden** algorytm liczenia czasu i że front go nie duplikuje.

**Kontekst dla wykonawcy:** `dashboard/src-tauri/src/commands/time_algorithm.rs` deklaruje się jako „single physical home for the time-computation algorithm" — host (`load_project_intervals`) + strategia (`WallClockStrategy`) + rejestr. To jest **zamierzone** źródło prawdy. Zadaniem etapu jest sprawdzić, czy deklaracja jest prawdziwa: czy `dashboard/src/components/time-analysis/`, `project-day-timeline/timeline-calculations.ts`, `report-timeline.ts`, `sessions-grouping.ts`, `pm-projects-list-utils.ts` i kontrolery stron liczą czas ponownie, czy tylko formatują to, co przyszło z backendu.

**Files:**
- Create: `docs/release/audit/etap1-czas.md`
- Create: `scripts/audit/find-duplicate-math.sh`
- Create: `docs/release/INVARIANTS.md`
- Create: `dashboard/src-tauri/tests/consistency.rs`

### Task 1.1: Skaner miejsc liczących czas

- [ ] **Step 1: Napisz skaner**

Create `scripts/audit/find-duplicate-math.sh`:

```bash
#!/usr/bin/env bash
# Wypisuje kandydatów na "drugi algorytm": miejsca, które agregują czas/kwoty
# poza wyznaczonym źródłem prawdy. To NIE jest bramka — to narzędzie inwentaryzacji.
# Wynik przeklejasz do docs/release/audit/etap1-czas.md i oceniasz ręcznie.
set -uo pipefail
cd "$(dirname "$0")/../.."

echo "=== FRONT: agregacja sekund/czasu trwania ==="
grep -rn --include='*.ts' --include='*.tsx' \
  -E 'reduce\(|\+= *[a-zA-Z_]*([Ss]econds|[Dd]uration)|Math\.(min|max)\(.*([Ss]tart|[Ee]nd)' \
  dashboard/src \
  | grep -viE '\.test\.|__tests__' \
  | grep -iE 'second|duration|elapsed|total|sum|start|end'

echo
echo "=== FRONT: własna arytmetyka dat/przedziałów ==="
grep -rn --include='*.ts' --include='*.tsx' \
  -E 'getTime\(\)|new Date\(.*\) *-|differenceIn|addSeconds|overlap' \
  dashboard/src \
  | grep -viE '\.test\.|__tests__'

echo
echo "=== BACKEND: agregacja czasu w SQL poza time_algorithm.rs ==="
grep -rn --include='*.rs' \
  -E "SUM\(|julianday|strftime\('%s'|duration_seconds" \
  dashboard/src-tauri/src src shared \
  | grep -v 'time_algorithm.rs' \
  | grep -v '/tests.rs' \
  | grep -v 'mod tests'

echo
echo "=== BACKEND: mnożniki i stawki ==="
grep -rn --include='*.rs' -E 'multiplier|hourly_rate|rate_multiplier' \
  dashboard/src-tauri/src src shared | grep -v '/tests.rs'
```

- [ ] **Step 2: Uruchom skaner i zrzuć wynik do pliku roboczego**

Run:
```bash
chmod +x scripts/audit/find-duplicate-math.sh
./scripts/audit/find-duplicate-math.sh > /tmp/etap1-raw.txt
wc -l /tmp/etap1-raw.txt
```
Expected: kilkaset linii. To surowiec, nie wynik.

- [ ] **Step 3: Commit skanera**

```bash
git add scripts/audit/find-duplicate-math.sh
git commit -m "chore(audit): skaner miejsc duplikujących obliczenia czasu i kwot"
```

### Task 1.2: Inwentaryzacja — tabela ustaleń dla czasu

- [ ] **Step 1: Utwórz szkielet dokumentu**

Create `docs/release/audit/etap1-czas.md`:

```markdown
# Etap 1 — Jedno źródło prawdy: obliczenia czasu

**Wyznaczone źródło prawdy:** `dashboard/src-tauri/src/commands/time_algorithm.rs`
(host `load_project_intervals` + strategia `WallClockStrategy` + rejestr `registry()`).

**Reguła, którą weryfikujemy:** front **nie liczy** czasu. Front wyłącznie:
(a) formatuje sekundy na tekst, (b) nakłada zaokrąglenie prezentacyjne
(`dashboard/src/lib/rounding.ts`), (c) grupuje/sortuje gotowe wartości.
Każde `reduce`, które sumuje sekundy w celu pokazania **innej liczby** niż
suma zwrócona przez backend, jest ustaleniem.

## Tabela ustaleń

| # | Plik:linia | Co liczy | Kto jest źródłem prawdy dla tej liczby | Zgodne? | Priorytet | Decyzja |
|---|---|---|---|---|---|---|
| 1-01 | | | | tak/nie | P0–P4 | |

## Miejsca sprawdzone i uznane za poprawne

(wypisz je jawnie — inaczej następny audyt zacznie od zera)

| Plik | Dlaczego to nie jest drugi algorytm |
|---|---|
```

- [ ] **Step 2: Przejdź listę z `/tmp/etap1-raw.txt` i wypełnij tabelę**

Dla **każdej** linii z sekcji „FRONT: agregacja sekund" zadaj trzy pytania i zapisz odpowiedzi w wierszu tabeli:
1. Czy ta suma trafia na ekran jako liczba, którą użytkownik może porównać z inną liczbą w aplikacji?
2. Czy backend zwraca już tę samą liczbę innym poleceniem?
3. Czy przy włączonym zaokrągleniu (`rounding.ts`) obie drogi dadzą ten sam wynik?

Jeśli odpowiedzi to „tak / tak / nie" — to `P1`. Jeśli „tak / tak / tak" — to `P2` (duplikat bez skutku dziś, ale rozjedzie się jutro). Jeśli „nie" — wpisz do drugiej tabeli jako sprawdzone i poprawne.

Zacznij od tych plików — są największe i najbardziej ryzykowne:
- `dashboard/src/components/dashboard/project-day-timeline/timeline-calculations.ts` (628 linii)
- `dashboard/src/components/time-analysis/useTimeAnalysisData.ts` (528 linii)
- `dashboard/src/lib/report-timeline.ts`
- `dashboard/src/lib/sessions-grouping.ts`
- `dashboard/src/lib/pm-projects-list-utils.ts`
- `dashboard/src/lib/estimate-report.ts`
- `dashboard/src/hooks/useDashboardPageController.ts`
- `dashboard/src/hooks/useReportViewController.ts`

- [ ] **Step 3: Sprawdź drugą stronę — SQL sumujący czas poza `time_algorithm.rs`**

Sekcja „BACKEND: agregacja czasu w SQL" pokazuje `SUM(...)` w plikach takich jak `commands/dashboard.rs`, `commands/report.rs`, `commands/clients.rs`, `commands/estimates.rs`, `commands/analysis.rs`. Dla każdego zapisz w tabeli, czy suma powstaje z tych samych przedziałów co `time_algorithm.rs`, czy z surowego `sessions.duration_seconds`. **Różnica jest kluczowa:** `time_algorithm` deduplikuje nakładające się przedziały i dzieli czas współbieżny (patrz `effective_by_source` i jego niezmiennik), a proste `SUM(duration_seconds)` tego nie robi. Jeśli dwa ekrany pokazują „czas projektu X" i jeden idzie przez strategię, a drugi przez `SUM`, to jest `P1`.

- [ ] **Step 4: Commit dokumentu**

```bash
git add docs/release/audit/etap1-czas.md
git commit -m "docs(audit): inwentaryzacja miejsc liczących czas (etap 1, faza A)"
```

### Task 1.3: Rejestr inwariantów

Bez spisanych inwariantów nie da się napisać testów, które ich pilnują.

- [ ] **Step 1: Napisz rejestr**

Create `docs/release/INVARIANTS.md`:

```markdown
# INVARIANTS — inwarianty obliczeniowe TIMEFLOW

Każdy wiersz to zdanie, które musi być prawdziwe **zawsze**, plus nazwa testu,
który to sprawdza. Wiersz bez testu jest ustaleniem P2.

## Czas

| # | Inwariant | Test |
|---|---|---|
| I-01 | Suma czasów efektywnych wszystkich źródeł projektu równa się `total_by_project` tego projektu | `time_algorithm.rs` (istniejący `#[cfg(test)]`) |
| I-02 | Suma czasów projektów w zakresie dat = suma czasów kubełków (dni/tygodni) w tym samym zakresie | do napisania |
| I-03 | Czas projektu na stronie Dashboard = czas tego samego projektu na stronie Projects dla tego samego zakresu | do napisania |
| I-04 | Czas projektu w raporcie = czas projektu w Time Analysis dla tego samego zakresu | do napisania |
| I-05 | Suma czasu wszystkich projektów + „nieprzypisane" = całkowity zmierzony czas w zakresie | do napisania |
| I-06 | Nakładające się sesje nie są liczone dwa razy | do napisania |
| I-07 | Sesja manualna i sesja automatyczna w tym samym oknie czasowym nie sumują się podwójnie | do napisania |
| I-08 | Zmiana strefy czasowej / DST nie zmienia sumy dziennej dla dnia bez przejścia DST | do napisania |

## Zaokrąglanie

| # | Inwariant | Test |
|---|---|---|
| I-10 | Zaokrąglenie nigdy nie modyfikuje danych źródłowych w bazie | do napisania |
| I-11 | `per_total`: suma dni po zaokrągleniu = zaokrąglona suma całkowita (nadwyżka rozdzielona) | `report-consistency.test.ts` (istnieje) |
| I-12 | Zaokrąglenie wyłączone ⇒ wartości identyczne z surowymi | `report-consistency.test.ts` (istnieje) |
| I-13 | Zaokrąglenie jest zawsze w górę i nigdy nie zamienia 0 s na >0 s | `rounding.test.ts` (istnieje) |

## Pieniądze

| # | Inwariant | Test |
|---|---|---|
| I-20 | Kwota = zaokrąglone sekundy × stawka; nigdy surowe sekundy × stawka przy włączonym zaokrągleniu | do napisania |
| I-21 | Suma kwot pozycji raportu = kwota łączna raportu (do 1 grosza) | do napisania |
| I-22 | Koszty dodatkowe (`project_costs`) wchodzą do sumy projektu dokładnie raz | do napisania |
| I-23 | Stawka projektu ma pierwszeństwo nad stawką klienta, a mnożnik sesji nakłada się na obie — w każdym module tak samo | do napisania |

## Dane i synchronizacja

| # | Inwariant | Test |
|---|---|---|
| I-30 | `table_hashes` demona i dashboardu opisują ten sam zbiór tabel | do napisania (etap 3) |
| I-31 | Merge jest idempotentny: dwukrotny merge tego samego archiwum daje tę samą bazę | `sync_common.rs` (częściowo) |
| I-32 | Po zbieżności sync `table_hashes` obu peerów są równe | `sync_common.rs:1754` (istnieje) |
| I-33 | Pole per-maszyna (`gcal_event_id`, `gcal_synced_at`) nigdy nie wchodzi do eksportu/merge/checksumu | `merge_todos_never_touches_gcal_fields` (istnieje) |
```

- [ ] **Step 2: Commit**

```bash
git add docs/release/INVARIANTS.md
git commit -m "docs: rejestr inwariantów obliczeniowych TIMEFLOW"
```

### Task 1.4: Test międzymodułowy — jedna baza, dwa moduły, ta sama liczba (I-03/I-04)

To jest serce etapu: test, który tworzy bazę z sesjami i sprawdza, że **różne polecenia backendu** zwracają dla tego samego zakresu tę samą sumę.

- [ ] **Step 1: Znajdź, jak istniejące testy budują bazę**

Run: `grep -n "fn .*test_db\|fn setup\|Connection::open_in_memory" dashboard/src-tauri/src/commands/sessions/tests.rs | head -20`
Przeczytaj znalezioną funkcję pomocniczą i **użyj jej ponownie** zamiast pisać własną. Jeśli jest prywatna, wystaw ją jako `pub(crate)` w module `#[cfg(test)]`.

- [ ] **Step 2: Napisz test padający — suma kubełków = suma projektów (I-02)**

Dopisz na końcu `dashboard/src-tauri/src/commands/time_algorithm.rs`, wewnątrz istniejącego `mod tests`:

```rust
    /// I-02: dla tego samego zakresu suma czasu po kubełkach (dni) musi być
    /// równa sumie czasu po projektach. Rozjazd oznacza, że kubełkowanie gubi
    /// albo dubluje sekundy na granicy dnia.
    #[test]
    fn bucket_totals_equal_project_totals() {
        let conn = test_conn_with_sessions(&[
            // (start, end, project) — sesja przechodząca przez północ
            ("2026-03-01 22:30:00", "2026-03-02 01:15:00", "Alpha"),
            ("2026-03-02 09:00:00", "2026-03-02 10:00:00", "Beta"),
            ("2026-03-02 09:30:00", "2026-03-02 10:30:00", "Alpha"),
        ]);

        let out = compute_for_range(
            &conn,
            "2026-03-01",
            "2026-03-03",
            BucketKind::Day,
        );

        let by_bucket: i64 = out
            .bucket_project_seconds
            .values()
            .flat_map(|m| m.values())
            .map(|s| s.round() as i64)
            .sum();
        let by_project: i64 = out
            .total_by_project
            .values()
            .map(|s| s.round() as i64)
            .sum();

        assert_eq!(
            by_bucket, by_project,
            "suma kubełków ({by_bucket} s) != suma projektów ({by_project} s)"
        );
    }
```

**Uwaga:** nazwy `test_conn_with_sessions`, `compute_for_range`, `BucketKind::Day` muszą odpowiadać temu, co realnie istnieje w pliku. Jeśli publiczna funkcja liczenia nazywa się inaczej, **odczytaj ją z pliku i dostosuj wywołanie** — nie zmieniaj kodu produkcyjnego, żeby dopasować go do testu. Jeśli pomocnika `test_conn_with_sessions` nie ma, napisz go w `mod tests` jako pierwszą rzecz.

- [ ] **Step 3: Uruchom test — musi paść albo przejść**

Run: `cargo test -p timeflow-dashboard bucket_totals_equal_project_totals -- --nocapture`
- Jeśli **przechodzi** — świetnie, inwariant już trzyma. Oznacz I-02 w `INVARIANTS.md` nazwą tego testu i przejdź do Step 5.
- Jeśli **pada** — masz ustalenie `P1`. Wpisz je do `etap1-czas.md`, potem przejdź do Step 4.

- [ ] **Step 4: Napraw (tylko jeśli test padł)**

Nie zgaduj. Uruchom test z wypisaniem obu map:

```rust
        eprintln!("buckets: {:#?}", out.bucket_project_seconds);
        eprintln!("totals:  {:#?}", out.total_by_project);
```

Porównaj, na którym dniu brakuje sekund. Najczęstsza przyczyna: przedział przecinający północ jest przycinany do zakresu przy kubełkowaniu, ale nie przy sumie projektu (albo odwrotnie). Popraw **jedno** miejsce — to, które łamie regułę „kubełki są rozbiciem sumy, a nie osobnym liczeniem". Usuń `eprintln!` przed commitem.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/time_algorithm.rs docs/release/INVARIANTS.md
git commit -m "test(time): I-02 suma kubełków równa sumie projektów (sesja przez północ)"
```

### Task 1.5: Test cross-layer — front nie liczy tego, co liczy backend (I-03)

- [ ] **Step 1: Ustal, jakie polecenia backendu zwracają „czas projektu"**

Run: `grep -rn "pub async fn\|#\[tauri::command\]" dashboard/src-tauri/src/commands/dashboard.rs dashboard/src-tauri/src/commands/time_algorithm.rs dashboard/src-tauri/src/commands/projects.rs | grep -B0 -A1 'tauri::command' | head -40`

Wypisz w `etap1-czas.md` listę poleceń zwracających czas projektu i dla każdego: który ekran go używa.

- [ ] **Step 2: Napisz test integracyjny Rusta porównujący dwa polecenia**

Create `dashboard/src-tauri/tests/consistency.rs`:

```rust
//! Testy międzymodułowe: te same dane, różne polecenia, ta sama liczba.
//!
//! Sens: pojedyncze moduły mają własne testy jednostkowe, ale nikt nie pilnuje,
//! że Dashboard i Projects pokazują tę samą liczbę dla tego samego projektu.
//! Ten plik jest jedynym miejscem, gdzie taki inwariant jest sprawdzany.

// UWAGA dla wykonawcy: `timeflow-dashboard` to crate binarny Tauri; jeśli testy
// integracyjne nie mają dostępu do potrzebnych elementów, przenieś ten test do
// `#[cfg(test)] mod cross_module` wewnątrz `dashboard/src-tauri/src/commands/mod.rs`
// i zachowaj treść asercji bez zmian.

#[test]
fn placeholder_until_command_surface_is_mapped() {
    // Zastępujesz w Step 3 realnym testem. Ten test istnieje, żeby plik
    // kompilował się i był wpięty w CI od pierwszego commita.
    assert!(true);
}
```

- [ ] **Step 3: Zastąp placeholder realnym testem**

Na podstawie listy z Step 1 napisz test, który: (a) tworzy bazę tymczasową z 3 projektami i 10 sesjami (w tym jedna manualna i jedna nakładająca się), (b) woła funkcję stojącą za poleceniem Dashboard, (c) woła funkcję stojącą za poleceniem Projects/Time Analysis dla tego samego zakresu, (d) porównuje sumy per projekt z tolerancją 0 sekund.

Wzorzec asercji (dostosuj nazwy funkcji do tego, co znalazłeś):

```rust
    let dash = dashboard_project_seconds(&conn, "2026-03-01", "2026-03-31");
    let analysis = analysis_project_seconds(&conn, "2026-03-01", "2026-03-31");

    for (project, seconds) in &dash {
        assert_eq!(
            analysis.get(project).copied().unwrap_or(0),
            *seconds,
            "projekt '{project}': Dashboard pokazuje {seconds} s, Time Analysis co innego"
        );
    }
    assert_eq!(
        dash.len(),
        analysis.len(),
        "moduły widzą różny zestaw projektów"
    );
```

- [ ] **Step 4: Uruchom**

Run: `cargo test -p timeflow-dashboard --test consistency -- --nocapture`
Expected: PASS, albo czerwone z konkretną nazwą projektu i dwiema liczbami — wtedy masz ustalenie `P1` do wpisania w tabelę.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/tests/consistency.rs docs/release/audit/etap1-czas.md
git commit -m "test(consistency): Dashboard i Time Analysis raportują ten sam czas projektu"
```

### Task 1.6: Naprawa ustaleń P1 z tabeli

- [ ] **Step 1: Posortuj tabelę po priorytecie**

Otwórz `docs/release/audit/etap1-czas.md`. Weź pierwsze ustalenie `P1`.

- [ ] **Step 2: Dla każdego ustalenia P1 — pętla naprawcza**

Powtórz dla każdego wiersza `P1`:
1. Napisz test odtwarzający złą liczbę (Vitest jeśli to front, `cargo test` jeśli backend).
2. Run test → musi paść. Wklej komunikat błędu do kolumny „Decyzja".
3. Usuń duplikat: front przestaje liczyć, zaczyna czytać liczbę z backendu. **Kierunek jest zawsze taki** — backend jest źródłem prawdy, chyba że w kolumnie „Kto jest źródłem prawdy" zapisałeś inaczej z uzasadnieniem.
4. Run test → PASS.
5. Run pełne testy: `cd dashboard && npm test && cd .. && cargo test --workspace`.
6. Commit: `git commit -m "fix(time): <plik> czyta czas z backendu zamiast liczyć własną sumę (ustalenie 1-NN)"`.
7. Oznacz wiersz jako zamknięty w tabeli.

- [ ] **Step 3: Zaktualizuj Help.tsx, jeśli któraś liczba na ekranie się zmieniła**

Jeśli naprawa zmienia wartość widoczną dla użytkownika (np. Dashboard pokazywał 7 h 12 min, teraz 7 h 05 min), opisz to w `dashboard/src/pages/Help.tsx` oraz dopisz do `CHANGELOG.md` w sekcji `Unreleased` → `Fixed`.

- [ ] **Step 4: Commit domknięcia etapu**

```bash
git add docs/release/audit/etap1-czas.md docs/release/RELEASE_CHECKLIST.md docs/release/INVARIANTS.md
git commit -m "docs(audit): etap 1 zamknięty — jedno źródło prawdy dla obliczeń czasu"
```

**Bramka etapu 1:** `cargo test -p timeflow-dashboard --test consistency` w CI (job `rust` już wywołuje `cargo test`, więc test integracyjny wchodzi automatycznie — potwierdź to w logu CI), wszystkie `P1` z `etap1-czas.md` zamknięte, `INVARIANTS.md` bez wierszy „do napisania" w sekcji Czas.

---

## Etap 2 — Jedno źródło prawdy: dane, schemat i kontrakty

**Cel:** Każda encja ma **jedną** definicję kolumn, **jeden** schemat i **jeden** kontrakt między warstwami. Dziś tak nie jest.

**Kontekst dla wykonawcy — trzy potwierdzone rozjazdy:**

1. **`TableHashes` istnieje w trzech miejscach**, każde z własną listą pól:
   - `src/lan_server.rs:43` (demon) — 9 pól,
   - `dashboard/src-tauri/src/commands/delta_export.rs:11` (dashboard) — 9 pól, inna kolejność, `#[derive(Default)]`,
   - `dashboard/src/lib/online-sync-types.ts` (front) — typ TS.
   Dodanie tabeli wymaga edycji w trzech miejscach i nic tego nie pilnuje.

2. **Listy kolumn są scentralizowane tylko dla `projects`.** `shared/sync/columns.rs` ma `PROJECT_COLUMNS` + `PROJECT_SELECT` z komentarzem „finding #10 — 5 miejsc na kolumnę". Pozostałe encje (`sessions`, `applications`, `manual_sessions`, `clients`, `project_costs`, `todos`) nadal mają rozrzucone listy — `FROM sessions` pojawia się w 32 plikach.

3. **Demon ma własny, ręcznie pisany schemat SQL** (`src/sync_common.rs`: `CREATE TABLE` dla `clients`, `project_costs`, `todos`, …) i **nie uruchamia migracji dashboardu**. `PARITY.md` opisuje, jak to już raz wysadziło merge (`ensure_m26_entity_tables`). To znaczy: każda przyszła migracja dodająca tabelę synchronizowaną jest miną.

4. **Polecenia Tauri wymagają rejestracji w trzech miejscach** (`commands/mod.rs`, `invoke_handler` w `lib.rs`, wygenerowany `webui/rpc_generated.rs`). Brak trzeciego = polecenie działa na desktopie i **cicho nie działa w webui**; `build.rs` sygnalizuje to tylko ostrzeżeniem. CI ma już `gen_webrpc.cjs --check` — sprawdź, czy naprawdę łapie brak wpisu.

**Files:**
- Create: `docs/release/audit/etap2-dane.md`
- Modify: `shared/sync/columns.rs`
- Modify: `src/lan_server.rs`
- Modify: `dashboard/src-tauri/src/commands/delta_export.rs`
- Modify: `dashboard/src-tauri/build.rs`

### Task 2.1: Inwentaryzacja definicji encji

- [ ] **Step 1: Zbierz listę encji synchronizowanych**

Run:
```bash
grep -n "pub " dashboard/src-tauri/src/commands/delta_export.rs | sed -n '1,60p'
grep -rn "CREATE TABLE" --include='*.rs' src/sync_common.rs | head -30
ls dashboard/src-tauri/src/db_migrations/
```

- [ ] **Step 2: Utwórz dokument z macierzą encji**

Create `docs/release/audit/etap2-dane.md`:

```markdown
# Etap 2 — Jedno źródło prawdy: dane, schemat i kontrakty

## Macierz encji

Dla każdej encji: gdzie żyje jej definicja. Cel wydania — kolumna
„Liczba miejsc" ma być **1** dla schematu i **1** dla listy kolumn.

| Encja | Migracja dashboardu | Schemat demona | Lista kolumn | SELECT eksportu | Checksum | Merge | Typ TS | Liczba miejsc |
|---|---|---|---|---|---|---|---|---|
| projects | | | `shared/sync/columns.rs` | `PROJECT_SELECT` | | | | |
| clients | | `src/sync_common.rs:277` | | | | | | |
| applications | | | | | | | | |
| sessions | | | | | | | | |
| manual_sessions | | | | | | | | |
| assignment_feedback | | | | | | | | |
| assignment_auto_runs | | | | | | | | |
| project_costs | | `src/sync_common.rs:304` | | | | | | |
| todos | | `src/sync_common.rs:319` | | | | | | |
| tombstones | | | | | | | | |
| sync_markers | | | | | | | | |

## Tabela ustaleń

| # | Rozjazd | Skutek dla użytkownika | Priorytet | Poprawka | Test |
|---|---|---|---|---|---|
| 2-01 | `TableHashes` zdefiniowany w 3 miejscach z 3 listami pól | Dodanie tabeli w jednym miejscu ⇒ cicha niewykrywalność rozjazdu w sync | P1 | Task 2.2 | |
| 2-02 | Listy kolumn scentralizowane tylko dla `projects` | Dodanie kolumny wymaga edycji ~5 miejsc; pominięcie ⇒ kolumna nie synchronizuje się | P1 | Task 2.3 | |
| 2-03 | Demon ma własny schemat SQL, nie uruchamia migracji | Nowa tabela synchronizowana wysadza cały merge (`no such table`) | P1 | Task 2.4 | |
| 2-04 | Polecenia Tauri rejestrowane w 3 miejscach | Polecenie działa na desktopie, cicho nie działa w webui | P1 | Task 2.5 | |
```

- [ ] **Step 3: Wypełnij macierz**

Dla każdej encji wypełnij komórki ścieżką `plik:linia`. Pusta komórka = encja nie występuje w tej warstwie (np. `sync_markers` nie ma typu TS) — wpisz `—`, nie zostawiaj pustej.

- [ ] **Step 4: Commit**

```bash
git add docs/release/audit/etap2-dane.md
git commit -m "docs(audit): macierz definicji encji — gdzie żyje schemat, kolumny i kontrakt"
```

### Task 2.2: `TableHashes` — jedna lista tabel, wyprowadzona derive'em

Manualne `impl PartialEq for TableHashes` w `src/lan_server.rs:1804` pomija `assignment_feedback` i `assignment_auto_runs` (`PARITY.md` opisuje to jako najgroźniejszy typ pominięcia: rozjazd nie zostałby wykryty i peery raportowałyby „zsynchronizowane"). Naprawa to nie „dopisz dwa pola" — to **usunięcie ręcznej implementacji**, żeby nie dało się jej znowu przeoczyć.

- [ ] **Step 1: Napisz test padający**

Dopisz w `src/lan_server.rs`, w `mod tests`:

```rust
    /// Ręczne porównanie hashy pomijało `assignment_feedback` i
    /// `assignment_auto_runs`, więc rozjazd danych AI był niewidoczny i peery
    /// raportowały "zsynchronizowane". Ten test pilnuje, że KAŻDE pole liczy się
    /// do równości — jeśli ktoś doda tabelę i zapomni o porównaniu, test padnie.
    #[test]
    fn table_hashes_equality_covers_every_field() {
        let base = TableHashes {
            projects: "p".into(),
            clients: "c".into(),
            applications: "a".into(),
            sessions: "s".into(),
            manual_sessions: "m".into(),
            assignment_feedback: "f".into(),
            assignment_auto_runs: "r".into(),
            project_costs: "k".into(),
            todos: "t".into(),
        };

        // Serde zna każde pole struktury, więc lista kluczy z JSON-a jest pełną
        // listą pól — nie da się jej rozjechać z definicją.
        let json = serde_json::to_value(&base).expect("TableHashes serializuje się");
        let fields: Vec<String> = json
            .as_object()
            .expect("obiekt")
            .keys()
            .cloned()
            .collect();
        assert!(!fields.is_empty());

        for field in &fields {
            let mut obj = json.as_object().unwrap().clone();
            obj.insert(field.clone(), serde_json::Value::String("ZMIENIONE".into()));
            let mutated: TableHashes =
                serde_json::from_value(serde_json::Value::Object(obj)).expect("deserializacja");
            assert_ne!(
                base, mutated,
                "zmiana pola '{field}' nie zmienia wyniku porównania — rozjazd tej tabeli byłby niewykrywalny"
            );
        }
    }
```

- [ ] **Step 2: Uruchom — musi paść**

Run: `cargo test -p timeflow-demon table_hashes_equality_covers_every_field -- --nocapture`
Expected: FAIL z komunikatem `zmiana pola 'assignment_feedback' nie zmienia wyniku porównania…` (albo `assignment_auto_runs`).

- [ ] **Step 3: Usuń ręczną implementację i wyprowadź derive'em**

W `src/lan_server.rs` skasuj cały blok:

```rust
// ── PartialEq for TableHashes ──

impl PartialEq for TableHashes {
    fn eq(&self, other: &Self) -> bool {
        self.projects == other.projects
            && self.clients == other.clients
            && self.applications == other.applications
            && self.sessions == other.sessions
            && self.manual_sessions == other.manual_sessions
            && self.project_costs == other.project_costs
            && self.todos == other.todos
    }
}
```

i zmień atrybut struktury z:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TableHashes {
```

na:

```rust
// PartialEq WYPROWADZONY, nie pisany ręcznie: ręczna wersja pomijała
// assignment_feedback i assignment_auto_runs, przez co rozjazd tych tabel był
// niewykrywalny. Derive obejmuje każde pole z definicji — dodanie tabeli nie
// wymaga pamiętania o porównaniu.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct TableHashes {
```

- [ ] **Step 4: Uruchom — musi przejść**

Run: `cargo test -p timeflow-demon table_hashes_equality_covers_every_field -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Sprawdź, czy nic nie zależało od starego (błędnego) porównania**

Run: `cargo test -p timeflow-demon`
Expected: 0 failed. Jeśli jakiś test padł, bo dotąd przechodził dzięki ignorowaniu dwóch pól — to jest kolejne ustalenie `P1`: zapisz je w `etap2-dane.md` i napraw źródło, nie test.

- [ ] **Step 6: Commit**

```bash
git add src/lan_server.rs
git commit -m "fix(sync): PartialEq dla TableHashes wyprowadzony derive'em — rozjazd assignment_feedback/auto_runs był niewykrywalny"
```

### Task 2.3: Jedna lista tabel dla obu implementacji `TableHashes`

Po Task 2.2 porównanie jest bezpieczne, ale wciąż istnieją dwie niezależne definicje struktury (demon i dashboard) i dwa `build_table_hashes`. Zbieżność zapewnia dziś tylko czujność.

- [ ] **Step 1: Napisz test pilnujący zgodności zestawów pól**

Dopisz w `src/sync_common.rs`, w `mod tests` (ten moduł już testuje ścieżkę end-to-end przez eksport demona — patrz `merge_roundtrip_project_costs_via_daemon_export`):

```rust
    /// Demon i dashboard mają DWA niezależne typy TableHashes i dwa niezależne
    /// eksporty. Jeśli zestawy pól się rozjadą, jedna strona policzy hash tabeli,
    /// której druga nie zna — i rozjazd danych przejdzie jako "zsynchronizowane".
    /// Ten test przypina obie listy do jednej, jawnej listy oczekiwanej.
    #[test]
    fn daemon_table_hashes_field_set_is_the_agreed_one() {
        // Jedyna dopuszczalna lista tabel objętych checksumem. Dodajesz tabelę?
        // Dopisz ją TUTAJ, a test wskaże każde miejsce, które trzeba zaktualizować.
        const EXPECTED: &[&str] = &[
            "projects",
            "clients",
            "applications",
            "sessions",
            "manual_sessions",
            "assignment_feedback",
            "assignment_auto_runs",
            "project_costs",
            "todos",
        ];

        let sample = crate::lan_server::TableHashes {
            projects: String::new(),
            clients: String::new(),
            applications: String::new(),
            sessions: String::new(),
            manual_sessions: String::new(),
            assignment_feedback: String::new(),
            assignment_auto_runs: String::new(),
            project_costs: String::new(),
            todos: String::new(),
        };
        let json = serde_json::to_value(&sample).expect("serializacja");
        let mut actual: Vec<String> =
            json.as_object().unwrap().keys().cloned().collect();
        actual.sort();
        let mut expected: Vec<String> =
            EXPECTED.iter().map(|s| s.to_string()).collect();
        expected.sort();

        assert_eq!(
            actual, expected,
            "zestaw tabel w TableHashes demona rozjechał się z uzgodnioną listą"
        );
    }
```

- [ ] **Step 2: Uruchom**

Run: `cargo test -p timeflow-demon daemon_table_hashes_field_set_is_the_agreed_one`
Expected: PASS (lista jest dziś zgodna). Jeśli kompilacja pada na widoczności `crate::lan_server::TableHashes` — pole/struktura jest już `pub`, więc problem będzie w ścieżce modułu; sprawdź `grep -n "mod lan_server" src/main.rs` i użyj właściwej ścieżki.

- [ ] **Step 3: Zrób bliźniaczy test po stronie dashboardu**

Dopisz w `dashboard/src-tauri/src/commands/delta_export.rs`, w `#[cfg(test)] mod tests` (jeśli modułu nie ma — utwórz go na końcu pliku):

```rust
#[cfg(test)]
mod tests {
    use super::TableHashes;

    /// Bliźniak testu `daemon_table_hashes_field_set_is_the_agreed_one`
    /// w `src/sync_common.rs`. Obie listy MUSZĄ być identyczne — inaczej jedna
    /// strona liczy hash tabeli, o której druga nie wie.
    #[test]
    fn dashboard_table_hashes_field_set_is_the_agreed_one() {
        const EXPECTED: &[&str] = &[
            "projects",
            "clients",
            "applications",
            "sessions",
            "manual_sessions",
            "assignment_feedback",
            "assignment_auto_runs",
            "project_costs",
            "todos",
        ];

        let json = serde_json::to_value(TableHashes::default()).expect("serializacja");
        let mut actual: Vec<String> = json.as_object().unwrap().keys().cloned().collect();
        actual.sort();
        let mut expected: Vec<String> = EXPECTED.iter().map(|s| s.to_string()).collect();
        expected.sort();

        assert_eq!(
            actual, expected,
            "zestaw tabel w TableHashes dashboardu rozjechał się z uzgodnioną listą"
        );
    }
}
```

- [ ] **Step 4: Uruchom oba**

Run: `cargo test -p timeflow-demon table_hashes && cargo test -p timeflow-dashboard table_hashes`
Expected: oba PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync_common.rs dashboard/src-tauri/src/commands/delta_export.rs
git commit -m "test(sync): przypnij zestaw tabel w obu implementacjach TableHashes do jednej uzgodnionej listy"
```

### Task 2.4: Centralizacja list kolumn dla pozostałych encji

`shared/sync/columns.rs` robi to poprawnie dla `projects`. Rozszerz wzorzec, encja po encji — **jedna encja = jeden commit**, żeby dało się to rozłożyć na kilka sesji.

- [ ] **Step 1: Wybierz encję i znajdź wszystkie jej listy kolumn**

Zacznij od `sessions` (najszersza). Run:

```bash
grep -rn "FROM sessions\|INSERT INTO sessions\|INTO sessions" --include='*.rs' \
  src shared dashboard/src-tauri/src | grep -v '/tests.rs' | grep -v 'mod tests'
```

Wypisz w `etap2-dane.md` każdą listę kolumn, którą znajdziesz, i zaznacz, które są **identyczne** (kandydaci na jedną stałą), a które celowo różne (np. delta-SELECT z `WHERE updated_at > ?`).

- [ ] **Step 2: Dodaj stałą do `shared/sync/columns.rs`**

Wzorując się dokładnie na `PROJECT_COLUMNS`/`PROJECT_SELECT`, dopisz (nazwy kolumn skopiuj z realnego schematu, nie z pamięci — odczytaj je z `dashboard/src-tauri/src/db_migrations/m07_sessions_v2.rs` i późniejszych migracji dotykających `sessions`):

```rust
/// Kolumny `sessions` w kolejności używanej przy eksporcie i mapowaniu.
/// Jedno źródło dla: export SELECT, delta SELECT, row-mapping, checksum.
pub const SESSION_COLUMNS: &[&str] = &[
    // <- wklej realną listę odczytaną z migracji
];

/// SELECT sesji do eksportu/merge.
pub const SESSION_SELECT: &str = concat!(
    "SELECT ",
    // <- ta sama lista, rozdzielona przecinkami
    " FROM sessions"
);
```

- [ ] **Step 3: Dopisz test strażniczy (wzór z `PROJECT_SELECT`)**

W `shared/sync/columns.rs`, w `mod tests`:

```rust
    #[test]
    fn session_select_lists_all_columns_in_order() {
        for (i, col) in SESSION_COLUMNS.iter().enumerate() {
            assert!(
                SESSION_SELECT.contains(col),
                "SESSION_SELECT pomija kolumnę {col} (#{i})"
            );
        }
    }
```

- [ ] **Step 4: Uruchom**

Run: `cargo test -p timeflow-shared session_select_lists_all_columns_in_order`
Expected: PASS.

- [ ] **Step 5: Podmień jedno miejsce użycia i sprawdź testami**

Wybierz **jedno** miejsce z listy z Step 1 (zacznij od `shared/sync/checksum.rs` — jest najkrótsze) i zastąp lokalną listę kolumn odwołaniem do `SESSION_COLUMNS`/`SESSION_SELECT`.

Run: `cargo test --workspace`
Expected: 0 failed. **Jeśli coś padnie, to znaczy, że listy nie były identyczne** — to jest ustalenie `P0` (kolumna nie synchronizowała się albo synchronizowała w złej kolejności). Zapisz je w tabeli i napraw źródło.

- [ ] **Step 6: Commit i powtórz**

```bash
git add shared/sync/columns.rs shared/sync/checksum.rs
git commit -m "refactor(sync): kolumny sessions z jednego źródła (shared/sync/columns.rs)"
```

Powtórz Step 1–6 dla kolejnych miejsc użycia `sessions`, a potem dla encji: `applications`, `manual_sessions`, `clients`, `project_costs`, `todos`, `assignment_feedback`, `assignment_auto_runs`. **Jeden commit = jedna encja albo jedno miejsce użycia.** Po każdej encji zaktualizuj kolumnę „Liczba miejsc" w macierzy.

### Task 2.5: Schemat demona kontra migracje dashboardu

- [ ] **Step 1: Napisz test porównujący schematy**

Dopisz w `src/sync_common.rs`, w `mod tests`:

```rust
    /// Demon ma własny, ręcznie pisany schemat i NIE uruchamia migracji
    /// dashboardu (patrz PARITY.md). Gdy dashboard doda tabelę synchronizowaną,
    /// a demon jej nie zna, merge wywala się na `no such table` — i to nie tylko
    /// dla nowej encji, ale dla CAŁEGO merge (pętla triggerów tombstone).
    /// Ten test wymusza świadomą decyzję przy każdej nowej tabeli.
    #[test]
    fn daemon_schema_knows_every_synced_table() {
        // Ta sama uzgodniona lista co w `daemon_table_hashes_field_set_is_the_agreed_one`.
        const SYNCED_TABLES: &[&str] = &[
            "projects",
            "clients",
            "applications",
            "sessions",
            "manual_sessions",
            "assignment_feedback",
            "assignment_auto_runs",
            "project_costs",
            "todos",
            "tombstones",
            "sync_markers",
        ];

        let conn = rusqlite::Connection::open_in_memory().expect("baza w pamięci");
        // Odtwórz schemat dokładnie tak, jak robi to demon przy starcie.
        // UWAGA: podmień na realną nazwę funkcji inicjalizującej schemat demona —
        // znajdź ją: `grep -n "fn ensure_.*schema\|fn init_schema" src/*.rs`
        ensure_daemon_schema(&conn).expect("schemat demona");

        for table in SYNCED_TABLES {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .expect("zapytanie sqlite_master");
            assert_eq!(
                exists, 1,
                "schemat demona nie zna tabeli '{table}' — merge padnie na `no such table` i zabierze ze sobą cały sync"
            );
        }
    }
```

- [ ] **Step 2: Uruchom**

Run: `cargo test -p timeflow-demon daemon_schema_knows_every_synced_table -- --nocapture`
Expected: PASS lub FAIL z nazwą brakującej tabeli. FAIL = ustalenie `P0`.

- [ ] **Step 3: Napraw, jeśli padł**

Dopisz brakujący `CREATE TABLE IF NOT EXISTS` w miejscu, gdzie demon tworzy pozostałe tabele m26 (`ensure_m26_entity_tables` w `src/sync_common.rs` jest wzorcem). **Nie kopiuj schematu z migracji na ślepo** — skopiuj dokładnie te kolumny, które wchodzą do eksportu (lista z Task 2.4), plus klucze i indeksy potrzebne triggerom tombstone.

- [ ] **Step 4: Commit**

```bash
git add src/sync_common.rs
git commit -m "test(sync): schemat demona musi znać każdą synchronizowaną tabelę"
```

### Task 2.6: Potrójna rejestracja poleceń Tauri

- [ ] **Step 1: Sprawdź, czy istniejąca bramka faktycznie łapie brak wpisu**

Run:
```bash
cd dashboard/src-tauri && node scripts/gen_webrpc.cjs --check && echo "BRAMKA OK"
```
Expected: `BRAMKA OK`.

Teraz zepsuj to celowo i sprawdź, czy bramka reaguje:
```bash
# usuń tymczasowo jedną linię z wygenerowanego pliku
cp src/webui/rpc_generated.rs /tmp/rpc_generated.rs.bak
grep -v 'build_table_hashes_only' /tmp/rpc_generated.rs.bak > src/webui/rpc_generated.rs
node scripts/gen_webrpc.cjs --check; echo "kod wyjścia: $?"
# przywróć
cp /tmp/rpc_generated.rs.bak src/webui/rpc_generated.rs
```
Expected: kod wyjścia różny od 0. **Jeśli bramka przeszła mimo braku linii — to jest ustalenie `P1`:** bramka nie działa i trzeba ją naprawić, zanim uznasz ten punkt za zamknięty.

- [ ] **Step 2: Podnieś ostrzeżenie `build.rs` do błędu**

`PARITY.md` mówi: „`build.rs` sygnalizuje rozjazd tylko ostrzeżeniem". Ostrzeżenie w Rust build script ginie w logu. Znajdź je:

Run: `grep -n "cargo:warning" dashboard/src-tauri/build.rs`

Zamień `println!("cargo:warning=…")` dotyczące rozjazdu rejestracji poleceń na `panic!` z tym samym komunikatem plus instrukcją naprawy:

```rust
    panic!(
        "Rozjazd rejestracji poleceń: {details}\n\
         Uruchom `node scripts/gen_webrpc.cjs` i zacommituj src/webui/rpc_generated.rs.\n\
         Bez tego polecenie działa na desktopie i CICHO nie działa w webui."
    );
```

- [ ] **Step 3: Sprawdź, że build nadal przechodzi**

Run: `cargo build -p timeflow-dashboard`
Expected: sukces. Jeśli `panic!` się odpalił — masz realny, istniejący rozjazd: uruchom `node scripts/gen_webrpc.cjs`, zacommituj wygenerowany plik i zapisz ustalenie `P1` w tabeli.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/build.rs dashboard/src-tauri/src/webui/rpc_generated.rs
git commit -m "build: rozjazd rejestracji poleceń Tauri przerywa build zamiast ostrzegać"
```

- [ ] **Step 5: Zamknij etap**

```bash
git add docs/release/audit/etap2-dane.md docs/release/RELEASE_CHECKLIST.md
git commit -m "docs(audit): etap 2 zamknięty — jedno źródło prawdy dla danych i kontraktów"
```

**Bramka etapu 2:** testy `table_hashes_*`, `daemon_schema_knows_every_synced_table`, `*_select_lists_all_columns_in_order` w `cargo test --workspace`; `gen_webrpc.cjs --check` udowodniony jako działający; `build.rs` przerywa build przy rozjeździe.

---

## Etap 3 — Spójność synchronizacji (LAN + online)

**Cel:** Udowodnić, że dwie maszyny zbiegają się do identycznego stanu i że aplikacja **wie**, kiedy się nie zbiegły.

**Kontekst dla wykonawcy:** istnieją **dwa całkowicie niezależne eksporty** — dashboard serializuje archiwum przez serde (`commands/delta_export.rs`), a demon składa JSON ręcznie (`build_delta_for_pull` w `src/lan_server.rs`, `fetch_all_rows`). Każda encja wymaga wpięcia w oba. `PARITY.md` opisuje, jak pominięcie jednego z nich kończy się fałszywym „zsynchronizowane".

**Files:**
- Create: `docs/release/audit/etap3-sync.md`
- Modify: `src/sync_common.rs`

### Task 3.1: Inwentaryzacja ścieżek synchronizacji

- [ ] **Step 1: Utwórz dokument**

Create `docs/release/audit/etap3-sync.md`:

```markdown
# Etap 3 — Spójność synchronizacji

## Macierz wpięcia encji w ścieżki sync

Encja jest wpięta poprawnie tylko wtedy, gdy ma ✅ w KAŻDEJ kolumnie.
Kolumny odpowiadają realnym, niezależnym implementacjom — nie warstwom abstrakcji.

| Encja | Eksport dashboardu (`delta_export.rs`) | Eksport demona (`build_delta_for_pull`) | `TableHashes` demona | `TableHashes` dashboardu | Merge (`shared/sync/merge.rs`) | Trigger tombstone | Checksum | Test end-to-end |
|---|---|---|---|---|---|---|---|---|
| projects | | | | | | | | |
| clients | | | | | | | | |
| applications | | | | | | | | |
| sessions | | | | | | | | |
| manual_sessions | | | | | | | | |
| assignment_feedback | | | | | | | | |
| assignment_auto_runs | | | | | | | | |
| project_costs | | | | | | | `merge_roundtrip_project_costs_via_daemon_export` | |
| todos | | | | | | | `merge_todos_never_touches_gcal_fields` | |
| file_activities | | | | | | | | |

## Pola per-maszyna (NIE synchronizowane — celowo)

| Encja | Pole | Dlaczego per-maszyna | Test pilnujący |
|---|---|---|---|
| todos | `gcal_event_id` | dwa urządzenia biłyby się o to samo wydarzenie | `merge_todos_never_touches_gcal_fields` |
| todos | `gcal_synced_at` | jw. | `todos_hash_ignores_gcal_fields` |

## Tabela ustaleń

| # | Rozjazd | Skutek | Priorytet | Poprawka | Test |
|---|---|---|---|---|---|
```

- [ ] **Step 2: Wypełnij macierz czytając kod**

Run dla każdej encji (przykład dla `clients`):
```bash
grep -rn "clients" src/lan_server.rs | grep -i "fetch_all_rows\|hash\|delta" 
grep -rn "clients" dashboard/src-tauri/src/commands/delta_export.rs
grep -rn "clients" shared/sync/merge.rs shared/sync/checksum.rs shared/sync/triggers.rs
```

Każda komórka: ✅ (wpięte) / ❌ (brak) / `—` (nie dotyczy). **Każde ❌ jest ustaleniem** — wpisz je do tabeli z priorytetem `P0`, jeśli oznacza cichą utratę zmian, `P1`, jeśli oznacza fałszywy status „zsynchronizowane".

- [ ] **Step 3: Commit**

```bash
git add docs/release/audit/etap3-sync.md
git commit -m "docs(audit): macierz wpięcia encji w obie ścieżki eksportu sync"
```

### Task 3.2: Test idempotencji merge (I-31)

- [ ] **Step 1: Napisz test**

Dopisz w `src/sync_common.rs`, w `mod tests` — użyj istniejących pomocników z tego modułu (odczytaj je: `grep -n "fn .*_db\|fn seed\|fn make_conn" src/sync_common.rs`):

```rust
    /// I-31: merge musi być idempotentny. Dwukrotne wchłonięcie tego samego
    /// archiwum nie może zmienić bazy ani przy drugim przebiegu, ani odbić się
    /// na checksumie. Brak tej własności oznacza wieczny re-sync: peery co cykl
    /// widzą różnicę i mielą pełne archiwum.
    #[test]
    fn merge_is_idempotent_for_every_entity() {
        let (mut local, remote_archive) = two_peers_with_divergent_data();

        merge_incoming_data(&mut local, &remote_archive).expect("pierwszy merge");
        let hashes_after_first = build_table_hashes(&local);

        merge_incoming_data(&mut local, &remote_archive).expect("drugi merge");
        let hashes_after_second = build_table_hashes(&local);

        assert_eq!(
            hashes_after_first, hashes_after_second,
            "drugi merge tego samego archiwum zmienił bazę — sync nigdy nie zgłosi 'none'"
        );
    }
```

**Uwaga:** `two_peers_with_divergent_data` prawdopodobnie nie istnieje. Napisz go jako pomocnika w `mod tests`: buduje dwie bazy w pamięci przez `ensure_daemon_schema`, wstawia do każdej po jednym rekordzie **każdej** encji z listy `SYNCED_TABLES` (Task 2.5), plus jeden rekord skasowany (tombstone) i jeden zmodyfikowany po obu stronach (konflikt LWW). Dzięki temu test pokrywa wszystkie trzy klasy zdarzeń merge.

- [ ] **Step 2: Uruchom**

Run: `cargo test -p timeflow-demon merge_is_idempotent_for_every_entity -- --nocapture`
Expected: PASS. FAIL = ustalenie `P0` (wieczny re-sync / niestabilna baza).

- [ ] **Step 3: Commit**

```bash
git add src/sync_common.rs
git commit -m "test(sync): merge idempotentny dla każdej encji (I-31)"
```

### Task 3.3: Test zbieżności dwóch peerów (I-32)

Test `sync_common.rs:1754` już pilnuje, że po zbieżności `table_hashes(master) == table_hashes(slave)`. Sprawdź jego zakres — czy obejmuje wszystkie encje z macierzy.

- [ ] **Step 1: Przeczytaj istniejący test**

Run: `sed -n '1700,1790p' src/sync_common.rs`

- [ ] **Step 2: Rozszerz dane wejściowe testu o brakujące encje**

Jeśli test wstawia tylko projekty i sesje, dopisz do jego danych po jednym rekordzie każdej encji z macierzy z Task 3.1 (`clients`, `project_costs`, `todos`, `assignment_feedback`, `assignment_auto_runs`, `manual_sessions`, `applications`). Nie zmieniaj asercji — one już są właściwe.

- [ ] **Step 3: Uruchom**

Run: `cargo test -p timeflow-demon -- --nocapture 2>&1 | grep -E 'table_hashes|test result'`
Expected: PASS. FAIL na nowo dodanej encji = ustalenie `P0`: ta encja nie zbiega się między peerami.

- [ ] **Step 4: Commit**

```bash
git add src/sync_common.rs docs/release/audit/etap3-sync.md
git commit -m "test(sync): test zbieżności peerów obejmuje wszystkie encje z macierzy"
```

### Task 3.4: Kompatybilność wersji peerów

`shared/version_compat.rs` istnieje — sprawdź, co dokładnie gwarantuje.

- [ ] **Step 1: Przeczytaj**

Run: `cat shared/version_compat.rs`

- [ ] **Step 2: Wypisz w dokumencie scenariusze międzywersyjne**

Uzupełnij `etap3-sync.md` o sekcję:

```markdown
## Scenariusze międzywersyjne

| Scenariusz | Oczekiwane zachowanie | Zweryfikowane? |
|---|---|---|
| Peer starszy nie zna tabeli m26 | Nasze klucze ignorowane, brak utraty danych, brak propagacji do czasu aktualizacji obu maszyn | PARITY.md: opisane |
| Peer nowszy przysyła pole, którego nie znamy | `#[serde(default)]` / pominięcie, brak paniki przy deserializacji | |
| Peer przysyła archiwum z brakującą sekcją | Deserializacja przechodzi, sekcja pusta | |
| Peer przysyła archiwum większe niż limit | Odrzucenie z 413, bez OOM | |
| Peer przysyła uszkodzony JSON | Odrzucenie z błędem, baza nietknięta | |
```

- [ ] **Step 3: Napisz test dla „nieznane pole nie wywala deserializacji"**

Dopisz w `src/online_store_forward.rs`, w `mod tests` (jest tam już `SAMPLE_EXPORT` — użyj go jako bazy):

```rust
    /// Peer z nowszą wersją dosyła pola, których nie znamy. Deserializacja MUSI
    /// przejść — inaczej aktualizacja jednej maszyny zrywa sync z drugą do czasu
    /// aktualizacji obu, a użytkownik widzi tylko błąd bez wyjaśnienia.
    #[test]
    fn unknown_fields_from_newer_peer_do_not_break_parsing() {
        let with_future_fields = r#"{
            "table_hashes":{"projects":"abc","future_entity":"xyz"},
            "exported_at":"2026-06-24 10:00:00",
            "device_id":"dev-1",
            "schema_version":999,
            "data":{"projects":[],"applications":[],"sessions":[],
                    "manual_sessions":[],"tombstones":[],"clients":[],
                    "assignment_feedback":[],"assignment_auto_runs":[],
                    "future_entity":[{"id":1}]}
        }"#;

        let parsed = parse_export(with_future_fields);
        assert!(
            parsed.is_ok(),
            "archiwum od nowszego peera odrzucone: {:?}",
            parsed.err()
        );
    }
```

**Uwaga:** `parse_export` to nazwa zastępcza — odczytaj realną funkcję parsującą archiwum w tym module (`grep -n "fn parse\|serde_json::from_str" src/online_store_forward.rs`) i użyj jej.

- [ ] **Step 4: Uruchom**

Run: `cargo test -p timeflow-demon unknown_fields_from_newer_peer_do_not_break_parsing -- --nocapture`
Expected: PASS. FAIL = ustalenie `P0` (aktualizacja jednej maszyny zrywa sync).

- [ ] **Step 5: Commit**

```bash
git add src/online_store_forward.rs docs/release/audit/etap3-sync.md
git commit -m "test(sync): archiwum od nowszego peera parsuje się mimo nieznanych pól"
```

### Task 3.5: Test manualny — dwie realne maszyny

Testy w pamięci nie zastąpią realnego przebiegu. To jedyny krok tego planu, który wymaga drugiego komputera.

- [ ] **Step 1: Przygotuj scenariusz**

Dopisz do `etap3-sync.md`:

```markdown
## Test manualny LAN sync (wymagany przed wydaniem)

Maszyna A (macOS), maszyna B (Windows lub druga macOS), ta sama sieć.

1. Na obu: świeża baza, ta sama wersja TIMEFLOW. Sparuj urządzenia.
2. Na A: utwórz projekt „Sync-Test", klienta „Klient-A", 2 sesje, koszt dodatkowy, zadanie.
3. Na B: utwórz projekt „Sync-Test-B", klienta „Klient-B", 1 sesję, zadanie.
4. Uruchom sync z A. Poczekaj na „completed".
5. **Sprawdź:** obie maszyny widzą 2 projekty, 2 klientów, 3 sesje, 1 koszt, 2 zadania.
6. **Sprawdź:** czas projektu „Sync-Test" jest identyczny na A i B (co do sekundy).
7. Na A: skasuj sesję. Sync. **Sprawdź:** sesja zniknęła na B (tombstone).
8. Na obu jednocześnie: zmień nazwę tego samego projektu na różne. Sync.
   **Sprawdź:** wygrywa późniejsza zmiana (LWW), obie maszyny mają tę samą nazwę.
9. Sync po raz drugi bez zmian. **Sprawdź:** status „brak zmian" / „none",
   NIE pełne archiwum (to by znaczyło brak idempotencji — I-31).
10. **Sprawdź:** `gcal_event_id` zadania na A nie pojawił się na B.

Wynik: ☐ zaliczony ☐ niezaliczony — ustalenia: ______
```

- [ ] **Step 2: Wykonaj scenariusz i zapisz wynik**

Każdy punkt, który nie wyszedł, wpisz do tabeli ustaleń jako `P0`.

- [ ] **Step 3: Commit**

```bash
git add docs/release/audit/etap3-sync.md docs/release/RELEASE_CHECKLIST.md
git commit -m "docs(audit): etap 3 zamknięty — spójność synchronizacji LAN i online"
```

**Bramka etapu 3:** macierz bez ❌ w kolumnach obu eksportów, testy `merge_is_idempotent_for_every_entity` i `unknown_fields_from_newer_peer_do_not_break_parsing` w CI, test manualny zaliczony.

---

## Etap 4 — Pieniądze, stawki i raporty

**Cel:** Kwota pokazana użytkownikowi jest zawsze tą samą kwotą, niezależnie od ekranu. To etap, w którym błąd kosztuje najwięcej reputacyjnie — użytkownik fakturuje z tych liczb.

**Kontekst dla wykonawcy:** kwota powstaje z co najmniej pięciu składników: czas efektywny (etap 1) × mnożnik sesji (`rate_multiplier`) × stawka (projektu lub klienta) + koszty dodatkowe (`project_costs`), całość pod wpływem zaokrąglenia prezentacyjnego (`rounding.ts`). Miejsca liczące: `commands/estimates.rs`, `commands/clients.rs`, `commands/report.rs`, `dashboard/src/lib/estimate-report.ts`, `dashboard/src/lib/costs-utils.ts`, `dashboard/src/lib/rate-utils.ts`, `dashboard/src/lib/report-view-formatting.ts`.

**Files:**
- Create: `docs/release/audit/etap4-pieniadze.md`
- Create: `dashboard/src/lib/__tests__/money-consistency.test.ts`

### Task 4.1: Spisz regułę wyliczania kwoty

- [ ] **Step 1: Odczytaj obie implementacje**

Run:
```bash
grep -n "hourly_rate\|rate_multiplier\|multiplier" dashboard/src-tauri/src/commands/estimates.rs | head -30
grep -n "hourly_rate\|rate_multiplier\|multiplier" dashboard/src-tauri/src/commands/clients.rs | head -30
cat dashboard/src/lib/rate-utils.ts
cat dashboard/src/lib/costs-utils.ts
```

- [ ] **Step 2: Zapisz jedną, kanoniczną regułę**

Create `docs/release/audit/etap4-pieniadze.md`:

```markdown
# Etap 4 — Pieniądze, stawki i raporty

## Kanoniczna reguła wyliczenia kwoty

Zapisz TU jedno zdanie na każdy krok, w kolejności, w jakiej ma się liczyć.
Ta reguła jest źródłem prawdy dla wszystkich modułów. Każde odstępstwo = ustalenie.

1. **Czas efektywny sesji** — z `time_algorithm.rs` (etap 1). Sekundy, surowe.
2. **Mnożnik sesji** — `sessions.rate_multiplier`; brak/0 traktowane jako ______.
3. **Zaokrąglenie** — nakładane ______ (przed/po mnożniku?) i na poziomie ______ (sesja/dzień/suma), wg `RoundingSettings.mode`.
4. **Stawka** — pierwszeństwo: stawka projektu → stawka klienta → ______. Brak stawki ⇒ ______.
5. **Koszty dodatkowe** — `project_costs` doliczane ______ (przed/po zaokrągleniu czasu), nie podlegają mnożnikowi ani stawce godzinowej.
6. **Zaokrąglenie kwoty** — do ______ miejsc, metodą ______.

## Weryfikacja per moduł

| Moduł | Krok 1 | Krok 2 | Krok 3 | Krok 4 | Krok 5 | Krok 6 | Zgodny? |
|---|---|---|---|---|---|---|---|
| `commands/estimates.rs` | | | | | | | |
| `commands/clients.rs` | | | | | | | |
| `commands/report.rs` | | | | | | | |
| `lib/estimate-report.ts` | | | | | | | |
| `lib/report-view-formatting.ts` | | | | | | | |
| `lib/costs-utils.ts` | | | | | | | |
| Widok PM (`pm-projects-list-utils.ts`) | | | | | | | |

## Tabela ustaleń

| # | Moduł | Odstępstwo od reguły | Skutek na fakturze | Priorytet | Test |
|---|---|---|---|---|---|
```

- [ ] **Step 3: Wypełnij puste miejsca w regule, czytając kod**

Puste `______` uzupełnij tym, co **faktycznie robi** kod źródła prawdy — nie tym, co uważasz za słuszne. Jeśli moduły robią to różnie i nie da się wskazać źródła prawdy, **to samo w sobie jest ustaleniem `P1`**: wpisz je i wybierz źródło prawdy świadomie (rekomendacja: backend, `commands/estimates.rs`, bo tam powstaje raport rozliczeniowy).

- [ ] **Step 4: Commit**

```bash
git add docs/release/audit/etap4-pieniadze.md
git commit -m "docs(audit): kanoniczna reguła wyliczania kwoty + weryfikacja per moduł"
```

### Task 4.2: Test — kolejność zaokrąglenia i mnożnika (I-20)

Kolejność `zaokrąglij → pomnóż` daje inną kwotę niż `pomnóż → zaokrąglij`. Różnica na 15-minutowym interwale i mnożniku 1.5 to realne pieniądze.

- [ ] **Step 1: Napisz test**

Create `dashboard/src/lib/__tests__/money-consistency.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROUNDING_SETTINGS,
  roundSeconds,
  type RoundingSettings,
} from '@/lib/rounding';

/**
 * I-20: kwota liczy się z sekund PO zaokrągleniu, nigdy z surowych.
 * Kolejność ma znaczenie: przy interwale 15 min i mnożniku 1.5
 * 3300 s → zaokrąglone 3600 s → ×1.5 = 5400 s, ale
 * 3300 s → ×1.5 = 4950 s → zaokrąglone = 5400 s. Zbieżnie tutaj, lecz
 * dla 3500 s wyniki się rozjeżdżają — dlatego kolejność musi być jedna
 * i udokumentowana w docs/release/audit/etap4-pieniadze.md.
 */
const settings: RoundingSettings = {
  ...DEFAULT_ROUNDING_SETTINGS,
  enabled: true,
  intervalMinutes: 15,
  mode: 'per_session',
};

describe('spójność wyliczenia kwoty', () => {
  it('zaokrągla sekundy przed nałożeniem mnożnika', () => {
    const rawSeconds = 3500;
    const multiplier = 1.5;
    const hourlyRate = 200;

    const rounded = roundSeconds(rawSeconds, settings.intervalMinutes);
    const canonical = (rounded * multiplier / 3600) * hourlyRate;

    const wrongOrder =
      (roundSeconds(rawSeconds * multiplier, settings.intervalMinutes) / 3600) *
      hourlyRate;

    expect(rounded).toBe(3600);
    expect(canonical).toBeCloseTo(300, 6);
    // Ten assert dokumentuje, że kolejność NIE jest obojętna.
    expect(wrongOrder).not.toBeCloseTo(canonical, 6);
  });

  it('kwota jest sumą pozycji do jednego grosza (I-21)', () => {
    const entries = [1234, 5678, 900, 4321];
    const hourlyRate = 187.5;

    const perEntry = entries.map(
      (seconds) => (roundSeconds(seconds, settings.intervalMinutes) / 3600) * hourlyRate,
    );
    const sumOfEntries = perEntry.reduce((acc, value) => acc + value, 0);

    const totalSeconds = entries
      .map((seconds) => roundSeconds(seconds, settings.intervalMinutes))
      .reduce((acc, value) => acc + value, 0);
    const totalAmount = (totalSeconds / 3600) * hourlyRate;

    expect(Math.round(sumOfEntries * 100)).toBe(Math.round(totalAmount * 100));
  });
});
```

- [ ] **Step 2: Uruchom**

Run: `cd dashboard && npx vitest run src/lib/__tests__/money-consistency.test.ts`
Expected: PASS. Jeśli drugi test pada, masz `P1`: suma pozycji nie zgadza się z sumą raportu.

- [ ] **Step 3: Sprawdź, czy kod produkcyjny robi to w tej samej kolejności**

Otwórz `dashboard/src/lib/estimate-report.ts` i `dashboard/src-tauri/src/commands/estimates.rs:258` (`let seconds = seconds_f64.round() as i64;`). Porównaj kolejność operacji z regułą z Task 4.1. Każde odstępstwo → wiersz w tabeli ustaleń.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/__tests__/money-consistency.test.ts docs/release/audit/etap4-pieniadze.md
git commit -m "test(money): kolejność zaokrąglenia i mnożnika oraz zgodność sumy pozycji z sumą raportu"
```

### Task 4.3: Test — koszty dodatkowe liczone dokładnie raz (I-22)

- [ ] **Step 1: Napisz test w Rust**

Dopisz w `dashboard/src-tauri/src/commands/estimates.rs`, w `mod tests`:

```rust
    /// I-22: koszt dodatkowy wchodzi do sumy projektu dokładnie raz.
    /// Ryzyko: koszt doliczany zarówno w zapytaniu projektu, jak i w agregacie
    /// klienta ⇒ podwójne naliczenie na fakturze.
    #[test]
    fn additional_cost_counted_exactly_once_in_project_and_client_totals() {
        let conn = test_conn();
        seed_project(&conn, "Alpha", 100.0);
        seed_cost(&conn, "Alpha", 500.0, "2026-03-05");
        seed_session(&conn, "Alpha", "2026-03-05 10:00:00", "2026-03-05 11:00:00");

        let project_total = project_amount(&conn, "Alpha", "2026-03-01", "2026-03-31");
        let client_total = client_amount(&conn, "Alpha", "2026-03-01", "2026-03-31");

        // 1 h × 100 + koszt 500 = 600
        assert!(
            (project_total - 600.0).abs() < 0.005,
            "suma projektu = {project_total}, oczekiwano 600.00 (1 h × 100 + koszt 500)"
        );
        assert!(
            (client_total - project_total).abs() < 0.005,
            "agregat klienta ({client_total}) rozjeżdża się z sumą projektu ({project_total}) — koszt policzony dwa razy?"
        );
    }
```

**Uwaga:** `test_conn`, `seed_project`, `seed_cost`, `seed_session`, `project_amount`, `client_amount` to nazwy zastępcze. Odczytaj realne pomocniki (`grep -n "mod tests" -A 40 dashboard/src-tauri/src/commands/estimates.rs`) i realne funkcje liczące kwoty; dopisz brakujące pomocniki w `mod tests`.

- [ ] **Step 2: Uruchom**

Run: `cargo test -p timeflow-dashboard additional_cost_counted_exactly_once -- --nocapture`
Expected: PASS. FAIL = `P0` (podwójne naliczenie na fakturze).

- [ ] **Step 3: Commit**

```bash
git add dashboard/src-tauri/src/commands/estimates.rs
git commit -m "test(money): koszt dodatkowy liczony dokładnie raz w sumie projektu i klienta (I-22)"
```

### Task 4.4: Naprawa ustaleń i domknięcie

- [ ] **Step 1: Pętla naprawcza dla każdego `P0`/`P1` z tabeli**

Jak w Task 1.6: test → czerwony → poprawka w **jednym** module (tym, który odbiega od reguły z Task 4.1) → zielony → pełne testy → commit.

- [ ] **Step 2: Zaktualizuj Help.tsx i CHANGELOG**

Jeśli którakolwiek kwota na ekranie się zmieniła, opisz to w `Help.tsx` (sekcja o raportach/stawkach) i w `CHANGELOG.md` → `Unreleased` → `Fixed`. Użytkownik musi wiedzieć, że stara faktura i nowa mogą się różnić.

- [ ] **Step 3: Commit domknięcia**

```bash
git add docs/release/audit/etap4-pieniadze.md docs/release/INVARIANTS.md docs/release/RELEASE_CHECKLIST.md
git commit -m "docs(audit): etap 4 zamknięty — spójne wyliczanie kwot we wszystkich modułach"
```

**Bramka etapu 4:** `money-consistency.test.ts` i `additional_cost_counted_exactly_once` w CI; tabela „Weryfikacja per moduł" bez wierszy „nie".

---

## Etap 5 — Bezpieczeństwo

**Cel:** Zamknąć macierz endpointów z `docs/SECURITY_AUDIT.md` — dziś **wszystkie 21 wierszy ma pustą kolumnę „Reviewed?"** — oraz sprawdzić powierzchnię ataku poza HTTP.

**Kontekst dla wykonawcy:** `docs/SECURITY_AUDIT.md` definiuje już siedem oczekiwań na endpoint (AuthN, AuthZ, walidacja wejścia, rate-limiting, ujawnianie informacji, logowanie, obsługa błędów) i listę endpointów bez uwierzytelnienia. Ten etap **wykonuje** ten dokument, nie pisze go od nowa.

**Files:**
- Modify: `docs/SECURITY_AUDIT.md`
- Create: `docs/release/audit/etap5-bezpieczenstwo.md`

### Task 5.1: Przegląd endpointów — po jednym na raz

Endpointów jest 21. Realistyczne tempo to 3–5 na sesję. **Rozłóż to na kilka dni** — każdy endpoint to osobny commit.

- [ ] **Step 1: Wybierz endpoint i przeczytaj handler**

Zacznij od tych, które mutują stan lub zwracają sekrety — kolejność: `/lan/pair`, `/lan/upload-db`, `/lan/pull`, `/lan/store-paired-device`, `/lan/remove-paired-device`, `/lan/generate-pairing-code`, `/lan/trigger-sync`, reszta.

Run: `grep -n "fn handle_pair" -A 80 src/lan_server.rs`

- [ ] **Step 2: Przejdź siedem oczekiwań i zapisz odpowiedzi**

Dla wybranego endpointu wypełnij wiersz w nowym dokumencie:

Create/append `docs/release/audit/etap5-bezpieczenstwo.md`:

```markdown
# Etap 5 — Bezpieczeństwo

## Przegląd endpointów (wykonanie docs/SECURITY_AUDIT.md)

### POST /lan/pair

| Oczekiwanie | Stan | Dowód (plik:linia) | Ustalenie |
|---|---|---|---|
| 1. AuthN | | | |
| 2. AuthZ | | | |
| 3. Walidacja wejścia (rozmiar ciała, długość stringów, zakresy liczb) | | | |
| 4. Rate-limiting | | `src/lan_pair_throttle.rs` | |
| 5. Ujawnianie informacji (czy odpowiedź zdradza sekret niesparowanemu?) | | | |
| 6. Logowanie `[LAN][SEC]` | | | |
| 7. Kody błędów (401/403/404/413/429) bez wycieku szczegółów | | | |

**Werdykt:** ☐ zgodny ☐ ustalenia poniżej

(powtórz blok dla każdego endpointu)

## Tabela ustaleń

| # | Endpoint | Problem | Możliwy skutek | Priorytet | Poprawka | Test |
|---|---|---|---|---|---|---|
```

- [ ] **Step 3: Dla każdego ustalenia napisz test bezpieczeństwa**

Wzór (dopasuj do konkretnego handlera) — dopisz w `src/lan_server.rs`, `mod tests`, wzorując się na istniejącym `pull_rejected_without_active_sync`:

```rust
    /// Ciało żądania bez limitu rozmiaru pozwala niesparowanemu klientowi
    /// wyczerpać pamięć demona jednym POST-em. Limit musi odrzucać nadmiarowe
    /// ciało PRZED parsowaniem JSON-a, kodem 413.
    #[test]
    fn oversized_body_is_rejected_before_parsing() {
        let state = LanSyncState::new();
        let huge = format!(r#"{{"device_id":"{}"}}"#, "x".repeat(20 * 1024 * 1024));
        let (status, resp) = handle_pair(&state, &huge);
        assert_eq!(status, 413, "nadmiarowe ciało musi dostać 413, dostało {status}");
        assert!(
            !resp.contains("xxxx"),
            "odpowiedź nie może odbijać treści żądania"
        );
    }
```

- [ ] **Step 4: Uruchom, napraw, zaznacz w macierzy**

Run: `cargo test -p timeflow-demon <nazwa_testu> -- --nocapture`
Po naprawie zaznacz `[x]` w kolumnie „Reviewed?" w `docs/SECURITY_AUDIT.md` dla tego endpointu i wpisz numer wersji w kolumnę „Released in".

- [ ] **Step 5: Commit (jeden endpoint = jeden commit)**

```bash
git add src/lan_server.rs docs/SECURITY_AUDIT.md docs/release/audit/etap5-bezpieczenstwo.md
git commit -m "security(lan): przegląd POST /lan/pair — <co znaleziono/potwierdzono>"
```

Powtórz Step 1–5 dla pozostałych 20 endpointów.

### Task 5.2: Kryptografia i sekrety

- [ ] **Step 1: Przejrzyj moduł szyfrowania**

Run: `cat src/sync_encryption.rs | head -120`

Sprawdź i zapisz w dokumencie odpowiedzi na:
- Czy nonce/IV jest losowy per wiadomość i nigdy nie powtarzany dla tego samego klucza? (AES-GCM z powtórzonym nonce = utrata poufności **i** integralności)
- Czy klucz pochodzi z KDF z solą i odpowiednią liczbą iteracji, czy z gołego hasła?
- Czy porównania sekretów są stałoczasowe? (`grep -n "constant_time_eq" src/lan_server.rs` — funkcja istnieje, sprawdź, czy jest używana **wszędzie**, gdzie porównuje się sekret)
- Czy sekrety trafiają do logów? Run: `grep -rn "secret\|token\|password" --include='*.rs' src | grep -i "log\|println\|eprintln"`

- [ ] **Step 2: Sprawdź, czy sekrety nie wyciekły do repo**

Run:
```bash
git log --all --format='%H' | head -500 | while read sha; do
  git grep -I -n -E '(api[_-]?key|secret|password|token)\s*[:=]\s*["'"'"'][A-Za-z0-9/+_-]{16,}' "$sha" -- \
    ':!*.lock' ':!*test*' 2>/dev/null
done | sort -u | head -40
```
Expected: pusto. Każde trafienie = `P0`: sekret trzeba **unieważnić** (rotacja po stronie usługi), nie tylko usunąć z kodu.

- [ ] **Step 3: Sprawdź konfigurację Tauri**

Run:
```bash
cat dashboard/src-tauri/tauri.conf.json
ls dashboard/src-tauri/capabilities/ 2>/dev/null && cat dashboard/src-tauri/capabilities/*.json
```

Zapisz w dokumencie: czy CSP jest ustawione (nie `null`), czy uprawnienia (`capabilities`) są zawężone do faktycznie używanych poleceń, czy `withGlobalTauri` nie jest włączone bez potrzeby, czy `devUrl` nie zostaje w produkcyjnej konfiguracji.

- [ ] **Step 4: Commit**

```bash
git add docs/release/audit/etap5-bezpieczenstwo.md
git commit -m "security: przegląd kryptografii, sekretów i konfiguracji Tauri"
```

### Task 5.3: Powierzchnia webui i MCP

`dashboard/src-tauri/src/webui/` wystawia serwer HTTP (potencjalnie w LAN — `lan_exposure` w `webui/config.rs`), a `mcp/` wystawia narzędzia sterujące danymi.

- [ ] **Step 1: Sprawdź uwierzytelnienie webui**

Run: `cat dashboard/src-tauri/src/webui/auth.rs`

Zapisz: jak wygląda sesja, czy hasło jest hashowane, czy jest ograniczenie prób, czy ciasteczko ma `HttpOnly`/`SameSite`, co się dzieje przy `lan_exposure = true` (serwer widoczny dla całej sieci).

- [ ] **Step 2: Sprawdź powierzchnię MCP**

Run: `grep -n "fn \|name:" dashboard/src-tauri/src/mcp/tools.rs | head -60`

Dla każdego narzędzia MCP zapisz: czy modyfikuje dane, czy kasuje, czy wymaga potwierdzenia. Narzędzie kasujące dane bez potwierdzenia i bez kopii zapasowej = `P1`. (`mcp/backup.rs` istnieje — sprawdź, czy jest wołane przed operacjami destrukcyjnymi.)

- [ ] **Step 3: Commit**

```bash
git add docs/release/audit/etap5-bezpieczenstwo.md
git commit -m "security: przegląd powierzchni webui i narzędzi MCP"
```

**Bramka etapu 5:** `docs/SECURITY_AUDIT.md` bez pustych `[ ]` w kolumnie „Reviewed?"; wszystkie `P0`/`P1` zamknięte testem; `cargo deny` i `npm audit` zielone bez `|| true`.

---

## Etap 6 — Wydajność

**Cel:** Aplikacja startuje szybko, nie mieli bazy przy każdym renderze, a demon nie rośnie w pamięci. Punkt odniesienia: `docs/release/BASELINE.md`.

**Files:**
- Create: `docs/release/audit/etap6-wydajnosc.md`

### Task 6.1: Profil zapytań SQL

- [ ] **Step 1: Włącz logowanie wolnych zapytań na czas audytu**

Znajdź miejsce otwarcia połączenia (`grep -n "fn open\|Connection::open" dashboard/src-tauri/src/db.rs`) i dodaj tymczasowo profiler rusqlite:

```rust
    // TYMCZASOWO na czas audytu wydajności (etap 6). USUŃ przed commitem finalnym.
    conn.profile(Some(|sql: &str, duration: std::time::Duration| {
        if duration.as_millis() >= 20 {
            log::warn!("[SLOW SQL] {} ms — {}", duration.as_millis(), sql);
        }
    }));
```

- [ ] **Step 2: Przeklikaj aplikację i zbierz logi**

Uruchom aplikację na bazie o realnym rozmiarze (jeśli nie masz — zaimportuj `projects_list.json` albo wygeneruj kilkanaście tysięcy sesji). Przejdź kolejno: Dashboard → Projects → Sessions → Time Analysis → Report → PM → Clients → Estimates → AI. Zbierz wszystkie linie `[SLOW SQL]`.

- [ ] **Step 3: Zapisz i posortuj**

Create `docs/release/audit/etap6-wydajnosc.md`:

```markdown
# Etap 6 — Wydajność

## Wolne zapytania (>20 ms) zebrane profilerem

| # | Ekran | Zapytanie (skrót) | Czas | Ile razy na wejście na ekran | Diagnoza | Priorytet | Poprawka |
|---|---|---|---|---|---|---|---|

**Diagnozy do wyboru:** brak indeksu / N+1 (zapytanie w pętli) / pełny skan tabeli /
zapytanie wołane przy każdym renderze zamiast raz / agregacja, którą można policzyć w SQL.

## Plan indeksów

| Tabela | Kolumny | Uzasadnia zapytanie # | Migracja |
|---|---|---|---|

## Wynik pomiaru po poprawkach

| Metryka | Baseline | Po poprawkach | Zmiana |
|---|---|---|---|
```

- [ ] **Step 4: Sprawdź istniejące indeksy**

Run: `grep -rn "CREATE INDEX" --include='*.rs' dashboard/src-tauri/src/db_migrations/ | sed 's/.*CREATE INDEX/CREATE INDEX/'`

Porównaj z kolumnami, po których filtrują wolne zapytania. Brakujący indeks na `sessions(session_date)`, `sessions(updated_at)` czy `session_project_cache` to typowe `P2` z dużym zyskiem. (`m22_updated_at_indexes.rs` już coś dodaje — sprawdź zakres.)

- [ ] **Step 5: Dodaj brakujące indeksy jako nową migrację**

Utwórz `dashboard/src-tauri/src/db_migrations/m28_perf_indexes.rs` wzorując się **dokładnie** na `m22_updated_at_indexes.rs` (odczytaj go i skopiuj strukturę: sygnaturę funkcji, sposób rejestracji w `mod.rs`, obsługę idempotencji przez `IF NOT EXISTS`).

- [ ] **Step 6: Zmierz ponownie i usuń profiler**

Powtórz Step 2 z indeksami. Wpisz liczby do tabeli „Wynik pomiaru". Usuń kod profilera dodany w Step 1.

Run: `grep -rn "SLOW SQL" --include='*.rs' dashboard/src-tauri/src`
Expected: pusto.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src-tauri/src/db_migrations/ docs/release/audit/etap6-wydajnosc.md
git commit -m "perf(db): indeksy dla zapytań ekranów Dashboard/Sessions/Report (m28)"
```

### Task 6.2: Renderowanie frontu

- [ ] **Step 1: Zmierz zbędne renderowanie**

Uruchom dev (`cd dashboard && npm run dev`), otwórz React DevTools → Profiler, nagraj wejście na Dashboard i przełączenie zakresu dat. Zapisz w dokumencie komponenty renderujące się >5 razy na jedną akcję.

- [ ] **Step 2: Sprawdź `useEffect` wołające backend**

Run: `grep -rn "useEffect(" -A 3 --include='*.ts' --include='*.tsx' dashboard/src/hooks | grep -B1 "invoke\|fetch" | head -40`

Dla każdego trafienia zapisz: czy tablica zależności jest stabilna, czy efekt nie strzela dwa razy przy montowaniu (React 19 StrictMode), czy jest anulowanie przy odmontowaniu.

- [ ] **Step 3: Sprawdź reguły selektorów Zustand**

`docs/CODING_STYLE.md` zabrania destrukturyzacji całego store'a. Run:

```bash
grep -rn "use\(UI\|Data\|Settings\)Store()" --include='*.ts' --include='*.tsx' dashboard/src | grep -v '\.test\.'
```
Expected: pusto. Każde trafienie = `P3` (komponent renderuje się na każdą zmianę store'a).

- [ ] **Step 4: Poprawki, po jednej na commit**

Kolejność: najpierw komponenty na ścieżce startu aplikacji, potem listy (`SessionsVirtualList` już używa `react-virtuoso` — sprawdź, czy inne długie listy też), potem reszta.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src docs/release/audit/etap6-wydajnosc.md
git commit -m "perf(ui): ogranicz zbędne renderowanie na ekranie <nazwa>"
```

### Task 6.3: Rozmiar bundla i czas startu

- [ ] **Step 1: Zobacz, co waży**

Run: `cd dashboard && npm run build && ls -S dist/assets/*.js | head -10 | xargs du -h`

Porównaj z `BASELINE.md`. Sprawdź, czy `recharts` i `react-virtuoso` są ładowane leniwie tylko na ekranach, które ich potrzebują (kod jest już dzielony — nazwy plików w `dist/assets` sugerują `lazy()`; potwierdź: `grep -rn "lazy(" dashboard/src | head -20`).

- [ ] **Step 2: Zmierz zimny start**

Uruchom zbudowaną aplikację z zamkniętym procesem i pustym cache. Stoper: od kliknięcia ikony do widocznych danych na Dashboardzie. Powtórz 3× i zapisz medianę.

- [ ] **Step 3: Zapisz wyniki i zamknij etap**

```bash
git add docs/release/audit/etap6-wydajnosc.md docs/release/BASELINE.md docs/release/RELEASE_CHECKLIST.md
git commit -m "docs(audit): etap 6 zamknięty — wydajność zmierzona i poprawiona względem baseline"
```

### Task 6.4: Zużycie zasobów przez demona

- [ ] **Step 1: Uruchom demona na 8 godzin i zmierz**

```bash
# co 15 minut zapisz RSS i CPU
while true; do
  ps -o rss=,%cpu=,etime= -p "$(pgrep -f timeflow-demon | head -1)" >> /tmp/demon-usage.txt
  sleep 900
done
```

- [ ] **Step 2: Oceń trend**

Run: `column -t /tmp/demon-usage.txt`
Rosnący monotonicznie RSS przez 8 h = wyciek pamięci, `P1`. Stabilny lub oscylujący = OK. Zapisz wykres/tabelę w dokumencie.

- [ ] **Step 3: Sprawdź częstotliwość odpytywania**

Run: `grep -rn "sleep\|interval\|Duration::from_secs" --include='*.rs' src/monitor.rs src/tracker.rs src/lan_discovery.rs | head -20`

Zapisz, jak często demon budzi system. Wybudzanie co <5 s bez potrzeby to realny koszt baterii na laptopie — `P2`.

- [ ] **Step 4: Commit**

```bash
git add docs/release/audit/etap6-wydajnosc.md
git commit -m "docs(audit): pomiar zużycia zasobów przez demona przez 8 h"
```

**Bramka etapu 6:** tabela „Wynik pomiaru" wypełniona; żadna metryka nie jest gorsza niż w `BASELINE.md`; brak wolnych zapytań >100 ms na ścieżce startu.

---

## Etap 7 — Odporność na błędy i awarie

**Cel:** Aplikacja nie ginie po cichu i nie zostawia uszkodzonej bazy.

**Kontekst dla wykonawcy — jedno ustalenie jest znane z góry:** `Cargo.toml` ustawia w profilu release `panic = "abort"`. Jednocześnie w kodzie produkcyjnym Rusta jest **ponad tysiąc** wywołań `.unwrap()` / `.expect(...)` (`src/sync_common.rs` ~252, `commands/import_data.rs` ~102, `commands/projects.rs` ~100, `shared/sync/merge.rs` ~93 — część z nich w blokach testowych, ale nie wszystkie). W buildzie release **każdy z nich, który wykona się na ścieżce produkcyjnej, ubija cały proces bez rozwijania stosu** — bez zapisania niedokończonej transakcji, bez komunikatu dla użytkownika. To główne ryzyko wydania.

**Files:**
- Create: `docs/release/audit/etap7-odpornosc.md`
- Create: `scripts/audit/find-panics-in-prod.sh`

### Task 7.1: Inwentaryzacja punktów paniki na ścieżce produkcyjnej

- [ ] **Step 1: Napisz skaner odsiewający testy**

Create `scripts/audit/find-panics-in-prod.sh`:

```bash
#!/usr/bin/env bash
# Wypisuje unwrap/expect/panic POZA blokami #[cfg(test)].
# Z panic="abort" w profilu release każde takie miejsce to potencjalne
# natychmiastowe ubicie procesu bez zapisu danych.
set -uo pipefail
cd "$(dirname "$0")/../.."

for file in $(find src shared dashboard/src-tauri/src -name '*.rs' | sort); do
  awk -v F="$file" '
    /#\[cfg\(test\)\]/ { intest=1 }
    intest && /^}/ && depth<=1 { intest=0 }
    intest { next }
    /\.unwrap\(\)|\.expect\(|panic!\(|unreachable!\(|todo!\(|unimplemented!\(/ {
      printf "%s:%d: %s\n", F, NR, $0
    }
  ' "$file"
done
```

- [ ] **Step 2: Uruchom i policz**

Run:
```bash
chmod +x scripts/audit/find-panics-in-prod.sh
./scripts/audit/find-panics-in-prod.sh > /tmp/panics.txt
wc -l /tmp/panics.txt
awk -F: '{print $1}' /tmp/panics.txt | sort | uniq -c | sort -rn | head -20
```

Zapisz obie liczby w dokumencie.

**Uwaga:** skaner `awk` jest zgrubny (nie liczy zagnieżdżenia nawiasów precyzyjnie). Traktuj go jako sito, nie wyrocznię — każde trafienie potwierdzasz wzrokiem.

- [ ] **Step 3: Sklasyfikuj trafienia**

Create `docs/release/audit/etap7-odpornosc.md`:

```markdown
# Etap 7 — Odporność na błędy i awarie

## Punkty paniki na ścieżce produkcyjnej

Profil release ma `panic = "abort"` → panika = natychmiastowe ubicie procesu
bez rozwinięcia stosu, bez `Drop`, bez zamknięcia transakcji SQLite.

Klasyfikacja:
- **A — niemożliwe do wywołania** (np. `unwrap()` na `Regex::new` ze stałej literalnej,
  `Mutex` bez zatrutej ścieżki). Zostaw, ale dopisz komentarz `// SAFETY: …`.
- **B — możliwe przy nietypowych danych** (uszkodzona baza, archiwum od peera,
  plik użytkownika, brak uprawnień). **Musi zniknąć przed wydaniem.**
- **C — możliwe przy błędzie programisty** (indeksowanie tablicy, `expect` na
  wyniku zapytania). Zamień na obsługę błędu z komunikatem.

| Plik:linia | Klasa | Co się stanie, gdy padnie | Poprawka | Zrobione |
|---|---|---|---|---|

## Podsumowanie

| Klasa | Liczba | Zamkniętych |
|---|---|---|
| A | | |
| B | | |
| C | | |
```

Przejdź `/tmp/panics.txt` **plik po pliku**, zaczynając od tych na ścieżce danych użytkownika: `commands/import_data.rs`, `commands/import.rs`, `shared/sync/merge.rs`, `src/sync_common.rs`, `commands/database.rs`. Klasa B ma priorytet `P0`.

- [ ] **Step 4: Commit skanera i inwentaryzacji**

```bash
git add scripts/audit/find-panics-in-prod.sh docs/release/audit/etap7-odpornosc.md
git commit -m "chore(audit): inwentaryzacja punktów paniki na ścieżce produkcyjnej"
```

### Task 7.2: Eliminacja klasy B — po jednym module na commit

- [ ] **Step 1: Napisz test odtwarzający panikę**

Przykład dla importu uszkodzonego archiwum — dopisz w `dashboard/src-tauri/src/commands/import_data.rs`, `mod tests`:

```rust
    /// Plik importu od użytkownika bywa uszkodzony (obcięty transfer, ręczna
    /// edycja, archiwum z innej aplikacji). Z panic="abort" panika przy parsowaniu
    /// ubija cały dashboard bez komunikatu. Import MUSI zwrócić błąd.
    #[test]
    fn corrupted_archive_returns_error_instead_of_panicking() {
        let cases = [
            "",                                   // pusty plik
            "{",                                  // obcięty JSON
            r#"{"data":null}"#,                   // null tam, gdzie oczekiwany obiekt
            r#"{"data":{"sessions":"nie-tablica"}}"#, // zły typ
            r#"{"data":{"sessions":[{"id":"tekst-zamiast-liczby"}]}}"#,
        ];

        for raw in cases {
            let result = parse_import_archive(raw);
            assert!(
                result.is_err(),
                "uszkodzone archiwum {raw:?} nie zwróciło błędu — grozi panika w produkcji"
            );
        }
    }
```

**Uwaga:** `parse_import_archive` to nazwa zastępcza — odczytaj realną funkcję wejściową importu (`grep -n "pub.*fn.*import" dashboard/src-tauri/src/commands/import_data.rs | head`).

- [ ] **Step 2: Uruchom**

Run: `cargo test -p timeflow-dashboard corrupted_archive_returns_error -- --nocapture`
Expected: FAIL (panika lub `is_err() == false`) — to potwierdza ustalenie.

- [ ] **Step 3: Zamień `unwrap`/`expect` na propagację błędu**

Wzorzec: `let x = foo().unwrap();` → `let x = foo().map_err(|e| CommandError::from(format!("<co się nie udało>: {e}")))?;`

**Nie łap paniki przez `catch_unwind`** — z `panic = "abort"` to nie zadziała, a poza tym maskuje problem zamiast go usuwać.

- [ ] **Step 4: Uruchom ponownie**

Run: `cargo test -p timeflow-dashboard corrupted_archive_returns_error && cargo test --workspace`
Expected: PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/import_data.rs docs/release/audit/etap7-odpornosc.md
git commit -m "fix(import): uszkodzone archiwum zwraca błąd zamiast ubijać proces"
```

Powtórz Step 1–5 dla kolejnych modułów klasy B. **Jeden moduł = jeden commit**, żeby dało się rozłożyć na tygodnie.

### Task 7.3: Integralność bazy i transakcje

- [ ] **Step 1: Sprawdź, czy operacje wieloetapowe są w transakcjach**

Run:
```bash
grep -rn "BEGIN\|transaction()\|unchecked_transaction" --include='*.rs' \
  dashboard/src-tauri/src/commands shared/sync src | grep -v 'mod tests'
```

Porównaj z listą operacji, które modyfikują więcej niż jedną tabelę: merge, import, kasowanie projektu (`delete_costs_of_project` + kasowanie sesji + kasowanie projektu), scalanie projektów (m23), podział sesji (`sessions/split.rs`), `rebuild_sessions`. Każda taka operacja **bez** transakcji = `P0` (przerwanie w połowie zostawia bazę w stanie pośrednim).

- [ ] **Step 2: Napisz test przerwania w połowie**

```rust
    /// Kasowanie projektu dotyka trzech tabel (projects, sessions, project_costs).
    /// Bez transakcji przerwanie w połowie zostawia sesje-sieroty wskazujące na
    /// nieistniejący projekt. Test wymusza atomowość przez wstrzyknięcie błędu
    /// w ostatnim kroku.
    #[test]
    fn deleting_project_is_atomic() {
        let conn = test_conn();
        seed_project(&conn, "Alpha", 100.0);
        seed_session(&conn, "Alpha", "2026-03-05 10:00:00", "2026-03-05 11:00:00");
        seed_cost(&conn, "Alpha", 500.0, "2026-03-05");

        // Symulacja awarii: zablokuj tabelę kosztów tak, by ostatni krok padł.
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();

        let _ = delete_project_with_failure_injection(&conn, "Alpha");

        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            before, after,
            "przerwane kasowanie projektu zostawiło bazę w stanie pośrednim"
        );
    }
```

**Uwaga:** `delete_project_with_failure_injection` musisz dopisać w `mod tests` — najprościej: wywołaj realną funkcję kasowania na połączeniu, w którym wcześniej wykonasz `CREATE TRIGGER` rzucający `RAISE(ABORT, ...)` na ostatniej tabeli. Jeśli to zbyt kruche, alternatywa: sprawdź wprost, że funkcja kasująca otwiera transakcję (`assert!` na obecności `BEGIN` w logu SQL profilera z Task 6.1).

- [ ] **Step 3: Sprawdź odporność na uszkodzoną bazę przy starcie**

Ręcznie: skopiuj bazę, uszkodź ją (`dd if=/dev/urandom of=<baza> bs=1 seek=5000 count=200 conv=notrunc`), uruchom aplikację.
Oczekiwane: czytelny komunikat + propozycja przywrócenia z kopii, **nie** natychmiastowe zamknięcie. Zapisz obserwację w dokumencie; brak obsługi = `P1`.

- [ ] **Step 4: Sprawdź kopie zapasowe przed migracją**

Run: `grep -rn "backup\|VACUUM INTO" --include='*.rs' dashboard/src-tauri/src/db.rs dashboard/src-tauri/src/db_migrations/mod.rs`

Zapisz: czy przed uruchomieniem migracji powstaje kopia bazy i gdzie. Brak kopii przy migracji nieodwracalnej = `P0`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src docs/release/audit/etap7-odpornosc.md
git commit -m "fix(db): atomowość operacji wielotabelowych + kopia przed migracją"
```

### Task 7.4: Wielowątkowość

- [ ] **Step 1: Wypisz stan współdzielony**

Run:
```bash
grep -rn "Arc<\|Mutex<\|RwLock<\|AtomicBool\|AtomicU\|static " --include='*.rs' src shared dashboard/src-tauri/src | grep -v 'mod tests' | head -40
```

- [ ] **Step 2: Dla każdego zapisz w dokumencie**

| Zmienna | Wątki, które ją czytają | Wątki, które ją piszą | Ryzyko zakleszczenia | Ryzyko wyścigu |

Szczególnie: `LanSyncState` (dotykany przez pętlę discovery, serwer HTTP i orkiestrator), `peer_present` (`AtomicBool` — kto ustawia, kto czyta), stan „freeze" bazy (`AUTO_UNFREEZE_TIMEOUT`).

- [ ] **Step 3: Uruchom testy pod detektorem wyścigów**

Run: `RUSTFLAGS="-Z sanitizer=thread" cargo +nightly test -p timeflow-demon --target aarch64-apple-darwin 2>&1 | tail -40`

Jeśli nightly nie jest dostępny, pomiń i zapisz w dokumencie: „nie zweryfikowano sanitizerem — ryzyko przeniesione do backlogu". **Nie udawaj, że sprawdziłeś.**

- [ ] **Step 4: Commit**

```bash
git add docs/release/audit/etap7-odpornosc.md
git commit -m "docs(audit): mapa stanu współdzielonego i ryzyk wielowątkowych"
```

**Bramka etapu 7:** zero pozycji klasy B w tabeli punktów paniki; operacje wielotabelowe w transakcjach; kopia bazy przed migracją potwierdzona.

---

## Etap 8 — Nadmiarowość i over-engineering

**Cel:** Usunąć kod, którego nikt nie wywołuje, i abstrakcje, które nie zarabiają na siebie. Dopiero teraz — wcześniejsze etapy mogły coś uzasadnić lub obalić.

**Files:**
- Create: `docs/release/audit/etap8-nadmiar.md`

### Task 8.1: Martwy kod

- [ ] **Step 1: Front — knip**

Run: `cd dashboard && npm run lint:knip`
CI już to uruchamia, więc wynik powinien być czysty. Jeśli nie — usuń nieużywane eksporty, po jednym obszarze na commit.

- [ ] **Step 2: Backend — clippy z ostrzeżeniami o martwym kodzie**

Run: `cargo clippy --workspace --all-targets 2>&1 | grep -E "never used|never read|never constructed" | sort -u`

Każde trafienie: sprawdź, czy naprawdę nikt tego nie woła (`grep -rn "<nazwa>" --include='*.rs' .`). Uwaga na funkcje wołane tylko przez `webui/rpc_generated.rs` albo przez `#[tauri::command]` — clippy ich nie widzi. **Nie usuwaj niczego, co pojawia się w `rpc_generated.rs` lub `invoke_handler`.**

- [ ] **Step 3: Nieużywane zależności**

Run:
```bash
cargo install cargo-udeps --locked 2>/dev/null || true
cargo +nightly udeps --workspace 2>&1 | tail -30
cd dashboard && npx depcheck 2>&1 | head -30
```

Każdą nieużywaną zależność usuń osobnym commitem i po każdym uruchom `cargo build --workspace` / `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: usuń martwy kod i nieużywane zależności (etap 8)"
```

### Task 8.2: Over-engineering — abstrakcje bez drugiego użytkownika

- [ ] **Step 1: Wypisz kandydatów**

Zasada: abstrakcja z **jedną** implementacją i **bez** planu na drugą jest kosztem bez zysku.

Run:
```bash
grep -rn "trait " --include='*.rs' src shared dashboard/src-tauri/src | grep -v 'mod tests'
```

Dla każdego traitu policz implementacje: `grep -rn "impl .* for " --include='*.rs' . | grep "<NazwaTraitu>"`.

Wpisz do dokumentu:

```markdown
## Abstrakcje — czy zarabiają na siebie?

| Abstrakcja | Implementacje | Uzasadnienie istnienia | Werdykt |
|---|---|---|---|
| `TimeStrategy` (`time_algorithm.rs`) | 1 (`WallClockStrategy`) | Rejestr strategii wystawiony w UI (Preferences → „Time algorithm"), przygotowany pod plugin/WASM | **zostaje** — jest częścią kontraktu UI, nie spekulacją |
```

**Uwaga dla wykonawcy:** `TimeStrategy` jest przykładem abstrakcji, która **zostaje** mimo jednej implementacji — jest wystawiona użytkownikowi przez `list_time_algorithms` i stanowi zamierzone jedno źródło prawdy dla obliczeń (etap 1). Nie usuwaj jej. Szukaj innych: warstw opakowujących jedno wywołanie, generyków z jednym typem konkretnym, konfiguracji, której nikt nie zmienia.

- [ ] **Step 2: Wypisz duplikaty logiki**

Run: `./scripts/audit/find-duplicate-math.sh > /tmp/etap8-dup.txt` i porównaj z ustaleniami z etapu 1 — po naprawach lista powinna być krótsza. Różnica to miara postępu; wpisz obie liczby do dokumentu.

- [ ] **Step 3: Wielkie pliki**

Run: `find src shared dashboard/src-tauri/src dashboard/src -name '*.rs' -o -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | head -15`

Pliki >1000 linii (`src/sync_common.rs` 3668, `commands/projects.rs` 2765, `commands/import_data.rs` 2397, `src/lan_server.rs` 2060, `shared/sync/merge.rs` 1653) wpisz do tabeli z propozycją podziału **wzdłuż odpowiedzialności, nie wzdłuż warstw**. `docs/TODO.md` wymienia „refactor duży plików" jako oczekujący.

**Podział wykonuj tylko wtedy, gdy i tak modyfikujesz dany plik w innym etapie.** Refaktor dla samego refaktoru przed wydaniem to ryzyko regresji bez zysku — zapisz propozycję i odłóż na po wydaniu, jeśli nie ma innego powodu.

- [ ] **Step 4: Zaostrz clippy do `-D warnings`**

Gdy lista ostrzeżeń jest już pusta (porównaj z `BASELINE.md`), zmień w `.github/workflows/ci.yml`:

```yaml
      - run: cargo clippy --workspace --all-targets -- -D warnings
```

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: sukces. Jeśli zostały ostrzeżenia, których świadomie nie naprawiasz — dodaj punktowe `#[allow(...)]` **z komentarzem dlaczego**, nigdy globalnie w `lib.rs`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml docs/release/audit/etap8-nadmiar.md
git commit -m "ci: clippy z -D warnings po wyczyszczeniu ostrzeżeń"
```

**Bramka etapu 8:** `cargo clippy --workspace --all-targets -- -D warnings` zielone; `npm run lint:knip` zielone; tabela abstrakcji wypełniona z werdyktem dla każdej pozycji.

---

## Etap 9 — Parity Windows ⇄ macOS

**Cel:** Zamknąć tracker `PARITY.md` albo świadomie zaakceptować pozostałe różnice.

**Kontekst dla wykonawcy:** `PARITY.md` ma dziś dwa otwarte TODO, oba z adnotacją **„NIEZWERYFIKOWANE na realnym Windows (cross-compile pada na `libsqlite3-sys`)"**. CI buduje na Windows tylko demona (`cargo build -p timeflow-demon`) — **nie uruchamia testów** i nie buduje dashboardu. To znaczy, że kod Windows jest kompilowany, ale nigdy nie wykonywany w CI.

**Files:**
- Modify: `PARITY.md`, `.github/workflows/ci.yml`
- Create: `docs/release/audit/etap9-parity.md`

### Task 9.1: Uruchom testy Rusta na Windows w CI

- [ ] **Step 1: Zmień job `windows-build` na testujący**

W `.github/workflows/ci.yml` zamień:

```yaml
      - run: cargo build -p timeflow-demon
```

na:

```yaml
      - run: cargo build -p timeflow-demon
      # Kompilacja wykrywa błędy składni w platform/windows/*, ale nie wykrywa
      # błędów zachowania. Testy demona i shared działają bez dist/ frontu.
      - run: cargo test -p timeflow-demon -p timeflow-shared
```

- [ ] **Step 2: Uruchom CI i zobacz, co pada**

Wypchnij gałąź i obejrzyj log joba `windows-build`. Każdy padający test = ustalenie: albo test zakłada zachowanie macOS, albo kod Windows faktycznie działa inaczej. **Rozróżnij to zanim cokolwiek naprawisz** — poprawianie testu, żeby przechodził na Windows, może zamaskować realną różnicę zachowania.

- [ ] **Step 3: Zapisz ustalenia**

Create `docs/release/audit/etap9-parity.md`:

```markdown
# Etap 9 — Parity Windows ⇄ macOS

## Testy padające na Windows

| Test | Przyczyna | Test zakłada macOS / kod różni się | Poprawka |
|---|---|---|---|

## Weryfikacja TODO z PARITY.md

| Pozycja z PARITY.md | Jak zweryfikowano | Wynik | Status |
|---|---|---|---|
| Tray — ukrywanie bloku sync przez Win32 `RemoveMenu`/`InsertMenuW` | | | |
| `query_daemon_process_status` — scoped query przez `Get-CimInstance` | | | |

## Ścieżki i separatory

| Obszar | Sprawdzone | Uwagi |
|---|---|---|
| `shared/timeflow_paths.rs` — katalog danych na obu systemach | | |
| Ścieżki w eksporcie/imporcie (czy archiwum z Windows importuje się na macOS) | | |
| `find_daemon_exe` — rozszerzenie `.exe`, spacje w ścieżce | | |
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml docs/release/audit/etap9-parity.md
git commit -m "ci: uruchamiaj testy demona i shared także na Windows"
```

### Task 9.2: Weryfikacja na realnym Windows

Cross-compile nie działa (`libsqlite3-sys`), więc to wymaga maszyny albo maszyny wirtualnej z Windows.

- [ ] **Step 1: Zbuduj pełną aplikację na Windows**

Na maszynie Windows:
```powershell
cd dashboard; npm ci; npm run build
cd ..; cargo build --release -p timeflow-demon
cd dashboard; npm run tauri build
```

- [ ] **Step 2: Zweryfikuj oba TODO z PARITY.md**

Punkt 1 — tray: wyłącz sync całkowicie w ustawieniach. **Sprawdź:** czy blok sync znika (jak na macOS), czy zostaje wyszarzony. Zapisz obserwację.

Punkt 2 — detekcja demona: uruchom demona, sprawdź status w dashboardzie; zatrzymaj demona, sprawdź ponownie; uruchom **drugi, obcy proces o nazwie `timeflow-demon.exe`** z innej ścieżki i sprawdź, czy status nie daje fałszywego „Running". Zapisz obserwację. `PARITY.md` wymienia konkretne ryzyko: quoting `-Command` w `std::process` i fałszywy „Stopped" przy pustym wyjściu PowerShella — sprawdź oba.

- [ ] **Step 3: Test archiwum międzysystemowego**

Wyeksportuj dane na Windows, zaimportuj na macOS i odwrotnie. **Sprawdź:** te same sumy czasu, te same projekty, brak zdublowanych sesji, ścieżki plików w `file_activities` nie wysypują widoku Detailed.

- [ ] **Step 4: Zaktualizuj PARITY.md**

Dla każdej pozycji: albo usuń wiersz (różnica zamknięta), albo zmień adnotację z „NIEZWERYFIKOWANE" na „Zweryfikowane na buildzie Windows `<data>`, zachowanie: `<opis>`". **Nie zostawiaj słowa „NIEZWERYFIKOWANE" w wydaniu** — albo sprawdzasz, albo jawnie akceptujesz jako znaną różnicę z uzasadnieniem.

- [ ] **Step 5: Commit**

```bash
git add PARITY.md docs/release/audit/etap9-parity.md
git commit -m "docs(parity): weryfikacja tray i detekcji demona na realnym buildzie Windows"
```

**Bramka etapu 9:** testy Rusta zielone na Windows w CI; `PARITY.md` bez adnotacji „NIEZWERYFIKOWANE"; archiwum przenosi się w obie strony.

---

## Etap 10 — UI, i18n, Help i terminologia

**Cel:** To, co użytkownik widzi, jest kompletne, przetłumaczone i opisane w pomocy.

**Kontekst:** `dashboard/package.json` ma już trzy lintery i18n (`check-hardcoded-i18n.cjs`, `check-inline-i18n-bridge.cjs`, `check-locale-consistency.cjs`), a locale to `en/common.json` i `pl/common.json`. `CLAUDE.md` wymaga, żeby każda nowa funkcja trafiła do `Help.tsx`, a `docs/TODO.md` notuje: „cały UI ma być po angielsku (pomoc i quick start są wyjątkiem)".

**Files:**
- Create: `docs/release/audit/etap10-ui.md`
- Modify: `dashboard/src/pages/Help.tsx`

### Task 10.1: Kompletność tłumaczeń

- [ ] **Step 1: Uruchom istniejące bramki**

Run: `cd dashboard && npm run lint:i18n-hardcoded && npm run lint:inline-i18n-bridge && npm run lint:locales`
Expected: wszystkie zielone (CI je uruchamia). Jeśli któraś pada — to jest ustalenie.

- [ ] **Step 2: Sprawdź, czy klucze są faktycznie użyte**

Run:
```bash
cd dashboard
node -e "
const en = require('./src/locales/en/common.json');
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  typeof v === 'object' && v !== null ? flat(v, p + k + '.') : [p + k]);
console.log(flat(en).length + ' kluczy w en/common.json');
" 
grep -roh "t(['\"][a-zA-Z0-9_.]*['\"]" src --include='*.tsx' --include='*.ts' | sed "s/t(['\"]//;s/['\"]//" | sort -u | wc -l
```

Duża różnica między liczbą kluczy a liczbą użyć sugeruje martwe tłumaczenia. Zapisz obie liczby; nie usuwaj kluczy hurtem — klucze bywają składane dynamicznie (np. `nameKey` z `ROUNDING_VARIANTS`).

- [ ] **Step 3: Sprawdź terminologię TIMEFLOW**

Run:
```bash
grep -rn "Timeflow\|timeflow\b" --include='*.tsx' --include='*.ts' --include='*.json' dashboard/src | grep -v "timeflow-\|@timeflow\|timeflow_" | head -20
```
Każde wystąpienie w tekście widocznym dla użytkownika, które nie jest `TIMEFLOW`, to ustalenie `P3` (reguła z `CLAUDE.md` §2).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src docs/release/audit/etap10-ui.md
git commit -m "fix(i18n): uzupełnij brakujące tłumaczenia i ujednolić zapis TIMEFLOW"
```

### Task 10.2: Kompletność Help.tsx

- [ ] **Step 1: Zestaw funkcje z pomocą**

Wypisz każdą pozycję nawigacji i każdą kartę ustawień:

Run:
```bash
cat dashboard/src/lib/sidebar-nav-items.ts
ls dashboard/src/components/settings/
ls dashboard/src/pages/
```

Create `docs/release/audit/etap10-ui.md` z sekcją:

```markdown
## Pokrycie Help.tsx

| Ekran / ustawienie | Opisane w Help.tsx? | Zawiera „co robi"? | „kiedy użyć"? | „ograniczenia"? |
|---|---|---|---|---|
```

Wypełnij dla każdego ekranu i każdej karty ustawień. Reguła z `CLAUDE.md` §3 wymaga wszystkich trzech elementów opisu.

- [ ] **Step 2: Uzupełnij braki w Help.tsx**

Dopisz brakujące sekcje, zachowując istniejący format i kolejność (`CLAUDE.md` §3: „Utrzymuj spójny format i kolejność sekcji"). Zwróć uwagę na funkcje dodane niedawno i widoczne w `CHANGELOG.md → Unreleased`: koszty dodatkowe, zadania (todos), eksport `file_activities`, zmiany w AI.

- [ ] **Step 3: Sprawdź stany UI**

Dla każdego ekranu z listy zweryfikuj ręcznie trzy stany (`CLAUDE.md` §4): ładowanie, pusto, błąd. Zapisz w tabeli:

```markdown
## Stany ekranów

| Ekran | Loading | Empty | Error | Uwagi |
|---|---|---|---|---|
```

Ekran, który przy błędzie pokazuje pustą tabelę zamiast komunikatu, to `P2` — użytkownik nie odróżni „brak danych" od „nie udało się pobrać".

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/Help.tsx docs/release/audit/etap10-ui.md
git commit -m "docs(help): uzupełnij opisy funkcji i zweryfikuj stany ekranów"
```

### Task 10.3: Dostępność i react-doctor

- [ ] **Step 1: Uruchom react-doctor z roota**

Run: `npx -y react-doctor@latest . --verbose`
Expected: **100/100** (`CLAUDE.md` §5). Wynik ~49/100 z błędami „security" na plikach `.py` oznacza, że config się nie załadował — sprawdź obecność `doctor.config.json` w roocie.

- [ ] **Step 2: Napraw, co zgłasza**

Każde ustalenie osobnym commitem, żeby dało się cofnąć pojedynczo.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix(ui): ustalenia react-doctor (etap 10)"
```

**Bramka etapu 10:** trzy lintery i18n zielone; react-doctor 100/100; tabela pokrycia Help.tsx bez „nie"; tabela stanów ekranów wypełniona.

---

## Etap 11 — Inżynieria wydania

**Cel:** Zbudować, podpisać, wydać i umieć się wycofać.

**Files:**
- Create: `docs/release/audit/etap11-wydanie.md`
- Modify: `CHANGELOG.md`, `VERSION`, `.gitignore`

### Task 11.1: Porządek w repo przed wydaniem

- [ ] **Step 1: Napraw mylący wpis w `.gitignore`**

`.gitignore` zawiera linię `dashboard/src-tauri/Cargo.toml`, mimo że ten plik **jest śledzony** przez git. Wpis nic dziś nie robi (śledzone pliki ignorują `.gitignore`), ale jest pułapką: po `git rm --cached` plik zniknąłby z repo bez ostrzeżenia, a build przestałby działać u innych.

Usuń tę linię z `.gitignore`.

Run: `git ls-files --error-unmatch dashboard/src-tauri/Cargo.toml && echo "plik jest śledzony — usunięcie wpisu bezpieczne"`
Expected: potwierdzenie.

- [ ] **Step 2: Sprawdź, co jeszcze niepotrzebnie siedzi w repo**

Run:
```bash
git ls-files | xargs -I{} du -k {} 2>/dev/null | sort -rn | head -15
```

Duże pliki binarne w repo (`icons.ai` ~735 KB, `projects_list.json` ~86 KB) — zapisz w dokumencie, czy są potrzebne w wydaniu. `icons.ai` to źródło grafiki: rozważ przeniesienie do `assets/` z notatką, ale **nie usuwaj bez zgody** — to materiał źródłowy.

- [ ] **Step 3: Commit**

```bash
git add .gitignore docs/release/audit/etap11-wydanie.md
git commit -m "chore: usuń mylący wpis .gitignore dla śledzonego dashboard/src-tauri/Cargo.toml"
```

### Task 11.2: Wersja i CHANGELOG

- [ ] **Step 1: Ustal numer wydania**

`VERSION` to pojedynczy licznik (`0.1.5760`), a `CHANGELOG.md` mówi: „Versions correspond to the single running counter in `VERSION`". Podbij go i uruchom synchronizację:

```bash
echo "0.1.<nowy>" > VERSION
cd dashboard && node scripts/sync-version.cjs && cd ..
./scripts/audit/check-version-sync.sh
```
Expected: pięć linii `ok:`.

- [ ] **Step 2: Zamknij sekcję `Unreleased`**

W `CHANGELOG.md` zamień nagłówek `## Unreleased` na `## 0.1.<nowy> — <data>` i utwórz nad nim nową, pustą sekcję `## Unreleased`. Przejdź wpisy i **usuń te, które opisują zmiany cofnięte w trakcie audytu**; dopisz wpisy dla napraw z etapów 1–10, które użytkownik odczuje (zmienione liczby, zmienione zachowanie).

- [ ] **Step 3: Commit**

```bash
git add VERSION Cargo.toml shared/Cargo.toml dashboard/src-tauri/Cargo.toml dashboard/package.json dashboard/src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "release: 0.1.<nowy>"
```

### Task 11.3: Build, podpis i notaryzacja

- [ ] **Step 1: Zbuduj macOS**

Run: `python3 build_all_macos.py` (skrypt istnieje w roocie — przeczytaj go przed uruchomieniem: `head -60 build_all_macos.py`, żeby wiedzieć, co robi z `dist/`).

- [ ] **Step 2: Zweryfikuj podpis i notaryzację**

Run:
```bash
codesign --verify --deep --strict --verbose=2 "dist/TIMEFLOW.app"
codesign --verify --deep --strict --verbose=2 "dist/TIMEFLOW Demon.app"
spctl --assess --type execute --verbose "dist/TIMEFLOW.app"
xcrun stapler validate "dist/TIMEFLOW.app"
```
Expected: `accepted`, `source=Notarized Developer ID`, `The validate action worked!`. Każdy inny wynik = `P0` — użytkownik dostanie ostrzeżenie Gatekeepera przy pierwszym uruchomieniu.

- [ ] **Step 3: Test na czystej maszynie**

Skopiuj `.app` na maszynę, na której TIMEFLOW nigdy nie był uruchamiany (albo utwórz nowe konto użytkownika). Uruchom. **Sprawdź:** aplikacja startuje bez ostrzeżeń, prosi o uprawnienia (dostępność/monitorowanie) z czytelnym komunikatem, tworzy pustą bazę, demon startuje.

- [ ] **Step 4: Zbuduj Windows i powtórz**

Na maszynie Windows: `npm run tauri build`. Uruchom instalator na czystej maszynie. **Sprawdź:** brak ostrzeżenia SmartScreen (jeśli jest podpis) albo jawnie zapisz, że go nie ma i użytkownik zobaczy ostrzeżenie.

- [ ] **Step 5: Zapisz wyniki**

```markdown
## Weryfikacja buildów

| Platforma | Build | Podpis | Notaryzacja | Start na czystej maszynie | Uwagi |
|---|---|---|---|---|---|
| macOS | | | | | |
| Windows | | — | — | | |
```

- [ ] **Step 6: Commit**

```bash
git add docs/release/audit/etap11-wydanie.md
git commit -m "docs(release): weryfikacja buildów, podpisu i notaryzacji"
```

### Task 11.4: Migracja i ścieżka wycofania

To najważniejszy test przed wydaniem: **czy dane użytkownika przeżyją aktualizację.**

- [ ] **Step 1: Test migracji na realnej bazie**

1. Zrób kopię bazy z **poprzedniej** wydanej wersji (nie z gałęzi deweloperskiej).
2. Zanotuj z tej wersji: sumę czasu za ostatni miesiąc, liczbę projektów, liczbę sesji, kwotę w raporcie dla jednego projektu.
3. Uruchom nową wersję na kopii tej bazy.
4. **Sprawdź:** wszystkie cztery liczby zgadzają się co do sekundy i grosza — **z wyjątkiem** tych, które celowo zmieniłeś w etapach 1 i 4. Dla każdej celowo zmienionej liczby wpisz do dokumentu: stara wartość, nowa wartość, uzasadnienie, wpis w `CHANGELOG.md`.

- [ ] **Step 2: Opisz ścieżkę wycofania**

```markdown
## Ścieżka wycofania (rollback)

**Pytanie, na które musi odpowiadać ten rozdział:** użytkownik zaktualizował
TIMEFLOW, coś jest nie tak, chce wrócić do poprzedniej wersji. Co się dzieje
z jego danymi?

| Migracja w tym wydaniu | Odwracalna? | Co się stanie po powrocie do starej wersji |
|---|---|---|
| m28_perf_indexes | tak (indeksy są ignorowane przez starą wersję) | brak skutku |
| (kolejne) | | |

**Procedura dla użytkownika:**
1. Zamknij TIMEFLOW i demona.
2. Przywróć kopię bazy z `<ścieżka do automatycznej kopii przed migracją>`.
3. Zainstaluj poprzednią wersję z `<gdzie jest dostępna>`.

**Czy przetestowano?** ☐ tak ☐ nie
```

- [ ] **Step 3: Wykonaj procedurę wycofania i zaznacz wynik**

Nie zaznaczaj „tak", jeśli nie przeszedłeś tej procedury krok po kroku na realnej kopii.

- [ ] **Step 4: Commit**

```bash
git add docs/release/audit/etap11-wydanie.md docs/release/RELEASE_CHECKLIST.md
git commit -m "docs(release): test migracji z poprzedniej wersji i udokumentowana ścieżka wycofania"
```

### Task 11.5: Ostateczna bramka

- [ ] **Step 1: Przejdź `RELEASE_CHECKLIST.md` od góry do dołu**

Uruchom każdą komendę z sekcji „Bramki wydaniowe" i zaznacz wynik. **Nie zaznaczaj niczego z pamięci** — uruchom i zobacz wyjście.

- [ ] **Step 2: Sprawdź, że każdy etap ma zamknięte P0/P1**

Run: `grep -rn "P0\|P1" docs/release/audit/*.md | grep -v "zamknięte\|✅" | head -40`
Expected: pusto albo tylko wiersze z jawną decyzją o odłożeniu.

- [ ] **Step 3: Otaguj wydanie**

```bash
git tag -a "v$(cat VERSION)" -m "TIMEFLOW $(cat VERSION) — wydanie po audycie przedwydaniowym"
git push origin "v$(cat VERSION)"
```

- [ ] **Step 4: Commit domknięcia**

```bash
git add docs/release/RELEASE_CHECKLIST.md
git commit -m "docs(release): lista kontrolna wydania zamknięta dla $(cat VERSION)"
```

**Bramka etapu 11:** wszystkie wiersze `RELEASE_CHECKLIST.md` odhaczone lub z zapisaną decyzją; tag utworzony.

---

## Kolejność i zależności etapów

```
Etap 0  (bramki, baseline)  ── wymagany przed wszystkim
   │
   ├─► Etap 1 (czas) ──► Etap 4 (pieniądze)   ← 4 zależy od 1: kwota bierze czas
   │
   ├─► Etap 2 (dane) ──► Etap 3 (sync)        ← 3 zależy od 2: macierz encji
   │
   ├─► Etap 5 (bezpieczeństwo)   niezależny
   ├─► Etap 6 (wydajność)        niezależny, ale po 0 (baseline)
   ├─► Etap 7 (odporność)        niezależny
   ├─► Etap 9 (parity)           niezależny
   └─► Etap 10 (UI/i18n/Help)    niezależny
              │
              └─► Etap 8 (nadmiar)  ← po 1–7: wcześniejsze etapy uzasadniają lub obalają abstrakcje
                        │
                        └─► Etap 11 (wydanie)  ← ostatni
```

**Sugerowana kolejność realizacji, gdy pracujesz sam:** 0 → 1 → 2 → 3 → 4 → 7 → 5 → 6 → 9 → 10 → 8 → 11.
Uzasadnienie: najpierw poprawność liczb (1–4), bo one decydują o zaufaniu do produktu; potem odporność (7), bo `panic="abort"` to największe pojedyncze ryzyko; potem bezpieczeństwo i wydajność; sprzątanie (8) na końcu, żeby nie kolidowało z resztą.

**Etapy 5, 6, 9, 10 można rozdzielić na osobne osoby/sesje** — nie dotykają tych samych plików co 1–4.

---

## Co ten plan świadomie pomija

Zapisane, żeby nie wyglądało na przeoczenie:

- **Migracja bazy w drugą stronę (downgrade).** Nie wprowadzamy migracji odwracalnych; ścieżka wycofania opiera się na kopii bazy (etap 11, Task 11.4).
- **Testy E2E przez UI (Playwright/WebDriver).** Koszt utrzymania przewyższa zysk przy tej wielkości zespołu; zastąpione testami międzymodułowymi (etap 1) i scenariuszami manualnymi (etapy 3, 9, 11).
- **Refaktor wielkich plików.** Etap 8 tylko je inwentaryzuje. Podział przed wydaniem to ryzyko regresji bez zysku dla użytkownika.
- **Nowe funkcje.** Ten plan niczego nie dodaje. Każda pokusa „przy okazji dodam" jest naruszeniem `CLAUDE.md` §4.

