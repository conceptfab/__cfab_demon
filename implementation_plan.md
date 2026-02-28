# Plan implementacji poprawek TIMEFLOW

Na podstawie [raport.md](./raport.md)

## Status wdrożenia (2026-02-28)

### Zrealizowane

- [x] AI: `evidence_factor` przy `min_evidence_auto=3` jest skalowany przez `/3.0`.
- [x] AI: tokenizacja dopuszcza tokeny o długości `>= 2`.
- [x] AI: rozszerzono reinforcement o realne źródła manualnego feedbacku:
  - `manual_session_assign`
  - `manual_session_change`
  - `manual_project_card_change`
  - `manual_session_unassign`
  - `bulk_unassign`
  - `manual_app_assign`
  - `ai_suggestion_reject`
  - `ai_suggestion_accept`
- [x] AI: sugestie i score breakdown filtrują projekty nieaktywne (`excluded_at` / `frozen_at`) we wszystkich warstwach (L0-L3).
- [x] AI: retraining nie używa jako danych bazowych sesji, których ostatni feedback to `auto_accept` (ograniczenie self-reinforcement).
- [x] AI: `auto_safe` nie inkrementuje `feedback_since_train` po auto-przypisaniach.
- [x] Testy Tauri: naprawiono drift fixture schema (`projects.excluded_at`, `manual_sessions.title`, `sessions.rate_multiplier`, `sessions.comment`).
- [x] UI cleanup: usunięto duplikat `dashboard/src/pages/Projects.tsx (fixing imports)`.
- [x] UI EN strings z fazy 2 są obecne w kodzie (`Sessions`, `Projects`, `prompt-modal`, `ProjectContextMenu`).
- [x] Manual override: priorytet `session_id` + migracja schematu i fallback legacy.
- [x] AI suggestions: batch processing w `get_sessions` (jedno połączenie i zbiorczy lookup nazw projektów).
- [x] Sessions UI: usunięto preload breakdown dla wszystkich sesji, przejście na lazy load on demand.
- [x] Refresh/sync: wprowadzono throttling `triggerRefresh` (250ms) dla redukcji lawinowych refetchy.
- [x] Wykresy: odciążenie `TimelineChart` dla dużych datasetów (prostsze ticki, wyłączone animacje/shape overlay przy wysokiej złożoności).
- [x] Dashboard i ProjectPage: wyłączono AI suggestions tam, gdzie nie są potrzebne (`includeAiSuggestions: false`).
- [x] Time Analysis: naprawiono regresję znikającego wykresu kołowego we wszystkich trybach (daily/weekly/monthly) przez oparcie danych pie chart o `get_project_timeline` + agregację frontendową (bez zależności od `get_top_projects`).
- [x] Time Analysis / backend: rozszerzono parser timestampów (`analysis.rs`) o legacy formaty (`YYYY-MM-DD HH:mm[:ss][.fraction]`) dla pełniejszej kompatybilności danych historycznych i stabilniejszych agregacji wykresów.

### W trakcie / do decyzji

- [ ] Full i18n całego UI (poza Help/QuickStart) jako osobny etap migracji kluczy.

### Niezrealizowane (zostawione celowo na oddzielny etap)

- [ ] Refaktoryzacja modułowa `assignment_model.rs` (podział na `training/inference/auto_safe/...`).
- [ ] Refaktoryzacja modułowa `online-sync.ts`.
- [ ] Refaktor `tracker.rs` (deduplikacja `file_index_cache` helperem).

---

## Faza 1 — Naprawa logiki AI (krytyczne)

### [MODIFY] [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs)

**1A. Fix confidence math** (linia 352)

Zmiana `evidence_factor` z `/4.0` na `/3.0`, aby przy `min_evidence_auto=3` faktor wynosił 1.0 zamiast 0.75:

```diff
-let evidence_factor = ((evidence_count as f64) / 4.0).min(1.0);
+let evidence_factor = ((evidence_count as f64) / 3.0).min(1.0);
```

**1B. Nie inkrementuj feedback dla deterministic** (linia 1165)

Usunięcie [increment_feedback_counter](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#152-162) z [apply_deterministic_assignment()](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#1043-1188) — automatyczne przypisania nie powinny liczyć się jako korekty użytkownika:

```diff
             // Record feedback for ML training
             tx.execute(
                 "INSERT INTO assignment_feedback (...)...",
                 ...
             ).map_err(|e| e.to_string())?;
-            increment_feedback_counter(&tx);
```

**1C. Nie inkrementuj feedback per-sesja w auto_safe** (linia 862)

Zmiana: zamiast [increment_feedback_counter](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs#152-162) per sesja, jeden increment per run:

```diff
 // W pętli for session_id in session_ids:
-            increment_feedback_counter(&tx);
 // Po pętli, przed tx.commit():
+if result.assigned > 0 {
+    increment_feedback_counter(&tx);
+}
```

**1D. Min token length 2→2** (linia 169)

Zmiana filtra tokenizera żeby nie gubić [ui](file:///c:/_cloud/__cfab_demon/__client/src/single_instance.rs#30-56), `ux`, `3d`:

```diff
-.filter(|t| t.len() > 2 && t.chars().any(|c| c.is_alphabetic()))
+.filter(|t| t.len() >= 2 && t.chars().any(|c| c.is_alphabetic()))
```

---

## Faza 2 — Tłumaczenia UI (PL → EN)

### [MODIFY] [Sessions.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Sessions.tsx)
- L892: `"Brak powiazanej karty projektu"` → `"No linked project card"`
- L892: `"Przejdz do karty projektu"` → `"Go to project card"`

### [MODIFY] [Projects.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Projects.tsx)
- L1161: `title="Zapisz widok jako domyślny"` → `title="Save view as default"`

### [MODIFY] [prompt-modal.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/components/ui/prompt-modal.tsx)
- L31: `cancelLabel = "Anuluj"` → `cancelLabel = "Cancel"`

### [MODIFY] [ProjectContextMenu.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/components/project/ProjectContextMenu.tsx)
- L118: `"Przejdz do karty projektu"` → `"Go to project card"`

---

## Faza 3 — Czyszczenie nadmiarowego kodu

### [DELETE] pliki debug/test/migracyjne

- [dashboard/debug.js](file:///c:/_cloud/__cfab_demon/__client/dashboard/debug.js)
- [dashboard/debug2.js](file:///c:/_cloud/__cfab_demon/__client/dashboard/debug2.js)
- [dashboard/fix_dash.js](file:///c:/_cloud/__cfab_demon/__client/dashboard/fix_dash.js)
- [dashboard/test_dates.py](file:///c:/_cloud/__cfab_demon/__client/dashboard/test_dates.py)
- [dashboard/test_db.js](file:///c:/_cloud/__cfab_demon/__client/dashboard/test_db.js)
- [dashboard/update_filter.py](file:///c:/_cloud/__cfab_demon/__client/dashboard/update_filter.py)
- [dashboard/update_sessions.py](file:///c:/_cloud/__cfab_demon/__client/dashboard/update_sessions.py)
- [dashboard/update_sessions_ts.py](file:///c:/_cloud/__cfab_demon/__client/dashboard/update_sessions_ts.py)
- [dashboard/src/pages/Projects.tsx (fixing imports)](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/pages/Projects.tsx%20%28fixing%20imports%29) — plik-duplikat z spacją w nazwie

---

## Faza 4 — Drobne poprawki logiki

### [MODIFY] [App.tsx](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/App.tsx)

Hardcoded date range `"2020-01-01"` → `"2000-01-01"` (L216), aby nie tracić danych sprzed 2020:

```diff
-const detected = await autoCreateProjectsFromDetection(
-  { start: "2020-01-01", end: "2100-01-01" },
+const detected = await autoCreateProjectsFromDetection(
+  { start: "2000-01-01", end: "2100-01-01" },
```

### [MODIFY] [online-sync.ts](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/online-sync.ts)

Usunięcie re-mappingu nowego URL na legacy (L205-208) — blokuje migrację:

```diff
-if (normalized === PLACEHOLDER_TIMEFLOW_ONLINE_SYNC_SERVER_URL) {
-  return LEGACY_DEFAULT_ONLINE_SYNC_SERVER_URL;
-}
+// Legacy remap removed — TIMEFLOW server is now primary.
```

### [MODIFY] [tracker.rs](file:///c:/_cloud/__cfab_demon/__client/src/tracker.rs)

Duplikacja `file_index_cache` rebuild (L182-187 vs L216-221) → wyciągnąć do helpera:

```diff
+fn rebuild_file_index_cache(daily_data: &storage::DailyData) -> HashMap<String, HashMap<String, usize>> {
+    let mut cache = HashMap::new();
+    for (exe_name, app_data) in &daily_data.apps {
+        let file_map = cache.entry(exe_name.clone()).or_insert_with(HashMap::new);
+        for (idx, file_entry) in app_data.files.iter().enumerate() {
+            file_map.insert(file_entry.name.clone(), idx);
+        }
+    }
+    cache
+}
```

---

## Faza 5 — Modularyzacja (opcjonalna, do oddzielnego PR)

> [!NOTE]
> Ta faza jest **opcjonalna** i powinna być realizowana jako osobny PR. Wymaga więcej czasu, ale przygotowuje projekt na rozwój.

### Podział [assignment_model.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/assignment_model.rs) (1213 linii → 5 plików)

```
commands/assignment/
├── mod.rs              – re-eksporty #[command] fn
├── types.rs            – structs, state helpers
├── training.rs         – train_assignment_model
├── inference.rs        – compute_raw_suggestion, suggest_project_for_session
├── auto_safe.rs        – run/rollback/auto_run_if_needed
└── deterministic.rs    – apply_deterministic_assignment
```

### Podział [online-sync.ts](file:///c:/_cloud/__cfab_demon/__client/dashboard/src/lib/online-sync.ts) (1470 linii → 5 plików)

```
lib/sync/
├── index.ts            – re-eksporty publicznego API
├── settings.ts         – load/save settings, normalizacja
├── state.ts            – sync state, scoped storage
├── indicator.ts        – snapshot, listeners
└── engine.ts           – runOnlineSyncOnce + helpers
```

---

## Verification Plan

### Automated Tests

**Rust backend** — istniejące testy:
```bash
cd c:\_cloud\__cfab_demon\__client\dashboard\src-tauri
cargo test
```
Pokrywa testy w [projects.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/projects.rs), [import_data.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/import_data.rs), [estimates.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/estimates.rs), [dashboard.rs](file:///c:/_cloud/__cfab_demon/__client/dashboard/src-tauri/src/commands/dashboard.rs), [monitor.rs](file:///c:/_cloud/__cfab_demon/__client/src/monitor.rs).

**Daemon:**
```bash
cd c:\_cloud\__cfab_demon\__client
cargo test
```
Pokrywa testy [extract_file_from_title](file:///c:/_cloud/__cfab_demon/__client/src/monitor.rs#183-223) w [monitor.rs](file:///c:/_cloud/__cfab_demon/__client/src/monitor.rs).

**Frontend build check:**
```bash
cd c:\_cloud\__cfab_demon\__client\dashboard
npx tsc --noEmit
```

### Manual Verification

> [!IMPORTANT]
> Proszę o informację: czy masz gotowy sposób uruchomienia dashboardu do manualnych testów (np. `npm run dev` + daemon)?
> Jeśli tak, mogę dodać krok weryfikacji AI sugestii na żywo w przeglądarce.

1. **Tłumaczenia**: po uruchomieniu dashboardu sprawdzić:
   - Sessions → prawy klik na sesję → tekst po angielsku
   - Projects → przycisk zapisu widoku → tooltip "Save view as default"
   - Dowolny prompt-modal → przycisk "Cancel"

2. **AI**: w zakładce AI & Model:
   - Status powinien nadal się poprawnie ładować
   - Train Now powinien nadal działać
   - Weryfikacja, że confidence przy 3 evidence = ~1.0 × sigmoid(margin) (zamiast ~0.75 × sigmoid(margin))
