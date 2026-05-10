# TIMEFLOW Dashboard — Plan poprawek po audycie react-doctor

> **Dla agentów:** WYMAGANY SUB-SKILL: użyj `superpowers:subagent-driven-development` (zalecane) lub `superpowers:executing-plans` do realizacji zadań krok po kroku. Wszystkie kroki używają składni `- [ ]`.

**Cel:** Podnieść wynik react-doctor z **70/100** do **≥ 85/100** poprzez fazową redukcję 988 warningów w `dashboard/`. Brak błędów krytycznych — wyłącznie warningi.

**Architektura:** Faza per kategoria reguł, od najtańszych do najdroższych. Po każdej fazie: typecheck + lint + test + react-doctor regression check + commit. Brak nowych zależności. Zero zmian funkcjonalnych.

**Stack:** React 19.2, Vite, TypeScript, Tailwind v4, Tauri 2.x, Vitest, ESLint.

**Working directory:** `dashboard/` (wszystkie ścieżki w planie są względne wobec tego katalogu).

**Komendy weryfikujące (po każdej fazie):**
```bash
cd dashboard
npx tsc -b
npm run lint
npm run test
cd .. && npx -y react-doctor@latest . --score
```

**Uwaga o Tauri:** projekt jest aplikacją desktop (Tauri + Vite, bez SSR). Reguła `rendering-hydration-mismatch-time` (21 wystąpień) jest fałszywym alarmem — pomijamy ją lub dokumentujemy w `.react-doctor-ignore` w fazie 11.

---

## Faza 0 — Baseline i przygotowanie

### Task 0.1: Snapshot wyjściowy

**Files:** brak zmian

- [ ] **Step 1: Zapisz baseline score**

```bash
cd /Users/micz/__DEV__/__cfab_demon
npx -y react-doctor@latest . --score > /tmp/react-doctor-baseline.txt
cat /tmp/react-doctor-baseline.txt
```

Expected: `70`

- [ ] **Step 2: Upewnij się że czyste drzewo robocze**

```bash
git status
```

Expected: `nothing to commit, working tree clean` (poza `raport.md` i `plan_poprawek.md`).

- [ ] **Step 3: Utwórz branch roboczy**

```bash
git checkout -b chore/react-doctor-cleanup
```

---

## Faza 1 — Tailwind shorthand (445 issues, mechaniczne)

**Reguły:** `design-no-redundant-size-axes` (439), `design-no-redundant-padding-axes` (6).
**Zysk:** ~45% wszystkich warningów. Zero ryzyka regresji wizualnej (Tailwind v4 generuje identyczny CSS dla `size-N` i `w-N h-N`).

### Task 1.1: Skrypt zamieniający `w-N h-N` → `size-N`

**Files:**
- Create: `dashboard/scripts/codemod-size-axes.cjs`

- [ ] **Step 1: Napisz codemod**

```js
// dashboard/scripts/codemod-size-axes.cjs
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const files = execSync(
  'git ls-files "src/**/*.tsx" "src/**/*.ts"',
  { cwd: __dirname + '/..', encoding: 'utf8' }
).trim().split('\n').filter(Boolean);

// Match w-N h-N or h-N w-N (same N, where N can be number, decimal, or fraction)
// Only inside className="..." or className={'...'} contexts
const PATTERNS = [
  // w-4 h-4 → size-4
  /\b(w-([\w./[\]]+))\s+(h-\2)\b/g,
  // h-4 w-4 → size-4
  /\b(h-([\w./[\]]+))\s+(w-\2)\b/g,
];

let total = 0;
for (const rel of files) {
  const file = path.join(__dirname, '..', rel);
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const pat of PATTERNS) {
    after = after.replace(pat, (_m, _a, n) => `size-${n}`);
  }
  if (after !== before) {
    const diff = (before.match(/\b[wh]-[\w./[\]]+\s+[hw]-[\w./[\]]+/g) || []).length;
    fs.writeFileSync(file, after);
    console.log(`  ${rel}: ~${diff} occurrences`);
    total += diff;
  }
}
console.log(`Total files touched, ~${total} occurrences`);
```

- [ ] **Step 2: Uruchom codemod**

```bash
cd dashboard
node scripts/codemod-size-axes.cjs
```

Expected: wypisuje listę plików, ~439 podmianek.

- [ ] **Step 3: Sanity check — diff musi pokazywać tylko `w-N h-N` ↔ `size-N`**

```bash
cd dashboard
git diff --stat
git diff src/components/ui/dialog.tsx
```

Expected: same zamiany w className. Żadnych innych zmian.

- [ ] **Step 4: Typecheck**

```bash
cd dashboard
npx tsc -b
```

Expected: brak błędów.

- [ ] **Step 5: Build smoke test**

```bash
cd dashboard
npm run build
```

Expected: build sukces.

### Task 1.2: Ręcznie `px-N py-N` → `p-N` (6 miejsc)

**Files (z raportu lines 900-908):**
- Modify: `src/components/projects/ProjectList.tsx:83`
- Modify: `src/pages/ProjectPage.tsx:999, 1012, 1058`
- Modify: `src/pages/Reports.tsx:418`
- Modify: `src/components/layout/Sidebar.tsx:400`

- [ ] **Step 1: Dla każdego pliku zamień `px-N py-N` (gdzie N to ta sama wartość) na `p-N`**

Przykład:
```diff
- <div className="px-0.5 py-0.5 ...">
+ <div className="p-0.5 ...">
```

Sprawdź czy wartości faktycznie się zgadzają (`px-2 py-2` → `p-2`, ale `px-2 py-3` zostaw).

- [ ] **Step 2: Typecheck + build**

```bash
cd dashboard
npx tsc -b && npm run build
```

### Task 1.3: Weryfikacja fazy 1 i commit

- [ ] **Step 1: Sprawdź score**

```bash
cd /Users/micz/__DEV__/__cfab_demon
npx -y react-doctor@latest . --score
```

Expected: ≥ 78 (wzrost z 70).

- [ ] **Step 2: Lint i testy**

```bash
cd dashboard
npm run lint
npm run test
```

Expected: brak nowych błędów.

- [ ] **Step 3: Commit**

```bash
cd /Users/micz/__DEV__/__cfab_demon
git add dashboard/scripts/codemod-size-axes.cjs dashboard/src
git commit -m "refactor(dashboard): collapse Tailwind w-N h-N to size-N and px-N py-N to p-N"
```

---

## Faza 2 — Usunięcie `forwardRef` (React 19) (22 issues)

**Reguła:** `no-react19-deprecated-apis`.
**Zysk:** 22 issues, czystszy kod komponentów `ui/`.

W React 19 `ref` jest zwykłym propsem na komponentach funkcyjnych — `forwardRef` jest niepotrzebny.

### Task 2.1: Przepisz każdy `ui/` komponent

**Files (z raportu lines 619-643):**
- Modify: `src/components/ui/progress.tsx`
- Modify: `src/components/ui/card.tsx`
- Modify: `src/components/ui/tabs.tsx`
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/toast-notification.tsx`
- Modify: `src/components/ui/select.tsx`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/components/ui/switch.tsx`
- Modify: `src/components/ui/tooltip.tsx`
- Modify: `src/components/ui/label.tsx`

- [ ] **Step 1: Zamień wzorzec w każdym pliku**

Przed:
```tsx
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, ...props }, ref) => {
    return <button ref={ref} className={cn(buttonVariants(), className)} {...props} />;
  }
);
Button.displayName = "Button";
```

Po:
```tsx
function Button({ ref, className, ...props }: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  return <button ref={ref} className={cn(buttonVariants(), className)} {...props} />;
}
```

Uwaga: jeśli typ propsów był `ButtonProps`, dodaj `ref?: React.Ref<...>` do typu albo użyj `React.ComponentProps<'button'>` które już zawiera `ref` w React 19.

- [ ] **Step 2: Usuń `displayName` (niepotrzebne dla zwykłych funkcji nazwanych)**

- [ ] **Step 3: Typecheck**

```bash
cd dashboard
npx tsc -b
```

Expected: brak błędów. Jeśli typy callsite'ów się sypią, prawdopodobnie ktoś używał `React.ElementRef<typeof Component>` — zamień na `React.ComponentRef<typeof Component>` lub bezpośrednio HTML element type.

- [ ] **Step 4: Build + test**

```bash
cd dashboard
npm run build && npm run test
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/ui
git commit -m "refactor(ui): drop forwardRef, use React 19 ref as prop"
```

---

## Faza 3 — Klucze listowe stabilne (23 issues)

**Reguła:** `no-array-index-as-key`.
**Zysk:** 23 issues + realna eliminacja bugów rerenderingu list.

### Task 3.1: Audyt każdego miejsca

**Files (z raportu lines 595-617):**
- `src/components/time-analysis/WeeklyView.tsx:116`
- `src/components/project-page/ProjectEstimatesSection.tsx:191`
- `src/components/project/ProjectSessionDetailDialog.tsx:151`
- `src/pages/TimeAnalysis.tsx:147, 177`
- `src/components/help/help-shared.tsx:73`
- `src/components/time-analysis/DailyView.tsx:98`
- `src/components/project/ProjectCard.tsx:299`
- `src/components/settings/LanSyncCard.tsx:183`
- `src/components/import/FileDropzone.tsx:144`
- `src/pages/QuickStart.tsx:136`
- `src/components/sessions/SessionRow.tsx:216, 409`
- `src/components/sessions/MultiSplitSessionModal.tsx:266, 341`
- `src/pages/Dashboard.tsx:494`
- `src/components/pm/PmCreateProjectDialog.tsx:181`
- `src/components/pm/PmTemplateManager.tsx:168`
- `src/components/dashboard/TimelineChart.tsx:333`
- `src/components/dashboard/TopProjectsList.tsx:69`
- `src/components/dashboard/ProjectDayTimeline.tsx:552, 911`
- `src/components/dashboard/TopAppsChart.tsx:27`

- [ ] **Step 1: Dla każdego miejsca zweryfikuj czy item ma stabilne `id`**

Przykład dobrej zamiany:
```diff
- {items.map((item, i) => <Row key={i} {...item} />)}
+ {items.map((item) => <Row key={item.id} {...item} />)}
```

Jeśli item to czyste prymitywy bez ID (np. `string[]`), zbuduj stabilny klucz:
```diff
- {labels.map((label, i) => <Tag key={i}>{label}</Tag>)}
+ {labels.map((label) => <Tag key={label}>{label}</Tag>)}
```

Jeśli ID nie istnieje a wartości mogą się powtarzać, zostaw index ale dodaj `eslint-disable-next-line react-doctor/no-array-index-as-key` z komentarzem dlaczego (np. „statyczna lista, nigdy nie reorder").

- [ ] **Step 2: Typecheck + build + test**

```bash
cd dashboard
npx tsc -b && npm run build && npm run test
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src
git commit -m "refactor(dashboard): use stable keys instead of array index in list renders"
```

---

## Faza 4 — Wzorce iteracji i wydajność JS (~76 issues)

**Reguły:** `js-combine-iterations` (24), `js-tosorted-immutable` (12), `async-await-in-loop` (11), `js-set-map-lookups` (9), `js-flatmap-filter` (2), `js-hoist-intl` (4), `js-index-maps` (1), `js-cache-property-access` (1), `js-min-max-loop` (1), `js-length-check-first` (1).

### Task 4.1: `[...arr].sort()` → `arr.toSorted()` (12 miejsc, mechaniczne)

**Files (z raportu lines 761-775):**
- `src/pages/Applications.tsx:246`
- `src/pages/PM.tsx:44, 140`
- `src/components/pm/PmProjectsList.tsx:120, 143, 150`
- `src/pages/Projects.tsx:55, 252`
- `src/components/pm/PmClientsList.tsx:58`
- `src/components/dashboard/project-day-timeline/timeline-calculations.ts:216, 567, 580`

- [ ] **Step 1: Dla każdego miejsca:**

```diff
- const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
+ const sorted = items.toSorted((a, b) => a.name.localeCompare(b.name));
```

`toSorted` zwraca nową tablicę bez mutacji — semantycznie identyczne, jedna alokacja mniej.

- [ ] **Step 2: Typecheck + test**

```bash
cd dashboard
npx tsc -b && npm run test
```

### Task 4.2: Hoist `Intl.NumberFormat` (4 miejsca)

**Files (z raportu lines 910-916):**
- `src/pages/Estimates.tsx:68, 77`
- `src/pages/Applications.tsx:63`
- `src/lib/utils.ts:80`

- [ ] **Step 1: Wyciągnij konstruktor poza komponent/funkcję**

Przed:
```tsx
function MyComponent() {
  const formatter = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
  return <span>{formatter.format(value)}</span>;
}
```

Po:
```tsx
const CURRENCY_FORMATTER = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });

function MyComponent() {
  return <span>{CURRENCY_FORMATTER.format(value)}</span>;
}
```

- [ ] **Step 2: Typecheck + test**

### Task 4.3: `.filter().map()` → `.reduce()` lub `for…of` (24 miejsca)

**Files (z raportu lines 564-590):** ~14 plików, najwięcej w `pages/ProjectPage.tsx` (6 razy) i `project-day-timeline/timeline-calculations.ts`.

- [ ] **Step 1: Dla każdego ciągu `.filter().map()` lub `.map().filter()` zastosuj jeden z wzorców**

Wzorzec A (preferowany, czytelny):
```diff
- const result = items.filter(x => x.active).map(x => transform(x));
+ const result = items.reduce<Transformed[]>((acc, x) => {
+   if (x.active) acc.push(transform(x));
+   return acc;
+ }, []);
```

Wzorzec B (jeśli filter+map+filter):
```diff
- const result = items.filter(...).map(...).filter(Boolean);
+ const result = items.flatMap(x => {
+   if (!condition(x)) return [];
+   const v = transform(x);
+   return v ? [v] : [];
+ });
```

- [ ] **Step 2: Po każdym pliku: typecheck + test odnośnego flow (jeśli istnieje)**

```bash
cd dashboard
npx tsc -b
npm run test -- --reporter=verbose
```

### Task 4.4: `array.indexOf()` w pętli → `Set` (9 miejsc)

**Files (z raportu lines 851-862):**
- `src/lib/sync/sync-sse.ts:95`
- `src/pages/PM.tsx:34, 75, 79` (2×)
- `src/components/pm/PmProjectsList.tsx:133`
- `src/pages/Projects.tsx:670`
- `src/components/pm/PmClientsList.tsx:34, 55`

- [ ] **Step 1: Zbuduj `Set` raz przed pętlą**

Przed:
```ts
const filtered = items.filter(x => excludedIds.indexOf(x.id) === -1);
```

Po:
```ts
const excludedSet = new Set(excludedIds);
const filtered = items.filter(x => !excludedSet.has(x.id));
```

- [ ] **Step 2: Typecheck + test**

### Task 4.5: `array.find()` w pętli → `Map` (1 miejsce)

**File:** `src/pages/Projects.tsx:669`

- [ ] **Step 1:**

```diff
+ const projectMap = new Map(projects.map(p => [p.id, p]));
  for (const session of sessions) {
-   const project = projects.find(p => p.id === session.projectId);
+   const project = projectMap.get(session.projectId);
    ...
  }
```

### Task 4.6: Pozostałe drobne (3 miejsca)

- [ ] **Step 1: `js-min-max-loop`** — `src/components/dashboard/TimelineChart.tsx:159`

```diff
- const minVal = values.sort()[0];
+ const minVal = Math.min(...values);
```

- [ ] **Step 2: `js-cache-property-access`** — `src/components/pm/PmClientsList.tsx:48`

```diff
  for (const p of projects) {
-   if (p.prj_client.toUpperCase().startsWith('A')) ...
-   if (p.prj_client.toUpperCase().endsWith('Z')) ...
-   const label = p.prj_client.toUpperCase();
+   const client = p.prj_client.toUpperCase();
+   if (client.startsWith('A')) ...
+   if (client.endsWith('Z')) ...
+   const label = client;
  }
```

- [ ] **Step 3: `js-length-check-first`** — `src/store/background-status-store.ts:25`

```diff
- if (a.every((x, i) => x === b[i])) ...
+ if (a.length === b.length && a.every((x, i) => x === b[i])) ...
```

### Task 4.7: `async/await` w pętli → `Promise.all` (11 miejsc — wymagana analiza)

**Files (z raportu lines 809-822):** Większość w `lib/sync/*`, `hooks/useJobPool.ts`, `pages/DaemonControl.tsx`.

⚠ **Ważne:** wiele z tych pętli **musi** być sekwencyjnych (np. SSE stream consumer, kolejka job poola, retry logic). NIE przerabiaj na ślepo.

- [ ] **Step 1: Dla każdego miejsca przeczytaj kontekst i zdecyduj:**

  - **Sekwencyjne celowo** (SSE, kolejka, retry, czytanie strumieniem): dodaj komentarz `// sequential: <powód>` i `// eslint-disable-next-line react-doctor/async-await-in-loop`.
  - **Operacje niezależne**: zamień na `Promise.all`:

```diff
- for (const item of items) {
-   await processItem(item);
- }
+ await Promise.all(items.map(processItem));
```

- [ ] **Step 2: Test + smoke (uruchom dev, zweryfikuj LAN sync / job pool / daemon control)**

```bash
cd dashboard
npm run test
npm run dev
# Manualnie: LAN sync, job pool runner, daemon control panel
```

### Task 4.8: Weryfikacja fazy 4 i commit

- [ ] **Step 1: Score + lint + test**

```bash
cd /Users/micz/__DEV__/__cfab_demon
cd dashboard && npm run lint && npm run test && cd ..
npx -y react-doctor@latest . --score
```

Expected: ≥ 82.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src
git commit -m "perf(dashboard): optimize iteration patterns (toSorted, Set/Map lookups, hoist Intl, single-pass reduce)"
```

---

## Faza 5 — Stan i re-rendery (~50 issues, mieszane)

### Task 5.1: `rerender-functional-setstate` (12 miejsc)

**Files (z raportu lines 793-807):**
- `src/pages/ProjectPage.tsx:743`
- `src/components/data/DatabaseManagement.tsx:166, 316`
- `src/components/layout/BugHunter.tsx:55`
- `src/components/pm/PmTemplateManager.tsx:141, 154`
- `src/components/pm/PmProjectDetailDialog.tsx:115, 120, 126, 132, 137, 142`

- [ ] **Step 1: Zamień `setState({ ...state, key: val })` na callback**

```diff
- setProject({ ...project, name: newName });
+ setProject(prev => ({ ...prev, name: newName }));
```

- [ ] **Step 2: Typecheck + test**

### Task 5.2: `rerender-state-only-in-handlers` → `useRef` (9 miejsc)

**Files (z raportu lines 838-849):**
- `src/pages/Estimates.tsx:63` (`dataReloadVersion`)
- `src/pages/Applications.tsx:57`
- `src/pages/ReportView.tsx:30`
- `src/components/ManualSessionDialog.tsx:64`
- `src/pages/ProjectPage.tsx:168, 260`
- `src/pages/DaemonControl.tsx:37`
- `src/pages/Dashboard.tsx:205`
- `src/components/layout/SplashScreen.tsx:5`

⚠ **Ważne:** zweryfikuj że wartość **naprawdę** nie jest czytana w JSX. Jeśli jest używana jako klucz w `useEffect` dep array do wymuszenia rerendera — to celowy mechanizm, **zostaw** i dodaj `eslint-disable` z komentarzem.

- [ ] **Step 1: Dla każdej zmiennej:**
  - Jeśli służy tylko do triggerowania useEffect (klasyczny „force refresh" wzorzec): **zostaw** + disable z komentarzem.
  - Jeśli faktycznie nieczytana nigdzie: zamień na `useRef`:

```diff
- const [counter, setCounter] = useState(0);
- // ...handler...
- setCounter(c => c + 1);
+ const counterRef = useRef(0);
+ // ...handler...
+ counterRef.current += 1;
```

- [ ] **Step 2: Test (manualnie zweryfikuj że flow działa)**

### Task 5.3: `no-cascading-set-state` → `useReducer` (21 miejsc)

**Files (z raportu lines 645-668):** 21 hooków i komponentów z ≥5 setState w jednym useEffect.

⚠ To większy refactor. Rób **per plik**, commitując co plik.

- [ ] **Step 1: Dla każdego pliku z listy**

Wzorzec:
```tsx
// Przed
const [a, setA] = useState(0);
const [b, setB] = useState('');
const [c, setC] = useState(false);
useEffect(() => {
  setA(1); setB('x'); setC(true); setD(...); setE(...);
}, [trigger]);
```

```tsx
// Po
type State = { a: number; b: string; c: boolean; d: ...; e: ... };
type Action = { type: 'bootstrap'; payload: State } | ...;

function reducer(state: State, action: Action): State { ... }

const [state, dispatch] = useReducer(reducer, initialState);
useEffect(() => {
  dispatch({ type: 'bootstrap', payload: { a: 1, b: 'x', c: true, d: ..., e: ... } });
}, [trigger]);
```

Jeśli refactor jest zbyt szeroki dla pojedynczego pliku (np. używany w wielu miejscach) — **odłóż** i zaznacz w sekcji „Faza 12 — odłożone" poniżej.

- [ ] **Step 2: Po każdym pliku: typecheck + test + smoke**

```bash
cd dashboard
npx tsc -b && npm run test
```

- [ ] **Step 3: Commit per plik**

```bash
git add dashboard/src/hooks/useSettingsDemoMode.ts
git commit -m "refactor(hooks): migrate useSettingsDemoMode cascading setState to useReducer"
```

### Task 5.4: `no-derived-useState` (1 miejsce)

**File:** `src/components/ui/prompt-modal.tsx:39`

- [ ] **Step 1:**

```diff
- const [value, setValue] = useState(initialValue);
- // ...nigdzie nie wywołujemy setValue
+ const value = initialValue;
```

albo jeśli komponent ma być kontrolowany — przyjmij `value` + `onChange` jako propsy.

### Task 5.5: `rerender-memo-with-default-value` (1 miejsce)

**File:** `src/components/dashboard/ProjectDayTimeline.tsx:56`

- [ ] **Step 1:**

```diff
+ const EMPTY_ITEMS: Item[] = [];
- function ProjectDayTimeline({ items = [] }: Props) {
+ function ProjectDayTimeline({ items = EMPTY_ITEMS }: Props) {
```

### Task 5.6: `prefer-use-effect-event` + `no-effect-event-handler` (2 miejsca)

**Files:**
- `src/components/sync/SyncProgressOverlay.tsx:98` (prefer-use-effect-event)
- `src/components/sync/DaemonSyncOverlay.tsx:58` (no-effect-event-handler)

- [ ] **Step 1: SyncProgressOverlay.tsx** — opakuj callback w `useEffectEvent`

```tsx
import { useEffectEvent } from 'react';

const onFinishedStable = useEffectEvent(onFinished);

useEffect(() => {
  const t = setTimeout(() => onFinishedStable(), delay);
  return () => clearTimeout(t);
}, [delay]); // onFinished usunięty z depsów
```

- [ ] **Step 2: DaemonSyncOverlay.tsx** — przenieś warunkową logikę z useEffect do handlerów (onClick/onChange).

### Task 5.7: `no-derived-state-effect` (3 miejsca)

**Files:**
- `src/hooks/useLanSyncManager.ts:36`
- `src/components/sessions/MultiSplitSessionModal.tsx:97`
- `src/pages/Projects.tsx:541`

- [ ] **Step 1: Dla każdego:**

```diff
- const [derived, setDerived] = useState(...);
- useEffect(() => { setDerived(compute(input)); }, [input]);
+ const derived = useMemo(() => compute(input), [input]);
```

Jeśli jest to „reset state on prop change" — zamień na klucz na komponencie nadrzędnym:
```tsx
<Component key={parentProp} />
```

### Task 5.8: `rendering-usetransition-loading` (1 miejsce)

**File:** `src/components/time-analysis/useTimeAnalysisData.ts:30`

- [ ] **Step 1: Jeśli isLoading dotyczy synchronicznej transformacji danych** (nie async fetch), zamień na `useTransition`:

```diff
- const [isLoading, setIsLoading] = useState(false);
- const handler = () => {
-   setIsLoading(true);
-   computeHeavy();
-   setIsLoading(false);
- };
+ const [isPending, startTransition] = useTransition();
+ const handler = () => {
+   startTransition(() => { computeHeavy(); });
+ };
```

Jeśli to async fetch — **zostaw** i dodaj `eslint-disable` z komentarzem.

### Task 5.9: Weryfikacja fazy 5 i commit

- [ ] **Step 1: Score + lint + test**

```bash
cd /Users/micz/__DEV__/__cfab_demon
cd dashboard && npm run lint && npm run test && cd ..
npx -y react-doctor@latest . --score
```

Expected: ≥ 85.

- [ ] **Step 2: Commit (jeśli nie wcześniej, per task 5.3)**

```bash
git add dashboard/src
git commit -m "refactor(dashboard): tighten state management — functional setState, useRef for handler-only state, useEffectEvent"
```

---

## Faza 6 — Accessibility (~30 issues, krytyczne dla UX)

**Reguły:** `jsx-a11y/label-has-associated-control` (12), `jsx-a11y/no-static-element-interactions` (10), `jsx-a11y/click-events-have-key-events` (8).

### Task 6.1: Labels (12 miejsc)

**Files (z raportu lines 777-791):** głównie `src/components/settings/*Card.tsx`.

- [ ] **Step 1: Każdy `<label>` musi mieć tekst lub `aria-label`**

Wzorzec A — z tekstem:
```diff
- <label><input type="checkbox" /></label>
+ <label>
+   <input type="checkbox" />
+   <span>{t('settings.feature.label')}</span>
+ </label>
```

Wzorzec B — z `htmlFor`:
```diff
- <label><Switch /></label>
+ <label htmlFor="switch-id">{t('...')}</label>
+ <Switch id="switch-id" />
```

Wzorzec C — komponent owinięty z aria-label:
```diff
- <label><CustomControl /></label>
+ <label aria-label={t('...')}><CustomControl /></label>
```

### Task 6.2: Static element interactions + click w/o keys (przeważnie te same pliki, 10+8 issues)

**Files (z raportu lines 824-836, 864-873):**
- `src/components/projects/ProjectList.tsx:47`
- `src/components/project/ProjectManualSessionsCard.tsx:55`
- `src/components/project/ProjectSessionsTable.tsx:143`
- `src/components/settings/LanSyncCard.tsx:843, 848`
- `src/components/data/ImportPanel.tsx:96`
- `src/components/sessions/SessionsVirtualList.tsx:134`
- `src/components/settings/DevSettingsCard.tsx:189`
- `src/components/layout/Sidebar.tsx:306`
- `src/components/layout/TopBar.tsx:76`

- [ ] **Step 1: Dla każdego `<div onClick>` bez roli:**

Opcja A — zamień na semantyczny element:
```diff
- <div onClick={handle} className="...">
+ <button type="button" onClick={handle} className="...">
```

Opcja B — jeśli musi zostać `<div>` (np. wiersz tabeli):
```diff
- <div onClick={handle}>
+ <div
+   role="button"
+   tabIndex={0}
+   onClick={handle}
+   onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handle(); }}
+ >
```

- [ ] **Step 2: Test manualny — klawiatura Tab + Enter na zmodyfikowanych elementach**

```bash
cd dashboard && npm run dev
# Manualnie: tabuj po sidebarze, listach, dialogach
```

### Task 6.3: Weryfikacja fazy 6 i commit

- [ ] **Step 1: Lint + test**

```bash
cd dashboard && npm run lint && npm run test
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src
git commit -m "a11y(dashboard): add accessible labels, keyboard handlers, and roles on interactive elements"
```

---

## Faza 7 — Dynamic import dla recharts (8 issues)

**Reguła:** `prefer-dynamic-import`.
**Zysk:** istotna redukcja initial bundle (recharts ~150 KB gzipped).

**Files (z raportu lines 888-898):**
- `src/components/time-analysis/WeeklyView.tsx`
- `src/components/time-analysis/DailyView.tsx`
- `src/components/time-analysis/MonthlyView.tsx`
- `src/pages/TimeAnalysis.tsx`
- `src/components/dashboard/TimelineChart.tsx`
- `src/components/dashboard/HourlyBreakdown.tsx`
- `src/components/dashboard/AllProjectsChart.tsx`
- `src/components/ai/AiMetricsCharts.tsx`

### Task 7.1: Wrapuj komponenty wykresowe w `React.lazy`

- [ ] **Step 1: Dla każdego komponentu wykresowego, wydziel cały komponent do osobnego pliku `*.lazy.tsx`** (jeśli jeszcze nie jest)

- [ ] **Step 2: Stwórz wrapper z `React.lazy` + `Suspense`**

```tsx
// src/components/dashboard/TimelineChart.tsx (wrapper)
import { lazy, Suspense } from 'react';
const TimelineChartInner = lazy(() => import('./TimelineChart.impl'));

export function TimelineChart(props: Props) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded" />}>
      <TimelineChartInner {...props} />
    </Suspense>
  );
}
```

- [ ] **Step 3: Build + weryfikacja chunkowania**

```bash
cd dashboard && npm run build
ls -lh dist/assets | grep -i chart
```

Expected: oddzielne chunki dla wykresów.

- [ ] **Step 4: Smoke test (każdy ekran z wykresem)**

```bash
npm run dev
# Manualnie: Dashboard, TimeAnalysis (Daily/Weekly/Monthly), AI metrics
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src
git commit -m "perf(dashboard): code-split recharts via React.lazy in chart components"
```

---

## Faza 8 — Dead code (knip) (207 issues — ale ostrożnie)

**Reguły:** `knip/exports` (177), `knip/types` (27), `knip/files` (3).

⚠ **Ważne:** Wiele eksportów z `lib/tauri/*.ts` to **publiczne API** wystawione dla Tauri commands. Nie kasuj bez weryfikacji backendu (Rust IPC).

### Task 8.1: Audyt 3 nieużywanych plików

- [ ] **Step 1: Sprawdź każdy plik czy jest naprawdę martwy**

```bash
cd dashboard
grep -r "from.*run_tsc" --include="*.ts*" --include="*.json"
grep -r "HourlyBreakdown" src/
grep -r "from.*settings/types" src/
```

- [ ] **Step 2: Dla każdego potwierdzonego dead file:**

  - `run_tsc.js` — usuń jeśli nie odpalany przez żaden skrypt npm.
  - `src/components/dashboard/HourlyBreakdown.tsx` — usuń jeśli nie zaimportowany nigdzie (lub zachowaj z `// eslint-disable-next-line knip/files` jeśli świadomie zarezerwowany).
  - `src/components/settings/types.ts` — usuń jeśli typy nieużywane.

```bash
git rm dashboard/run_tsc.js  # tylko jeśli rzeczywiście martwy
```

### Task 8.2: Audyt 177 nieużywanych eksportów

⚠ **Bardzo ostrożnie**: `lib/tauri/*.ts` eksportuje funkcje **wołane przez frontend dynamicznie albo przez Tauri IPC**. Knip widzi to jako nieużywane bo nie skanuje string-based `invoke()`.

- [ ] **Step 1: Wygeneruj listę kandydatów do usunięcia**

```bash
cd /Users/micz/__DEV__/__cfab_demon
npx -y react-doctor@latest . --verbose 2>&1 | grep -A 200 "knip/exports" | head -250
```

- [ ] **Step 2: Pomiń pliki w `lib/tauri/*` (publiczne API)** — dla każdego dodaj `// eslint-disable knip` na górze pliku z komentarzem „Public Tauri command bindings".

- [ ] **Step 3: Dla pozostałych eksportów w `lib/`, `components/`, `hooks/` weryfikuj per export:**

```bash
cd dashboard
grep -rn "areFileActivitiesEqual" src/
```

  - Jeśli **0 hitów poza definicją** — usuń export (i ewentualnie funkcję).
  - Jeśli używane wewnętrznie — zmień `export function` na `function`.

- [ ] **Step 4: Po każdej partii (np. 20 eksportów) typecheck + test**

```bash
cd dashboard
npx tsc -b && npm run test
```

### Task 8.3: Audyt 27 nieużywanych typów

**Files (z raportu lines 550-562):** głównie `lib/db-types.ts`, `lib/online-sync-types.ts`, `lib/lan-sync-types.ts`, `components/ui/{button,badge,input}.tsx`.

- [ ] **Step 1: Per typ — sprawdź czy używany przez konsumentów**

```bash
grep -rn "FileActivity" dashboard/src/
```

  - Jeśli to typ shared API z backendem (np. db-types, online-sync-types) — **zostaw** + eslint-disable z komentarzem.
  - Jeśli faktycznie martwy — usuń.

### Task 8.4: Weryfikacja fazy 8 i commit

- [ ] **Step 1: Pełny pipeline**

```bash
cd dashboard
npx tsc -b && npm run lint && npm run test && npm run build
```

- [ ] **Step 2: Smoke test**

```bash
npm run tauri dev
# Manualnie: każdy ekran, każda Tauri command (timer, sync, AI)
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src dashboard/run_tsc.js dashboard/.eslintrc*
git commit -m "chore(dashboard): remove dead exports/types and document Tauri public API bindings"
```

---

## Faza 9 — Design polish (~60 issues)

### Task 9.1: `design-no-default-tailwind-palette` (41 miejsc)

**Files (z raportu lines 505-548):** głównie `pages/ReportView.tsx` (35×) i `App.tsx` (5×) + 1× `TimeAnalysis.tsx`.

Reguła: zamień default `slate-*`, `gray-*`, `indigo-*` na tokeny projektu (`zinc-*`, `neutral-*`, `stone-*` lub CSS vars z `@theme`).

- [ ] **Step 1: Sprawdź czy projekt ma zdefiniowane tokeny brandowe**

```bash
cd dashboard
grep -rn "@theme" src/ tailwind.config*
grep -rn "var(--" src/index.css src/App.css 2>/dev/null
```

- [ ] **Step 2: Jeśli są tokeny (np. `bg-muted`, `bg-card`) — użyj ich. Jeśli nie — zamień na `zinc-*` jako neutralny default.**

```diff
- <div className="bg-slate-600 text-slate-100">
+ <div className="bg-zinc-600 text-zinc-100">
```

⚠ **Wizualnie**: zinc i slate różnią się subtelnie (zinc to czyste szare, slate niebieskawe). Skonsultuj z designerem jeśli istnieje system. W TIMEFLOW raczej dążymy do neutralnego — zinc OK.

- [ ] **Step 3: Visual diff (manual)**

```bash
npm run tauri dev
# Manualnie: ReportView, App layout — porównaj „przed i po"
```

### Task 9.2: `design-no-bold-heading` (13 miejsc)

**Files (z raportu lines 744-759):** głównie `ReportView.tsx`.

- [ ] **Step 1:**

```diff
- <h2 className="font-bold ...">
+ <h2 className="font-semibold ...">
```

### Task 9.3: `design-no-space-on-flex-children` (4 miejsca)

**Files (z raportu lines 926-932):**
- `src/pages/Help.tsx:74`
- `src/components/data/DataStats.tsx:70`
- `src/pages/QuickStart.tsx:105`
- `src/components/layout/BugHunter.tsx:121`

- [ ] **Step 1: Zamień `space-y-N` na parencie flex/grid na `gap-y-N`**

```diff
- <div className="flex flex-col space-y-4">
+ <div className="flex flex-col gap-y-4">
```

### Task 9.4: `no-tiny-text` (3 miejsca)

**File:** `src/components/dashboard/TimelineChart.tsx:333, 340, 346`

- [ ] **Step 1: 11px → 12px (lub większy jeśli kontekst pozwala)**

```diff
- fontSize: 11
+ fontSize: 12
```

⚠ Sprawdź wizualnie czy nie psuje to layoutu chart axisów.

### Task 9.5: `design-no-em-dash-in-jsx-text` (2 miejsca)

**Files:**
- `src/components/settings/LanSyncCard.tsx:545`
- `src/components/pm/PmProjectDetailDialog.tsx:154`

- [ ] **Step 1: Zamień `—` na `:` lub `,` w tekście JSX**

```diff
- <span>Sync — last 5 minutes</span>
+ <span>Sync: last 5 minutes</span>
```

⚠ Jeśli teksty są z `t('...')` — zamień w pliku tłumaczenia, nie w JSX.

### Task 9.6: Weryfikacja fazy 9 i commit

- [ ] **Step 1: Smoke + commit**

```bash
cd dashboard && npm run lint && npm run test
git add dashboard/src
git commit -m "style(dashboard): replace default Tailwind palette with project tokens, use semibold headings, gap over space-y"
```

---

## Faza 10 — `no-render-in-render` (8 issues)

**Reguła:** `no-render-in-render`.

**Files (z raportu lines 876-886):**
- `src/components/projects/ProjectList.tsx:93`
- `src/components/projects/ProjectsList.tsx:259`
- `src/components/project/ProjectCard.tsx:218, 306`
- `src/components/projects/ExcludedProjectsList.tsx:61`
- `src/components/sessions/SessionRow.tsx:293, 469`
- `src/pages/Projects.tsx:821`

### Task 10.1: Wyciągnij inline render functions do nazwanych komponentów

- [ ] **Step 1: Wzorzec**

```diff
  function ProjectCard({ project }: Props) {
-   const renderDuplicateMarker = (dup: Duplicate) => (
-     <span className="badge">{dup.label}</span>
-   );
+   ...
    return (
      <div>
-       {duplicates.map(d => renderDuplicateMarker(d))}
+       {duplicates.map(d => <DuplicateMarker key={d.id} duplicate={d} />)}
      </div>
    );
  }
+
+ function DuplicateMarker({ duplicate }: { duplicate: Duplicate }) {
+   return <span className="badge">{duplicate.label}</span>;
+ }
```

- [ ] **Step 2: Per plik typecheck + smoke**

- [ ] **Step 3: Commit**

```bash
git add dashboard/src
git commit -m "refactor(dashboard): extract inline render functions to named components"
```

---

## Faza 11 — Hydration warnings (false positives w Tauri)

**Reguła:** `rendering-hydration-mismatch-time` (21 issues).

Projekt jest aplikacją Tauri/Vite **bez SSR** — warning nie ma zastosowania.

### Task 11.1: Skonfiguruj wyłączenie reguły dla projektu

- [ ] **Step 1: Sprawdź dokumentację react-doctor czy istnieje config**

```bash
cd /Users/micz/__DEV__/__cfab_demon
npx -y react-doctor@latest --help
```

- [ ] **Step 2: Jeśli istnieje `.react-doctor.json` / `.react-doctorrc` lub równoważny config, dodaj wyłączenie reguły:**

```json
{
  "rules": {
    "rendering-hydration-mismatch-time": "off"
  }
}
```

- [ ] **Step 3: Jeśli config nie jest wspierany — dodaj inline `// eslint-disable-next-line react-doctor/rendering-hydration-mismatch-time` przy każdym `new Date()` z komentarzem „No SSR — Tauri client app".**

Files (z raportu lines 695-718):
- `src/components/settings/LanSyncCard.tsx:545, 803`
- `src/pages/ProjectPage.tsx:1002`
- `src/components/settings/OnlineSyncCard.tsx:130`
- `src/components/data/DataHistory.tsx:187`
- `src/components/sync/SyncProgressOverlay.tsx:153`
- `src/components/data/DatabaseManagement.tsx:345, 456`
- `src/components/layout/Sidebar.tsx:556`
- `src/components/ai/AiFolderScanCard.tsx:39`

- [ ] **Step 4: Commit**

```bash
git add dashboard/.react-doctor* dashboard/src
git commit -m "chore(dashboard): silence hydration-mismatch warnings — Tauri client app has no SSR"
```

---

## Faza 12 — Architektura (opcjonalna, duża)

Te warningi to subiektywne zalecenia architektoniczne — wymagają decyzji właściciela produktu.

### `no-giant-component` (20 plików) i `prefer-useReducer` (21 plików)

**Files (z raportu lines 670-693, 720-742):** głównie `pages/*`, `Settings/LanSyncCard.tsx`, `Settings/OnlineSyncCard.tsx`, `DataHistory.tsx`, `DatabaseManagement.tsx`.

Decyzja:
- **Jeśli zespół ma czas** — wydziel sekcje z każdego komponentu >400 linii do osobnych podkomponentów. To 1-2 dni pracy.
- **Jeśli nie** — zostaw, te issues nie wpływają na poprawność. Wynik 85+ jest osiągalny bez tej fazy.

### `no-many-boolean-props` (4 komponenty)

**Files (z raportu lines 918-924):**
- `ProjectDiscoveryPanel.tsx`, `ProjectCard.tsx`, `LanSyncCard.tsx`, `SessionsVirtualList.tsx`

Jeśli komponent ma `isA`, `isB`, `isC`, `isD` — rozważ:
- Compound component pattern, lub
- Enum/literal union: `mode: 'idle' | 'loading' | 'error' | 'demo'`.

---

## Faza 13 — Weryfikacja końcowa

### Task 13.1: Final scan

- [ ] **Step 1: Pełny audyt**

```bash
cd /Users/micz/__DEV__/__cfab_demon
npx -y react-doctor@latest . --verbose > raport_po.md
diff <(grep "Score\|/ 100" raport.md) <(grep "Score\|/ 100" raport_po.md)
```

Expected: wynik ≥ 85.

- [ ] **Step 2: Full CI pipeline**

```bash
cd dashboard
npx tsc -b
npm run lint
npm run test
npm run build
```

Expected: wszystko zielone.

- [ ] **Step 3: Tauri smoke test**

```bash
npm run tauri dev
# Manualne testy:
# - timer (start/stop)
# - LAN sync (jeśli dostępny peer)
# - Online sync
# - Reports
# - Projects discovery
# - Settings → wszystkie karty
```

- [ ] **Step 4: Help.tsx — zaktualizuj jeśli zmieniono zachowanie czegokolwiek widocznego dla użytkownika**

Per `CLAUDE.md` §3 — jeśli którakolwiek faza zmieniła zachowanie widoczne dla użytkownika (np. faza 7 z lazy loading wprowadziła krótki skeleton wykresu), dodaj wzmiankę w `src/pages/Help.tsx`.

- [ ] **Step 5: Push i PR**

```bash
git push -u origin chore/react-doctor-cleanup
gh pr create --title "chore(dashboard): react-doctor cleanup — 70→85+" --body "..."
```

---

## Mapa zysków per faza

| Faza | Reguły | Issues | Score est. | Wysiłek |
|------|--------|--------|------------|---------|
| 1 — Tailwind shorthand | `design-no-redundant-{size,padding}-axes` | 445 | 70→78 | 1-2h (codemod) |
| 2 — React 19 refs | `no-react19-deprecated-apis` | 22 | 78→79 | 1h |
| 3 — Stabilne klucze | `no-array-index-as-key` | 23 | 79→80 | 1-2h |
| 4 — Iteracje JS | 10 reguł JS | 76 | 80→82 | 3-4h |
| 5 — Stan/rerender | 7 reguł state | 50 | 82→85 | 4-6h |
| 6 — Accessibility | 3 reguły a11y | 30 | 85→86 | 2-3h |
| 7 — Dynamic import | `prefer-dynamic-import` | 8 | 86→87 | 1-2h + bundle gain |
| 8 — Dead code (knip) | 3 reguły knip | 207* | 87→90+ | 3-4h (ostrożnie) |
| 9 — Design polish | 5 reguł design | 63 | 90→92 | 2h |
| 10 — Render in render | `no-render-in-render` | 8 | 92→93 | 1h |
| 11 — Hydration false-pos | `rendering-hydration-mismatch-time` | 21 | 93→95 | 30min |
| 12 — Architektura (opt.) | `no-giant-component`, `prefer-useReducer`, `no-many-boolean-props` | 45 | 95→97 | 1-2 dni |

\* knip wymaga ostrożności — wiele „nieużywanych" eksportów to publiczne Tauri API.

**Realistyczny cel bez fazy 12:** 90-93/100.
**Cel z fazą 12:** 95-97/100.

---

## Zasady wykonania

1. **Commit po każdej fazie** (lub per task w fazach 5.3 i 8 — większe refaktory).
2. **Po każdej fazie:** typecheck + lint + test + react-doctor score check. Jeśli score spadł → cofnij ostatnie zmiany.
3. **Brak nowych zależności.**
4. **Brak zmian funkcjonalnych** (poza fazą 7 — lazy loading wykresów dodaje krótki skeleton).
5. **Help.tsx** — aktualizuj tylko jeśli faza zmienia zachowanie widoczne użytkownikowi.
6. **Język w UI:** zawsze `TIMEFLOW` (wielkie litery) jeśli jakikolwiek string był poprawiany.
7. **CLAUDE.md §1:** komunikacja po polsku, zmiany >2 plików — plan przed implementacją (ten dokument to wypełnia).
