react-doctor v0.1.6

✔ Select projects to scan › dashboard
Scanning /Users/micz/__DEV__/__cfab_demon/dashboard...



  ⚠ react-doctor/design-no-default-tailwind-palette ×36
      bg-slate-600 reads as the Tailwind template default — use zinc (true neutral), neutral (warmer), or stone (warmest)
      → Replace `indigo-*` / `gray-*` / `slate-*` with project tokens, your brand color, or a less-default neutral (`zinc`, `neutral`, `stone`)
      src/pages/TimeAnalysis.impl.tsx:197
      src/pages/ReportView.tsx:181
      src/pages/ReportView.tsx:199
      src/pages/ReportView.tsx:227
      src/pages/ReportView.tsx:229
      src/pages/ReportView.tsx:245
      src/pages/ReportView.tsx:250
      src/pages/ReportView.tsx:257
      src/pages/ReportView.tsx:261
      src/pages/ReportView.tsx:275
      src/pages/ReportView.tsx:290
      src/pages/ReportView.tsx:309
      src/pages/ReportView.tsx:310
      src/pages/ReportView.tsx:315
      src/pages/ReportView.tsx:323
      src/pages/ReportView.tsx:337
      src/pages/ReportView.tsx:342
      src/pages/ReportView.tsx:342
      src/pages/ReportView.tsx:361
      src/pages/ReportView.tsx:363
      src/pages/ReportView.tsx:372
      src/pages/ReportView.tsx:393
      src/pages/ReportView.tsx:402
      src/pages/ReportView.tsx:426
      src/pages/ReportView.tsx:431
      src/pages/ReportView.tsx:431
      src/pages/ReportView.tsx:450
      src/pages/ReportView.tsx:452
      src/pages/ReportView.tsx:475
      src/pages/ReportView.tsx:480
      src/pages/ReportView.tsx:480
      src/pages/ReportView.tsx:499
      src/pages/ReportView.tsx:501
      src/pages/ReportView.tsx:507
      src/pages/ReportView.tsx:530
      src/pages/ReportView.tsx:530

  ⚠ react-doctor/prefer-useReducer                  ×21
      Component "DevSettingsCard" has 5 useState calls — consider useReducer for related state
      → Group related state: `const [state, dispatch] = useReducer(reducer, { field1, field2, ... })`
      src/components/settings/DevSettingsCard.tsx:25
      src/components/dashboard/ProjectDayTimeline.tsx:67
      src/pages/PM.tsx:107
      src/components/layout/Sidebar.tsx:123
      src/pages/Dashboard.tsx:183
      src/components/layout/BugHunter.tsx:30
      src/components/settings/LanSyncCard.tsx:287
      src/pages/Sessions.tsx:61
      src/pages/Estimates.tsx:38
      src/pages/Applications.tsx:36
      src/pages/Projects.tsx:133
      src/pages/AI.tsx:131
      src/pages/ReportView.tsx:18
      src/pages/ProjectPage.tsx:141
      src/components/pm/PmCreateProjectDialog.tsx:21
      src/components/ManualSessionDialog.tsx:51
      src/components/data/DatabaseManagement.tsx:28
      src/components/data/ImportPanel.tsx:23
      src/components/pm/PmProjectDetailDialog.tsx:26
      src/components/data/ExportPanel.tsx:16
      src/components/sync/LanPeerNotification.tsx:78

  ⚠ react-doctor/no-cascading-set-state             ×21
      3 setState calls in a single useEffect — consider using useReducer or deriving state
      → Combine into useReducer: `const [state, dispatch] = useReducer(reducer, initialState)`
      src/components/time-analysis/useTimeAnalysisData.ts:87
      src/components/settings/LanSyncCard.tsx:332
      src/hooks/useLanSyncManager.ts:199
      src/hooks/useSessionsData.ts:78
      src/pages/Estimates.tsx:91
      src/hooks/useSessionScoreBreakdown.ts:72
      src/components/layout/SplashScreen.tsx:8
      src/hooks/useSettingsDemoMode.ts:27
      src/hooks/useSessionSplitAnalysis.ts:47
      src/hooks/useBackgroundStartup.ts:23
      src/hooks/useSessionsFilters.ts:82
      src/hooks/useProjectsData.ts:140
      src/hooks/useProjectsData.ts:172
      src/hooks/useProjectsData.ts:216
      src/pages/ReportView.tsx:58
      src/hooks/settings/useSettingsGuards.ts:18
      src/pages/ProjectPage.tsx:283
      src/components/pm/PmCreateProjectDialog.tsx:33
      src/components/ManualSessionDialog.tsx:66
      src/components/project/ProjectContextMenu.tsx:80
      src/components/sync/SyncProgressOverlay.tsx:45

  ⚠ react-doctor/no-giant-component                 ×20
      Component "ProjectDayTimeline" is 925 lines — consider breaking it into smaller focused components
      → Extract logical sections into focused components: `<UserHeader />`, `<UserActions />`, etc.
      src/components/dashboard/ProjectDayTimeline.tsx:55
      src/components/layout/Sidebar.tsx:123
      src/pages/Dashboard.tsx:183
      src/components/settings/LanSyncCard.tsx:216
      src/pages/Sessions.tsx:61
      src/pages/Estimates.tsx:38
      src/pages/Reports.tsx:235
      src/pages/Applications.tsx:36
      src/pages/Projects.tsx:133
      src/pages/Settings.tsx:34
      src/components/sessions/MultiSplitSessionModal.tsx:83
      src/pages/AI.tsx:131
      src/pages/ReportView.tsx:18
      src/components/settings/OnlineSyncCard.tsx:52
      src/pages/ProjectPage.tsx:141
      src/pages/DaemonControl.tsx:26
      src/components/project/ProjectCard.tsx:97
      src/components/pm/PmProjectsList.tsx:97
      src/components/dashboard/TimelineChart.impl.tsx:104
      src/components/data/DatabaseManagement.tsx:28

  ⚠ knip/exports                                    ×12
      Unused export: tauriApi
      src/lib/tauri.ts
      src/lib/utils.ts
      src/lib/background-helpers.ts
      src/lib/date-helpers.ts
      src/lib/online-sync.ts
      src/lib/async-utils.ts
      src/components/sync/job-pool-helpers.ts
      src/lib/sync/sync-sse.ts
      src/lib/sync/sync-runner.ts
      src/lib/chart-animation.ts

  ⚠ react-doctor/async-await-in-loop                ×11
      await inside a while-loop runs the calls sequentially — for independent operations, collect them and use `await Promise.all(items.map(...))` to run them concurrently
      → Collect the items and use `await Promise.all(items.map(...))` to run independent operations concurrently
      src/components/layout/Sidebar.tsx:193
      src/hooks/useSessionScoreBreakdown.ts:210
      src/hooks/useJobPool.ts:189
      src/lib/sync/sync-runner.ts:249
      src/lib/sync/sync-http.ts:74
      src/lib/sync/sync-http.ts:205
      src/lib/session-pagination.ts:35
      src/lib/sync/sync-sse.ts:88
      src/pages/DaemonControl.tsx:148
      src/components/sync/job-pool-helpers.ts:84
      src/components/sync/LanPeerNotification.tsx:174

  ⚠ react-doctor/js-set-map-lookups                 ×9
      array.indexOf() in a loop is O(n) per call — convert to a Set for O(1) lookups
      → Use a `Set` or `Map` for repeated membership tests / keyed lookups — `Array.includes`/`find` is O(n) per call
      src/pages/PM.tsx:34
      src/pages/PM.tsx:75
      src/pages/PM.tsx:79
      src/pages/PM.tsx:79
      src/pages/Projects.tsx:673
      src/lib/sync/sync-sse.ts:95
      src/components/pm/PmProjectsList.tsx:133
      src/components/pm/PmClientsList.tsx:34
      src/components/pm/PmClientsList.tsx:55

  ⚠ react-doctor/no-array-index-as-key              ×8
      Array index "i" used as key — causes bugs when list is reordered or filtered
      → Use a stable unique identifier: `key={item.id}` or `key={item.slug}` — index keys break on reorder/filter
      src/components/time-analysis/WeeklyView.impl.tsx:117
      src/components/time-analysis/DailyView.impl.tsx:99
      src/pages/Dashboard.tsx:495
      src/components/settings/LanSyncCard.tsx:183
      src/components/help/help-shared.tsx:73
      src/components/pm/PmTemplateManager.tsx:167
      src/components/pm/PmCreateProjectDialog.tsx:181
      src/components/dashboard/TimelineChart.impl.tsx:337

  ⚠ react-doctor/rerender-state-only-in-handlers    ×7
      useState "dataReloadVersion" is updated but never read in the component's return — use useRef so updates don't trigger re-renders
      → Replace useState with useRef when the value is only mutated and never read in render — `ref.current = ...` updates without re-rendering the component
      src/pages/Dashboard.tsx:206
      src/pages/Estimates.tsx:64
      src/pages/Applications.tsx:58
      src/components/layout/SplashScreen.tsx:5
      src/pages/ReportView.tsx:30
      src/pages/ProjectPage.tsx:261
      src/pages/DaemonControl.tsx:38

  ⚠ react-doctor/js-combine-iterations              ×5
      .filter().map() iterates the array twice — combine into a single loop with .reduce() or for...of
      → Combine `.map().filter()` (or similar chains) into a single pass with `.reduce()` or a `for...of` loop to avoid iterating the array twice
      src/components/time-analysis/DailyView.impl.tsx:153
      src/components/sessions/MultiSplitSessionModal.tsx:333
      src/components/pm/PmTemplateManager.tsx:164
      src/components/ManualSessionDialog.tsx:236
      src/components/import/FileDropzone.tsx:142

  ⚠ react-doctor/no-render-in-render                ×5
      Inline render function "renderDuplicateMarker()" — extract to a separate component for proper reconciliation
      → Extract to a named component: `const ListItem = ({ item }) => <div>{item.name}</div>`
      src/components/projects/ProjectList.tsx:96
      src/components/sessions/SessionRow.tsx:293
      src/components/sessions/SessionRow.tsx:469
      src/components/projects/ProjectsList.tsx:259
      src/components/projects/ExcludedProjectsList.tsx:61

  ⚠ react-doctor/js-hoist-intl                      ×4
      new Intl.NumberFormat() inside a function — hoist to module scope or wrap in useMemo so it isn't recreated each call
      → Hoist `new Intl.NumberFormat(...)` to module scope or wrap in `useMemo` — Intl constructors allocate dozens of objects per locale lookup
      src/lib/utils.ts:80
      src/pages/Estimates.tsx:69
      src/pages/Estimates.tsx:78
      src/pages/Applications.tsx:64

  ⚠ react-doctor/no-many-boolean-props              ×4
      Component "LanSyncCard" takes 4 boolean-like props (enableTitle, enableDescription, showLogLabel…) — consider compound components or explicit variants instead of stacking flags
      → Split into compound components or named variants: `<Button.Primary />`, `<DialogConfirm />` instead of stacking `isPrimary`, `isConfirm` flags
      src/components/settings/LanSyncCard.tsx:216
      src/components/sessions/SessionsVirtualList.tsx:66
      src/components/project/ProjectCard.tsx:97
      src/components/projects/ProjectDiscoveryPanel.tsx:144

  ⚠ react-doctor/no-derived-state-effect            ×3
      Derived state in useEffect — wrap the calculation in useMemo([deps]) (or compute it directly during render if it isn't expensive)
      → For derived state, compute inline: `const x = fn(dep)`. For state resets on prop change, use a key prop: `<Component key={prop} />`. See https://react.dev/learn/you-might-not-need-an-effect
      src/hooks/useLanSyncManager.ts:36
      src/pages/Projects.tsx:544
      src/components/sessions/MultiSplitSessionModal.tsx:97

  ⚠ react-doctor/no-tiny-text                       ×2
      Font size 10px is too small — body text should be at least 12px for readability, 16px is ideal
      → Use at least 12px for body content, 16px is ideal. Small text is hard to read, especially on high-DPI mobile screens
      src/components/dashboard/TimelineChart.impl.tsx:344
      src/components/dashboard/TimelineChart.impl.tsx:350

  ⚠ knip/files                                      ×2
      Unused file
      → This file is not imported by any other file in the project.
      src/components/dashboard/HourlyBreakdown.impl.tsx
      src/components/dashboard/HourlyBreakdown.tsx

  ⚠ react-doctor/rendering-usetransition-loading
      useState for "isLoading" — if this guards a state transition (not an async fetch), consider useTransition instead
      → Replace with `const [isPending, startTransition] = useTransition()` — avoids a re-render for the loading state
      src/components/time-analysis/useTimeAnalysisData.ts:31

  ⚠ react-doctor/js-length-check-first
      .every() over an array compared to another array — short-circuit with `a.length === b.length && a.every(...)` so unequal-length arrays exit immediately
      → Short-circuit with `a.length === b.length && a.every((x, i) => x === b[i])` — unequal-length arrays exit immediately
      src/store/background-status-store.ts:25

  ⚠ react-doctor/js-index-maps
      array.find() in a loop is O(n*m) — build a Map for O(1) lookups
      → Build an index `Map` once outside the loop instead of `array.find(...)` inside it
      src/pages/Projects.tsx:672

  ⚠ react-doctor/no-derived-useState
      useState initialized from prop "initialValue" — if this value should stay in sync with the prop, derive it during render instead
      → Remove useState and compute the value inline: `const value = transform(propName)`
      src/components/ui/prompt-modal.tsx:39

  ⚠ react-doctor/no-react19-deprecated-apis
      useContext is superseded by `use()` on React 19+ — `use()` reads context conditionally inside hooks, branches, and loops; switch to `import { use } from 'react'`
      → Pass `ref` as a regular prop on function components — `forwardRef` is no longer needed in React 19+. Replace `useContext(X)` with `use(X)` for branch-aware context reads. Only enabled on projects detected as React 19+.
      src/components/ui/toast-notification.tsx:1

  ⚠ react-doctor/no-effect-event-handler
      useEffect simulating an event handler — move logic to an actual event handler instead
      → Move the conditional logic into onClick, onChange, or onSubmit handlers directly
      src/components/sync/DaemonSyncOverlay.tsx:58

  ┌─────┐  84 / 100 Great
  │ ◠ ◠ │  ██████████████████████████████████████████░░░░░░░░
  │  ▽  │  React Doctor (www.react.doctor)
  └─────┘

  176 issues across 74/229 files  in 561ms
  Full diagnostics written to /var/folders/mh/pdxysvws74v3zq32ky1z1r680000gn/T/react-doctor-42a1a6bb-f08a-4c06-826a-436c17613a61

  → Share your results: https://www.react.doctor/share?p=dashboard&s=84&w=176&f=74

