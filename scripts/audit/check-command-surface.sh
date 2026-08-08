#!/usr/bin/env bash
# Porownuje TRZY rejestry komend Tauri i wypisuje roznice.
#
# DLACZEGO: komenda musi byc zarejestrowana w trzech miejscach —
#   1. #[tauri::command] w commands/*.rs
#   2. invoke_handler(generate_handler![...]) w lib.rs      -> desktop
#   3. webui/rpc_generated.rs (node scripts/gen_webrpc.cjs) -> webui/telefon
#
# Brak (3) = komenda dziala na desktopie i CICHO nie dziala w webui.
# gen_webrpc.cjs --check tego NIE wykryje, gdy generator swiadomie POMINAL
# komende (parametr Window/WebviewWindow/State) — wtedy plik jest "aktualny",
# a funkcja i tak jest niedostepna. Ten skrypt pokazuje takie przypadki.
set -uo pipefail
cd "$(dirname "$0")/../.."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DEFS=$(grep -rc "^#\[tauri::command" dashboard/src-tauri/src/ 2>/dev/null \
  | awk -F: '{s+=$2} END {print s+0}')

awk '/invoke_handler\(tauri::generate_handler!\[/,/\]\)/' \
  dashboard/src-tauri/src/lib.rs \
  | grep -o 'commands::[a-z_0-9]*' | sed 's/commands:://' | sort -u > "$TMP/handler.txt"

grep -oE '^[[:space:]]*"[a-z_0-9]+" =>' dashboard/src-tauri/src/webui/rpc_generated.rs \
  | tr -d ' "=>' | sort -u > "$TMP/rpc.txt"

echo "definicje #[tauri::command] : $DEFS"
echo "rejestracje w invoke_handler: $(wc -l < "$TMP/handler.txt" | tr -d ' ')"
echo "mostek webui rpc_generated  : $(wc -l < "$TMP/rpc.txt" | tr -d ' ')"
echo

echo "--- W invoke_handler, BRAK w webui (nie dziala na telefonie) ---"
comm -23 "$TMP/handler.txt" "$TMP/rpc.txt" || true
echo
echo "--- W webui, BRAK w invoke_handler (osierocone) ---"
comm -13 "$TMP/handler.txt" "$TMP/rpc.txt" || true
echo
echo "--- Co generator swiadomie pomija (parametr Window/State) ---"
(cd dashboard/src-tauri && node scripts/gen_webrpc.cjs 2>&1 | grep -i "skipped" || echo "(nic)")
echo
echo "UWAGA: kazda pozycja na liscie 'BRAK w webui' wymaga decyzji —"
echo "albo front ukrywa ta funkcje w trybie webui, albo tlumaczy jej brak."
