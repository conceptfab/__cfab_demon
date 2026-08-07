# Archiwum dokumentacji

Materiały do **jednorazowego** użytku, których zadanie zostało wykonane: specyfikacje
i plany wdrożonych funkcji, zakończone audyty, prompty do konkretnych porządków.

Trzymamy je, bo tłumaczą **dlaczego** kod wygląda tak, jak wygląda — przy grzebaniu
w sync, zaokrąglaniu czy MCP szybciej znaleźć uzasadnienie tutaj niż odtwarzać je
z diffów. Nie są jednak aktualnym opisem systemu i nie należy na nich polegać przy
nowej pracy.

## Co zostaje poza archiwum

W `docs/` mają leżeć wyłącznie dokumenty **żywe** — czytane w trakcie normalnego
rozwoju:

| Plik | Do czego służy |
|---|---|
| `CODING_STYLE.md` | konwencje kodu (selektory Zustand itd.) |
| `SECURITY_AUDIT.md` | tracker przeglądu endpointów LAN/online, wciąż z otwartymi pozycjami |
| `TODO.md` | zasady projektu (m.in. „każda nowa funkcja → `Help.tsx`") |
| `AI_OPTIMAL_SETTINGS.md` | aktualne wartości strojenia modelu przypisań |
| `data-flow.html` | diagram przepływu danych |
| `superpowers/specs/` | specyfikacje funkcji **jeszcze niewdrożonych** |

## Kiedy przenosić tutaj

Spec — gdy wszystkie jego fazy trafiły do `stable`. Plan — gdy został wykonany.
Audyt lub prompt — gdy wynikające z niego zmiany są w kodzie.

## Zawartość

- `plans/` — wykonane plany wdrożeniowe (sync online, MCP, spójność czasu, koszty, zadania)
- `specs/` — specyfikacje funkcji już wydanych
- `AUDIT-time-consistency.md` — audyt zliczania i zaokrąglania czasu; poprawki w `plans/2026-07-03-time-consistency-fixes.md`
- `PLAN-rounding-clients.md` — zaokrąglanie czasu i panel klientów; oba wdrożone
- `MCP_PROJECT_EDITING_MISSING_COMMANDS.md` — lista brakujących komend MCP; wszystkie istnieją dziś w `mcp/tools.rs`
- `PROMPT-lint-fixes.md`, `prompt.md` — prompty do zakończonych porządków
