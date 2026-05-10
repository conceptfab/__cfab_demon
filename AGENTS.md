# TIMEFLOW — instrukcje projektu (AGENTS.md)

## 0) PRO TIPY I WSKAZÓWKI
  → Double-check your output before presenting it. Verify that your changes actually address what the user asked for.
  → Re-read the user's last message before responding. Follow through on every instruction completely.
  → When the user corrects you, stop and re-read their message. Quote back what they asked for and confirm before proceeding.
  → When stuck, summarize what you've tried and ask the user for guidance instead of retrying the same approach.
  → Read the full file before editing. Plan all changes, then make ONE complete edit. If you've edited a file 3+ times, stop and re-read the user's requirements.
  → After 2 consecutive tool failures, stop and change your approach entirely. Explain what failed and try a different strategy.
  → Every few turns, re-read the original request to make sure you haven't drifted from the goal.
__cfab_demon  codex is 📦 v0.2.0 

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

# [__cfab_demon] recent context, 2026-04-30 8:17pm GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (21,614t read) | 953,612t work | 98% savings

### Apr 27, 2026
S758 LAN Sync Pairing Asymmetry Fix — Full implementation of mutual pairing fix for Windows master / macOS client divergence (Apr 27 at 12:56 PM)
S764 LAN Sync Completely Broken After Apr 27 Pairing Refactor — Both Delta and Force Sync Non-Functional (Apr 27 at 1:11 PM)
S770 LAN Sync — Slave (Windows/MICZ_NX) not receiving full database after sync; investigation of root cause (Apr 27 at 1:17 PM)
S779 LAN Sync Completely Broken After Last Refactoring Session — Both Delta and Force Sync Non-Functional (Apr 27 at 1:25 PM)
1008 1:27p 🔵 __cfab_demon sync_markers and sync_merge_log Full Schema Confirmed
1009 1:28p 🔵 __cfab_demon LAN Sync Merge Logic Detailed — Sessions, Manual Sessions, Tombstones Resolution Strategy
1011 " 🔵 __cfab_demon sessions.updated_at Triggers — Critical Sync Guard Behavior Confirmed
1012 1:30p 🟣 __cfab_demon — Diagnostic Sync Roundtrip Test Added to sync_common.rs
1013 " 🔵 __cfab_demon Is a Binary-Only Crate — Tests Must Use `cargo test` Not `cargo test --lib`
1014 " 🔵 __cfab_demon Diagnostic Roundtrip Test PASSES — Core Sync Merge Logic Is Correct
1015 " 🟣 __cfab_demon — Second Diagnostic Test Added: Shared App Name with Different Local IDs
S780 LAN Sync Data Loss — Detailed Diagnostic State Captured Before Two-Machine Test (Apr 27 at 1:32 PM)
1016 1:33p 🔵 LAN Sync Investigation — Work Paused for Two-Machine Compile and Test
1017 1:34p 🔵 LAN Sync Data Loss — Detailed Diagnostic State Captured Before Two-Machine Test
S782 LAN Sync Data Loss — Save Investigation Status Before Two-Machine Compile and Test (Apr 27 at 1:34 PM)
S788 LAN Sync Full Sync Destroys Slave Data — Two-Machine Hardware Test Confirmed, Root Cause Investigation (Apr 27 at 1:34 PM)
1018 2:16p 🔵 LAN Sync Full Sync Destroys Slave's Own Data — Critical Bug Confirmed via Hardware Test
1020 2:17p 🔵 LAN Sync Slave-Side Full Sync Flow Mapped — verify_merge_integrity Confirmed to Zero project_id
1021 " 🔵 LAN Sync Data Loss Root Cause — verify_merge_integrity Deletes Sessions with Orphan app_id
S790 LAN Sync Completely Broken After Refactor — Both Delta and Force Sync Non-Functional (Apr 27 at 2:18 PM)
1023 2:20p 🔵 LAN Sync Completely Broken After Refactor — Both Delta and Force Sync Non-Functional
S795 Version Bumped to 0.1.5699 for LAN Sync Fix Release (Apr 27 at 2:20 PM)
1024 2:22p 🔴 LAN Full Sync Data Loss — Tombstones Suppressed in Full Snapshots
1025 " 🔴 LAN Pull Endpoint — full_sync Flag Added to Suppress Tombstones on Slave Side
1026 " 🔴 sync_common::build_full_export — Switched to Tombstone-Free Snapshot
1027 2:23p 🔵 Orchestrator pull_body Missing full_sync Flag
1028 " 🔴 Orchestrator pull_body Now Passes full_sync Flag to Slave
1029 2:24p 🔴 Merge Ordering Fix — Tombstones Now Applied Before Record Inserts
1031 2:26p 🔵 LAN Sync Fixes Compile Clean — cargo check Passes With No Errors
1033 " 🟣 Regression Test Added: Full Sync Must Not Lose Records When Tombstones Present
1034 2:27p 🔴 LAN Sync Data-Loss Fix Verified — All 3 Diagnostic Tests Pass GREEN
1035 " 🔴 LAN Sync Fix Complete — Full Test Suite 34/34 PASS
1036 2:28p 🔵 Tauri Dashboard Bridge Also Compiles Clean After LAN Sync API Changes
1037 " ✅ Version Bumped to 0.1.5699 for LAN Sync Fix Release
S796 LAN Sync Completely Broken After Refactor — Critical Data Loss Fixed (Tombstones in Full Sync + Merge Ordering) (Apr 27 at 2:28 PM)
### Apr 30, 2026
1241 7:54p 🔵 Synchronization Audit Initiated for cfab_demon Application
1242 " 🔵 cfab_demon (TimeFlow) Dual-Mode Sync Architecture Mapped
1243 " 🔵 Sync Merge Engine: Last-Write-Wins with Tombstones, Mutex, and DB Freeze
1244 " 🔵 Frontend Sync Orchestration: SSE Push + Job Pool Intervals + Exponential Backoff
1245 7:55p 🔵 Sync Architecture Audit: useJobPool + LAN Sync System
1246 7:56p 🔵 run_lan_sync Rust Command Ignores the `since` Timestamp Parameter
1247 " 🔵 invokeMutation Auto-Fires LOCAL_DATA_CHANGED_EVENT, Triggering 1.5s Sync Debounce
1248 " 🔵 Online Sync Settings Stored Plaintext Including auth_token
1249 " 🔵 Database Schema Uses updated_at Triggers and Tombstones Table for Delta Sync
1250 " 🔵 useJobPool Event Loop: 1s Tick + Visibility Guard + Startup Sync
1251 7:57p 🔵 Sync Test Coverage: 18 Frontend + 13 Rust Tests Pass; No Tests for Core Sync Logic
1252 " 🔵 Daemon Config: sync_mode Field ("session"/"async"/"auto") + tombstone GC + group_id
1253 " 🔵 Security Audit Document: 20 HTTP Endpoints, None Yet Reviewed; 4 Known Gaps
1255 " 🔵 LAN Sync Orchestration: 13-Step Master Flow with MERGE_MUTEX, SyncGuard, and Pre-Sync Backup
1254 7:58p 🔵 LAN Server Security: Access-Control-Allow-Origin: * on All Responses + Unauthenticated Trigger Endpoints
1256 7:59p 🔵 LAN Sync Broken Across All Modes — Master/Slave Merge Flow Identified
1257 8:08p 🟣 LAN Sync Convergence Snapshot — Master Pulls, Merges, Pushes Back to Slave
1258 8:10p 🟣 Rust Unit Test Suite Added to sync_common.rs — Convergence Protocol Verified In-Memory
1259 " 🔵 sync_common.rs — MERGE_MUTEX Serializes Concurrent Merges; normalize_ts Handles Mixed Timestamp Formats
1260 " 🟣 LanSyncSimulator Test Harness Added — Three Parametric Tests Cover Delta+Full Mode Convergence
1261 8:11p 🟣 LanSyncSimulator Tests Pass — 10/13 sync_common Tests Green; Dashboard Bumped to v0.1.5699
1262 " 🔴 Core Merge Logic Fixed — Tombstones Now Included in Full Snapshots With Local Guard Preventing Row Resurrection
1263 8:15p 🔵 TIMEFLOW Project Build Structure — Rust Workspace with Tauri Dashboard and Daemon Binary
1264 " 🟣 scripts/lan_sync_simulator.py — Python Harness to Run LAN Sync Rust Tests by Suite Name
1265 " 🟣 scripts/lan_sync_simulator.py Verified Working — 3 Tests Pass in 0.01s, Cargo.lock Auto-Restored

Access 954k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>