# TIMEFLOW — instrukcje projektu (AGENTS.md)

## 1) Język i styl pracy
- Komunikuj się po polsku.
- Pisz zwięźle i precyzyjnie (bez długich wstępów).
- Gdy zmiana dotyka >2 plików lub niesie ryzyko regresji: najpierw plan w max 5 punktach, potem implementacja.
- Jeśli brakuje kluczowych danych (ścieżki, API, wymagania): zadaj maks. 3 pytania doprecyzowujące i wstrzymaj implementację.

## 2) Zasady produktu i brandingu
- Nazwa produktu w UI, komunikatach, tytułach, logach aplikacji: zawsze `TIMEFLOW` (wielkie litery).
- Nie refaktoruj identyfikatorów w kodzie tylko po to, by wymusić `TIMEFLOW` (zmienne/pliki trzymają się konwencji repo).
- Terminologia: używaj spójnych nazw funkcji/pojęć w całej aplikacji (UI + Help + komunikaty).

## 3) Dokumentacja: panel pomocy (Help.tsx) — obowiązkowe
Definicja „nowej funkcji” (wymaga aktualizacji Help.tsx):
- Nowy ekran / nowa sekcja UI.
- Nowa opcja/ustawienie lub nowy tryb działania.
- Nowy endpoint / nowy background job / nowy typ danych, który użytkownik odczuwa.
- Zmiana zachowania istniejącej funkcji (nawet bez zmiany UI), jeśli wpływa na użytkownika.

Zasady aktualizacji Help.tsx:
- Aktualizuj Help.tsx w tym samym PR/commicie co funkcję.
- Teksty mają być: krótkie, konkretne, zorientowane na użytkownika końcowego (bez żargonu implementacyjnego).
- Opis powinien zawierać: „co to robi”, „kiedy użyć”, „jakie ma ograniczenia/konsekwencje” (jeśli dotyczy).
- Utrzymuj spójny format i kolejność sekcji (nie mieszaj stylów).
- Jeśli funkcja ma parametry/ustawienia: opisz je listą z krótkim wyjaśnieniem.

Checklist (przed zakończeniem zadania z nową funkcją):
- [ ] Implementacja działa.
- [ ] Help.tsx zaktualizowany.
- [ ] Terminologia spójna (UI/Help/logi).
- [ ] Brak zbędnych zmian stylistycznych w niepowiązanych plikach.

## 4) Standardy zmian w kodzie
- Minimalizuj zakres: nie rób „przy okazji” refaktorów bez uzasadnienia.
- Zachowuj kompatybilność wstecz, chyba że jawnie poproszono o breaking change.
- Preferuj małe, czytelne kroki i jasne nazwy.
- Nie dodawaj zależności bez powodu; jeśli dodajesz, uzasadnij (1 zdanie) i upewnij się, że jest używana.
- Nie wprowadzaj sekretów/kluczy do repo (żadnych tokenów, haseł, URL-i z kredencjałami).
- Jeśli dotykasz UI: dbaj o stany (loading/empty/error) tam gdzie ma to sens.
- Jeśli dotykasz logiki: dodaj/aktualizuj testy lub chociaż opisz scenariusze manualne (gdy testów brak).

## 5) Uruchamianie, testy i komendy (uzupełnij w repo)
Wklej tutaj realne komendy dla projektu (Codex ma je wykonywać/zakładać):

- Instalacja: `<npm|pnpm|bun> install`
- Dev: `<...>`
- Build: `<...>`
- Test: `<...>`
- Lint/format: `<...>`

Zasada:
- Przed zakończeniem zadania: uruchom (lub załóż uruchomienie) linta i testy, jeśli są skonfigurowane.
- Gdy nie da się uruchomić komend w środowisku: wypisz dokładnie, co należy uruchomić lokalnie i jakiego wyniku oczekujesz.

## Format odpowiedzi (gdy prosisz o zmianę w kodzie)
- 1–2 zdania: co zmieniasz i dlaczego.
- Lista plików, które zmieniasz (jeśli >1).
- Kroki testu: jak sprawdzić (manualnie lub testami).

<claude-mem-context>
# Memory Context

# [__cfab_demon] recent context, 2026-04-24 10:31am GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (16,130t read) | 198,287t work | 92% savings

### Apr 23, 2026
S8 User asked whether building only on Mac is sufficient for diagnostics — clarified that both Mac and Windows builds are required to get full [DIAG] coverage from both sides of the LAN sync (Apr 23 at 8:44 AM)
S10 Fix AI model settings saving in both versions of the cfab_demon dashboard (Apr 23 at 8:44 AM)
S18 Fix AI settings save bug — user changed training horizon days to 60 but displayed 244 after pressing Save in cfab_demon dashboard (Apr 23 at 8:47 AM)
S21 LAN sync broken — local projects not transferring, sessions showing as UNASSIGNED after sync (Apr 23 at 8:55 AM)
S39 Fix macOS daemon recording activity during system sleep — full root cause analysis and fix plan (Apr 23 at 9:11 AM)
S42 macOS Sleep Bug Fix — cfab_demon phantom activity during sleep — full implementation complete and verified (Apr 23 at 10:10 AM)
S54 macOS native window controls (traffic lights) integration in Tauri dashboard — replacing custom minimize/maximize/close buttons with native macOS traffic lights (Apr 23 at 10:24 AM)
S62 macOS titlebar redesign: native traffic-light dots in default position + TIMEFLOW logo moved to right side of window (Windows unchanged) (Apr 23 at 5:51 PM)
S73 TIMEFLOW Comprehensive Codebase Audit — raport.md Written (Apr 23 at 5:59 PM)
S74 Implementation Plan Initiated from TIMEFLOW Audit Report (Apr 23 at 9:29 PM)
### Apr 24, 2026
300 9:36a ✅ P0 Security Commit Landed: LAN Pairing Hardening
302 " 🔴 P1 Fix: Background Activity Elapsed Uses effective_elapsed, Not actual_elapsed
303 " ✅ All P0/P1 Security and Correctness Tests Pass
304 9:39a ✅ P1 Fixes Committed: Online Sync Join + Idle Elapsed Alignment
305 9:40a 🔴 Dashboard i18n Hardcoded String Fixes — AiBatchActionsCard and SessionContextMenu
306 " 🔴 Polish Locale File Extended with Missing i18n Keys for AI Batch and Session Menu Modes
307 9:41a 🔴 English Locale File Extended with Missing i18n Keys for AI Batch and Session Menu Modes
308 " 🔵 Dashboard TypeScript Typecheck Reveals 25+ Pre-existing Errors Across Multiple Files
309 " 🔵 i18n Hardcoded Linter Finds 2 Remaining Polish Template Literals in useSettingsFormState.ts
310 9:42a 🔴 DB Init Cache Now Validates File Existence Before Skipping Re-initialization
311 9:43a 🔴 Tauri: Reinitialize Missing Cached Database File
312 9:49a 🔵 macOS CPU Measurement Uses sysinfo cpu_usage() — Fundamentally Different from Windows FILETIME Delta
313 " 🔵 Tracker Sleep Detection Uses 30s Wall-vs-Uptime Gap Threshold
314 9:50a 🔴 macOS CPU Measurement Replaced: sysinfo cpu_usage() → libproc proc_pidinfo() Delta
315 9:54a 🔴 macOS CPU Measurement: Delta-Based Calculation Replaces Snapshot
316 9:58a 🟣 macOS Window Title Detection Module Added via core-graphics Crate
317 " 🟣 macOS frontmost_window_title() Implemented via CGWindowList API
318 9:59a 🔴 macOS Window Title No Longer Empty — CGWindowList Replaces Placeholder
319 " ✅ Help Page Updated with macOS Window Title Feature Documentation Key
320 " ✅ Polish Locale String Added for macOS Window Title Help Entry
321 " ✅ PARITY.md: window_title Row Updated from Stub to CGWindowList OK
322 10:00a 🔵 Rust Compile Error: platform::macos Module Is Private — Must Use Re-exported Path
324 " 🔵 platform/mod.rs Uses Glob Re-export: pub use macos::* Flattens Platform API
325 " 🔴 monitor_macos.rs: Fixed Private Module Path for window_title Call
327 10:02a ✅ plan_implementacji.md Progress: Tasks 3 and 4 Complete, Task 7 DST Fix Now In Progress
328 " 🔴 DST Fix: wall_delta_since() Helper Added Using SystemTime in tracker.rs
329 10:03a 🔴 DST Fix: tracker.rs Wall-Clock Tracking Switched from DateTime&lt;Local&gt; to SystemTime
330 10:05a 🔴 DST Fix Complete: wall_delta_since() Unit Test Passes, cargo check Clean
331 10:09a 🔴 Task 7 Committed: SystemTime Sleep Gap Detection Fix
332 " ✅ plan_implementacji.md Phase Shift: macOS Tray i18n, RAII is_training, AI Confidence Validation
333 10:10a 🔵 macOS Tray Uses Hardcoded English Strings — i18n System Exists But Is Bypassed
334 " 🔵 i18n load_language() Returns Lang::Pl Fallback on macOS — No macOS Config Path Defined
335 " 🔴 macOS Tray Menu Items Now Use i18n System Instead of Hardcoded English
336 " ✅ PARITY.md: Tray i18n Row Updated from Hardcoded EN to TrayText::* OK
337 10:11a 🔴 Task 17: macOS Tray Menu i18n Fix Committed
338 " 🔵 Task 11 Investigation: is_training Guard Already Uses DB-Level CAS Pattern
339 10:13a 🔴 Task 11: RAII IsTrainingGuard Implemented in training.rs
340 " 🔵 Cargo Test Fails Due to Stale Tauri Build Artifact Path
341 10:16a 🔴 Task 11 Committed: RAII is_training Guard in training.rs
342 10:17a 🔴 Task 12: AI Confidence Cross-Validation Added to set_assignment_mode
343 " 🔴 Task 12: Frontend Confidence Validation Added to AI.tsx handleSaveMode
344 10:18a 🔵 Pre-existing TypeScript Typecheck Failures Found on codex Branch
347 10:21a 🔴 Task 12 Committed: AI Confidence Threshold Validation
348 10:22a ⚖️ Plan Pivots to P1 LAN Sync: Merge Mutex and Tombstone Keys
349 " 🔵 LAN Sync Merge Architecture: Tombstone sync_key Portability Gap Confirmed
350 " 🔴 MERGE_MUTEX Added to sync_common.rs — Prevents Concurrent Merge Races
351 10:24a 🔴 Task 8 (Partial) Committed: MERGE_MUTEX Serializes Sync Merges
352 10:25a 🔵 Tombstone Trigger sync_key Confirmed in m12_delta_sync.rs — Migration Required to Fix
353 " 🔴 Migration m21: Tombstone Session sync_key Changed to exe_name|start_time
354 " 🔴 sync_common.rs Tombstone Consumer Updated for exe_name|start_time Format

Access 198k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>