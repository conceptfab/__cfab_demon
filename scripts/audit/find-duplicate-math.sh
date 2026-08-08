#!/usr/bin/env bash
# Wypisuje kandydatow na "drugi algorytm": miejsca, ktore agreguja czas lub kwoty
# poza wyznaczonym zrodlem prawdy.
#
# ZRODLA PRAWDY w TIMEFLOW:
#   czas projektu       -> dashboard/src-tauri/src/commands/time_algorithm.rs
#   czas per aplikacja  -> time_algorithm::distribute_app_seconds
#   zaokraglenie        -> dashboard/src/lib/rounding.ts (TYLKO prezentacja)
#   kwota               -> dashboard/src-tauri/src/commands/estimates.rs
#
# To NIE jest bramka — to narzedzie inwentaryzacji. Wynik przeklejasz do
# dokumentu ustalen i oceniasz recznie wg trzech pytan z INSTRUKCJA-AUDYTU.md.
set -uo pipefail
cd "$(dirname "$0")/../.."

echo "=============================================================="
echo " 1. BACKEND: agregacja czasu w SQL poza time_algorithm.rs"
echo "=============================================================="
grep -rn --include='*.rs' -E "SUM\(" dashboard/src-tauri/src src shared \
  | grep -v 'time_algorithm.rs' \
  | grep -v '/tests\.rs' \
  | grep -iE 'duration|second|time' \
  || echo "(brak)"

echo
echo "=============================================================="
echo " 2. BACKEND: kto NIE wola distribute_app_seconds, a robi"
echo "    rozbicie per aplikacja (kandydat na ustalenie C-01)"
echo "=============================================================="
echo "--- pliki produkujace TopApp / rozbicie per aplikacja:"
grep -rln --include='*.rs' "TopApp" dashboard/src-tauri/src | grep -v '/tests\.rs'
echo "--- pliki wolajace distribute_app_seconds:"
grep -rln --include='*.rs' "distribute_app_seconds(" dashboard/src-tauri/src \
  | grep -v 'time_algorithm.rs'
echo "  >> Roznica tych dwoch list to lista ustalen."

echo
echo "=============================================================="
echo " 3. FRONT: agregacja sekund poza rounding.ts"
echo "=============================================================="
grep -rn --include='*.ts' --include='*.tsx' \
  -E 'reduce\(|\+= *[a-zA-Z_]*([Ss]econds|[Dd]uration)' \
  dashboard/src \
  | grep -viE '\.test\.|__tests__' \
  | grep -iE 'second|duration|elapsed|total|sum' \
  || echo "(brak)"

echo
echo "=============================================================="
echo " 4. FRONT: wlasna arytmetyka dat i przedzialow"
echo "=============================================================="
grep -rn --include='*.ts' --include='*.tsx' \
  -E 'getTime\(\) *-|differenceIn|addSeconds|overlap' \
  dashboard/src \
  | grep -viE '\.test\.|__tests__' \
  || echo "(brak)"

echo
echo "=============================================================="
echo " 5. PIENIADZE: stawki, mnozniki, koszty"
echo "=============================================================="
grep -rn --include='*.rs' -E 'hourly_rate|rate_multiplier|multiplier' \
  dashboard/src-tauri/src src shared | grep -v '/tests\.rs' | grep -v 'mod tests'
