# Plan — pozostałe punkty po sesji 2026-04-24

Uzupełnienie do [`plan_implementacji.md`](./plan_implementacji.md). Zawiera
wszystkie kroki z checkboxem `- [ ]`, które pozostają otwarte po dzisiejszej
sesji, pogrupowane wg typu i rekomendowanej kolejności wykonania.

> **Źródło prawdy:** zawsze sprawdzaj `plan_implementacji.md` — tam `- [x]` vs
> `- [ ]` daje aktualny status. Ten dokument jest migawką pomocniczą.

---

## 1. Zadania implementacyjne — do zrobienia

### 1.1. Task 24 — Merge streaming *(P2, średni ryzyko)*

**Plik:** `src/sync_common.rs:267-290`
**Kroki:**
- [ ] 24.1: Dwie ścieżki do wyboru:
  - **(A)** `serde_json::StreamDeserializer` per-tabela — pełen refactor
    `merge_incoming_data`, ale zachowuje limit 200 MB. Wymaga rozbicia
    payloadu na per-tabela chunki po stronie wysyłającej.
  - **(B)** Obniżenie `MAX_PAYLOAD_SIZE` do 50 MB + delta-only merge —
    szybkie, ale zmienia kontrakt sync (odrzuca duże DB).
- [ ] 24.2: Test — merge 100 MB nie przekracza 200 MB RSS.
- [ ] 24.3: Commit.

**Decyzja potrzebna od usera:** ścieżka A vs B.

---

### 1.2. Task 32.3 — Rozbicie `useSettingsFormState` *(P2, niskie ryzyko)*

**Plik:** `dashboard/src/hooks/useSettingsFormState.ts` (27 KB)
**Kroki:**
- [x] 32.3: Rozbij na `useGeneralSettings`, `useAiSettings`, `useSyncSettings`,
  `useUiSettings` (ewentualnie więcej — patrz faktyczne grupy pól w pliku).
- [x] 32.4: Commit per plik / per logiczna grupa.

**Uwaga:** czysty refactor frontend — bez zmiany API konsumentów. Najlepszy
kandydat do wykonania jako pierwszy (brak decyzji projektowych).

---

### 1.3. Task 36 — macOS tray sync status + attention counter *(P2, duży)*

**Plik:** `src/platform/macos/tray.rs`
**Wzorzec do portu:** `src/platform/windows/tray.rs:170-330`
**Kroki:**
- [ ] 36.1: Skopiuj kontrakt:
  - `update_tray_appearance`
  - `menu_sync_status`
  - `was_syncing` (state tracking)
  - Tooltip z `query_unassigned_attention_count`.
- [ ] 36.2: Aktualizuj `PARITY.md` (wiersz „Tray sync status" → ✅).
- [ ] 36.3: Commit.

**Blocker techniczny:** `tray-icon` crate w macOS ma ograniczoną API do
dynamicznych update'ów menu — trzeba zweryfikować jakie operacje są wspierane.

---

### 1.4. Task 37 — NSWorkspace foreground notifications *(P2, duży)*

**Plik:** `src/platform/macos/foreground.rs:16`
**Kroki:**
- [ ] 37.1: Subskrypcja `NSWorkspace.didActivateApplicationNotification`
  przez NSRunLoop (tray-loop już istnieje, można wpiąć obserwatora tam).
- [ ] 37.2: Usuń polling 250 ms; fallback polling 2 s jako safety net.
- [ ] 37.3: Aktualizuj `PARITY.md` (wiersz „Foreground detection" → ✅).
- [ ] 37.4: Commit.

**Blocker techniczny:** Potrzeba `objc2` / `block2` bindings dla `NSNotification`.
Sprawdź czy `cocoa` / `core-foundation` crates w projekcie wystarczą, czy
trzeba dodać nową zależność.

**Pamiętać o `[HELP]`** — raport oznaczył ten task jako wymagający zmian w
Help.tsx (dokumentacja co-for macOS user widzi).

---

### 1.5. Task 38 — Incremental AI retraining *(P2, duży)*

**Plik:** `dashboard/src-tauri/src/commands/assignment_model/training.rs`
**Kroki:**
- [ ] 38.1: Dodaj kolumnę `last_train_at` w `assignment_model_state` —
  migracja `m23` w `db_migrations/`.
- [ ] 38.2: `retrain_incremental(since: last_train_at)` — UPDATE tylko
  wag (`_app`/`_time`/`_token`) dla feedbacku starszego niż `last_train_at`.
- [ ] 38.3: Zachowaj `retrain_full` jako opcja „Full Rebuild" (drugi
  przycisk w UI).
- [ ] 38.4: Commit.

**Uwaga integracyjna:** Task 38 jest blisko związany z Task 39 (soft/full
reset — już zrobiony). Po resetach `retrain_incremental` powinien zwracać
„nic nowego do wytrenowania" jeśli `last_train_at` jest po resecie.

---

### 1.6. Task 88 — LAN sync roundtrip test *(P5, duży)*

**Plik:** `tests/integration/lan_sync_roundtrip.rs` (do utworzenia)
**Kroki:**
- [ ] 88.1: Test — 2 instancje demona (master + slave) z 2 projektami × 10
  sesji; po round-trip `project_name` == input; weryfikuj regresję m20
  (session project_name nadpisywany przez NULL).
- [ ] 88.2: Commit.

**Blocker infrastrukturalny:** Wymaga spawnowania dwóch procesów demona
albo ekstrakcji `merge_incoming_data` do poziomu library-test. Alternatywa:
test jednostkowy symulujący negotiate→upload→unfreeze w pamięci.

---

## 2. Świadomie odroczone

| Task | Powód | Re-open when |
|---|---|---|
| **64 (P3)** — `platform.ts` `@tauri-apps/plugin-os` | UA fallback wystarcza; dodanie pluginu = npm dep + Cargo dep + lib.rs + capabilities | Potrzebna precyzyjna detekcja platformy (np. feature-flag per-OS) |
| **75 (P4)** — usuń `CpuSnapshot.total_time` | Pole nadal wymagane do delty CPU między pomiarami (macOS `libproc` delta) | Po refaktorze CPU measurement na mechanizm który nie używa delty między snapami |

---

## 3. Testy weryfikacyjne TDD-FAIL (nieblokujące)

Kroki w planie oznaczone jako „uruchom test — oczekiwany FAIL" — to były TDD
checkpointy *przed* implementacją. Ponieważ implementacja już jest
(`- [x]`), te checkpointy są historyczne. Można domknąć jednym passem:
uruchomić aktualną suitę testów, potwierdzić PASS, a następnie zbiorczo
oznaczyć jako `[x]`.

- [ ] 1.2, 2.3, 6.1, 6.2, 9.1, 10.1, 11.1, 12.1 — wszystkie to „oczekiwany FAIL" TDD-checkpointy.
- [ ] Kroki „test end-to-end / unit test" gdzie backing implementacja już istnieje:
  - [ ] 3.3 (skasowanie `total_time`) — **nie wykonywać**, patrz Task 75 (sekcja 2).
  - [ ] 4.4 (`window_title_not_empty` e2e)
  - [ ] 8.4 (INSERT w trakcie merge kolejkowany)
  - [ ] 19.2 (5 min pracy + 25 min idle + 5 min pracy = 2 sesje)

**Rekomendacja:** te testy można napisać jednym subagentem — wszystkie są
krótkie, przeciwko już-istniejącej logice.

---

## 4. Smoki manualne

Wymagają realnego środowiska (Windows + macOS, pair devices, itp.):

- [ ] **1.5** — `/lan/pair` nadal działa po usunięciu secret z `/lan/local-identity`.
- [ ] **5.3** — restart demona via tray czyści online-sync thread.
- [ ] **14.3** — przełączenie locale na EN w sessions context menu.
- [ ] **17.2** — `LanguageChange` signal w tray macOS (podłączenie do przełącznika PL/EN).
- [ ] **17.3** — tray po EN/PL po zmianie config.

**Rekomendacja:** zrobić razem w jednej sesji QA przed release.

---

## 5. Kryteria ukończenia (meta)

Z planu (sekcja *Kryteria ukończenia*):

- [ ] Wszystkie testy jednostkowe i integracyjne PASS (`cargo test --all`, `npm test`).
- [ ] `cargo clippy -- -D warnings` na demon i Tauri.
- [ ] `npm run lint` i `npm run typecheck` na dashboard.
- [ ] Manualny smoke-test per platforma (Windows 11 + macOS 14+):
  - Uruchomienie → tray widoczny + i18n poprawne.
  - Kilka sesji → `window_title` (macOS post-Task 4).
  - LAN sync master ↔ slave — 2 maszyny, `project_name` zachowane.
  - AI breakdown — popover pokazuje Layer scores.
  - Help.tsx — wszystkie nowe sekcje widoczne w PL i EN.
- [x] `PARITY.md` zaktualizowany (Task 91).
- [x] CHANGELOG wpisany (Task 92).
- [ ] PR otwarty z linkiem do `raport.md` w opisie (traceability per task).

---

## 6. Rekomendowana kolejność po dzisiejszej sesji

Sprint porządkowy (≈1 dzień):
1. **Task 32.3** — useSettingsFormState split (czysty refactor, 0 decyzji).
2. **Testy TDD-FAIL** (sekcja 3) — dogonienie zaległych testów jednostkowych.
3. **Task 38** — incremental AI retraining (wartość dla użytkownika, wyraźny kontrakt).

Sprint macOS parity (≈1–2 dni):
4. **Task 37** — NSWorkspace foreground (usuwa CPU hog z polling 250ms).
5. **Task 36** — tray sync status (parity z Windows).

Sprint sync / release (≈1 dzień):
6. **Task 24** — merge streaming (decyzja A/B najpierw).
7. **Task 88** — integracyjny roundtrip test.
8. Smoki manualne (sekcja 4) + kryteria ukończenia (sekcja 5) + PR.

---

## 7. Co zrobione w sesji 2026-04-24

Kontekst dla następnej sesji — 16 tasków zamkniętych, 11 commitów na
branchu `codex`:

- **P1:** Task 8.2 (MERGE_MUTEX wpięty w `merge_incoming_data`).
- **P2:** 41 (auto-safe batch), 40 (feedback_weight w statusie), 18
  (DailyStore), 21 (title_parser.rs), 39 (soft/full reset AI), 27
  (run_db_blocking), 25 (upload progress callback), 19 (idle split
  sesji).
- **P3:** 64 (świadomie pominięte).
- **P4:** 82 (dev artefakty).
- **P5:** 92 (CHANGELOG), 91 (PARITY.md), 93 (SECURITY_AUDIT.md), 90
  (ESLint rule no-zustand-full-destructure), 89 (fresh DB test).

Wszystkie buildy i 29 testów demon przechodzą; TypeScript typecheck
dashboard czysty.
