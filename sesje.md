# Analiza logiki podziału sesji (split)

## Przegląd przepływu

### 1. Podział sesji — `execute_session_split` (sessions.rs:1269)
- Oryginalną sesję (i=0) **UPDATE** — skraca `end_time`, zmienia `project_id`, ustawia `split_source_session_id = session_id`
- Pozostałe części (i>0) **INSERT** — nowe sesje z nowymi `start_time`/`end_time`, swoim `project_id`, `split_source_session_id = original_id`
- Side-effects (`apply_split_side_effects`):
  - Reassignuje `file_activities.project_id` na podstawie midpointu aktywności vs segmenty splitu
  - Tworzy rekordy w `assignment_feedback`
  - Tworzy `session_manual_overrides` (upsert) dla każdego segmentu

### 2. Dane wejściowe do splitu
- **MultiSplitSessionModal**: użytkownik definiuje `SplitPart[]` = `{project_id, ratio}`
- **buildAutoSplits** (BackgroundServices): automatycznie buduje `SplitPart[]` z `analyzeSessionProjects`
- `SplitPart.project_id` **może być `null`** — to jest poprawne

## Zidentyfikowane problemy

### PROBLEM 1: `refresh_today` NADPISUJE czas oryginalnej sesji po splicie
**Krytyczny** — upsert w `import.rs:203-209`:
```sql
INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id)
VALUES (...)
ON CONFLICT(app_id, start_time) DO UPDATE SET
  end_time = excluded.end_time,
  duration_seconds = excluded.duration_seconds,
  is_hidden = sessions.is_hidden
```
Po podziale sesji (np. 8:00-10:00 → 8:00-9:00 + 9:00-10:00):
- Pierwsza część ma **ten sam `start_time`** co oryginał (8:00), ale skrócony `end_time` (9:00)
- Przy następnym `refresh_today` daemon nadpisuje `end_time` z powrotem na 10:00 i `duration_seconds` na pełną wartość
- **Efekt**: pierwsza część splitu wraca do pełnego czasu, ale `project_id` zostaje (bo upsert go nie rusza)
- **Ale**: druga część splitu (9:00-10:00) **nie jest nadpisywana** — ma inny `start_time`, więc upsert nie matchuje
- **Rezultat**: masz teraz sesję 8:00-10:00 z project_id A **PLUS** sesję 9:00-10:00 z project_id B → **duplikacja czasu**

### PROBLEM 2: `project_id` nie jest chroniony w upsert, ale nie jest też nadpisywany
Upsert NIE zawiera `project_id` w `DO UPDATE SET` — to znaczy, że split nie jest nadpisywany pod kątem przypisania projektu. **To jest OK**.

### PROBLEM 3: Auto-split działa tylko na nieprzypisane sesje
`useAutoSplitSessions` (BackgroundServices.tsx:218) filtruje `unassigned: true`. Jeśli sesja ma `project_id` (np. z deterministic assignment), **nie zostanie podzielona** automatycznie, nawet jeśli powinna.

### PROBLEM 4: `rebuild_sessions` może zmergeować splity z powrotem
`rebuild_sessions` (sessions.rs:915) merguje sesje z tym samym `app_id`, `project_id`, i `rate_multiplier`, jeśli gap jest wystarczająco mały. Po splicie każdy fragment ma **inny `project_id`**, więc normalnie nie zostaną zmergeowane. **ALE**: jeśli dwa segmenty splitu trafią do tego samego projektu (np. użytkownik ręcznie zmieni), rebuild może je zmergeować.

### PROBLEM 5: Brak ochrony przed ponownym splitem
`isSessionAlreadySplit` sprawdza `split_source_session_id`, ale **pierwsza część splitu** ma `split_source_session_id = session_id` (self-reference). Nowa sesja (i>0) ma `split_source_session_id = original_id`. Pierwsza część jest poprawnie oznaczona. ✅

## Główna przyczyna "tracenia" projektów po podziale

**Najbardziej prawdopodobny scenariusz**: `refresh_today` nadpisuje `end_time` i `duration_seconds` pierwszej części splitu, przywracając oryginalne wartości. To powoduje:
1. Duplikację czasu (oryginalna sesja wg pliku + fragmenty splitu)
2. Potencjalne zamieszanie w raportach — czas jest podwójnie liczony

**Drugi scenariusz**: jeśli podział następuje na sesji z **dzisiaj**, daemon cyklicznie odpala `refresh_today` (co kilka sekund) → split jest natychmiast "cofany" pod kątem czasu, choć `project_id` zostaje.

## Rekomendacje naprawy

1. **Upsert powinien respektować split**: dodać warunek `WHERE split_source_session_id IS NULL` do upsertu, lub nie aktualizować sesji, która ma `split_source_session_id != NULL`
2. Alternatywnie: w `ON CONFLICT` nie nadpisywać `end_time`/`duration_seconds` jeśli sesja jest już podzielona
3. Rozważyć flagę `is_split` lub wykorzystać istniejący `split_source_session_id` w upsert:
   ```sql
   ON CONFLICT(app_id, start_time) DO UPDATE SET
     end_time = CASE WHEN sessions.split_source_session_id IS NULL THEN excluded.end_time ELSE sessions.end_time END,
     duration_seconds = CASE WHEN sessions.split_source_session_id IS NULL THEN excluded.duration_seconds ELSE sessions.duration_seconds END,
     is_hidden = sessions.is_hidden
   ```

## Pliki kluczowe
- `dashboard/src-tauri/src/commands/sessions.rs` — logika splitu (linie 1269-1383)
- `dashboard/src-tauri/src/commands/import.rs` — upsert sesji (linie 203-216) ← tu jest główny problem
- `dashboard/src/components/sync/BackgroundServices.tsx` — auto-split i refresh loop
- `dashboard/src/components/sessions/MultiSplitSessionModal.tsx` — UI podziału
