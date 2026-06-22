# Audyt TIMEFLOW — jakość kodu i architektura

> Data: 2026-06-23 · Branch: `fix/lan-sync-m24-parity` · Status: **raport (findings only, brak zmian w kodzie)**

**Zakres:** świeży, niezależny audyt jakości + architektury (desktop Tauri v2 + daemon, workspace Cargo + frontend React/TS). Bezpieczeństwo celowo poza zakresem — jest osobny audyt [2026-06-17-tauri-security-audit-remediation.md](2026-06-17-tauri-security-audit-remediation.md).

**Metoda:** 5 równoległych audytorów (backend dashboardu, daemon/sync, frontend, react-doctor/tooling, przekrój build/test/deps), cytaty `plik:linia` weryfikowane na źródłach.

---

## Werdykt

Kodebaza jest **zaskakująco zdyscyplinowana** tam, gdzie to najważniejsze: `main.rs` to czysty passthrough, praca na SQLite konsekwentnie przez `spawn_blocking`, **zero `.unwrap()`/`panic!` w ścieżkach produkcyjnych komend**, warstwa IPC po stronie TS jest wzorowa (jeden typowany wrapper, **0 `any`, 0 `@ts-ignore`**), a **react-doctor = 100/100** (poprawnie skonfigurowane, bramka zielona).

Cały dług koncentruje się w **jednym miejscu: podsystemie sync** — zarazem najbardziej krytycznym dla danych i najgorzej ustrukturyzowanym obszarze, który historycznie powodował utratę danych. Trzy najważniejsze ryzyka:

1. **Silnik merge/tombstony/checksum jest skopiowany (copy-paste) przez granicę crate'ów daemon↔dashboard — z już istniejącą rozbieżnością algorytmu checksumy.**
2. **Content-hash chroni tylko `projects`; pozostałe 4 encje wciąż mają tę samą podatność klasy m24** (dane rozjeżdżają się bez bumpu `updated_at`).
3. **Brak jakiegokolwiek CI** przy częstych bumpach wersji i logice podatnej na utratę danych.

---

## 🔴 Krytyczne / Wysokie — integralność danych i odporność

### 1. Rdzeń sync zduplikowany przez granicę crate'ów (root przyczyn #2–#6)
Logika LWW-merge + tombstony napisana ręcznie **dwa razy**: daemon dla LAN sync (`src/sync_common.rs:362-1190`) i dashboard dla importu/restore z pliku (`dashboard/src-tauri/src/commands/import_data.rs:289-466`). **Oba aktywne** (LAN → daemon; import pliku → dashboard), nie dead code. Ten sam sentinel `manual_sessions project_id=0`, ten sam `splitn(3,'|')`. Korzeń: crate `shared` (`shared/lib.rs`) **nie eksportuje nic z warstwy sync**, a binarki nie mogą się nawzajem importować → kopiuj-wklej zamiast reuse.

### 2. ⚠️ Żywa rozbieżność algorytmu checksumy między dwiema kopiami
`src/lan_common.rs:203-242` liczy SHA-256→128-bit (`{:032x}`), a `dashboard/src-tauri/src/commands/helpers.rs:84-173` — ręczny FNV-1a→64-bit (`{:016x}`). SQL `group_concat` identyczny, ale digest inny algorytmicznie i szerokością. **Komentarz w `helpers.rs:84` twierdzi, że „matches daemon's `lan_common::fnv1a_64`" — funkcja, która nie istnieje.** Dokładnie ta klasa cichej rozbieżności, którą content-hash miał wyeliminować, reintrodukowana przez copy-paste.

### 3. Content-hash chroni tylko `projects` — pozostałe 4 encje wciąż podatne (klasa m24)
`src/lan_common.rs:204-232`: `projects` hashuje pełny zestaw kolumn, ale `clients` (`name|updated_at`), `applications`, `sessions`, `manual_sessions` hashują tylko klucz + `updated_at`. Rozbieżność pola przy równym `updated_at` → peery uznają się za zsynchronizowane **na zawsze**. To ten sam mechanizm, który zgubił przypisania klientów w m24 — naprawiony tylko dla jednej z pięciu encji. Test strażniczy (`sync_common.rs:2353`) pokrywa wyłącznie projects.

### 4. Wątek master LAN-sync bez panic-guard + `panic = "abort"` → panika ubija cały daemon
`src/lan_sync_orchestrator.rs:327-427`: cleanup (`unfreeze`/czyszczenie `sync_in_progress`) działa tylko przy normalnym return; `execute_master_sync` nie jest owinięte w `catch_unwind` (ścieżka online-sync **jest** — `src/lan_server.rs:1237`). Z `panic="abort"` (`Cargo.toml:87`) panika w merge abortuje proces. Komentarz w `:417-418` o „cleanup przy panice" jest nieprawdziwy. Samo-leczy się przy restarcie (stale-lock auto-clear), stąd nie Krytyczne.

### 5. Sprzeczność PRAGMA `foreign_keys` rozjechana między crate'ami
Pula dashboardu wymusza `ON` (`dashboard/src-tauri/src/db/pool.rs:113,124`), a merge/tombstony **wymagają `OFF`** (inaczej `CASCADE` kasuje `manual_sessions` — udokumentowane w pamięci projektu); daemon otwiera z `OFF` (`src/lan_common.rs:185-192`). Czy ścieżka importu-z-pliku w dashboardzie merge'uje z FK w poprawnym stanie — „nieoczywiste i nieasertowane w kodzie". Bezpieczeństwo merge'a opiera się dziś na tym, że każdy wywołujący pamięta ręcznie wynullować FK (`import_data.rs:333-352`, błędy połykane przez `.ok()`).

### 6. Triggery tombstone zmirrorowane w dwóch crate'ach i odtwarzane z kopii daemona przy każdym merge
`src/tombstone_triggers.rs:26-78` vs `dashboard/src-tauri/src/db_migrations/tombstone_triggers.rs:18-81` — ciała znak-w-znak identyczne, oba nagłówki przyznają ręczny mirror. `merge_incoming_data` DROP+CREATE produkcyjnych triggerów **z kopii daemona** przy każdym merge (`sync_common.rs:400-402`); jeśli dashboard bumpnie trigger (jak m21), a mirror daemona się zestarzeje, kolejny LAN-merge cicho zdowngrade'uje trigger w całej bazie.

### 7. Brak CI
Nie ma `.github/workflows/` — nic nie odpala `cargo test`, `npm test`, `eslint`, `tsc` na push/PR. Aplikacja przy wersji 0.1.5737 i logice podatnej na utratę danych polega **wyłącznie na lokalnej dyscyplinie**. To najtańszy do założenia bezpiecznik dla całej reszty findings.

---

## 🟠 Średnie — utrzymywalność i architektura

| # | Obszar | Ustalenie | Plik |
|---|--------|-----------|------|
| 8 | **Model błędów** | `Result<T, String>` wszędzie (668 wystąpień), zero `thiserror`. Frontend nie odróżni not-found / conflict / IO / validation inaczej niż po stringu; refaktor cicho zmienia treść błędu. | cała powierzchnia komend |
| 9 | **God-files** | `sync_common.rs` 3122 linie z funkcją `merge_incoming_data` **846 linii** (`:362-1208`); `projects.rs` 2550, `import_data.rs` 2247, `lan_server.rs` 1905, `online_sync.rs` 1360. Najbardziej bug-ryzykowny kod = najtrudniejszy do review. | jw. |
| 10 | **„5 miejsc na kolumnę" strukturalne** | Lista kolumn każdej encji ręcznie przepisana 4-5× (export SELECT / read-back / UPDATE / INSERT / checksum). Brak `const PROJECT_SYNC_COLUMNS` / `Project::from_row`, choć struct istnieje (`types.rs:21-46`). To dokładny mechanizm utraty przypisań w m24. | export/import/helpers |
| 11 | **Testy: krytyczne luki** | `online_sync.rs` (1360 linii) i `delta_export.rs` — **zero testów**, czyli dziura siedzi na granicy export→merge. (Pozytyw: `sync_common.rs` 30 testów, `import_data.rs` 20, `projects.rs` 22.) Brak jsdom/Testing Library → komponenty i hooki nietestowalne; brak progu coverage; brak `cargo-audit`/`npm audit`. | — |
| 12 | **Frontend: potrójne źródło prawdy w ustawieniach** | Zustand-store (`settings-store.ts:35-47`) + localStorage + `user_settings.json`; persist tylko w formularzu (`useSettingsFormState.ts:132-160`), który ręcznie mirroruje z powrotem do store. Nowe ustawienie skopiowane z `setCurrencyCode` **cicho się nie zapisze** (`setSidebarCollapsed` jako jedyny self-persist → niespójność). | jw. |
| 13 | **Frontend: niespójne raportowanie błędów** | Część kontrolerów toastuje każdy błąd (`useClientsPageController`), inne połykają do konsoli (`useSessionsPageController.ts:150` `.catch(console.error)`). Przypisanie sesji / mutacje dashboardu **cicho znikają** przy flaky sync. | jw. |
| 14 | **Frontend: God-hook zwracający JSX** | `useProjectsPageController.tsx:661-764` — 852 linie, zwraca `renderProjectCard` z ~25 propsami i 24-elementową tablicą zależności. `.tsx` na „kontrolerze" to sygnał zlania prezentacji z logiką. `useJobPool.ts` (459 linii, ~18 refów) orkiestruje 7 schedulerów naraz. | jw. |
| 15 | **react-hooks 7: stłumione, nie naprawione** | 11× `set-state-in-effect` + 3× `preserve-manual-memoization` disabled inline (m.in. `useAiPageController.ts:213`, `useLanSyncManager.ts:93`). Powtarzalny wzorzec „fetch-then-setState w efekcie" → kandydat na `useAsyncData`. | jw. |
| 16 | **Tailwind bez `cn()`** | 46 plików buduje klasy przez template-literal zamiast `cn()` (np. `SessionRow.tsx:58-62`) → omija tailwind-merge, kolizje `text-*`/`bg-*` cicho dają niezdefiniowaną kolejność. Ten footgun już raz ugryzł (pamięć projektu). | jw. |
| 17 | **knip osierocony** | `dashboard/knip.json` istnieje i jest sensownie skonfigurowany, ale `knip` **nie jest zależnością ani nie ma skryptu**. W połączeniu z globalnym wyciszeniem `deslop/unused-export` w react-doctor → **brak jakiejkolwiek bramki na dead code**. | jw. |
| 18 | **`rpc_generated.rs` commitowany, nie generowany w buildzie** | `rpc_generated.rs` generowany przez `scripts/gen_webrpc.cjs`, ale nic go nie regeneruje w `build.rs`/`package.json` (207 zarejestrowanych komend vs 190 `#[tauri::command]`). Dodanie komendy bez ręcznego re-runu → web UI cicho jej nie ma, brak błędu kompilacji. | jw. |
| 19 | **TS bez `noUncheckedIndexedAccess`** | `strict:true` jest, ale brak `noUncheckedIndexedAccess` (największy łapacz realnych bugów poza strict) i `exactOptionalPropertyTypes` — istotne przy intensywnym indeksowaniu wierszy DB. | `tsconfig.app.json` |
| 20 | **Wersje crate'ów daemon/shared rozjechane** | Daemon `0.2.0`, shared `0.1.0`, dashboard `0.1.5737`; `sync-version.cjs` aktualizuje tylko dashboard. `CARGO_PKG_VERSION` używane w version-gate LAN (`PARITY.md`) → zamrożone `0.2.0` może skrzywić porównania wersji. | `Cargo.toml:3` |
| 21 | **Brak `[workspace.dependencies]`** | `serde`/`rusqlite 0.31`/`chrono`/`sha2` redeklarowane w 2-3 crate'ach; wersje dziś zgodne, ale nic tego nie wymusza (bez CI + 3 ręczne manifesty = ryzyko driftu, zwł. `rusqlite` z linkowanym C SQLite). 3 wersje `rustls` współistnieją w locku (0.21/0.22/0.23). | `Cargo.toml` |

---

## 🟡 Niskie — higiena i polish

- **Osierocony drugi `Cargo.lock`** w `dashboard/src-tauri/Cargo.lock` (member workspace → autorytatywny jest tylko root lock; ten nieaktualny, ignorowany przez Cargo).
- **Duże/wrażliwe artefakty w repo:** `projects_list.json` (86 KB — wygląda na zrzut danych użytkownika, potencjalny wyciek nazw projektów), `icons.ai` (735 KB źródło Illustratora). Rozważyć usunięcie z trackingu.
- **Kolizja `claude.md` vs `CLAUDE.md`** na case-insensitive macOS FS + pusty root `TODO.md` + drugi `docs/TODO.md` → fragmentacja.
- **Brak emisji zdarzeń Tauri** — zero `emit`/`Emitter`; postęp sync wyłącznie przez polling (`get_lan_sync_progress`), który sam HTTP-polluje daemona. Idiomatyczny push = events/Channel.
- **Async komendy robią blokujące `std::fs`** bez `spawn_blocking` (np. `lan_sync.rs:95-102`) — niespójne z dyscypliną DB.
- **Niespójne nazewnictwo komend:** `verb_noun` (większość) vs `noun_verb` (`clients_*`, `pm_*`, `webserver_*`).
- **Duplikaty singular/plural komend** (`delete_session`/`delete_sessions` itd.) podwajają powierzchnię IPC.
- **Glob re-exports** (`pub use module::*`) w `commands/mod.rs` — powierzchnia komend nieaudytowalna na pierwszy rzut oka.
- **`ensure_project_merge_columns` połyka nie-duplikatowe błędy ALTER** (`sync_common.rs:310-322`) → merge może ruszyć na schemacie bez kolumn m24.
- **`bundle.targets: "all"`** mimo że cross-compile Windows z macOS jest znany-zepsuty; macOS świadomie niepodpisany (dobrze udokumentowane w PARITY.md).
- **Dług parności Windows** — `platform/windows/*` shippowane niezweryfikowane (blokuje `libsqlite3-sys`); świetnie trackowane, brak tylko Windows CI runnera (kompilacja).

---

## Mocne strony (do zachowania — NIE „naprawiać")

- `main.rs` cienki passthrough; konsekwentny `spawn_blocking` dla DB; brak produkcyjnych unwrap/panic.
- Stan zarządzany przez `app.manage(...)`; każdy `Mutex` lock z `.map_err(|_| "...poisoned")`, żaden lock nie trzymany przez `.await`; statyki globalne minimalne i poprawne (`OnceLock`).
- Merge LAN scentralizowany w daemonie pod `MERGE_MUTEX` + jedna transakcja + transakcyjne DDL; `sync_in_progress` przez atomic CAS — „two-scheduler race" realnie scentralizowany.
- Warstwa IPC frontu wzorowa: jeden typowany wrapper `lib/tauri/core.ts`, brak rozproszonych `invoke`, 0 `any`/`@ts-ignore`.
- react-doctor **100/100** (oba `doctor.config.json` obecne, uruchamiane z roota). Wyciszenia w większości legalne; jedyne ryzykowne to globalne `deslop/unused-export` (patrz #17).
- Profile release dobrze nastrojone (`opt-level="s"`, thin LTO, `codegen-units=1`, strip, per-package override). Wersja dashboardu single-source przez `VERSION` + `build.rs` + `sync-version.cjs`.
- Łańcuch lintów i18n/locale + baseline grandfathering — realny atut.
- `PARITY.md` — szczegółowy, uczciwy tracker długu platformowego.

---

## Rekomendowana kolejność działań

Najwyższa dźwignia to **wydzielenie `shared::sync`** — likwiduje korzeń findings #1–#6 rosnąco wg ryzyka:

1. **Najpierw (near-zero ryzyko):** przenieś stałe SQL triggerów do `shared` → kasuje #6 (stale-trigger). Potem czyste funkcje: **jeden** checksum + `normalize_ts` w `shared` → kasuje #2 (żywa rozbieżność).
2. **Rozszerz content-hash na wszystkie 5 encji** (#3) — najpilniejsze ryzyko utraty danych, najlepiej napędzone wspólną listą kolumn (#10).
3. **Załóż minimalne CI** (#7): `cargo test --workspace` + `npm ci && lint && test && typecheck` na macOS.
4. **Owiń wątek master-sync w `SyncGuard`/`catch_unwind`** (#4) i ujednolić PRAGMA FK przez wspólny `open_sync_connection()` (#5).
5. **Średnioterminowo:** `thiserror` CommandError (#8), rozbicie god-files i god-hooków (#9, #14), `useAsyncData` zamiast 11 wyciszeń (#15), write-through ustawień (#12), wpięcie knip + `noUncheckedIndexedAccess` (#17, #19).

---

## Komendy weryfikacyjne (referencyjnie)

- Frontend: `cd dashboard && npm test && npm run typecheck && npm run lint && npm run build`
- Backend: `cargo test -p timeflow-dashboard && cargo test -p timeflow-demon && cargo test -p timeflow-shared`
- Bramka jakości: `npx -y react-doctor@latest . --verbose` z **roota repo** (oczekiwane 100/100).
