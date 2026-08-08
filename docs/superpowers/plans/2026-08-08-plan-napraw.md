# TIMEFLOW — plan napraw po audycie przedwydaniowym

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamknąć wszystkie ustalenia P0 i P1 z audytu, wpiąć bramki pilnujące ich regresji, i doprowadzić repozytorium do stanu zdatnego do wydania.

**Architecture:** Kolejność wynika z ryzyka i zależności, **nie** z podziału tematycznego analizy. Bramki idą pierwsze (bez działającego CI każda naprawa da się cofnąć niezauważenie), potem jedyne P0, potem liczby widziane przez użytkownika, potem ustalenia wymagające decyzji. Każde ustalenie = jeden commit z testem, który wcześniej padał. Plan da się przerwać po dowolnym commicie z aplikacją w stanie zdatnym do wydania.

**Tech Stack:** Rust (workspace: `timeflow-demon`, `timeflow-dashboard`, `timeflow-shared`), SQLite/rusqlite, React 19 + TypeScript, Vitest, cargo test.

**Wejście:** [ANALIZA-02-szczegolowa.md](../../release/audit/ANALIZA-02-szczegolowa.md) — 27 ustaleń.
**Metodyka:** [INSTRUKCJA-AUDYTU.md](../../release/audit/INSTRUKCJA-AUDYTU.md).

> **Zastępuje** `2026-08-08-release-readiness-audit.md` — tamten plan powstał **przed** analizą i zakładał priorytety, które analiza obaliła (m.in. panika jako główne ryzyko). Nie wykonuj go.

---

## Ustalenia domknięte przed napisaniem planu

Sprawdzenie zapowiedziane po etapie 2, wykonane przed planowaniem:

**AI-04 podnosi się z P2 na P1** — z ostrzejszym mechanizmem, niż zakładałem.

`src/sync_common.rs:555` merguje `assignment_feedback` i `assignment_auto_runs` jako encje **append-only**, z dedupem po `(source, created_at)`. Te tabele **nie mają triggerów tombstone**. Kasowanie odbywa się w czterech miejscach:

| Komenda | Miejsce | Co kasuje |
|---|---|---|
| `reset_model_full` | `assignment_model/training.rs:95,98` | całe `assignment_feedback` i `assignment_auto_runs` |
| `delete_app_and_data` | `commands/settings.rs:339` | feedback powiązany z aplikacją i jej sesjami |
| `clear_all_data` | `commands/settings.rs:417,418` | wszystko |
| import z podmianą | `commands/import_data.rs:270,271` | wszystko |

**Skutek:** każde z tych kasowań jest **cofane przy następnej synchronizacji** — peer nadal ma swoje wiersze, a merge dopisuje je z powrotem. Użytkownik resetuje model albo kasuje aplikację wraz z danymi, synchronizuje i dostaje je z powrotem, bez żadnego komunikatu.

**Drugie ustalenie znalezione przy okazji — DEC-04 poniżej:** `clear_all_data` wykonuje `DELETE FROM tombstones` **po** skasowaniu encji, więc czyści tombstony wyprodukowane przez własne triggery. Po synchronizacji wraca **całość** danych, nie tylko dane AI. Czy to jest zamierzone (lokalny reset + odtworzenie z peera jako mechanizm naprawczy), czy błąd — to decyzja produktowa, nie techniczna.

**Nowe ustalenie AI-06 (P3):** klucz dedupu feedbacku to `(source, created_at)`, nie identyfikator. Dwa różne zdarzenia o tym samym źródle i tej samej sekundzie na dwóch maszynach zostaną scalone w jedno.

---

## Decyzje właściciela produktu — blokują konkretne zadania

Cztery pytania, na które nie odpowiadam sam. Każde blokuje wskazane zadanie; reszta planu wykonuje się niezależnie.

### DEC-01 · `panic = "abort"` czy `unwind` w profilu release? → blokuje **Etap D, zadanie D1**

Dziewięć wywołań `catch_unwind` jest martwych przy `abort`. Najgroźniejszy to `guarded_then_cleanup` (`src/lan_sync_orchestrator.rs:847`), którego zadaniem jest **na pewno** zdjąć flagi synchronizacji po panice — w tym odmrozić bazę. Test w linii 989 to sprawdza i przechodzi, bo build testowy używa `unwind`. Produkcja tej ochrony nie ma.

| Opcja | Zysk | Koszt |
|---|---|---|
| **A.** `panic = "unwind"` w release | 9 × `catch_unwind` zaczyna działać; testy odzwierciedlają produkcję | Większa binarka (tabele rozwijania stosu), nieco wolniej |
| **B.** Zostaje `abort`, usuwamy martwe `catch_unwind`, freeze chroni znacznik na dysku sprzątany przy starcie | Rozmiar binarki bez zmian; ochrona działa też przy `SIGKILL` i zaniku zasilania | Więcej kodu; trzeba przeprojektować sprzątanie |
| **C.** Zostaje `abort`, zostawiamy `catch_unwind`, dokumentujemy jako martwe | Zero pracy | Kod i testy nadal kłamią o odporności |

Rekomendacja: **B**. `abort` jest właściwy dla aplikacji desktopowej, a znacznik na dysku chroni przed szerszą klasą awarii niż panika (ubicie procesu, padnięcie systemu). Opcja C jest nie do przyjęcia w wydaniu.

### DEC-02 · Stawka klienta ma działać czy jest informacyjna? → blokuje **Etap C, zadanie C2**

`clients.default_hourly_rate` jest w schemacie, edytowalne w UI (`ClientsManageSection.tsx:129`), zapisywane, eksportowane i synchronizowane — i **nie występuje w żadnym wyliczeniu kwoty**. `estimates.rs:260` bierze wyłącznie stawkę projektu z fallbackiem na globalną.

| Opcja | Konsekwencja |
|---|---|
| **A.** Stawka klienta wchodzi jako poziom pośredni: projekt → **klient** → globalna | Kwoty projektów przypisanych do klientów ze stawką **zmienią się** po aktualizacji. Wymaga wpisu w `CHANGELOG` i ostrzeżenia dla użytkownika |
| **B.** Pole jest informacyjne (np. do umowy) | Trzeba to jawnie napisać przy polu w UI i w `Help.tsx`, żeby nikt nie zakładał inaczej |

Rekomendacja: **A** — hierarchia projekt → klient → globalna jest tym, czego użytkownik oczekuje po wpisaniu stawki przy kliencie. Ale to zmienia faktury, więc decyzja należy do Ciebie.

### DEC-03 · Co ma się dziać z danymi AI po skasowaniu, gdy peer je ma? → blokuje **Etap D, zadanie D3**

| Opcja | Konsekwencja |
|---|---|
| **A.** Tombstony dla `assignment_feedback` i `assignment_auto_runs` | Kasowanie propaguje się jak dla pozostałych encji. Wymaga migracji + triggerów + wpięcia w demona. Peer ze starszą wersją nie zrozumie tombstonów — kasowanie zacznie działać dopiero po aktualizacji obu maszyn |
| **B.** Wyłączyć te tabele z synchronizacji (per-maszyna, jak `gcal_*`) | Model uczy się osobno na każdej maszynie. Prostsze, nieodwracalne dla użytkowników korzystających ze wspólnego modelu |
| **C.** Ostrzeżenie w UI: „reset modelu nie obejmuje sparowanych urządzeń" | Zero zmian w danych; użytkownik wie, czego się spodziewać |

Rekomendacja: **A**. Feedback jest danymi użytkownika, a kasowanie danych użytkownika musi być trwałe. C jest akceptowalne jako doraźne, jeśli wydanie goni.

### DEC-04 · Czy `clear_all_data` ma kasować dane u peera? → blokuje **Etap D, zadanie D4**

Dziś: nie kasuje, i to nie przez decyzję, tylko przez `DELETE FROM tombstones` w tym samym batchu, który wymazuje dowody kasowania. Po synchronizacji wraca całość.

| Opcja | Konsekwencja |
|---|---|
| **A.** To jest zamierzone — „wyczyść lokalnie i odtwórz z peera" | Trzeba to napisać w UI przy przycisku i w `Help.tsx`. Zero zmian w kodzie |
| **B.** Kasowanie ma być globalne | Usunąć `DELETE FROM tombstones` z batcha. **Operacja destrukcyjna na wszystkich sparowanych urządzeniach** — wymaga jawnego, osobnego potwierdzenia w UI |
| **C.** Rozdzielić na dwie funkcje: „wyczyść lokalnie" i „wyczyść wszędzie" | Najbezpieczniejsze, najwięcej pracy |

Rekomendacja: **A** na to wydanie (zero ryzyka, wymaga tylko tekstu), **C** w backlogu.

---

## Kolejność i uzasadnienie

```
Etap A — bramki            ── musi być pierwszy: bez CI naprawy da się cofnąć
   │
Etap B — P0 bezpieczeństwo ── jedyne P0; niezależne od reszty
   │
Etap C — P1 liczby         ── C-01, M-01: to, co użytkownik widzi i czym fakturuje
   │
Etap D — P1 pozostałe      ── P-01, PW-01, AI-04: wymagają decyzji DEC-01/03/04
   │
Etap E — P2 strażnicy      ── testy inwariantów i centralizacja; chroni etapy A–D
   │
Etap F — białe plamy       ── profilowanie, webui/auth, MCP, UI/Help
   │
Etap G — P3/P4 + wydanie   ── sprzątanie, wersja, build, rollback
```

**Etapy B, C i F dają się rozdzielić na osobne osoby** — nie dotykają tych samych plików.

---

## Etap A — bramki

**Cel:** CI musi umieć powiedzieć „nie" zanim zaczniemy naprawiać.

### Zadanie A1: Bramka spójności wersji · B-05

**Files:** Create `scripts/audit/check-version-sync.sh`; Modify `.github/workflows/ci.yml`

- [ ] **Krok 1: Napisz skrypt**

```bash
#!/usr/bin/env bash
# VERSION jest jedynym zrodlem prawdy dla numeru wersji.
# Kazdy manifest musi go powtarzac co do znaku.
set -euo pipefail
cd "$(dirname "$0")/../.."

EXPECTED="$(tr -d '[:space:]' < VERSION)"
[ -n "$EXPECTED" ] || { echo "FAIL: plik VERSION jest pusty"; exit 1; }

fail=0
check() {
  if [ "$2" != "$EXPECTED" ]; then
    echo "FAIL: $1 = '$2', oczekiwano '$EXPECTED'"; fail=1
  else
    echo "ok:   $1 = $2"
  fi
}

pkg_version() {
  awk '/^\[package\]/{p=1} p && /^version *=/{gsub(/[" ]/,"",$3); print $3; exit}' "$1"
}

check "Cargo.toml"                       "$(pkg_version Cargo.toml)"
check "shared/Cargo.toml"                "$(pkg_version shared/Cargo.toml)"
check "dashboard/src-tauri/Cargo.toml"   "$(pkg_version dashboard/src-tauri/Cargo.toml)"
check "dashboard/package.json"           "$(node -p "require('./dashboard/package.json').version")"
check "dashboard/src-tauri/tauri.conf.json" "$(node -p "require('./dashboard/src-tauri/tauri.conf.json').version")"

exit $fail
```

- [ ] **Krok 2: Uruchom**

Run: `chmod +x scripts/audit/check-version-sync.sh && ./scripts/audit/check-version-sync.sh`
Expected: pięć linii `ok:`, kod wyjścia 0. Przy `FAIL` popraw **manifest**, nie skrypt.

- [ ] **Krok 3: Wepnij do CI**

W `.github/workflows/ci.yml`, job `frontend` (ma `working-directory: dashboard`), przed `npm run typecheck`:

```yaml
      - run: ../scripts/audit/check-version-sync.sh
```

- [ ] **Krok 4: Commit**

```bash
git add scripts/audit/check-version-sync.sh .github/workflows/ci.yml
git commit -m "ci: bramka spójności numeru wersji między VERSION a manifestami (B-05)"
```

### Zadanie A2: Audyt zależności faktycznie blokuje · B-02, B-03

- [ ] **Krok 1: Zobacz stan wyjściowy**

Run: `cd dashboard && npm ci && npm audit --omit=dev --audit-level=high; echo "kod: $?"`
Zapisz wynik. Jeśli są podatności `high`/`critical` — napraw je **przed** zaostrzeniem bramki, osobnymi commitami.

- [ ] **Krok 2: Usuń `|| true`**

W `.github/workflows/ci.yml`, job `audit`, zamień:

```yaml
      - run: cd dashboard && npm audit --omit=dev || true
```

na:

```yaml
      # Bez `|| true` — bramka ma padać. Poziom `high`: krytyczne i wysokie
      # blokują wydanie, niższe trafiają do backlogu.
      - run: cd dashboard && npm ci && npm audit --omit=dev --audit-level=high
```

- [ ] **Krok 3: Rozszerz cargo-deny**

```yaml
      - run: cargo deny check advisories bans licenses sources
```

- [ ] **Krok 4: Napraw `deny.toml`, jeśli pada na licencjach**

Run: `cargo deny check advisories bans licenses sources`
Uzupełnij `[licenses] allow = [...]` świadomą listą (`MIT`, `Apache-2.0`, `BSD-3-Clause`, `ISC`, `Unicode-3.0`, `Zlib`) i punktowe `[[licenses.exceptions]]`. **Nie używaj `allow-osi-fsf-free` jako drogi na skróty.**

- [ ] **Krok 5: Commit**

```bash
git add .github/workflows/ci.yml deny.toml
git commit -m "ci: audyt zależności faktycznie blokuje (B-02, B-03)"
```

### Zadanie A3: Clippy i rustfmt · B-01, B-06

- [ ] **Krok 1: Osobny commit z formatowaniem**

`cargo fmt --check` daje dziś 496 rozjazdów. Zrób go **osobno**, żeby nie zaśmiecić historii merytorycznych commitów:

```bash
cargo fmt --all
cargo test --workspace   # potwierdź, że formatowanie niczego nie zepsuło
git add -A && git commit -m "style: cargo fmt --all (wyłącznie formatowanie, bez zmian logiki)"
git rev-parse HEAD >> .git-blame-ignore-revs
git add .git-blame-ignore-revs && git commit -m "chore: pomiń commit formatujący w git blame"
```

- [ ] **Krok 2: Dodaj job do CI (na razie bez `-D warnings`)**

Clippy zgłasza dziś **71 ostrzeżeń**. Wpinamy job teraz, zaostrzamy w etapie G.

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
      # -D warnings dopiero po wyczyszczeniu 71 ostrzeżeń — patrz etap G.
      - run: cargo clippy --workspace --all-targets
```

- [ ] **Krok 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: cargo fmt --check i cargo clippy dla całego workspace (B-01)"
```

### Zadanie A4: Testy Rusta na Windows · B-04

- [ ] **Krok 1: Zmień job z budującego na testujący**

W `.github/workflows/ci.yml`, job `windows-build`, po istniejącym `cargo build`:

```yaml
      # Kompilacja wykrywa błędy składni w platform/windows/*, ale nie wykrywa
      # błędów zachowania. Testy demona i shared działają bez dist/ frontu.
      - run: cargo test -p timeflow-demon -p timeflow-shared
```

- [ ] **Krok 2: Uruchom CI i sklasyfikuj padające testy**

Dla każdego padającego testu rozstrzygnij, **zanim cokolwiek naprawisz**: czy test zakłada zachowanie macOS, czy kod Windows faktycznie działa inaczej. Poprawianie testu, żeby przechodził, może zamaskować realną różnicę.

Zapisz wyniki w `docs/release/audit/ANALIZA-02-szczegolowa.md`, sekcja 2.8.

- [ ] **Krok 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: uruchamiaj testy demona i shared także na Windows (B-04)"
```

### Zadanie A5: Wepnij skanery audytu do CI jako raport

Skanery z `scripts/audit/` nie są bramkami (nie mają progu), ale ich wynik w logu CI pozwala zauważyć dryf.

- [ ] **Krok 1: Dodaj krok raportujący do joba `quality`**

```yaml
      - run: ./scripts/audit/check-command-surface.sh
      - run: ./scripts/audit/find-panics-in-prod.sh | head -1
```

- [ ] **Krok 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: raportuj powierzchnię komend i punkty paniki w logu"
```

**Bramka etapu A:** CI zielone z jobami `lint-rust`, zaostrzonym `audit`, testami na Windows i bramką wersji.

---

## Etap B — P0: bezpieczeństwo LAN

**Cel:** zamknąć nieuwierzytelnioną ścieżkę do sekretu LAN.

### Zadanie B1: Potwierdź łańcuch ataku eksperymentalnie · S-01

Ustalenie pochodzi z analizy statycznej trzech funkcji. Przed poprawką potwierdź je na własnej maszynie.

- [ ] **Krok 1: Ustal port i adres**

Run: `grep -n "DEFAULT_LAN_PORT" src/lan_common.rs src/lan_server.rs | head -3`

- [ ] **Krok 2: Uruchom demona i wykonaj łańcuch z DRUGIEJ maszyny w tej samej sieci**

```bash
# 1. mintowanie kodu — bez zadnego naglowka autoryzacji
curl -s -X POST "http://<IP_MASZYNY_Z_DEMONEM>:<PORT>/lan/generate-pairing-code"

# 2. wymiana kodu na sekret
curl -s -X POST "http://<IP>:<PORT>/lan/pair" \
  -H 'Content-Type: application/json' \
  -d '{"code":"<KOD_Z_KROKU_1>","slave_device_id":"probe","slave_secret":"probe-secret","slave_machine_name":"probe"}'
```

Expected: krok 1 zwraca `{"ok":true,"code":"NNNNNN",...}`, krok 2 zwraca `"secret":"..."`.

- [ ] **Krok 3: Zapisz wynik**

Wpisz do `docs/release/audit/ANALIZA-02-szczegolowa.md`, ustalenie S-01: „Potwierdzone eksperymentalnie `<data>`" albo „Niepotwierdzone — `<co się stało zamiast>`".

Jeśli **nie** udało się odtworzyć — zatrzymaj się i ustal dlaczego. Poprawka bez potwierdzonego problemu to zgadywanie.

- [ ] **Krok 4: Posprzątaj po sondzie**

Usuń wpis `probe` z listy sparowanych urządzeń w dashboardzie.

### Zadanie B2: Test bezpieczeństwa — trzy endpointy wymagają loopbacku · S-01

- [ ] **Krok 1: Napisz test padający**

Dopisz w `src/lan_server.rs`, w `mod tests` (wzoruj się na istniejącym `pull_rejected_without_active_sync`):

```rust
    /// S-01: `/lan/generate-pairing-code` mintuje WAŻNY kod parowania i zwraca go
    /// w odpowiedzi. Bez bramki loopback dowolny host w sieci robi:
    ///   1. POST /lan/generate-pairing-code  → dostaje kod
    ///   2. POST /lan/pair z tym kodem       → dostaje sekret LAN maszyny
    ///   3. z sekretem przechodzi bramkę auth → POST /lan/pull → cała baza
    /// Throttle per-IP nie pomaga, bo kod jest znany i trafia za pierwszym razem.
    /// Te trzy endpointy obsługują LOKALNY dashboard, nie peera — muszą mieć
    /// `is_loopback` dokładnie jak `/lan/initiate-pair`.
    #[test]
    fn pairing_administration_endpoints_require_loopback() {
        let remote: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 77));

        let (status, body) = handle_generate_pairing_code(remote);
        assert_eq!(
            status, 403,
            "generate-pairing-code z sieci musi dostać 403, dostało {status}"
        );
        assert!(
            !body.contains("\"code\""),
            "odpowiedź nie może zawierać kodu parowania: {body}"
        );

        let (status, _) = handle_store_paired_device(
            r#"{"device_id":"x","secret":"y","machine_name":"z"}"#,
            remote,
        );
        assert_eq!(status, 403, "store-paired-device z sieci musi dostać 403");

        let (status, _) = handle_remove_paired_device(r#"{"device_id":"x"}"#, remote);
        assert_eq!(status, 403, "remove-paired-device z sieci musi dostać 403");
    }

    /// Ten sam zestaw wołany z localhost (czyli przez własny dashboard) musi działać.
    #[test]
    fn pairing_administration_endpoints_work_from_loopback() {
        let local: IpAddr = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        let (status, body) = handle_generate_pairing_code(local);
        assert_eq!(status, 200, "dashboard lokalny musi móc wygenerować kod");
        assert!(body.contains("\"code\""));
    }
```

- [ ] **Krok 2: Uruchom — musi paść na kompilacji**

Run: `cargo test -p timeflow-demon pairing_administration_endpoints`
Expected: błąd kompilacji — handlery nie przyjmują `client_ip`. **To jest sedno ustalenia:** funkcja, która nie dostaje adresu klienta, z definicji nie może go sprawdzić.

- [ ] **Krok 3: Dodaj bramkę loopback do trzech handlerów**

W `src/lan_server.rs` zmień sygnatury i dodaj bramkę, **kopiując wzorzec z `handle_initiate_pair` (linia ~1460)**:

```rust
fn handle_generate_pairing_code(client_ip: IpAddr) -> (u16, String) {
    // Kod parowania jest jednorazowym poświadczeniem wymienialnym na sekret LAN
    // przez /lan/pair. Mintować go może wyłącznie lokalny dashboard — z sieci
    // byłaby to nieuwierzytelniona ścieżka do przejęcia sekretu (S-01).
    if !is_loopback(client_ip) {
        log::warn!("[LAN][SEC] generate-pairing-code odrzucone spoza loopback: {client_ip}");
        return (403, json_error("loopback_only"));
    }
    let code = crate::lan_pairing::generate_code();
    let remaining = crate::lan_pairing::active_code_remaining_secs();
    let resp = serde_json::json!({
        "ok": true,
        "code": code,
        "expires_in_secs": remaining,
    });
    (200, resp.to_string())
}
```

Analogicznie `handle_store_paired_device(body: &str, client_ip: IpAddr)` i `handle_remove_paired_device(body: &str, client_ip: IpAddr)` — bramka **przed** parsowaniem ciała.

- [ ] **Krok 4: Zaktualizuj tablicę routingu**

```rust
        ("POST", "/lan/generate-pairing-code") => handle_generate_pairing_code(client_ip),
        ("POST", "/lan/store-paired-device") => handle_store_paired_device(&body, client_ip),
        ("POST", "/lan/remove-paired-device") => handle_remove_paired_device(&body, client_ip),
```

- [ ] **Krok 5: Uruchom**

Run: `cargo test -p timeflow-demon pairing_administration_endpoints -- --nocapture`
Expected: oba testy PASS.

- [ ] **Krok 6: Sprawdź, że parowanie nadal działa**

Run: `cargo test -p timeflow-demon`
Expected: 0 failed. Następnie **ręcznie**: sparuj dwie maszyny przez UI. Dashboard woła te endpointy przez localhost, więc parowanie musi działać bez zmian. **Jeśli przestało — to znaczy, że dashboard woła je po adresie sieciowym, nie po `127.0.0.1`; wtedy popraw stronę wołającą, nie usuwaj bramki.**

- [ ] **Krok 7: Commit**

```bash
git add src/lan_server.rs
git commit -m "security(lan): trzy endpointy administracyjne parowania wymagają loopbacku (S-01, P0)"
```

### Zadanie B3: Zawęź `/lan/paired-devices` · S-01 (ujawnienie informacji)

- [ ] **Krok 1: Test**

```rust
    /// `/lan/paired-devices` zwraca device_id, nazwy maszyn i znaczniki błędów
    /// autoryzacji. To rozpoznanie dla atakującego i wyciek nazw maszyn
    /// użytkownika. Endpoint obsługuje lokalny dashboard — musi być loopback-only.
    #[test]
    fn paired_devices_listing_requires_loopback() {
        let remote: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 77));
        let (status, body) = handle_get_paired_devices(remote);
        assert_eq!(status, 403, "listing sparowanych urządzeń z sieci musi dostać 403");
        assert!(!body.contains("machine_name"), "odpowiedź nie może ujawniać nazw maszyn");
    }
```

- [ ] **Krok 2: Dodaj bramkę i zaktualizuj routing**

Ten sam wzorzec co B2 krok 3–4, dla `handle_get_paired_devices`.

- [ ] **Krok 3: Uruchom i commit**

```bash
cargo test -p timeflow-demon paired_devices_listing_requires_loopback
git add src/lan_server.rs
git commit -m "security(lan): listing sparowanych urządzeń tylko z loopbacku (S-01)"
```

### Zadanie B4: Zawęź CORS · S-01 (eskalacja)

Każda odpowiedź niesie `Access-Control-Allow-Origin: *`, co pozwala dowolnej stronie WWW otwartej przez użytkownika czytać odpowiedzi z serwera LAN.

- [ ] **Krok 1: Ustal, kto potrzebuje CORS**

Run: `grep -rn "lan/ping\|lan/local-identity\|fetch(" --include='*.ts' dashboard/src/lib/sync dashboard/src/lib/lan-sync.ts | head -20`

Zapisz w dokumencie: czy front woła serwer demona **przeglądarkowo** (wtedy CORS jest potrzebny i trzeba go zawęzić do konkretnego origin), czy przez warstwę Tauri/HTTP po stronie Rusta (wtedy CORS jest zbędny i można go usunąć).

- [ ] **Krok 2: Zastosuj węższy wariant**

Jeśli CORS jest zbędny — usuń nagłówek z `format!` budującego odpowiedź (`src/lan_server.rs`, ~linia 641).
Jeśli potrzebny — zamień `*` na konkretny origin webui i **nie dodawaj go do odpowiedzi endpointów zwracających sekrety**.

- [ ] **Krok 3: Sprawdź ręcznie webui**

Otwórz webui na telefonie i przejdź główne ekrany. **Jeśli coś przestało działać — masz odpowiedź na krok 1 i wróć do wariantu zawężonego zamiast usunięcia.**

- [ ] **Krok 4: Commit**

```bash
git add src/lan_server.rs
git commit -m "security(lan): zawęź Access-Control-Allow-Origin (S-01)"
```

### Zadanie B5: Domknij macierz `SECURITY_AUDIT.md` · S-02

- [ ] **Krok 1: Przejdź pozostałe endpointy**

Dla każdego z 21 wierszy przejdź 7 kryteriów z nagłówka `docs/SECURITY_AUDIT.md` i zaznacz `[x]` w kolumnie „Reviewed?" oraz wpisz numer wersji w „Released in". Kolejność: najpierw mutujące stan (`/lan/upload-db`, `/lan/pull`, `/lan/db-ready`, `/lan/unfreeze`), potem odczytowe.

**Jeden endpoint = jeden commit.** To zadanie rozkłada się na kilka sesji.

- [ ] **Krok 2: Commit per endpoint**

```bash
git add docs/SECURITY_AUDIT.md src/lan_server.rs
git commit -m "security(lan): przegląd <METODA> <ścieżka> — <co potwierdzono/znaleziono>"
```

**Bramka etapu B:** testy `pairing_administration_endpoints_*` i `paired_devices_listing_requires_loopback` w CI; łańcuch z B1 nie odtwarza się; `SECURITY_AUDIT.md` bez pustych `[ ]`.

---

## Etap C — P1: liczby widziane przez użytkownika

### Zadanie C1: `distribute_app_seconds` we wszystkich trzech miejscach · C-01

`time_algorithm::distribute_app_seconds` jest w kodzie opisane jako **„the single home for per-app time math"**, a wołane jest wyłącznie z `projects.rs:1857`. Dashboard (top 5 aplikacji) i strona Applications pokazują surowe sumy, które przy aplikacjach działających równolegle przekraczają total wyświetlony obok.

- [ ] **Krok 1: Test padający — suma pozycji nie przekracza totalu**

Dopisz w `dashboard/src-tauri/src/commands/dashboard.rs`, w `#[cfg(test)] mod tests` (jeśli modułu nie ma — utwórz go na końcu pliku):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// C-01: `distribute_app_seconds` jest opisane w time_algorithm.rs jako
    /// "the single home for per-app time math" i wołane TYLKO z projects.rs.
    /// Dashboard i strona Applications sumują surowe duration_seconds, więc przy
    /// aplikacjach działających równolegle rozbicie per aplikacja przekracza
    /// total pokazany obok. Ten sam problem rozwiązano na karcie projektu.
    #[test]
    fn dashboard_top_apps_never_exceed_the_total_shown_next_to_them() {
        let conn = test_conn();
        // Dwie aplikacje pracujące w TYM SAMYM oknie czasowym (1 h zegarowa,
        // 2 h surowej sumy per aplikacja).
        seed_app_session(&conn, "Editor",  "2026-03-05 10:00:00", "2026-03-05 11:00:00");
        seed_app_session(&conn, "Browser", "2026-03-05 10:00:00", "2026-03-05 11:00:00");

        let range = DateRange { start: "2026-03-05".into(), end: "2026-03-05".into() };
        let stats = build_dashboard_stats_for_test(&conn, &range);

        let apps_sum: i64 = stats.top_apps.iter().map(|a| a.seconds).sum();
        assert!(
            apps_sum <= stats.total_seconds,
            "suma top apps ({apps_sum} s) przekracza total ({} s) — rozbicie liczone inną matematyką niż total",
            stats.total_seconds
        );
    }
}
```

**Uwaga:** `test_conn`, `seed_app_session`, `build_dashboard_stats_for_test` to nazwy zastępcze. Odczytaj realne pomocniki (`grep -n "mod tests" -A 40 dashboard/src-tauri/src/commands/sessions/tests.rs`) i użyj ich ponownie; jeśli są prywatne, wystaw je jako `pub(crate)` w module testowym. `build_dashboard_stats` jest funkcją prywatną w tym samym pliku, więc test w `mod tests` ma do niej dostęp bez zmian widoczności.

- [ ] **Krok 2: Uruchom — musi paść**

Run: `cargo test -p timeflow-dashboard dashboard_top_apps_never_exceed -- --nocapture`
Expected: FAIL z `suma top apps (7200 s) przekracza total (3600 s)`.

- [ ] **Krok 3: Wywołaj `distribute_app_seconds` w `build_dashboard_stats`**

W `dashboard/src-tauri/src/commands/dashboard.rs`, po zbudowaniu `top_apps` (przed wypełnieniem `daily_seconds`), dodaj — wzorując się **dokładnie** na `projects.rs:1839–1875`:

```rust
    // Surowe sumy per aplikacja nakładają się, gdy aplikacje pracowały równolegle,
    // i przekraczają zdeduplikowany total z time_algorithm. distribute_app_seconds
    // (jedyne miejsce matematyki per-aplikacja) skaluje je w dół do tego samego
    // totalu, który pokazujemy obok. Mianownik to surowa suma po WSZYSTKICH
    // aplikacjach, nie tylko po top 5 — inaczej ukryte aplikacje straciłyby udział.
    let raw_sum_all: f64 = conn
        .query_row(
            &format!(
                "SELECT COALESCE(SUM(s.duration_seconds), 0)
                 FROM sessions s
                 WHERE s.date >= ?1 AND s.date <= ?2 AND {ACTIVE_SESSION_FILTER_S}"
            ),
            rusqlite::params![&date_range.start, &date_range.end],
            |row| Ok(row.get::<_, i64>(0)? as f64),
        )
        .map_err(|e| e.to_string())?;
    let factor = if raw_sum_all > 0.0
        && (total_seconds as f64) > 0.0
        && (total_seconds as f64) < raw_sum_all
    {
        (total_seconds as f64) / raw_sum_all
    } else {
        1.0
    };
    super::time_algorithm::distribute_app_seconds(
        &mut top_apps,
        total_seconds as f64,
        raw_sum_all,
    );
```

Następnie przeskaluj `daily_by_app` **tym samym `factor`**, dokładnie jak `projects.rs:1866–1878` — inaczej sumy dzienne rozjadą się z `app.seconds` przy zaokrąglaniu `per_day`:

```rust
        let scaled = (secs as f64 * factor).round() as i64;
        if scaled > 0 {
            daily_by_app.entry(name).or_default().push(scaled);
        }
```

- [ ] **Krok 4: Uruchom**

Run: `cargo test -p timeflow-dashboard dashboard_top_apps_never_exceed -- --nocapture`
Expected: PASS.

- [ ] **Krok 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/dashboard.rs
git commit -m "fix(time): Dashboard skaluje rozbicie per aplikacja do zdeduplikowanego totalu (C-01)"
```

- [ ] **Krok 6: To samo dla strony Applications**

`get_applications` (`dashboard.rs:~493`) zwraca `AppWithStats` z surowym `SUM(s.duration_seconds)` per aplikacja — **bez żadnego totalu obok**, więc nie ma tu wprost sprzeczności na jednym ekranie. Ustal, zanim zmienisz: czy czas aplikacji na tej stronie jest porównywany przez użytkownika z czasem projektu albo z Dashboardem.

- Jeśli **tak** → zastosuj to samo skalowanie i napisz test porównujący sumę ze stron Applications i Dashboard.
- Jeśli **nie** → udokumentuj w `Help.tsx`, że czas na stronie Applications to czas surowy per aplikacja (bez podziału czasu współbieżnego), i dopisz komentarz w kodzie przy zapytaniu, żeby następny audyt nie zgłosił tego ponownie.

**Nie zgaduj** — to decyzja o znaczeniu liczby, więc zapisz uzasadnienie w commicie.

- [ ] **Krok 7: Commit**

```bash
git add dashboard/src-tauri/src/commands/dashboard.rs dashboard/src/pages/Help.tsx
git commit -m "fix(time)|docs(help): ujednolicenie znaczenia czasu per aplikacja na stronie Applications (C-01)"
```

### Zadanie C2: Stawka klienta · M-01 — **wymaga DEC-02**

- [ ] **Krok 1: Sprawdź decyzję DEC-02**

Bez odpowiedzi **nie zaczynaj**. Wariant A i B prowadzą do rozłącznych zmian.

- [ ] **Krok 2A (jeśli DEC-02 = A): test padający**

Dopisz w `dashboard/src-tauri/src/commands/estimates.rs`, w `mod tests`:

```rust
    /// M-01: stawka klienta jest edytowalna w UI, zapisywana, eksportowana
    /// i synchronizowana — a nie wchodziła do żadnego wyliczenia. Użytkownik
    /// ustawiał stawkę klienta i cicho fakturował po stawce globalnej.
    /// Hierarchia: stawka projektu → stawka klienta → stawka globalna.
    #[test]
    fn client_rate_applies_when_project_has_no_own_rate() {
        let conn = test_conn();
        set_global_hourly_rate(&conn, 100.0);
        seed_client(&conn, "Klient A", Some(250.0));
        seed_project_with_client(&conn, "Alpha", None, "Klient A");   // brak stawki projektu
        seed_project_with_client(&conn, "Beta",  Some(400.0), "Klient A"); // własna stawka
        seed_session(&conn, "Alpha", "2026-03-05 10:00:00", "2026-03-05 11:00:00");
        seed_session(&conn, "Beta",  "2026-03-05 12:00:00", "2026-03-05 13:00:00");

        let rows = build_estimate_rows(&conn, "2026-03-01", "2026-03-31");
        let alpha = rows.iter().find(|r| r.project_name == "Alpha").expect("Alpha");
        let beta  = rows.iter().find(|r| r.project_name == "Beta").expect("Beta");

        assert!(
            (alpha.effective_hourly_rate - 250.0).abs() < 0.005,
            "projekt bez własnej stawki musi wziąć stawkę klienta (250), wziął {}",
            alpha.effective_hourly_rate
        );
        assert!(
            (beta.effective_hourly_rate - 400.0).abs() < 0.005,
            "stawka projektu ma pierwszeństwo nad stawką klienta, wzięto {}",
            beta.effective_hourly_rate
        );
    }
```

**Uwaga:** pomocniki `set_global_hourly_rate`, `seed_client`, `seed_project_with_client` odczytaj z istniejącego `mod tests` (`estimates.rs:413` importuje już `build_estimate_rows` i `get_global_hourly_rate`) albo dopisz.

- [ ] **Krok 3A: Uruchom — musi paść**

Run: `cargo test -p timeflow-dashboard client_rate_applies_when_project_has_no_own_rate -- --nocapture`
Expected: FAIL — `Alpha` weźmie 100 (globalną) zamiast 250.

- [ ] **Krok 4A: Wstaw stawkę klienta do hierarchii**

`estimates.rs` ładuje już `client_name` w `project_meta` (linia ~63: `SELECT id, name, color, hourly_rate, client_name FROM projects`). Dociągnij mapę stawek klientów i zmień wyliczenie z linii 260:

```rust
        // Hierarchia stawek: projekt → klient → globalna (M-01).
        // Filtr `is_finite() && > 0` na każdym poziomie: 0 i NaN znaczą "nie ustawiono",
        // nie "za darmo" — inaczej pusty formularz wyzerowałby fakturę.
        let effective_hourly_rate = project_hourly_rate
            .filter(|r| r.is_finite() && *r > 0.0)
            .or_else(|| {
                client_name
                    .as_deref()
                    .and_then(|name| client_rates.get(name).copied())
                    .flatten()
                    .filter(|r: &f64| r.is_finite() && *r > 0.0)
            })
            .unwrap_or(global_hourly_rate);
```

Mapę `client_rates` zbuduj raz przed pętlą, obok `global_hourly_rate` (linia ~213):

```rust
    let client_rates: std::collections::HashMap<String, Option<f64>> = {
        let mut stmt = conn
            .prepare_cached("SELECT name, default_hourly_rate FROM clients")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<f64>>(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
```

- [ ] **Krok 5A: Uruchom**

Run: `cargo test -p timeflow-dashboard client_rate -- --nocapture && cargo test --workspace`
Expected: PASS, 0 failed.

- [ ] **Krok 6A: Sprawdź pozostałe moduły liczące kwoty**

Run: `grep -rn "effective_hourly_rate\|global_hourly_rate" --include='*.rs' dashboard/src-tauri/src | grep -v estimates.rs | grep -v 'mod tests'`

Każde inne miejsce wyliczające kwotę musi używać **tej samej** hierarchii. Jeśli `clients.rs` albo `report.rs` liczy własną — to kolejne ustalenie klasy C-01 i wymaga wydzielenia wspólnej funkcji `effective_rate_for(project, client, global)` w jednym miejscu.

- [ ] **Krok 7A: Help i CHANGELOG**

Kwoty projektów przypisanych do klientów ze stawką **się zmienią**. Opisz w `dashboard/src/pages/Help.tsx` (sekcja o stawkach) hierarchię projekt → klient → globalna, i dopisz do `CHANGELOG.md` → `Unreleased` → `Fixed` z jawnym ostrzeżeniem, że kwoty w raportach mogą się różnić od poprzednich.

- [ ] **Krok 8A: Commit**

```bash
git add dashboard/src-tauri/src/commands/estimates.rs dashboard/src/pages/Help.tsx CHANGELOG.md
git commit -m "fix(money): stawka klienta wchodzi do hierarchii projekt→klient→globalna (M-01)"
```

- [ ] **Krok 2B (jeśli DEC-02 = B): oznacz pole jako informacyjne**

Dopisz podpis pod polem w `dashboard/src/pages/clients/ClientsManageSection.tsx` (z kluczem i18n, nie tekstem wprost — bramka `lint:i18n-hardcoded` to wymusi) o treści w rodzaju „pole informacyjne — nie wpływa na wyliczane kwoty; stawkę rozliczeniową ustaw na projekcie", opisz to samo w `Help.tsx`, i dopisz komentarz w `estimates.rs` przy wyliczeniu stawki, żeby następny audyt nie zgłosił tego ponownie.

```bash
git add dashboard/src dashboard/src-tauri/src/commands/estimates.rs
git commit -m "docs(clients): stawka klienta oznaczona jako informacyjna (M-01, decyzja DEC-02=B)"
```

### Zadanie C3: Strażnik inwariantu „ta sama liczba wszędzie" · C-02

- [ ] **Krok 1: Test międzymodułowy**

Dopisz w `dashboard/src-tauri/src/commands/time_algorithm.rs`, w istniejącym `mod tests`:

```rust
    /// C-02: moduły mają własne testy jednostkowe, ale nikt nie pilnował, że
    /// różne ekrany pokazują tę samą liczbę dla tego samego projektu i zakresu.
    /// Ten test jest strażnikiem tego inwariantu — gdyby istniał wcześniej,
    /// wykryłby C-01 przy pisaniu.
    #[test]
    fn every_screen_reports_the_same_project_seconds() {
        let conn = test_conn_with_overlapping_sessions();
        let range = DateRange { start: "2026-03-01".into(), end: "2026-03-31".into() };

        let (_, totals, meta, _, _, _) =
            compute_project_activity_unique(&conn, &range, false, true, None, None, true)
                .expect("compute");

        let by_id = compute_project_clock_totals_by_id(&conn, &range).expect("by id");

        for (series_key, seconds) in &totals {
            let Some(project_id) = meta.get(series_key).and_then(|m| m.project_id) else {
                continue; // nieprzypisane nie mają id
            };
            let from_by_id = by_id.get(&project_id).copied().unwrap_or(0.0);
            assert!(
                (from_by_id - seconds).abs() < 0.5,
                "projekt {project_id}: compute_project_activity_unique daje {seconds} s, \
                 compute_project_clock_totals_by_id daje {from_by_id} s"
            );
        }
    }
```

**Uwaga:** sygnaturę `compute_project_clock_totals_by_id` (linia 384) i `compute_project_activity_unique` (linia 418) odczytaj z pliku i dopasuj wywołania — nie zmieniaj kodu produkcyjnego, żeby pasował do testu.

- [ ] **Krok 2: Uruchom**

Run: `cargo test -p timeflow-dashboard every_screen_reports_the_same_project_seconds -- --nocapture`
Expected: PASS. FAIL = kolejne ustalenie klasy C-01 — zapisz je i napraw źródło.

- [ ] **Krok 3: Commit**

```bash
git add dashboard/src-tauri/src/commands/time_algorithm.rs
git commit -m "test(time): strażnik inwariantu — dwa wejścia do rdzenia dają tę samą liczbę (C-02)"
```

### Zadanie C4: Strażnik sumy kwot · M-02

- [ ] **Krok 1: Test we froncie**

Create `dashboard/src/lib/__tests__/money-consistency.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { DEFAULT_ROUNDING_SETTINGS, roundSeconds } from '@/lib/rounding';

/**
 * M-02: `report-consistency.test.ts` pilnuje zgodności CZASU przy zaokrąglaniu
 * (dni vs total). Dla KWOT odpowiednika nie było. `scaleValueToRounded`
 * w estimate-report.ts skaluje kwotę proporcjonalnie do zaokrąglonych sekund —
 * przy wielu pozycjach błędy groszowe mogą się kumulować.
 */
const INTERVAL_MINUTES = 15;

/** Odwzorowuje `scaleValueToRounded` z lib/estimate-report.ts. */
const scaleValueToRounded = (
  value: number,
  realSeconds: number,
  displaySeconds: number,
): number => (realSeconds > 0 ? value * (displaySeconds / realSeconds) : 0);

describe('spójność kwot przy zaokrąglaniu', () => {
  it('suma kwot pozycji równa się kwocie łącznej do jednego grosza', () => {
    const rate = 187.5;
    const rawSeconds = [1234, 5678, 900, 4321, 77, 15000];

    const perEntry = rawSeconds.map((seconds) => {
      const value = (seconds / 3600) * rate;
      const rounded = roundSeconds(seconds, INTERVAL_MINUTES);
      return scaleValueToRounded(value, seconds, rounded);
    });
    const sumOfEntries = perEntry.reduce((acc, v) => acc + v, 0);

    const totalRawSeconds = rawSeconds.reduce((acc, s) => acc + s, 0);
    const totalRoundedSeconds = rawSeconds
      .map((s) => roundSeconds(s, INTERVAL_MINUTES))
      .reduce((acc, s) => acc + s, 0);
    const totalValue = scaleValueToRounded(
      (totalRawSeconds / 3600) * rate,
      totalRawSeconds,
      totalRoundedSeconds,
    );

    expect(Math.round(sumOfEntries * 100)).toBe(Math.round(totalValue * 100));
  });

  it('zaokrąglenie wyłączone ⇒ kwota identyczna z surową', () => {
    expect(DEFAULT_ROUNDING_SETTINGS.enabled).toBe(false);
    const value = (3500 / 3600) * 200;
    expect(scaleValueToRounded(value, 3500, 3500)).toBeCloseTo(value, 10);
  });
});
```

- [ ] **Krok 2: Uruchom**

Run: `cd dashboard && npx vitest run src/lib/__tests__/money-consistency.test.ts`
Expected: PASS. FAIL na pierwszym teście = realny błąd kumulacji groszy → ustalenie P1, napraw `scaleValueToRounded` (rozdzielenie reszty jak w `distributeReportRounding`).

- [ ] **Krok 3: Jeśli test przeszedł, przypnij go do realnej implementacji**

Test powyżej odwzorowuje `scaleValueToRounded` lokalnie, żeby nie zależeć od jej widoczności. Jeśli funkcja jest eksportowana z `@/lib/estimate-report`, **zaimportuj ją zamiast kopii** — kopia przestanie pilnować oryginału, gdy ten się zmieni.

Run: `grep -n "export .*scaleValueToRounded" dashboard/src/lib/estimate-report.ts`

- [ ] **Krok 4: Commit**

```bash
git add dashboard/src/lib/__tests__/money-consistency.test.ts
git commit -m "test(money): suma kwot pozycji równa kwocie łącznej przy zaokrąglaniu (M-02)"
```

**Bramka etapu C:** testy `dashboard_top_apps_never_exceed`, `every_screen_reports_the_same_project_seconds`, `money-consistency.test.ts` w CI; DEC-02 rozstrzygnięte i wykonane.

---

## Etap D — P1: pozostałe

### Zadanie D1: Odporność na panikę · P-01 — **wymaga DEC-01**

- [ ] **Krok 1: Sprawdź decyzję DEC-01**

- [ ] **Krok 2A (DEC-01 = A, `unwind`)**

W `Cargo.toml`, `[profile.release]`, usuń `panic = "abort"`. Zmierz wpływ:

```bash
cargo build --release -p timeflow-demon && ls -lh target/release/timeflow-demon
```

Porównaj z wartością sprzed zmiany i zapisz obie liczby w commicie.

- [ ] **Krok 2B (DEC-01 = B, znacznik na dysku) — rekomendowane**

Usuń martwe `catch_unwind` i zastąp ochronę freeze mechanizmem odpornym także na ubicie procesu. Miejsca do zmiany: `src/lan_sync_orchestrator.rs:847` (`guarded_then_cleanup`), `src/lan_server.rs:422,1358`, `src/lan_discovery.rs:205`, `src/tracker.rs:226`, `dashboard/src-tauri/src/commands/assignment_model/training.rs:810`.

Test pilnujący, dopisany w `src/lan_sync_orchestrator.rs`, `mod tests`:

```rust
    /// P-01: `guarded_then_cleanup` opierał się na catch_unwind, który przy
    /// panic="abort" nigdy nie łapie — po panice baza zostawała ZAMROŻONA,
    /// a AUTO_UNFREEZE_TIMEOUT działa tylko dopóki proces żyje. Ochrona musi
    /// przetrwać ubicie procesu, więc opiera się na znaczniku na dysku
    /// sprzątanym przy starcie.
    #[test]
    fn stale_freeze_marker_is_cleared_on_startup() {
        let dir = tempdir_for_test();
        write_freeze_marker(&dir, "sync-123");
        assert!(freeze_marker_exists(&dir));

        clear_stale_freeze_markers(&dir);

        assert!(
            !freeze_marker_exists(&dir),
            "znacznik freeze po ubitym procesie musi zostać zdjęty przy starcie — inaczej baza zostaje zamrożona na zawsze"
        );
    }
```

**Uwaga:** `write_freeze_marker`, `freeze_marker_exists`, `clear_stale_freeze_markers` i `tempdir_for_test` trzeba **napisać** — to nowy mechanizm. Wołaj `clear_stale_freeze_markers` przy starcie demona w `src/main.rs`, przed uruchomieniem serwera LAN.

- [ ] **Krok 3: Uruchom pełne testy**

Run: `cargo test --workspace`
Expected: 0 failed. Testy opierające się na `catch_unwind` (np. `lan_sync_orchestrator.rs:989`) trzeba przepisać na nowy mechanizm — **nie usuwaj ich**.

- [ ] **Krok 4: Commit**

```bash
git add Cargo.toml src/ dashboard/src-tauri/src/
git commit -m "fix(resilience): ochrona przed zamrożoną bazą działa też w buildzie release (P-01, decyzja DEC-01)"
```

### Zadanie D2: Cichy brak funkcji w webui · PW-01

- [ ] **Krok 1: Test padający po stronie generatora**

`gen_webrpc.cjs` pomija komendy z parametrem `Window` i **generuje poprawny plik**, więc `--check` przechodzi. Bramka musi widzieć pominięcia.

Dodaj do `dashboard/src-tauri/scripts/gen_webrpc.cjs`, na końcu (po `if (skipped.length) console.log(...)`):

```js
// Pominięta komenda dziala na desktopie i CICHO nie dziala w webui. To jest
// dopuszczalne tylko wtedy, gdy front swiadomie ukrywa ta funkcje w trybie
// webui — dlatego kazde pominiecie musi byc wpisane na liste ponizej.
// Dopisujac tu komende, dopisz TAKZE obsluge w froncie (ukrycie lub komunikat).
const KNOWN_UNBRIDGEABLE = new Set([
  'print_report', // drukowanie wymaga okna desktopowego; front ukrywa przycisk w webui
]);
const unexpected = skipped.filter((name) => !KNOWN_UNBRIDGEABLE.has(name));
if (unexpected.length) {
  console.error(
    `BLAD: komendy pominiete w mostku webui bez wpisu na liscie KNOWN_UNBRIDGEABLE:\n` +
    unexpected.map((n) => `  - ${n}`).join('\n') +
    `\nKazda taka komenda cicho nie dziala na telefonie.\n` +
    `Dopisz ja do KNOWN_UNBRIDGEABLE i obsluz brak w froncie.`
  );
  process.exit(1);
}
```

- [ ] **Krok 2: Uruchom**

Run: `cd dashboard/src-tauri && node scripts/gen_webrpc.cjs --check; echo "kod: $?"`
Expected: 0 (jedyne pominięcie, `print_report`, jest na liście).

Sprawdź, że bramka **umie paść**: tymczasowo usuń `print_report` z `KNOWN_UNBRIDGEABLE`, uruchom ponownie, potwierdź kod ≠ 0, przywróć wpis.

- [ ] **Krok 3: Ukryj funkcję w trybie webui**

Front nie ma dziś detekcji trybu (`lib/platform.ts` jej nie zawiera). Dodaj ją tam, obok istniejących detekcji:

```typescript
/**
 * Tryb webui (przeglądarka/telefon) — brak runtime'u Tauri. Funkcje wymagające
 * okna desktopowego (drukowanie raportu) są w tym trybie niedostępne i muszą
 * być ukryte, a nie pokazane jako martwy przycisk (PW-01).
 */
export const isWebuiMode = (): boolean => !hasTauriRuntime();
```

Następnie ukryj przycisk drukowania. Znajdź go: `grep -rn "print_report\|printReport" --include='*.tsx' --include='*.ts' dashboard/src`

- [ ] **Krok 4: Sprawdź ręcznie**

Otwórz webui na telefonie, przejdź na widok raportu. **Sprawdź:** przycisk drukowania nie jest widoczny. Na desktopie: jest i działa.

- [ ] **Krok 5: Commit**

```bash
git add dashboard/src-tauri/scripts/gen_webrpc.cjs dashboard/src/lib/platform.ts dashboard/src
git commit -m "fix(webui): pominięcia w mostku są jawne, a niedostępne funkcje ukryte (PW-01)"
```

### Zadanie D3: Kasowanie danych AI propaguje się · AI-04, SY-01 — **wymaga DEC-03**

- [ ] **Krok 1: Test padający**

Dopisz w `src/sync_common.rs`, w `mod tests` (obok `merge_carries_assignment_feedback_and_auto_runs_via_export_roundtrip`, linia 2026 — użyj tych samych pomocników):

```rust
    /// AI-04: `assignment_feedback` merguje się jako encja APPEND-ONLY i nie ma
    /// triggera tombstone. Użytkownik resetuje model (reset_model_full) albo
    /// kasuje aplikację wraz z danymi (delete_app_and_data), synchronizuje —
    /// i peer dopisuje skasowane wiersze z powrotem. Kasowanie danych
    /// użytkownika musi być trwałe.
    #[test]
    fn deleted_assignment_feedback_does_not_return_from_peer() {
        let mut sim = LanSyncSimulator::seeded();
        seed_feedback(&mut sim.master, "manual_session_assign", "2026-03-01 10:00:00");
        seed_feedback(&mut sim.slave,  "manual_session_assign", "2026-03-01 10:00:00");
        sim.run_master_cycle(SimulatorPullMode::Full, "1970-01-01 00:00:00")
            .expect("sync wyrównujący");

        // Użytkownik resetuje model na masterze.
        sim.master
            .execute_batch("DELETE FROM assignment_feedback;")
            .expect("reset modelu");

        sim.run_master_cycle(SimulatorPullMode::Full, "1970-01-01 00:00:00")
            .expect("sync po resecie");

        let count: i64 = sim
            .master
            .query_row("SELECT COUNT(*) FROM assignment_feedback", [], |r| r.get(0))
            .expect("policz feedback");
        assert_eq!(
            count, 0,
            "po synchronizacji wróciło {count} skasowanych wierszy feedbacku — reset modelu został cofnięty"
        );
    }
```

**Uwaga:** `seed_feedback` dopisz w `mod tests`; `LanSyncSimulator` i `SimulatorPullMode` już istnieją (`sync_common.rs:~1735`).

- [ ] **Krok 2: Uruchom — musi paść**

Run: `cargo test -p timeflow-demon deleted_assignment_feedback_does_not_return_from_peer -- --nocapture`
Expected: FAIL — `po synchronizacji wróciło N skasowanych wierszy`.

- [ ] **Krok 3A (DEC-03 = A): tombstony dla tabel AI**

Trzy zmiany, każda konieczna:
1. Migracja `m28_ai_tombstones.rs` — triggery `trg_assignment_feedback_tombstone` i `trg_assignment_auto_runs_tombstone`, wzorowane **dokładnie** na `trg_project_costs_tombstone` z m26. Klucz sync: `(source, created_at)` — ten sam, którego używa dedup w merge'u.
2. `shared/sync/triggers.rs` — dopisz oba do tablicy CREATE **i** do tablicy DROP (test `create_and_drop_arrays_are_aligned` to wymusi).
3. `src/sync_common.rs` — pętla append-only musi sprawdzać `local_tombstone_covers` przed INSERT-em, jak robią to pozostałe encje.

- [ ] **Krok 3B (DEC-03 = B): wyłącz tabele AI z synchronizacji**

Usuń `assignment_feedback` i `assignment_auto_runs` z obu eksportów, z obu `TableHashes`, z checksumu i z pętli merge. Dopisz test analogiczny do `merge_todos_never_touches_gcal_fields`, pilnujący, że pola nie wchodzą do eksportu.

- [ ] **Krok 3C (DEC-03 = C): ostrzeżenie w UI**

Zostaw zachowanie, dopisz ostrzeżenie przy przycisku resetu modelu i w `Help.tsx`: „reset modelu obejmuje wyłącznie to urządzenie; po synchronizacji dane treningowe mogą wrócić ze sparowanych urządzeń". Test z kroku 1 **odwróć** (asercja `count > 0` z komentarzem, że to zachowanie zamierzone i udokumentowane) — inaczej zostawisz czerwony test w repo.

- [ ] **Krok 4: Uruchom**

Run: `cargo test -p timeflow-demon && cargo test --workspace`

- [ ] **Krok 5: Commit**

```bash
git add src/ shared/ dashboard/src-tauri/src/ dashboard/src/pages/Help.tsx
git commit -m "fix(sync): kasowanie danych treningowych AI nie wraca od peera (AI-04, SY-01, decyzja DEC-03)"
```

### Zadanie D4: Zachowanie `clear_all_data` · DEC-04

- [ ] **Krok 1: Sprawdź decyzję DEC-04**

- [ ] **Krok 2A (DEC-04 = A, rekomendowane): udokumentuj**

Dopisz w `dashboard/src/pages/Help.tsx` i przy samym przycisku (klucz i18n) opis: „czyści dane wyłącznie na tym urządzeniu; po synchronizacji ze sparowanym urządzeniem dane mogą wrócić". Dopisz komentarz przy `DELETE FROM tombstones` w `settings.rs:417`, wyjaśniający, że jest tam **celowo** i dlaczego:

```rust
             -- DELETE FROM tombstones jest tu CELOWO i musi zostać PO kasowaniu
             -- encji: czyści tombstony wyprodukowane przez własne triggery, żeby
             -- lokalne czyszczenie NIE kasowało danych na sparowanych urządzeniach.
             -- Konsekwencja: po synchronizacji dane wracają od peera — opisane
             -- w Help.tsx przy przycisku (DEC-04 = A).
             DELETE FROM tombstones;
```

- [ ] **Krok 3: Commit**

```bash
git add dashboard/src-tauri/src/commands/settings.rs dashboard/src dashboard/src/pages/Help.tsx
git commit -m "docs(data): clear_all_data czyści lokalnie — zachowanie udokumentowane (DEC-04)"
```

**Bramka etapu D:** wszystkie cztery decyzje rozstrzygnięte i wykonane; testy `stale_freeze_marker_*`, `deleted_assignment_feedback_*` i bramka `gen_webrpc` w CI.

---

## Etap E — P2: strażnicy inwariantów

Zadania tego etapu **nie zmieniają zachowania** — dodają testy i centralizują definicje, żeby etapy A–D nie cofnęły się niezauważenie. Każde jest niezależne; rób po jednym.

### Zadanie E1: `TableHashes` przez `derive` · D-04, N-02

- [ ] **Krok 1: Test padający**

Dopisz w `src/lan_server.rs`, `mod tests`:

```rust
    /// D-04: ręczne `impl PartialEq for TableHashes` porównywało 7 z 9 pól —
    /// pomijało assignment_feedback i assignment_auto_runs. Dziś bez wywołań,
    /// więc skutek zerowy; pierwszy kod, który porówna hashe, odziedziczyłby
    /// błąd bez ostrzeżenia. Ten test wymusza, by KAŻDE pole liczyło się do równości.
    #[test]
    fn table_hashes_equality_covers_every_field() {
        let base = build_sample_table_hashes();
        let json = serde_json::to_value(&base).expect("serializacja");
        let fields: Vec<String> = json.as_object().expect("obiekt").keys().cloned().collect();
        assert_eq!(fields.len(), 9, "zmienił się zestaw pól TableHashes");

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

    fn build_sample_table_hashes() -> TableHashes {
        TableHashes {
            projects: "p".into(),
            clients: "c".into(),
            applications: "a".into(),
            sessions: "s".into(),
            manual_sessions: "m".into(),
            assignment_feedback: "f".into(),
            assignment_auto_runs: "r".into(),
            project_costs: "k".into(),
            todos: "t".into(),
        }
    }
```

- [ ] **Krok 2: Uruchom — musi paść**

Run: `cargo test -p timeflow-demon table_hashes_equality_covers_every_field -- --nocapture`
Expected: FAIL na `assignment_feedback` lub `assignment_auto_runs`.

- [ ] **Krok 3: Usuń ręczny impl**

W `src/lan_server.rs` skasuj cały blok od komentarza `// ── PartialEq for TableHashes ──` (linia ~1802) do zamykającej klamry `impl` (linia ~1814), i zmień atrybut struktury (linia ~42) z:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
```

na:

```rust
// PartialEq WYPROWADZONY, nie pisany ręcznie: ręczna wersja pomijała
// assignment_feedback i assignment_auto_runs, przez co rozjazd tych tabel był
// niewykrywalny. Derive obejmuje każde pole — dodanie tabeli nie wymaga
// pamiętania o aktualizacji porównania (D-04).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
```

- [ ] **Krok 4: Uruchom i commit**

```bash
cargo test -p timeflow-demon
git add src/lan_server.rs
git commit -m "fix(sync): PartialEq dla TableHashes wyprowadzony derive'em (D-04)"
```

### Zadanie E2: Idempotencja merge · SY-03

- [ ] **Krok 1: Test**

Dopisz w `src/sync_common.rs`, `mod tests`, wykorzystując istniejący `LanSyncSimulator`:

```rust
    /// SY-03: brak idempotencji merge'u objawia się wiecznym re-syncem — peery
    /// co cykl widzą różnicę i mielą pełne archiwum. Drugi merge tego samego
    /// archiwum nie może zmienić bazy.
    #[test]
    fn merging_the_same_archive_twice_changes_nothing() {
        let mut sim = LanSyncSimulator::seeded();
        let archive = build_full_export(&sim.slave).expect("eksport");

        merge_incoming_data(&mut sim.master, &archive).expect("pierwszy merge");
        let after_first = compute_tables_hash_string_conn(&sim.master);
        let snapshot_first = user_data_snapshot(&sim.master);

        merge_incoming_data(&mut sim.master, &archive).expect("drugi merge");
        let after_second = compute_tables_hash_string_conn(&sim.master);

        assert_eq!(
            after_first, after_second,
            "drugi merge tego samego archiwum zmienił hashe — sync nigdy nie zgłosi 'none'"
        );
        assert_eq!(
            snapshot_first,
            user_data_snapshot(&sim.master),
            "drugi merge zmienił dane użytkownika"
        );
    }
```

- [ ] **Krok 2: Uruchom**

Run: `cargo test -p timeflow-demon merging_the_same_archive_twice_changes_nothing -- --nocapture`
Expected: PASS. FAIL = ustalenie P0 (niestabilna baza) — zapisz i napraw źródło.

- [ ] **Krok 3: Commit**

```bash
git add src/sync_common.rs
git commit -m "test(sync): merge jest idempotentny (SY-03)"
```

### Zadanie E3: `file_activities` w checksumie · SY-02

`CHANGELOG → Unreleased` dodaje `file_activities` do archiwum eksportu, ale tabela nie występuje w `TableHashes` ani w `triggers.rs`. Rozjazd tych danych jest niewykrywalny.

- [ ] **Krok 1: Ustal, czy tabela ma być synchronizowana**

Run: `grep -rn "file_activities" --include='*.rs' shared/sync/ src/sync_common.rs dashboard/src-tauri/src/commands/import_data.rs | grep -iv "test" | head -20`

Jeśli merge ją wchłania — musi mieć checksum i tombstony (tak jak każda inna encja). Jeśli nie wchłania — jest jednokierunkowa (tylko eksport/import ręczny) i **to trzeba udokumentować**, bo `TableHashes` sugeruje inaczej.

- [ ] **Krok 2: Zastosuj wynik**

Dodanie do checksumu: `shared/sync/checksum.rs::table_hash_sql` (nowa gałąź) + oba `TableHashes` + oba `build_table_hashes`. Test w `checksum.rs` wzorowany na `project_costs_hash_detects_amount_drift`.

- [ ] **Krok 3: Commit**

```bash
git add shared/ src/ dashboard/src-tauri/src/
git commit -m "fix(sync): file_activities objęte checksumem (SY-02)"
```

### Zadanie E4: Centralizacja kolumn · D-01

`shared/sync/columns.rs` ma dziś wyłącznie `projects`. Rozszerz wzorzec — **jedna encja = jeden commit**, żeby rozłożyć na kilka sesji.

- [ ] **Krok 1: Wybierz encję (zacznij od `sessions`) i zbierz jej listy kolumn**

Run:
```bash
grep -rn "FROM sessions\|INSERT INTO sessions" --include='*.rs' src shared dashboard/src-tauri/src \
  | grep -v '/tests\.rs' | grep -v 'mod tests'
```

Zapisz w `ANALIZA-02-szczegolowa.md` (sekcja 2.3), które listy są identyczne, a które celowo różne.

- [ ] **Krok 2: Dodaj stałe wzorem `PROJECT_COLUMNS`/`PROJECT_SELECT`**

Nazwy kolumn odczytaj z realnych migracji (`m07_sessions_v2.rs` i późniejsze dotykające `sessions`), nie z pamięci.

- [ ] **Krok 3: Test strażniczy**

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

- [ ] **Krok 4: Podmień JEDNO miejsce użycia i uruchom pełne testy**

Zacznij od `shared/sync/checksum.rs` (najkrótsze).

Run: `cargo test --workspace`
Expected: 0 failed. **Padnięcie oznacza, że listy nie były identyczne** — to ustalenie P0 (kolumna nie synchronizowała się). Zapisz i napraw źródło.

- [ ] **Krok 5: Commit i powtórz**

```bash
git add shared/sync/columns.rs shared/sync/checksum.rs
git commit -m "refactor(sync): kolumny sessions z jednego źródła (D-01)"
```

Powtórz dla `applications`, `manual_sessions`, `clients`, `project_costs`, `todos`, `assignment_feedback`, `assignment_auto_runs`.

### Zadanie E5: Schemat demona zna każdą tabelę synchronizowaną · D-03

- [ ] **Krok 1: Test**

Dopisz w `src/sync_common.rs`, `mod tests`:

```rust
    /// D-03: demon ma własny, ręcznie pisany schemat i NIE uruchamia migracji
    /// dashboardu. Gdy dashboard doda tabelę synchronizowaną, a demon jej nie
    /// zna, merge wywala się na `no such table` — i zabiera ze sobą CAŁY merge,
    /// nie tylko nową encję (pętla triggerów tombstone). Obejście dla m26
    /// (ensure_m26_entity_tables) jest punktowe; ten test wymusza świadomą
    /// decyzję przy każdej kolejnej tabeli.
    #[test]
    fn daemon_schema_knows_every_synced_table() {
        const SYNCED_TABLES: &[&str] = &[
            "projects", "clients", "applications", "sessions", "manual_sessions",
            "assignment_feedback", "assignment_auto_runs", "project_costs", "todos",
            "tombstones", "sync_markers",
        ];

        let conn = fresh_daemon_schema_conn();
        for table in SYNCED_TABLES {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .expect("sqlite_master");
            assert_eq!(
                exists, 1,
                "schemat demona nie zna tabeli '{table}' — merge padnie na `no such table` i zabierze cały sync"
            );
        }
    }
```

**Uwaga:** `fresh_daemon_schema_conn` odtwórz z realnej funkcji inicjalizującej schemat demona — znajdź ją: `grep -n "fn ensure_.*table\|fn init_schema\|fn ensure_m26" src/sync_common.rs`.

- [ ] **Krok 2: Uruchom i commit**

```bash
cargo test -p timeflow-demon daemon_schema_knows_every_synced_table -- --nocapture
git add src/sync_common.rs
git commit -m "test(sync): schemat demona musi znać każdą synchronizowaną tabelę (D-03)"
```

### Zadanie E6: Asymetria eksportu `projects` · D-02

- [ ] **Krok 1: Ujednolić SELECT demona z `PROJECT_SELECT`**

W `src/lan_server.rs:1677` zamień ręcznie pisany SELECT na `timeflow_shared::sync::columns::PROJECT_SELECT`. To usuwa jednocześnie brak `is_imported` (bezskutkowy, ale przypadkowy) i asymetrię `status` vs `COALESCE(status,'active')`.

- [ ] **Krok 2: Test pilnujący zgodności obu eksportów**

```rust
    /// D-02: dashboard eksportował COALESCE(status,'active'), demon surowe
    /// `status`. Dla wiersza sprzed m24 z NULL-em ten sam projekt kończył
    /// z innym statusem w zależności od tego, z którego peera przyszedł.
    #[test]
    fn daemon_and_dashboard_export_projects_identically() {
        let conn = fresh_daemon_schema_conn();
        conn.execute(
            "INSERT INTO projects (name, color, created_at, updated_at, status)
             VALUES ('Legacy', '#fff', '2026-01-01 00:00:00', '2026-01-01 00:00:00', NULL)",
            [],
        )
        .expect("wiersz sprzed m24");

        let rows = fetch_all_rows(&conn, timeflow_shared::sync::columns::PROJECT_SELECT)
            .expect("eksport");
        let status = rows[0].get("status").and_then(|v| v.as_str());
        assert_eq!(
            status,
            Some("active"),
            "eksport demona musi domykać NULL-owy status tak samo jak dashboard"
        );
    }
```

- [ ] **Krok 3: Uruchom i commit**

```bash
cargo test -p timeflow-demon daemon_and_dashboard_export_projects_identically
git add src/lan_server.rs
git commit -m "fix(sync): eksport projektów demona używa wspólnego PROJECT_SELECT (D-02)"
```

**Bramka etapu E:** wszystkie testy strażnicze w `cargo test --workspace`; kolumna „Liczba miejsc" w macierzy encji zmniejszona dla każdej przerobionej encji.

---

## Etap F — białe plamy

Obszary, których analiza nie objęła. **Każde z tych zadań może wygenerować nowe ustalenia P0/P1** — po zakończeniu wróć do etapów B–D, jeśli coś takiego znajdziesz.

### Zadanie F1: Profilowanie SQL · W-01…W-05

- [ ] **Krok 1: Włącz profiler tymczasowo**

W miejscu otwarcia połączenia (`grep -n "Connection::open" dashboard/src-tauri/src/db.rs`):

```rust
    // TYMCZASOWO na czas profilowania (etap F). USUŃ przed commitem.
    conn.profile(Some(|sql: &str, duration: std::time::Duration| {
        if duration.as_millis() >= 20 {
            log::warn!("[SLOW SQL] {} ms — {}", duration.as_millis(), sql);
        }
    }));
```

- [ ] **Krok 2: Przejdź wszystkie ekrany na bazie realnego rozmiaru**

Dashboard → Projects → Sessions → Time Analysis → Report → PM → Clients → Estimates → AI → Todo. Zbierz linie `[SLOW SQL]`.

- [ ] **Krok 3: Tabela wolnych zapytań**

Zapisz w `ANALIZA-02-szczegolowa.md`, sekcja 2.7: ekran, zapytanie, czas, ile razy na wejście, diagnoza (brak indeksu / N+1 / pełny skan / wołane przy każdym renderze), priorytet.

**Kandydaci wskazani przez analizę statyczną:** `projects.rs:1813–1880` wykonuje trzy osobne zapytania na kartę projektu; `projects.rs` używa `prepare` zamiast `prepare_cached` w gorących ścieżkach.

- [ ] **Krok 4: Napraw, zmierz ponownie, usuń profiler**

Run: `grep -rn "SLOW SQL" --include='*.rs' dashboard/src-tauri/src` → musi być pusto.

- [ ] **Krok 5: Commit**

```bash
git add dashboard/src-tauri/src docs/release/audit/ANALIZA-02-szczegolowa.md
git commit -m "perf(db): <co poprawiono> — pomiar przed/po w dokumencie audytu"
```

### Zadanie F2: `webui/auth.rs`

- [ ] **Krok 1: Przegląd**

Run: `cat dashboard/src-tauri/src/webui/auth.rs`

Zapisz odpowiedzi: jak wygląda sesja i jej wygasanie; czy hasło jest hashowane (jakim algorytmem, z solą); czy jest ograniczenie prób; atrybuty ciasteczka (`HttpOnly`, `SameSite`, `Secure`); co dokładnie zmienia `lan_exposure = true` w `webui/config.rs`.

- [ ] **Krok 2: Ustalenia i testy**

Każde ustalenie → test → poprawka → commit, jak w etapie B.

### Zadanie F3: Powierzchnia MCP

- [ ] **Krok 1: Inwentaryzacja narzędzi**

Run: `grep -n "name:\|fn " dashboard/src-tauri/src/mcp/tools.rs | head -60`

Dla każdego narzędzia zapisz: czy modyfikuje dane, czy kasuje, czy wymaga potwierdzenia, czy woła `mcp/backup.rs` przed operacją destrukcyjną.

- [ ] **Krok 2: Ustalenia**

Narzędzie kasujące dane bez kopii zapasowej = P1.

### Zadanie F4: Konfiguracja Tauri

- [ ] **Krok 1: Przegląd**

Run: `cat dashboard/src-tauri/tauri.conf.json dashboard/src-tauri/capabilities/default.json`

Sprawdź: czy CSP jest ustawione (nie `null`); czy `capabilities/default.json` zawęża uprawnienia do faktycznie używanych; czy `withGlobalTauri` nie jest włączone bez potrzeby; czy `devUrl` nie zostaje w konfiguracji produkcyjnej.

### Zadanie F5: UI, i18n, Help · sekcja 2.10

- [ ] **Krok 1: Bramki i react-doctor**

```bash
cd dashboard && npm run lint:i18n-hardcoded && npm run lint:inline-i18n-bridge && npm run lint:locales && cd ..
npx -y react-doctor@latest . --verbose    # z ROOTA, oczekiwane 100/100
```

- [ ] **Krok 2: Tabela pokrycia `Help.tsx`**

Każdy ekran (26 stron) i każda karta ustawień × {opisane?, „co robi"?, „kiedy użyć"?, „ograniczenia"?} — `CLAUDE.md` §3.

Szczególnie funkcje z `CHANGELOG → Unreleased`: koszty dodatkowe, zadania, `file_activities` w eksporcie, zmiany w AI. Plus wszystko, co zmieniły etapy C i D.

- [ ] **Krok 3: Tabela stanów ekranów**

Każdy ekran × {loading, empty, error}. Ekran pokazujący przy błędzie pustą tabelę zamiast komunikatu = P2.

- [ ] **Krok 4: Terminologia**

Run: `grep -rn "Timeflow\|timeflow\b" --include='*.tsx' --include='*.json' dashboard/src | grep -v "timeflow-\|@timeflow\|timeflow_"`

Każde wystąpienie w tekście widocznym dla użytkownika, które nie jest `TIMEFLOW` — poprawka (`CLAUDE.md` §2).

- [ ] **Krok 5: Commit per obszar**

```bash
git add dashboard/src docs/release/audit/ANALIZA-02-szczegolowa.md
git commit -m "docs(help)|fix(i18n): <obszar> (sekcja 2.10)"
```

### Zadanie F6: Weryfikacja na realnym Windows · PW-03

- [ ] **Krok 1: Pełny build na maszynie Windows**

```powershell
cd dashboard; npm ci; npm run build
cd ..; cargo build --release -p timeflow-demon
cd dashboard; npm run tauri build
```

- [ ] **Krok 2: Zweryfikuj oba TODO z `PARITY.md`**

**Tray:** wyłącz sync całkowicie. Sprawdź, czy blok sync znika (jak na macOS), czy zostaje wyszarzony.

**Detekcja demona:** uruchom demona → sprawdź status; zatrzymaj → sprawdź; uruchom **obcy proces o nazwie `timeflow-demon.exe` z innej ścieżki** → sprawdź, czy nie ma fałszywego „Running". `PARITY.md` wskazuje dwa konkretne ryzyka: quoting `-Command` w `std::process` i fałszywy „Stopped" przy pustym wyjściu PowerShella — sprawdź oba.

**Punkt paniki klasy A:** `platform/windows/tray.rs:529` (`APP_ICON must exist`) — jedyny, którego nie dało się zweryfikować na macOS.

- [ ] **Krok 3: Archiwum międzysystemowe**

Eksportuj na Windows → importuj na macOS i odwrotnie. Sprawdź: te same sumy czasu, te same projekty, brak zdublowanych sesji, ścieżki w `file_activities` nie wysypują widoku Detailed.

- [ ] **Krok 4: Zaktualizuj `PARITY.md`**

Dla każdej pozycji: usuń wiersz (różnica zamknięta) albo zamień „NIEZWERYFIKOWANE" na „Zweryfikowane na buildzie Windows `<data>`, zachowanie: `<opis>`". **Słowo „NIEZWERYFIKOWANE" nie może zostać w wydaniu.**

- [ ] **Krok 5: Commit**

```bash
git add PARITY.md docs/release/audit/ANALIZA-02-szczegolowa.md
git commit -m "docs(parity): weryfikacja na realnym buildzie Windows (PW-03)"
```

**Bramka etapu F:** sekcja „białe plamy" w `ANALIZA-02-szczegolowa.md` pusta albo z jawną decyzją o odłożeniu; nowe ustalenia P0/P1 zamknięte.

---

## Etap G — P3/P4 i wydanie

### Zadanie G1: Wyczyść clippy i zaostrz bramkę · N-01, B-01

- [ ] **Krok 1: Napraw 71 ostrzeżeń**

Run: `cargo clippy --workspace --all-targets 2>&1 | grep "^warning" | sort | uniq -c | sort -rn`

Grupuj po typie ostrzeżenia; jeden typ = jeden commit. Ostrzeżenia, których świadomie nie naprawiasz, dostają punktowe `#[allow(...)]` **z komentarzem dlaczego** — nigdy globalnie w `lib.rs`.

- [ ] **Krok 2: Zaostrz CI**

```yaml
      - run: cargo clippy --workspace --all-targets -- -D warnings
```

- [ ] **Krok 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: clippy z -D warnings po wyczyszczeniu ostrzeżeń (N-01)"
```

### Zadanie G2: Drobne ustalenia · N-03, N-06, PW-02, AI-06, M-03

- [ ] **PW-02** — zastąp ręczny spis komend w `commands/mod.rs` generowanym albo skasuj go i wskaż `scripts/audit/check-command-surface.sh` jako źródło. Ręczna lista rozjechała się o ~35 pozycji i trzy moduły.
- [ ] **N-06** — przenieś 26 `println!/eprintln!` poza testami na `log::*` albo oznacz jako celową diagnostykę (`import_data.rs:2222+`).
- [ ] **N-03** — usuń z `PROJECT_SELECT` kolumny, których merge nie czyta (`is_imported`), albo dopisz komentarz, że są eksportowane celowo dla kompatybilności.
- [ ] **AI-06** — dedup feedbacku po `(source, created_at)` scala różne zdarzenia z tej samej sekundy. Rozważ dodanie `uid` jak w `project_costs`/`todos`.
- [ ] **M-03** — koszty linkowane po nazwie projektu: dodaj test, że **każda** ścieżka kasowania projektu czyści koszty (dziś dwie wołają `delete_costs_of_project`; trzecia je osieroci).

Każde osobnym commitem.

### Zadanie G3: `.gitignore`

- [ ] **Krok 1: Usuń mylący wpis**

`.gitignore` zawiera `dashboard/src-tauri/Cargo.toml`, mimo że plik **jest śledzony**. Dziś bez skutku, ale to pułapka przy `git rm --cached`.

Run: `git ls-files --error-unmatch dashboard/src-tauri/Cargo.toml && echo "śledzony — usunięcie wpisu bezpieczne"`

- [ ] **Krok 2: Commit**

```bash
git add .gitignore
git commit -m "chore: usuń mylący wpis .gitignore dla śledzonego Cargo.toml"
```

### Zadanie G4: Wersja i CHANGELOG

- [ ] **Krok 1: Podbij i zsynchronizuj**

```bash
echo "0.1.<nowy>" > VERSION
cd dashboard && node scripts/sync-version.cjs && cd ..
./scripts/audit/check-version-sync.sh
```
Expected: pięć linii `ok:`.

- [ ] **Krok 2: Zamknij sekcję `Unreleased`**

Zamień `## Unreleased` na `## 0.1.<nowy> — <data>` i utwórz nad nim nową pustą sekcję. Dopisz wpisy dla wszystkiego, co użytkownik odczuje — **w szczególności zmian z etapów C i D** (inne liczby na Dashboardzie, inne kwoty przy stawce klienta, zmienione zachowanie resetu modelu AI).

- [ ] **Krok 3: Commit**

```bash
git add VERSION Cargo.toml shared/Cargo.toml dashboard/src-tauri/Cargo.toml \
        dashboard/package.json dashboard/src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "release: 0.1.<nowy>"
```

### Zadanie G5: Build, podpis, notaryzacja

- [ ] **Krok 1: Zbuduj macOS**

Run: `head -60 build_all_macos.py` (przeczytaj, co robi z `dist/`), potem `python3 build_all_macos.py`

- [ ] **Krok 2: Zweryfikuj**

```bash
codesign --verify --deep --strict --verbose=2 "dist/TIMEFLOW.app"
codesign --verify --deep --strict --verbose=2 "dist/TIMEFLOW Demon.app"
spctl --assess --type execute --verbose "dist/TIMEFLOW.app"
xcrun stapler validate "dist/TIMEFLOW.app"
```
Expected: `accepted`, `source=Notarized Developer ID`, `The validate action worked!`. Każdy inny wynik = P0.

- [ ] **Krok 3: Czysta maszyna**

Uruchom na koncie, na którym TIMEFLOW nigdy nie działał. Sprawdź: brak ostrzeżeń Gatekeepera, czytelna prośba o uprawnienia, pusta baza, demon startuje.

- [ ] **Krok 4: Windows**

`npm run tauri build`, instalacja na czystej maszynie. Zapisz, czy pojawia się ostrzeżenie SmartScreen.

### Zadanie G6: Migracja i ścieżka wycofania

- [ ] **Krok 1: Test migracji na realnej bazie**

1. Kopia bazy z **poprzedniej wydanej** wersji (nie z gałęzi deweloperskiej).
2. Zanotuj ze starej wersji: sumę czasu za ostatni miesiąc, liczbę projektów, liczbę sesji, kwotę raportu dla jednego projektu.
3. Uruchom nową wersję na kopii.
4. Sprawdź wszystkie cztery liczby.

**Liczby, które celowo się zmieniły** (etap C: C-01 zmienia rozbicie per aplikacja; DEC-02=A zmienia kwoty przy stawce klienta), wypisz osobno: stara wartość, nowa, uzasadnienie, wpis w `CHANGELOG`. **Reszta musi się zgadzać co do sekundy i grosza.**

- [ ] **Krok 2: Opisz i przetestuj wycofanie**

Utwórz sekcję w `docs/release/RELEASE-<wersja>.md`:

```markdown
## Ścieżka wycofania

| Migracja w tym wydaniu | Odwracalna? | Co po powrocie do starej wersji |
|---|---|---|

**Procedura dla użytkownika:**
1. Zamknij TIMEFLOW i demona.
2. Przywróć kopię bazy z `<ścieżka automatycznej kopii przed migracją>`.
3. Zainstaluj poprzednią wersję z `<gdzie dostępna>`.

**Przetestowano:** ☐ tak ☐ nie
```

**Nie zaznaczaj „tak", jeśli nie przeszedłeś procedury na realnej kopii.**

- [ ] **Krok 3: Commit**

```bash
git add docs/release/
git commit -m "docs(release): test migracji i udokumentowana ścieżka wycofania"
```

### Zadanie G7: Ostateczna bramka

- [ ] **Krok 1: Uruchom wszystko**

```bash
./scripts/audit/check-version-sync.sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd dashboard && npm run typecheck && npm run lint && npm run lint:knip && npm test && cd ..
cargo deny check advisories bans licenses sources
cd dashboard && npm audit --omit=dev --audit-level=high && cd ..
npx -y react-doctor@latest . --verbose
./scripts/audit/check-command-surface.sh
./scripts/audit/find-panics-in-prod.sh | head -1
```

**Uruchom i zobacz wyjście — nie odhaczaj z pamięci.**

- [ ] **Krok 2: Sprawdź, że P0/P1 są zamknięte**

Run: `grep -n "P0\|P1" docs/release/audit/ANALIZA-02-szczegolowa.md | grep -v "zamknięte\|✅"`
Expected: pusto albo tylko wiersze z jawną decyzją o odłożeniu.

- [ ] **Krok 3: Otaguj**

```bash
git tag -a "v$(cat VERSION)" -m "TIMEFLOW $(cat VERSION) — wydanie po audycie przedwydaniowym"
git push origin "v$(cat VERSION)"
```

---

## Podsumowanie mapowania ustalenie → zadanie

| Ustalenie | Prio | Zadanie |
|---|---|---|
| S-01 | P0 | B1, B2, B3, B4 |
| C-01 | P1 | C1 |
| M-01 | P1 | C2 (DEC-02) |
| P-01 | P1 | D1 (DEC-01) |
| PW-01 | P1 | D2 |
| AI-04 / SY-01 | P1 | D3 (DEC-03) |
| D-04 / N-02 | P2 | E1 |
| SY-03 | P2 | E2 |
| SY-02 | P2 | E3 |
| D-01 | P2 | E4 |
| D-03 | P2 | E5 |
| C-02 | P2 | C3 |
| M-02 | P2 | C4 |
| S-02 | P2 | B5 |
| B-01 | P2 | A3, G1 |
| B-02 | P2 | A2 |
| B-04 / PW-03 | P2 | A4, F6 |
| D-02 | P3 | E6 |
| M-03 | P3 | G2 |
| B-03 | P3 | A2 |
| B-05 | P3 | A1 |
| AI-06 | P3 | G2 |
| N-01 | P4 | G1 |
| N-03, N-04, N-06 | P4 | G2 |
| PW-02 | P4 | G2 |
| B-06 | P4 | A3 |
| W-01…W-05 | — | F1 |
| DEC-04 | — | D4 |
