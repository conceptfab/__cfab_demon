# Zadanie: weryfikacja i naprawa pozostałych błędów lintu (TIMEFLOW / dashboard)

## Kontekst
- Repo: `/Users/micz/__DEV__/__cfab_demon`, frontend w `dashboard/` (React + TS + Vite + Tauri), gałąź `stable_1.6`.
- Stosuj `CLAUDE.md` z roota: komunikacja po polsku, minimalny zakres zmian, kompatybilność wstecz, aktualizacja `Help.tsx` jeśli zmienia się zachowanie odczuwalne przez użytkownika, terminologia „TIMEFLOW”.
- Stan wyjściowy JEST już częściowo posprzątany:
  - `npm run typecheck` (czyli `tsc -b`) = **0 błędów** — NIE ruszaj tego, nie wprowadzaj regresji.
  - `npm run build` = OK, `npm test` = 80/80, `npx react-doctor@latest . --score` (z roota) = **100/100**.
- Do naprawy zostały **92 problemy z `eslint .`** (`npm run lint` wywołuje `eslint . && lint:i18n-hardcoded && lint:inline-i18n-bridge && lint:locales`). To **dług istniejący wcześniej**, niezwiązany z ostatnią funkcją (range-pickery). Żaden z poniższych nie został wprowadzony tą funkcją.

## Jak odtworzyć
```bash
cd dashboard
npm run typecheck            # musi zostać 0 błędów po Twoich zmianach
npx eslint . -f stylish      # pełna lista 92 problemów
npx eslint . -f json         # do maszynowej analizy
npm run build && npm test    # regresja
cd .. && npx -y react-doctor@latest . --verbose   # musi zostać 100/100
```

## Podział 92 problemów wg reguł
**A. `react-doctor/*` (30) — PODEJRZENIE artefaktu konfiguracji, NIE realnych naruszeń:**
- `async-await-in-loop ×10`, `rendering-hydration-mismatch-time ×9`, `prefer-dynamic-import ×8`, `no-static-element-interactions ×2`, `label-has-associated-control ×1`.
- Hipoteza do **zweryfikowania**: goły `eslint .` nie ma załadowanej wtyczki `react-doctor`, więc te wpisy to najpewniej „Definition for rule … was not found” wynikające z komentarzy `eslint-disable react-doctor/*` w plikach (rzeczywisty skan robi `npx react-doctor`, który daje 100/100). Jeśli tak — **NIE edytuj kodu źródłowego pod te wpisy**; zdiagnozuj źródło (flat config `eslint.config.*` / wersja wtyczki / `package.json#reactDoctor`) i zaproponuj naprawę KONFIGURACJI (albo świadomą decyzję, że to oczekiwane i jak wyciszyć w `eslint .`). Potwierdź hipotezę przez `npx eslint . -f json` i sprawdzenie pola `message`/`ruleId`.

**B. `react-hooks/*` (58) — realne reguły React Compiler, każdą traktuj jako zmianę SEMANTYCZNĄ:**
- `refs ×38`, `set-state-in-effect ×12`, `purity ×5`, `preserve-manual-memoization ×3`.
- To często prawdziwe pułapki (czytanie/mutacja ref w trakcie renderu, `setState` w efekcie zamiast derywacji przy renderze, nieczyste obliczenia, ręczna memoizacja rozjeżdżająca się z zależnościami). **Nie „naprawiaj” przez ślepe wyłączanie reguły.** Dla każdego wystąpienia ustal: czy to realny bug/ryzyko, czy uzasadniony false-positive. Realne — popraw wzorzec. False-positive — `// eslint-disable-next-line react-hooks/<reguła> -- <powód>` z konkretnym uzasadnieniem.

**C. `jsx-a11y/*` (4) — realna dostępność:**
- `no-static-element-interactions ×2`, `click-events-have-key-events ×1`, `label-has-associated-control ×1` (pliki: `Sidebar.tsx`, `TopBar.tsx`, `ui/label.tsx`). Dodaj obsługę klawiatury / role / powiązanie label↔control. Zachowaj istniejące zachowanie myszą.

## Pełna lista plików (cel pracy)
```
src/components/ai/AiFolderScanCard.tsx                         [react-doctor/rendering-hydration-mismatch-time×1]
src/components/ai/AiMetricsCharts.impl.tsx                     [react-doctor/prefer-dynamic-import×1]
src/components/dashboard/AllProjectsChart.impl.tsx             [react-doctor/prefer-dynamic-import×1]
src/components/dashboard/ProjectDayTimeline.impl.tsx           [react-doctor/prefer-dynamic-import×1]
src/components/dashboard/timeline-chart/TimelineChartView.tsx  [react-doctor/prefer-dynamic-import×1]
src/components/data/DataHistory.tsx                            [react-hooks/set-state-in-effect×1, react-doctor/rendering-hydration-mismatch-time×1]
src/components/data/DatabaseBackupCard.tsx                     [react-doctor/rendering-hydration-mismatch-time×1]
src/components/data/DatabaseHealthCard.tsx                     [react-doctor/rendering-hydration-mismatch-time×1]
src/components/data/ImportPanel.tsx                            [react-hooks/refs×1]
src/components/layout/Sidebar.tsx                              [jsx-a11y/no-static-element-interactions×1, react-doctor/no-static-element-interactions×1]
src/components/layout/SidebarStatusPanel.tsx                   [react-doctor/rendering-hydration-mismatch-time×1]
src/components/layout/TopBar.tsx                               [jsx-a11y/no-static-element-interactions×1, jsx-a11y/click-events-have-key-events×1, react-doctor/no-static-element-interactions×1]
src/components/pm/PmCreateProjectDialog.tsx                    [react-hooks/refs×6]
src/components/pm/PmTemplateManager.tsx                        [react-hooks/set-state-in-effect×1]
src/components/settings/PmSettingsCard.tsx                     [react-hooks/set-state-in-effect×1]
src/components/settings/lan-sync/LanSyncPeersSection.tsx       [react-doctor/rendering-hydration-mismatch-time×1]
src/components/settings/lan-sync/LanSyncSettingsSection.tsx    [react-doctor/rendering-hydration-mismatch-time×1]
src/components/settings/online-sync/OnlineSyncLicenseSection.tsx [react-doctor/rendering-hydration-mismatch-time×1]
src/components/sync/BackgroundServices.tsx                     [react-hooks/refs×2]
src/components/sync/DaemonSyncOverlay.tsx                      [react-hooks/refs×1, react-hooks/set-state-in-effect×1]
src/components/sync/LanPeerNotification.tsx                    [react-hooks/refs×4]
src/components/sync/SyncProgressOverlay.tsx                    [react-hooks/refs×9, react-hooks/purity×1, react-doctor/rendering-hydration-mismatch-time×1]
src/components/sync/job-pool-helpers.ts                        [react-doctor/async-await-in-loop×2]
src/components/time-analysis/DailyView.impl.tsx               [react-doctor/prefer-dynamic-import×1]
src/components/time-analysis/MonthlyView.impl.tsx             [react-doctor/prefer-dynamic-import×1]
src/components/time-analysis/WeeklyView.impl.tsx              [react-doctor/prefer-dynamic-import×1]
src/components/ui/label.tsx                                   [jsx-a11y/label-has-associated-control×1, react-doctor/label-has-associated-control×1]
src/hooks/useAiPageController.ts                              [react-hooks/set-state-in-effect×1]
src/hooks/useApplicationsPageController.ts                    [react-hooks/set-state-in-effect×1]
src/hooks/useBackgroundSync.ts                                [react-hooks/refs×1]
src/hooks/useClientsPageController.ts                         [react-hooks/set-state-in-effect×1]
src/hooks/useDatabaseManagementController.ts                  [react-hooks/set-state-in-effect×1]
src/hooks/useJobPool.ts                                        [react-hooks/purity×4, react-hooks/refs×6]
src/hooks/useLanSyncCardController.ts                          [react-hooks/refs×1]
src/hooks/useLanSyncManager.ts                                [react-hooks/set-state-in-effect×2]
src/hooks/usePageRefreshListener.ts                           [react-hooks/refs×1]
src/hooks/useProjectDayTimelineController.ts                  [react-hooks/set-state-in-effect×1]
src/hooks/useProjectsData.ts                                  [react-hooks/refs×1]
src/hooks/useProjectsPageController.tsx                       [react-hooks/preserve-manual-memoization×2]
src/hooks/useReportViewController.ts                          [react-hooks/preserve-manual-memoization×1]
src/hooks/useSessionScoreBreakdown.ts                         [react-hooks/refs×3]
src/hooks/useSessionSplitAnalysis.ts                          [react-hooks/refs×1]
src/hooks/useSessionsData.ts                                  [react-hooks/refs×1]
src/lib/daemon-status-poll.ts                                 [react-doctor/async-await-in-loop×3]
src/lib/lan-sync-poll.ts                                      [react-doctor/async-await-in-loop×3]
src/lib/stream-utils.ts                                       [react-doctor/async-await-in-loop×1]
src/lib/sync/sync-sse.ts                                      [react-doctor/async-await-in-loop×1]
src/pages/ClientPage.tsx                                      [react-hooks/set-state-in-effect×1]
src/pages/TimeAnalysis.impl.tsx                               [react-doctor/prefer-dynamic-import×1]
```

## Twarde zasady
1. **Najpierw weryfikacja, potem kod.** Dla każdego wystąpienia sklasyfikuj: `realny-bug` / `false-positive` / `artefakt-konfiguracji`. Podaj dowód (plik:linia + 1 zdanie dlaczego).
2. **Zero zmian zachowania runtime** bez wyraźnego opisania konsekwencji. Reguły z grupy B potrafią zmienić logikę — przy każdej realnej poprawce opisz, co i dlaczego się zmienia.
3. **Żadnych zbiorczych `eslint-disable` na plik/projekt.** Wyłączenia tylko punktowe (`-next-line`) i tylko dla potwierdzonych false-positive’ów, zawsze z komentarzem-uzasadnieniem.
4. Nie psuj: po zmianach musi zostać `tsc -b` = 0, `npm run build` OK, `npm test` 80/80, `react-doctor` 100/100.
5. Jeśli któraś poprawka dotyka funkcji odczuwalnej przez użytkownika → zaktualizuj `Help.tsx` w tym samym kroku (zwykle nie dotyczy, ale sprawdź np. `Sidebar`/`TopBar` a11y, `label`).
6. Minimalny zakres: nie refaktoruj „przy okazji”, nie zmieniaj niepowiązanych plików, nie dotykaj plików już czystych.

## Oczekiwany rezultat (w tej kolejności)
1. **Raport weryfikacji** zgrupowany regułami: ile realnych, ile false-positive, ile artefakt-konfiguracji; dla grupy A jednoznaczne rozstrzygnięcie hipotezy o konfiguracji (z dowodem z `eslint -f json`).
2. **Plan napraw** (max kilka punktów per grupa reguł), z oznaczeniem ryzyka.
3. **Patche** pogrupowane logicznie (najpierw bezpieczne/mechaniczne: a11y, dynamic-import; potem semantyczne hooki), każdy z krótkim „co i dlaczego”.
4. **Dowód weryfikacji**: wklejone wyniki `tsc -b`, `eslint .` (liczba problemów przed/po), `npm test`, `react-doctor --score`.

Zacznij od raportu weryfikacji i planu; wstrzymaj się z masowymi zmianami semantyki hooków do akceptacji planu.
