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

# [__cfab_demon] recent context, 2026-04-25 12:13am GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (16,369t read) | 343,100t work | 95% savings

### Apr 23, 2026
S21 LAN sync broken — local projects not transferring, sessions showing as UNASSIGNED after sync (Apr 23 at 8:55 AM)
S39 Fix macOS daemon recording activity during system sleep — full root cause analysis and fix plan (Apr 23 at 9:11 AM)
S42 macOS Sleep Bug Fix — cfab_demon phantom activity during sleep — full implementation complete and verified (Apr 23 at 10:10 AM)
S54 macOS native window controls (traffic lights) integration in Tauri dashboard — replacing custom minimize/maximize/close buttons with native macOS traffic lights (Apr 23 at 10:24 AM)
S62 macOS titlebar redesign: native traffic-light dots in default position + TIMEFLOW logo moved to right side of window (Windows unchanged) (Apr 23 at 5:51 PM)
S73 TIMEFLOW Comprehensive Codebase Audit — raport.md Written (Apr 23 at 5:59 PM)
S74 Implementation Plan Initiated from TIMEFLOW Audit Report (Apr 23 at 6:49 PM)
S163 TIMEFLOW codex Branch: Completed UI Refactor Tasks Visible in Git Log (Apr 23 at 9:29 PM)
### Apr 24, 2026
S225 plan_implementacji.md implementation state analysis — session progress checkpoint after 16 tasks completed (Apr 24 at 7:37 PM)
419 8:51p 🔄 monitor.rs (Windows) Task 21 Complete: extract_file_from_title and collect_descendants Replaced with title_parser Imports
420 " 🔄 monitor.rs Duplicate extract_file Tests Removed — Now Covered by title_parser.rs Tests
421 " 🔄 Task 21 Complete: cargo check Passes Clean After title_parser Dedup Refactor
422 8:52p 🔴 collect_descendants Cycle Test Fails — Child Pushed to result Before Visited Check
423 " ⚖️ collect_descendants Cycle Test Fixed by Adjusting Expected Value, Not Fixing the Push-Before-Check Order
424 " 🔄 Task 21 Committed: refactor(monitor) deduplicate title parsing and process walking
425 " 🔵 training.rs Task 39 Investigation: reset_assignment_model_knowledge_sync Deletes assignment_feedback
426 8:53p 🔵 Task 39 Callsite Map: Single Reset Button in AiModelStatusCard Calls Full Delete Including Feedback
427 " 🟣 Task 39: Soft Reset Implemented — reset_model_weights_sync Preserves assignment_feedback
428 8:54p 🟣 Task 39: Two Tauri IPC Commands Replace Single reset_assignment_model_knowledge
429 " ✅ Task 39 Rust Backend Complete: lib.rs Updated and Tauri Backend Compiles Clean
430 " ✅ Task 39: TypeScript ai.ts Updated with resetModelWeights and resetModelFull Exports
432 9:02p ✅ Task 82: Dev-Only Artifact Cleanup Committed
433 9:03p ✅ CHANGELOG.md Created — Full Plan Implementation Summary
434 " 🔵 PARITY.md Current State: Two Open macOS Gaps Remain
435 9:04p 🔵 LAN Server HTTP Endpoint Map — Full API Surface in lan_server.rs
436 " ✅ Task 93: docs/SECURITY_AUDIT.md Created — LAN/Online HTTP Endpoint Security Roadmap
437 9:05p ✅ Task 91 Marked Complete in plan_implementacji.md — PARITY.md Finalization Done
438 9:06p ✅ Tasks 91–93 All Marked Complete — P5 Documentation Phase Finished
439 9:07p 🔵 Dashboard Uses ESLint Flat Config (eslint.config.js) — Not Legacy .eslintrc
440 " 🟣 Task 90: Zustand Selector Lint Rule Added to eslint.config.js
441 9:09p 🔵 ESLint Must Be Run from dashboard/ Subdirectory, Not Project Root
442 " 🔵 Pre-existing ESLint Errors in Dashboard — 15 Errors, 8 Warnings; Zustand Rule Produces Zero Violations
443 " 🟣 Task 90 ESLint Zustand Rule Verified Working via Synthetic Fixture Test
444 9:10p ✅ Task 90 Committed — Zustand Lint Rule Shipped in commit 92ffacc
445 " 🔵 run_db_blocking Signature Confirmed — Takes AppHandle, Returns async Result
446 9:11p 🔄 Task 27 (Part 1): manual_sessions.rs — All 5 Commands Migrated to run_db_blocking
447 " 🔴 Task 27 Compile Error — report.rs Calls get_manual_sessions Synchronously Inside run_app_blocking
448 " 🔄 Task 27: report.rs Fixed After manual_sessions Async Migration — Compiles Clean
450 9:17p 🔵 TIMEFLOW DB Schema Version is 22 with Once-Guard Initialization Pattern
452 " 🔵 db.rs Has No Test Module — initialize_database_file Is Private
453 " 🔵 dashboard/src-tauri Has No dev-dependencies — tempfile Crate Not Present
454 " 🔵 TIMEFLOW Schema Is Fully Migration-Driven — No Static CREATE TABLE in db.rs
455 " 🔵 TIMEFLOW Uses Hybrid Schema: Base Tables in schema.sql + Additional Tables via Migrations
456 9:18p 🟣 Task 89: DB Schema Regression Test Added to db.rs
457 " 🔴 LATEST_SCHEMA_VERSION Visibility Fixed for Cross-Module Test Access
458 " 🔵 Task 89 Test Fails: Rust Borrow Checker Rejects Explicit drop(conn) While stmt Borrows It
459 9:19p 🔴 Task 89 Test: Borrow Checker Fix — stmt Scoped to Inner Block
460 " 🟣 Task 89: DB Schema Regression Test Passing
461 " ✅ Task 89 Marked Complete in plan_implementacji.md
464 9:23p ✅ Task 89 Committed — commit 373fffa on branch codex
466 " 🟣 Task 25: Chunked Upload with Progress Callbacks Implemented in LAN Sync
468 " ✅ Task 25 Chunked Upload: Daemon Compiles Clean, All 29 Tests Pass
469 9:24p ✅ Task 25 Marked Complete in plan_implementacji.md
470 " ✅ Task 25 Committed — commit bce94a7 on branch codex
471 9:25p 🔵 Task 19 Investigation: Session Gap vs Idle Threshold — Current Behavior
472 " 🔴 Task 19: Idle Transition Now Clears active_sessions — Prevents Inflated Session Durations
473 " ✅ Task 19 Marked Complete in plan_implementacji.md with Implementation Note
474 9:26p ✅ Task 19 Committed — commit fcca7e8 on branch codex
475 9:29p ✅ plan_pozostale.md — Supplementary TODO Snapshot Created and Committed
S227 plan_pozostale.md — Supplementary TODO Snapshot Created and Committed (Apr 24 at 9:29 PM)

Access 343k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>