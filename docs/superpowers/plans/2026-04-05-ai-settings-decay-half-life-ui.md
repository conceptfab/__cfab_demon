# AI Settings — Decay Half-Life UI + Save Flow Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the `decay_half_life_days` setting in the AI page UI and fix the existing bug where `trainingHorizonDays` and `feedbackWeight` are displayed but never saved to the backend.

**Architecture:** The backend already reads `decay_half_life_days` from `assignment_model_state` (config.rs:12, training.rs:64-65). We need: (1) a Tauri command to set it, (2) expose it in `AssignmentModelStatus`, (3) add a slider to `AiSettingsForm`, (4) fix `handleSaveMode` to actually call all three save APIs. No new tables/migrations needed.

**Tech Stack:** Rust (Tauri), TypeScript (React), i18n (JSON)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `dashboard/src-tauri/src/commands/assignment_model/mod.rs` | Modify | Add `decay_half_life_days` to `AssignmentModelStatus` struct + new `set_decay_half_life_days` command |
| `dashboard/src/lib/db-types.ts` | Modify | Add `decay_half_life_days` to `AssignmentModelStatus` interface |
| `dashboard/src/lib/tauri/ai.ts` | Modify | Add `setDecayHalfLifeDays()` API function |
| `dashboard/src/components/ai/AiSettingsForm.tsx` | Modify | Add `decayHalfLifeDays` field + slider |
| `dashboard/src/pages/AI.tsx` | Modify | Add `decayHalfLifeDays` state + fix `handleSaveMode` to call all save APIs |
| `dashboard/src/locales/en/common.json` | Modify | Add i18n keys for decay half-life |
| `dashboard/src/locales/pl/common.json` | Modify | Add i18n keys for decay half-life |
| `dashboard/src/pages/Help.tsx` | Modify | Add decay half-life description to AI settings help |

---

## Task 1: Backend — expose decay_half_life_days in status + add set command

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/mod.rs`

- [ ] **Step 1: Add `decay_half_life_days` field to `AssignmentModelStatus` struct**

In `mod.rs`, find the `AssignmentModelStatus` struct (line 27-46). Add the new field after `training_horizon_days`:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct AssignmentModelStatus {
    pub mode: String,
    pub min_confidence_suggest: f64,
    pub min_confidence_auto: f64,
    pub min_evidence_auto: i64,
    pub training_horizon_days: i64,
    pub decay_half_life_days: i64,               // ← NEW
    pub training_app_blacklist: Vec<String>,
    pub training_folder_blacklist: Vec<String>,
    pub last_train_at: Option<String>,
    pub feedback_since_train: i64,
    pub is_training: bool,
    pub last_train_duration_ms: Option<i64>,
    pub last_train_samples: Option<i64>,
    pub train_error_last: Option<String>,
    pub cooldown_until: Option<String>,
    pub last_auto_run_at: Option<String>,
    pub last_auto_assigned_count: i64,
    pub last_auto_rolled_back_at: Option<String>,
    pub can_rollback_last_auto_run: bool,
}
```

- [ ] **Step 2: Populate `decay_half_life_days` in `get_assignment_model_status`**

In `get_assignment_model_status` (line 154), after the `training_horizon_days` computation (lines 157-165), add:

```rust
        let decay_half_life_days = clamp_i64(
            parse_state_i64(&state, "decay_half_life_days", DEFAULT_DECAY_HALF_LIFE_DAYS),
            MIN_DECAY_HALF_LIFE_DAYS,
            MAX_DECAY_HALF_LIFE_DAYS,
        );
```

Then add the field to the `AssignmentModelStatus` construction (line 175), after `training_horizon_days`:

```rust
            training_horizon_days,
            decay_half_life_days,
```

- [ ] **Step 3: Add `set_decay_half_life_days` Tauri command**

After the existing `set_training_horizon_days` command (lines 512-523), add:

```rust
#[command]
pub async fn set_decay_half_life_days(
    app: AppHandle,
    days: i64,
) -> Result<AssignmentModelStatus, String> {
    run_db_blocking(app.clone(), move |conn| {
        let clamped_days = clamp_i64(days, MIN_DECAY_HALF_LIFE_DAYS, MAX_DECAY_HALF_LIFE_DAYS);
        upsert_state(conn, "decay_half_life_days", &clamped_days.to_string())
    })
    .await?;
    get_assignment_model_status(app).await
}
```

- [ ] **Step 4: Register the new command in Tauri**

Find the Tauri command registration (likely in `main.rs` or `lib.rs` — search for `set_training_horizon_days` in the `.invoke_handler(tauri::generate_handler![...])` call). Add `set_decay_half_life_days` next to `set_training_horizon_days`.

- [ ] **Step 5: Build and verify**

Run: `cd dashboard/src-tauri && cargo check 2>&1 | tail -10`
Expected: Successful compilation (warnings OK, no errors).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/mod.rs dashboard/src-tauri/src/main.rs
git commit -m "feat(ai): expose decay_half_life_days in status + add set command"
```

---

## Task 2: Frontend types + API function

**Files:**
- Modify: `dashboard/src/lib/db-types.ts`
- Modify: `dashboard/src/lib/tauri/ai.ts`

- [ ] **Step 1: Add `decay_half_life_days` to TypeScript `AssignmentModelStatus`**

In `dashboard/src/lib/db-types.ts`, find the `AssignmentModelStatus` interface (line 89-108). Add after `training_horizon_days`:

```typescript
export interface AssignmentModelStatus {
  mode: AssignmentMode;
  min_confidence_suggest: number;
  min_confidence_auto: number;
  min_evidence_auto: number;
  training_horizon_days: number;
  decay_half_life_days: number;           // ← NEW
  training_app_blacklist: string[];
  training_folder_blacklist: string[];
  last_train_at: string | null;
  feedback_since_train: number;
  is_training: boolean;
  last_train_duration_ms: number | null;
  last_train_samples: number | null;
  train_error_last: string | null;
  cooldown_until: string | null;
  last_auto_run_at: string | null;
  last_auto_assigned_count: number;
  last_auto_rolled_back_at: string | null;
  can_rollback_last_auto_run: boolean;
}
```

- [ ] **Step 2: Add `setDecayHalfLifeDays` API function**

In `dashboard/src/lib/tauri/ai.ts`, after `setTrainingHorizonDays` (line 36-39), add:

```typescript
export const setDecayHalfLifeDays = (days: number) =>
  invokeMutation<AssignmentModelStatus>('set_decay_half_life_days', { days });
```

Then add it to the `aiApi` object (line 89-104):

```typescript
export const aiApi = {
  getAssignmentModelStatus,
  getAssignmentModelMetrics,
  setAssignmentMode,
  setAssignmentModelCooldown,
  setTrainingHorizonDays,
  setDecayHalfLifeDays,                   // ← NEW
  setTrainingBlacklists,
  resetAssignmentModelKnowledge,
  trainAssignmentModel,
  runAutoSafeAssignment,
  rollbackLastAutoSafeRun,
  autoRunIfNeeded,
  applyDeterministicAssignment,
  getFeedbackWeight,
  setFeedbackWeight,
} as const;
```

- [ ] **Step 3: TypeScript check**

Run: `cd dashboard && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/db-types.ts dashboard/src/lib/tauri/ai.ts
git commit -m "feat(ai): add decay_half_life_days to TS types and API"
```

---

## Task 3: i18n — add translation keys

**Files:**
- Modify: `dashboard/src/locales/en/common.json`
- Modify: `dashboard/src/locales/pl/common.json`

- [ ] **Step 1: Add English i18n keys**

In `dashboard/src/locales/en/common.json`, in the `ai_page.text` section (near line 504-506), add after `training_horizon_days`:

```json
"decay_half_life_days": "Decay half-life (days)",
"decay_half_life_description": "How quickly old data loses influence. Shorter = model adapts faster to workflow changes. Default: 90 days.",
```

- [ ] **Step 2: Add Polish i18n keys**

In `dashboard/src/locales/pl/common.json`, in the same section, add after `training_horizon_days`:

```json
"decay_half_life_days": "Okres połowicznego zaniku (dni)",
"decay_half_life_description": "Jak szybko stare dane tracą wpływ. Krócej = model szybciej adaptuje się do zmian. Domyślnie: 90 dni.",
```

- [ ] **Step 3: Add Help page i18n keys**

In both locale files, in the `help_page` section (near where `training_horizon_set_how_many_days_of_history` is), add:

English (`en/common.json`):
```json
"decay_half_life_controls_how_quickly_old_training_data": "Decay half-life: controls how quickly old training data loses influence on the model. At 90 days (default), data from 90 days ago contributes half as much as today's data. Lower values (14-60) make the model adapt faster to workflow changes; higher values (180-365) give more stable predictions but react slower.",
```

Polish (`pl/common.json`):
```json
"decay_half_life_controls_how_quickly_old_training_data": "Okres połowicznego zaniku: określa, jak szybko stare dane treningowe tracą wpływ na model. Przy 90 dniach (domyślnie) dane sprzed 90 dni mają połowę wagi dzisiejszych danych. Niższe wartości (14-60) sprawiają, że model szybciej adaptuje się do zmian; wyższe (180-365) dają stabilniejsze predykcje, ale wolniej reagują.",
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/locales/en/common.json dashboard/src/locales/pl/common.json
git commit -m "feat(ai): add i18n keys for decay half-life setting"
```

---

## Task 4: AiSettingsForm — add decay half-life slider

**Files:**
- Modify: `dashboard/src/components/ai/AiSettingsForm.tsx`

- [ ] **Step 1: Add `decayHalfLifeDays` to form values interface**

In `AiSettingsForm.tsx` (line 7-14), add the new field:

```typescript
export interface AiSettingsFormValues {
  mode: AssignmentMode;
  suggestConf: number;
  autoConf: number;
  autoEvidence: number;
  trainingHorizonDays: number;
  decayHalfLifeDays: number;              // ← NEW
  feedbackWeight: number;
}
```

- [ ] **Step 2: Add slider for decay half-life**

After the training horizon slider (line 111-134), add a new slider with identical structure. Insert before the `feedbackWeight` input (line 136):

```tsx
          <label className="space-y-1.5 text-sm md:col-span-2">
            <span className="text-xs text-muted-foreground">
              {tr('ai_page.text.decay_half_life_days')}
            </span>
            <p className="text-[11px] text-muted-foreground/70">
              {tr('ai_page.text.decay_half_life_description')}
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={14}
                max={365}
                step={1}
                className="h-9 w-full"
                value={values.decayHalfLifeDays}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  onChange({
                    decayHalfLifeDays: Number.isNaN(next) ? 90 : next,
                  });
                }}
              />
              <span className="min-w-[5rem] text-right text-xs text-muted-foreground">
                {values.decayHalfLifeDays} {tr('ai_page.text.days')}
              </span>
            </div>
          </label>
```

- [ ] **Step 3: TypeScript check**

Run: `cd dashboard && npx tsc --noEmit 2>&1 | tail -10`
Expected: Errors about missing `decayHalfLifeDays` in AI.tsx (expected — will fix in Task 5).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/ai/AiSettingsForm.tsx
git commit -m "feat(ai): add decay half-life slider to AiSettingsForm"
```

---

## Task 5: AI.tsx — wire up state + fix save flow

**Problem:** Current `handleSaveMode` calls `aiApi.setAssignmentMode()` but **never** calls `aiApi.setTrainingHorizonDays()` or `aiApi.setFeedbackWeight()`, so those fields are display-only. This task fixes that and adds `decayHalfLifeDays`.

**Files:**
- Modify: `dashboard/src/pages/AI.tsx`

- [ ] **Step 1: Add `decayHalfLifeDays` state**

After line 143 (`const [trainingHorizonDays, setTrainingHorizonDays] = ...`), add:

```typescript
  const [decayHalfLifeDays, setDecayHalfLifeDays] = useState<number>(90);
```

- [ ] **Step 2: Sync decay from status**

In `syncFormWithStatus` (line 153-164), add after `setTrainingHorizonDays`:

```typescript
        setDecayHalfLifeDays(nextStatus.decay_half_life_days);
```

- [ ] **Step 3: Handle onChange for decay**

In `handleSettingsChange` (line 182-194), add inside the callback:

```typescript
      if (patch.decayHalfLifeDays !== undefined) {
        setDecayHalfLifeDays(patch.decayHalfLifeDays);
      }
```

- [ ] **Step 4: Add `decayHalfLifeDays` to `settingsFormValues` memo**

In `settingsFormValues` (line 196-213), add:

```typescript
  const settingsFormValues = useMemo<AiSettingsFormValues>(
    () => ({
      mode,
      suggestConf,
      autoConf,
      autoEvidence,
      trainingHorizonDays,
      decayHalfLifeDays,                  // ← NEW
      feedbackWeight,
    }),
    [
      mode,
      suggestConf,
      autoConf,
      autoEvidence,
      trainingHorizonDays,
      decayHalfLifeDays,                  // ← NEW
      feedbackWeight,
    ],
  );
```

- [ ] **Step 5: Fix `handleSaveMode` to call all save APIs**

Replace the current `handleSaveMode` (lines 308-337) with:

```typescript
  const handleSaveMode = async () => {
    setSavingMode(true);
    try {
      const normalizedSuggest = clampNumber(suggestConf, 0, 1);
      const normalizedAuto = clampNumber(autoConf, 0, 1);
      const normalizedEvidence = Math.round(clampNumber(autoEvidence, 1, 50));

      await Promise.all([
        aiApi.setAssignmentMode(
          mode,
          normalizedSuggest,
          normalizedAuto,
          normalizedEvidence,
        ),
        aiApi.setTrainingHorizonDays(trainingHorizonDays),
        aiApi.setDecayHalfLifeDays(decayHalfLifeDays),
        aiApi.setFeedbackWeight(feedbackWeight),
      ]);

      await refreshAiStatus();
      const freshStatus = useBackgroundStatusStore.getState().aiStatus;
      if (freshStatus) {
        syncFormWithStatus(freshStatus, true);
      }
      const freshFw = await aiApi.getFeedbackWeight();
      setFeedbackWeight(freshFw);
      dirtyRef.current = false;
      await fetchMetrics(true);
    } catch (e) {
      console.error(e);
      showError(
        tr('ai_page.text.failed_to_save_model_settings') + ` ${String(e)}`,
      );
    } finally {
      setSavingMode(false);
    }
  };
```

Key changes:
1. Added `aiApi.setTrainingHorizonDays(trainingHorizonDays)` — **BUG FIX**
2. Added `aiApi.setDecayHalfLifeDays(decayHalfLifeDays)` — **NEW**
3. Added `aiApi.setFeedbackWeight(feedbackWeight)` — **BUG FIX**
4. Added `dirtyRef.current = false` after successful save
5. Uses `Promise.all` for parallel save calls

- [ ] **Step 6: TypeScript check**

Run: `cd dashboard && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/pages/AI.tsx
git commit -m "feat(ai): wire decay_half_life_days + fix save flow for horizon & feedbackWeight

handleSaveMode now calls setTrainingHorizonDays, setDecayHalfLifeDays,
and setFeedbackWeight which were previously display-only (never saved)."
```

---

## Task 6: Help.tsx — document decay half-life

**Files:**
- Modify: `dashboard/src/pages/Help.tsx`

- [ ] **Step 1: Add decay half-life to AI settings help section**

In `Help.tsx`, find the line referencing `training_horizon_set_how_many_days_of_history` (line 540). Add a new entry after it:

```tsx
                  t18n('help_page.decay_half_life_controls_how_quickly_old_training_data'),
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Help.tsx
git commit -m "docs: add decay half-life description to Help page"
```

---

## Final Verification

- [ ] **Step 1: Full TypeScript check**

Run: `cd dashboard && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors.

- [ ] **Step 2: Rust build**

Run: `cd dashboard/src-tauri && cargo check 2>&1 | tail -10`
Expected: No errors.

- [ ] **Step 3: Manual test scenario**

1. Open TIMEFLOW dashboard → AI page
2. Verify new "Decay half-life (days)" slider appears between Training horizon and Feedback Weight
3. Move slider to 60 days → click Save
4. Refresh page → verify value persisted at 60
5. Also verify Training horizon and Feedback Weight persist after save (previously broken)

---

## Summary of Changes

| Task | Files | Type | Impact |
|------|-------|------|--------|
| 1. Backend command | `mod.rs` | New feature | Expose + set decay_half_life_days |
| 2. TS types + API | `db-types.ts`, `ai.ts` | New feature | Frontend can read/write decay |
| 3. i18n | `en/common.json`, `pl/common.json` | i18n | PL + EN translations |
| 4. Form slider | `AiSettingsForm.tsx` | UI | Slider 14-365 days |
| 5. AI.tsx wiring | `AI.tsx` | **Bug fix** + feature | Save actually calls all APIs |
| 6. Help docs | `Help.tsx` | Docs | User documentation |
