# Serwer MCP w TIMEFLOW — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wbudowany serwer MCP (Streamable HTTP, endpoint `POST /mcp` na istniejącym serwerze webui, port 47892), przez który agenci (Claude Code, Codex) pracują na danych TIMEFLOW (projekty, klienci, sesje) — z kurowanym zestawem narzędzi, konfigurowalnymi uprawnieniami (domyślnie tylko odczyt), obowiązkowym backupem bazy przy każdym nowym połączeniu MCP, zakładką Ustawienia → MCP, ikoną statusu w sidebarze i sekcją Help.

**Architecture:** Nowy moduł Rust `dashboard/src-tauri/src/mcp/` (config, protokół JSON-RPC, rejestr narzędzi, sesje+backup) podpięty jako trasa `POST /mcp` w istniejącym serwerze HTTP `webui/server.rs`. Wykonanie narzędzi deleguje do istniejącego `webui::rpc::dispatch` (który używa auto-generowanego mostka `rpc_generated.rs`) — zero duplikacji logiki biznesowej. Autoryzacja: dedykowany, długożyciowy token Bearer w `mcp_settings.json` (wzorzec: LAN secret), zawsze wymagany (w odróżnieniu od `/rpc` nie ufamy loopbackowi, bo klienci MCP mogą ustawiać nagłówki). Backup przy `initialize` jest fail-closed: bez udanego backupu sesja nie startuje.

**Tech Stack:** Rust (Tauri v2, std::net TcpListener — bez nowych zależności), React 19 + TypeScript + Tailwind (frontend), SQLite (VACUUM INTO dla backupu), i18n (en/pl w `dashboard/src/locales/*/common.json`).

---

## Decyzje projektowe (potwierdzone z użytkownikiem)

1. **Transport:** Streamable HTTP na porcie webui (47892), endpoint `/mcp`. Klienci: `claude mcp add --transport http`, Codex przez `url` w config.toml. Bez SSE (`GET /mcp` → 405) — każda odpowiedź to pojedynczy JSON, co jest zgodne ze specyfikacją Streamable HTTP.
2. **Uprawnienia:** przełącznik w Ustawieniach: tylko-odczyt (domyślnie) / odczyt+zapis. W trybie odczytu narzędzia zapisujące są ukryte w `tools/list` i odrzucane w `tools/call`.
3. **Narzędzia:** kurowany zestaw 11 narzędzi domenowych (tabela w Task 3), rozszerzalny rejestr.
4. **Backup:** przy każdym `initialize` (nowa sesja klienta MCP) → `VACUUM INTO` do `<data_dir>/mcp_backups/` z rotacją 20 plików. Fail-closed.

## Mapa plików

**Nowe (backend):**
- `dashboard/src-tauri/src/mcp/mod.rs` — glue, globalny stan sesji, status
- `dashboard/src-tauri/src/mcp/config.rs` — `McpConfig` → `mcp_settings.json`
- `dashboard/src-tauri/src/mcp/protocol.rs` — typy JSON-RPC 2.0 + budowanie odpowiedzi MCP
- `dashboard/src-tauri/src/mcp/tools.rs` — rejestr narzędzi + dispatch
- `dashboard/src-tauri/src/mcp/backup.rs` — backup przed sesją + rotacja
- `dashboard/src-tauri/src/commands/mcp_server.rs` — komendy Tauri (status/config/token/sesje)

**Nowe (frontend):**
- `dashboard/src/lib/tauri/mcp.ts` — `mcpApi` + typy
- `dashboard/src/lib/mcp-snippets.ts` — generowanie snippetów konfiguracyjnych (czysta funkcja, testowalna)
- `dashboard/src/lib/__tests__/mcp-snippets.test.ts`
- `dashboard/src/pages/settings/SettingsMcpTab.tsx`
- `dashboard/src/components/settings/McpServerCard.tsx`
- `dashboard/src/hooks/useMcpStatus.ts`
- `dashboard/src/components/help/sections/HelpMcpSection.tsx`

**Modyfikowane:**
- `dashboard/src-tauri/src/lib.rs` (mod mcp; rejestracja komend ~linia 170)
- `dashboard/src-tauri/src/commands/mod.rs` (eksport mcp_server)
- `dashboard/src-tauri/src/webui/server.rs` (trasa `/mcp`, nagłówek `Mcp-Session-Id`, flaga „serwer działa")
- `dashboard/src-tauri/src/webui/mod.rs` (`start_if_enabled` uwzględnia MCP, `ensure_started`)
- `dashboard/src-tauri/src/webui/rpc_generated.rs` (regeneracja skryptem — NIE ręcznie)
- `dashboard/src/pages/settings/settings-page-constants.ts`, `SettingsView.tsx`, `dashboard/src/hooks/useSettingsPageController.ts` (zakładka `mcp`)
- `dashboard/src/components/layout/SidebarStatusPanel.tsx` (wiersz statusu MCP)
- `dashboard/src/pages/Help.tsx`, `dashboard/src/lib/help-navigation.ts` (sekcja pomocy)
- `dashboard/src/locales/en/common.json`, `dashboard/src/locales/pl/common.json`

---

### Task 1: Konfiguracja MCP (Rust) — `mcp/config.rs`

**Files:**
- Create: `dashboard/src-tauri/src/mcp/config.rs`
- Create: `dashboard/src-tauri/src/mcp/mod.rs`
- Modify: `dashboard/src-tauri/src/lib.rs` (dodaj `mod mcp;` obok `mod webui;` — linia 4)
- Test: testy inline w `config.rs` (konwencja repo — moduł `#[cfg(test)]` na dole pliku, wzór: `webui/config.rs`)

- [ ] **Step 1: Napisz failing testy**

Utwórz `dashboard/src-tauri/src/mcp/mod.rs` (na razie tylko):

```rust
pub mod config;
```

Utwórz `dashboard/src-tauri/src/mcp/config.rs` z samymi testami (i pustym miejscem na implementację powyżej):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "timeflow-mcp-config-test-{}-{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&dir).expect("temp dir should be created");
        dir
    }

    #[test]
    fn defaults_are_disabled_and_read_only() {
        let cfg = McpConfig::default();
        assert!(!cfg.enabled);
        assert!(!cfg.read_write);
        assert!(cfg.token.is_empty());
    }

    #[test]
    fn json_roundtrips() {
        let cfg = McpConfig {
            enabled: true,
            read_write: true,
            token: "abc123".to_string(),
        };
        let raw = cfg.to_json_string();
        assert_eq!(McpConfig::from_json_str(&raw), cfg);
    }

    #[test]
    fn garbage_json_falls_back_to_default() {
        assert_eq!(McpConfig::from_json_str("not-json"), McpConfig::default());
    }

    #[test]
    fn partial_json_uses_defaults() {
        let cfg = McpConfig::from_json_str(r#"{"enabled":true}"#);
        assert!(cfg.enabled);
        assert!(!cfg.read_write);
    }

    #[test]
    fn persistence_uses_mcp_settings_file_and_roundtrips() {
        let dir = temp_test_dir();
        let path = config_path_in(&dir);
        let cfg = McpConfig {
            enabled: true,
            read_write: false,
            token: "tok".to_string(),
        };
        save_to_path(&path, &cfg).expect("config should be saved");
        assert_eq!(
            path.file_name().and_then(|n| n.to_str()),
            Some("mcp_settings.json")
        );
        assert_eq!(load_from_path(&path), cfg);
        std::fs::remove_dir_all(dir).expect("temp dir should be removed");
    }

    #[test]
    fn ensure_token_generates_once_and_is_stable() {
        let mut cfg = McpConfig::default();
        let changed = cfg.ensure_token(|| "generated-token".to_string());
        assert!(changed);
        assert_eq!(cfg.token, "generated-token");
        let changed_again = cfg.ensure_token(|| "other".to_string());
        assert!(!changed_again);
        assert_eq!(cfg.token, "generated-token");
    }
}
```

W `dashboard/src-tauri/src/lib.rs` dodaj po `mod webui;` (linia 4):

```rust
mod mcp;
```

- [ ] **Step 2: Uruchom testy — mają NIE przejść (błąd kompilacji: brak McpConfig)**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml mcp::config -- --nocapture`
Expected: błąd kompilacji `cannot find struct McpConfig`

- [ ] **Step 3: Implementacja (nad modułem tests w tym samym pliku)**

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Konfiguracja serwera MCP. Token jest przechowywany JAWNIE w pliku
/// mcp_settings.json (katalog danych użytkownika) — świadomie, jak sekret LAN:
/// użytkownik musi móc go odczytać, by skonfigurować klienta (Claude Code/Codex).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct McpConfig {
    pub enabled: bool,
    /// false (domyślnie) = agenci widzą tylko narzędzia odczytu.
    /// true = również narzędzia zapisujące (create/update/assign).
    pub read_write: bool,
    /// Token Bearer wymagany na KAŻDYM żądaniu /mcp (również loopback).
    pub token: String,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            read_write: false,
            token: String::new(),
        }
    }
}

impl McpConfig {
    pub fn from_json_str(raw: &str) -> Self {
        serde_json::from_str(raw).unwrap_or_default()
    }

    pub fn to_json_string(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".to_string())
    }

    /// Generuje token, jeśli pusty. Zwraca true, gdy config się zmienił.
    pub fn ensure_token(&mut self, mint: impl FnOnce() -> String) -> bool {
        if self.token.is_empty() {
            self.token = mint();
            true
        } else {
            false
        }
    }
}

fn config_path() -> Result<PathBuf, String> {
    Ok(config_path_in(
        &crate::commands::helpers::timeflow_data_dir()?,
    ))
}

fn config_path_in(dir: &Path) -> PathBuf {
    dir.join("mcp_settings.json")
}

fn load_from_path(path: &Path) -> McpConfig {
    match std::fs::read_to_string(path) {
        Ok(raw) => McpConfig::from_json_str(&raw),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => McpConfig::default(),
        Err(e) => {
            log::warn!("Failed to read MCP config from {}: {}", path.display(), e);
            McpConfig::default()
        }
    }
}

fn save_to_path(path: &Path, cfg: &McpConfig) -> Result<(), String> {
    std::fs::write(path, cfg.to_json_string()).map_err(|e| e.to_string())
}

pub fn load() -> McpConfig {
    match config_path() {
        Ok(path) => load_from_path(&path),
        Err(e) => {
            log::warn!("Failed to resolve MCP config path: {}", e);
            McpConfig::default()
        }
    }
}

pub fn save(cfg: &McpConfig) -> Result<(), String> {
    let path = config_path()?;
    save_to_path(&path, cfg)
}
```

- [ ] **Step 4: Testy przechodzą**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml mcp::config`
Expected: `test result: ok. 6 passed`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/mcp/ dashboard/src-tauri/src/lib.rs
git commit -m "feat(mcp): add MCP server config module (mcp_settings.json)"
```

---

### Task 2: Protokół JSON-RPC / MCP — `mcp/protocol.rs`

**Files:**
- Create: `dashboard/src-tauri/src/mcp/protocol.rs`
- Modify: `dashboard/src-tauri/src/mcp/mod.rs` (dodaj `pub mod protocol;`)

Protokół jest czysty (bez AppHandle) — w pełni testowalny jednostkowo. Obsługujemy: `initialize`, `ping`, `tools/list`, `tools/call`, notyfikacje (id == None → brak odpowiedzi).

- [ ] **Step 1: Napisz failing testy**

Utwórz `dashboard/src-tauri/src/mcp/protocol.rs` z testami:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_request_with_id_and_params() {
        let req = parse_message(
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_projects"}}"#,
        )
        .expect("should parse");
        assert_eq!(req.method, "tools/call");
        assert_eq!(req.id, Some(json!(1)));
        assert_eq!(req.params["name"], "list_projects");
    }

    #[test]
    fn notification_has_no_id() {
        let req = parse_message(
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        )
        .expect("should parse");
        assert!(req.is_notification());
    }

    #[test]
    fn rejects_non_json_and_wrong_version() {
        assert!(parse_message("nope").is_err());
        assert!(parse_message(r#"{"jsonrpc":"1.0","id":1,"method":"ping"}"#).is_err());
    }

    #[test]
    fn result_response_carries_id_and_result() {
        let out = result_response(&Some(json!(7)), json!({"ok":true}));
        assert_eq!(out["jsonrpc"], "2.0");
        assert_eq!(out["id"], 7);
        assert_eq!(out["result"]["ok"], true);
    }

    #[test]
    fn error_response_carries_code_and_message() {
        let out = error_response(&Some(json!("x")), INVALID_PARAMS, "bad tool");
        assert_eq!(out["error"]["code"], INVALID_PARAMS);
        assert_eq!(out["error"]["message"], "bad tool");
        assert_eq!(out["id"], "x");
    }

    #[test]
    fn initialize_result_echoes_supported_protocol_version() {
        // Znana wersja klienta → echo; nieznana/brak → nasz domyślny.
        let known = initialize_result(Some("2025-06-18"), "9.9.9");
        assert_eq!(known["protocolVersion"], "2025-06-18");
        let unknown = initialize_result(Some("1999-01-01"), "9.9.9");
        assert_eq!(unknown["protocolVersion"], DEFAULT_PROTOCOL_VERSION);
        assert_eq!(unknown["serverInfo"]["name"], "TIMEFLOW");
        assert_eq!(unknown["serverInfo"]["version"], "9.9.9");
        assert!(unknown["capabilities"]["tools"].is_object());
    }

    #[test]
    fn tool_result_wraps_payload_as_text_content() {
        let out = tool_call_result(&json!([{"id":1}]));
        assert_eq!(out["content"][0]["type"], "text");
        assert!(out["content"][0]["text"]
            .as_str()
            .expect("text")
            .contains("\"id\":1"));
        assert_eq!(out["isError"], false);
    }

    #[test]
    fn tool_error_sets_is_error_flag() {
        let out = tool_call_error("read_only_mode");
        assert_eq!(out["isError"], true);
        assert_eq!(out["content"][0]["text"], "read_only_mode");
    }
}
```

- [ ] **Step 2: Uruchom testy — błąd kompilacji**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml mcp::protocol`
Expected: FAIL (brak `parse_message` itd.)

- [ ] **Step 3: Implementacja**

```rust
use serde::Deserialize;
use serde_json::{json, Value};

/// Wersje protokołu MCP, które umiemy obsłużyć (handshake `initialize`).
pub const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2024-11-05", "2025-03-26", "2025-06-18"];
pub const DEFAULT_PROTOCOL_VERSION: &str = "2025-03-26";

// Standardowe kody błędów JSON-RPC 2.0.
pub const PARSE_ERROR: i64 = -32700;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const INTERNAL_ERROR: i64 = -32603;

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

impl JsonRpcRequest {
    pub fn is_notification(&self) -> bool {
        self.id.is_none()
    }
}

pub fn parse_message(body: &str) -> Result<JsonRpcRequest, String> {
    let req: JsonRpcRequest =
        serde_json::from_str(body).map_err(|e| format!("parse_error: {e}"))?;
    if req.jsonrpc != "2.0" {
        return Err("parse_error: jsonrpc must be \"2.0\"".to_string());
    }
    Ok(req)
}

pub fn result_response(id: &Option<Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.clone().unwrap_or(Value::Null), "result": result })
}

pub fn error_response(id: &Option<Value>, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.clone().unwrap_or(Value::Null),
        "error": { "code": code, "message": message }
    })
}

pub fn initialize_result(client_protocol: Option<&str>, server_version: &str) -> Value {
    let protocol = client_protocol
        .filter(|v| SUPPORTED_PROTOCOL_VERSIONS.contains(v))
        .unwrap_or(DEFAULT_PROTOCOL_VERSION);
    json!({
        "protocolVersion": protocol,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "TIMEFLOW", "version": server_version }
    })
}

/// MCP tools/call zwraca content jako listę bloków; dane pakujemy jako JSON w text.
pub fn tool_call_result(payload: &Value) -> Value {
    let text = serde_json::to_string(payload).unwrap_or_else(|_| "null".to_string());
    json!({ "content": [{ "type": "text", "text": text }], "isError": false })
}

pub fn tool_call_error(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}
```

W `mod.rs` dodaj `pub mod protocol;`.

- [ ] **Step 4: Testy przechodzą**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml mcp::protocol`
Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/mcp/
git commit -m "feat(mcp): add JSON-RPC / MCP protocol types and response builders"
```

---

### Task 3: Rejestr narzędzi — `mcp/tools.rs`

**Files:**
- Create: `dashboard/src-tauri/src/mcp/tools.rs`
- Modify: `dashboard/src-tauri/src/mcp/mod.rs` (dodaj `pub mod tools;`)

Wykonanie deleguje do `crate::webui::rpc::dispatch` — mostek `rpc_generated.rs` już deserializuje argumenty (akceptuje snake_case i camelCase, patrz `from_arg` w `rpc_generated.rs:31`). Narzędzie = nazwa MCP + komenda RPC + flaga `write` + schema.

**Zestaw narzędzi (11):**

| Narzędzie MCP | Komenda RPC | Zapis? | Argumenty |
|---|---|---|---|
| `list_projects` | `get_projects` | nie | `date_range?: {start, end}` (YYYY-MM-DD) |
| `get_project` | `get_project` | nie | `id: number` |
| `list_clients` | `clients_list` | nie | — |
| `get_clients_summary` | `get_clients_summary` | nie | `date_range: {start, end}` |
| `list_sessions` | `get_sessions` | nie | `filters: {dateRange?, projectId?, appId?, unassigned?, minDuration?, limit?, offset?}` |
| `create_project` | `create_project` | tak | `name, color, assigned_folder_path?` |
| `assign_session_to_project` | `assign_session_to_project` | tak | `session_id, project_id?, source?` |
| `update_session_comment` | `update_session_comment` | tak | `session_id, comment?` |
| `create_client` | `clients_create` | tak | `name, contact?, address?, taxId?, currency?, defaultHourlyRate?, color?` |
| `update_client` | `clients_update` | tak | `id, name, contact?, address?, taxId?, currency?, defaultHourlyRate?, color?` |
| `set_project_client` | `project_set_client` | tak | `project_id, client_name?` |

(Sygnatury zweryfikowane: `commands/projects.rs:959,972,1008`, `commands/clients.rs:176,229,272,381,650`, `commands/sessions/query.rs:161`, `commands/sessions/mutations.rs:199,302`, `commands/types.rs:304` — `SessionFilters` używa camelCase rename.)

- [ ] **Step 1: Napisz failing testy**

Utwórz `dashboard/src-tauri/src/mcp/tools.rs` z testami:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_mode_hides_write_tools() {
        let read_only = tool_list_json(false);
        let full = tool_list_json(true);
        assert!(read_only.len() < full.len());
        assert_eq!(full.len(), TOOLS.len());
        let names: Vec<&str> = read_only
            .iter()
            .map(|t| t["name"].as_str().expect("name"))
            .collect();
        assert!(names.contains(&"list_projects"));
        assert!(!names.contains(&"create_project"));
    }

    #[test]
    fn every_tool_has_description_and_schema() {
        for tool in tool_list_json(true) {
            assert!(tool["description"].as_str().expect("desc").len() > 20);
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
    }

    #[test]
    fn find_tool_resolves_names_and_rejects_unknown() {
        assert_eq!(find_tool("list_projects").expect("known").command, "get_projects");
        assert!(find_tool("drop_database").is_none());
    }

    #[test]
    fn write_tool_in_read_only_mode_is_rejected_before_dispatch() {
        // Nie dotykamy AppHandle: sprawdzamy samą bramkę uprawnień.
        let def = find_tool("create_project").expect("known");
        assert!(def.write);
        assert!(matches!(
            check_permission(def, false),
            Err(msg) if msg == "read_only_mode"
        ));
        assert!(check_permission(def, true).is_ok());
    }

    #[test]
    fn read_tool_allowed_in_both_modes() {
        let def = find_tool("list_sessions").expect("known");
        assert!(check_permission(def, false).is_ok());
        assert!(check_permission(def, true).is_ok());
    }

    #[test]
    fn tool_names_are_unique() {
        let mut names: Vec<&str> = TOOLS.iter().map(|t| t.name).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), TOOLS.len());
    }
}
```

- [ ] **Step 2: Uruchom testy — błąd kompilacji**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml mcp::tools`
Expected: FAIL

- [ ] **Step 3: Implementacja**

```rust
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::webui::rpc::{self, RpcRequest};

pub struct ToolDef {
    pub name: &'static str,
    /// Nazwa komendy w warstwie RPC (webui::rpc::dispatch).
    pub command: &'static str,
    pub write: bool,
    pub description: &'static str,
    pub schema: fn() -> Value,
}

fn date_range_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "start": { "type": "string", "description": "YYYY-MM-DD" },
            "end": { "type": "string", "description": "YYYY-MM-DD" }
        },
        "required": ["start", "end"]
    })
}

pub static TOOLS: &[ToolDef] = &[
    ToolDef {
        name: "list_projects",
        command: "get_projects",
        write: false,
        description: "List active TIMEFLOW projects with time statistics. Optionally limit stats to a date range.",
        schema: || json!({
            "type": "object",
            "properties": { "date_range": date_range_schema() }
        }),
    },
    ToolDef {
        name: "get_project",
        command: "get_project",
        write: false,
        description: "Get a single project with its time statistics by numeric id.",
        schema: || json!({
            "type": "object",
            "properties": { "id": { "type": "integer" } },
            "required": ["id"]
        }),
    },
    ToolDef {
        name: "list_clients",
        command: "clients_list",
        write: false,
        description: "List all clients (name, contact, currency, hourly rate, archived flag).",
        schema: || json!({ "type": "object", "properties": {} }),
    },
    ToolDef {
        name: "get_clients_summary",
        command: "get_clients_summary",
        write: false,
        description: "Aggregated per-client summary (tracked time, value) for a date range.",
        schema: || json!({
            "type": "object",
            "properties": { "date_range": date_range_schema() },
            "required": ["date_range"]
        }),
    },
    ToolDef {
        name: "list_sessions",
        command: "get_sessions",
        write: false,
        description: "List work sessions. Supports filters: dateRange, projectId, appId, unassigned, minDuration (seconds), limit, offset. Always pass a limit (e.g. 100) to avoid huge results.",
        schema: || json!({
            "type": "object",
            "properties": {
                "filters": {
                    "type": "object",
                    "properties": {
                        "dateRange": date_range_schema(),
                        "projectId": { "type": "integer" },
                        "appId": { "type": "integer" },
                        "unassigned": { "type": "boolean" },
                        "minDuration": { "type": "integer" },
                        "limit": { "type": "integer" },
                        "offset": { "type": "integer" }
                    }
                }
            },
            "required": ["filters"]
        }),
    },
    ToolDef {
        name: "create_project",
        command: "create_project",
        write: true,
        description: "Create a new project. Requires a unique name and a hex color (e.g. #38bdf8). Optional folder path to associate.",
        schema: || json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "color": { "type": "string" },
                "assigned_folder_path": { "type": "string" }
            },
            "required": ["name", "color"]
        }),
    },
    ToolDef {
        name: "assign_session_to_project",
        command: "assign_session_to_project",
        write: true,
        description: "Assign a session to a project (or unassign with project_id=null). Optional source label, e.g. 'mcp'.",
        schema: || json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "integer" },
                "project_id": { "type": ["integer", "null"] },
                "source": { "type": "string" }
            },
            "required": ["session_id"]
        }),
    },
    ToolDef {
        name: "update_session_comment",
        command: "update_session_comment",
        write: true,
        description: "Set or clear (comment=null) the comment on a session.",
        schema: || json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "integer" },
                "comment": { "type": ["string", "null"] }
            },
            "required": ["session_id"]
        }),
    },
    ToolDef {
        name: "create_client",
        command: "clients_create",
        write: true,
        description: "Create a client. Only name is required; contact, address, taxId, currency, defaultHourlyRate, color are optional.",
        schema: || json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "contact": { "type": "string" },
                "address": { "type": "string" },
                "taxId": { "type": "string" },
                "currency": { "type": "string" },
                "defaultHourlyRate": { "type": "number" },
                "color": { "type": "string" }
            },
            "required": ["name"]
        }),
    },
    ToolDef {
        name: "update_client",
        command: "clients_update",
        write: true,
        description: "Update an existing client by id. Pass the full desired state (name required).",
        schema: || json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer" },
                "name": { "type": "string" },
                "contact": { "type": "string" },
                "address": { "type": "string" },
                "taxId": { "type": "string" },
                "currency": { "type": "string" },
                "defaultHourlyRate": { "type": "number" },
                "color": { "type": "string" }
            },
            "required": ["id", "name"]
        }),
    },
    ToolDef {
        name: "set_project_client",
        command: "project_set_client",
        write: true,
        description: "Link a project to a client by client name (client_name=null unlinks).",
        schema: || json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "client_name": { "type": ["string", "null"] }
            },
            "required": ["project_id"]
        }),
    },
];

pub fn find_tool(name: &str) -> Option<&'static ToolDef> {
    TOOLS.iter().find(|t| t.name == name)
}

pub fn check_permission(def: &ToolDef, read_write: bool) -> Result<(), String> {
    if def.write && !read_write {
        return Err("read_only_mode".to_string());
    }
    Ok(())
}

pub fn tool_list_json(read_write: bool) -> Vec<Value> {
    TOOLS
        .iter()
        .filter(|t| read_write || !t.write)
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": (t.schema)()
            })
        })
        .collect()
}

/// Wykonuje narzędzie przez istniejącą warstwę RPC (rpc_generated obsługuje
/// deserializację argumentów; klucze snake_case i camelCase są akceptowane).
pub fn call_tool(
    app: &AppHandle,
    name: &str,
    args: Value,
    read_write: bool,
) -> Result<Value, String> {
    let def = find_tool(name).ok_or_else(|| format!("unknown_tool: {name}"))?;
    check_permission(def, read_write)?;
    rpc::dispatch(
        app,
        RpcRequest {
            command: def.command.to_string(),
            args,
        },
    )
}
```

Uwaga: `ToolDef.schema` jako `fn() -> Value` bo `Value` nie jest `const` — statyczna tablica z fn-pointerami kompiluje się bez lazy_static. `date_range_schema()` wywoływana wewnątrz closure — jeśli kompilator odrzuci wywołanie funkcji w `fn` pointer (nie odrzuci — to zwykłe fn), zostaw jak wyżej.

W `mod.rs` dodaj `pub mod tools;`.

- [ ] **Step 4: Testy przechodzą**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml mcp::tools`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/mcp/
git commit -m "feat(mcp): add curated MCP tool registry with read-only gating"
```

---

### Task 4: Backup przed sesją + rejestr sesji — `mcp/backup.rs`, rozbudowa `mcp/mod.rs`

**Files:**
- Create: `dashboard/src-tauri/src/mcp/backup.rs`
- Modify: `dashboard/src-tauri/src/mcp/mod.rs`

Backup wzorowany 1:1 na `commands/sync_markers.rs:102` (`backup_before_sync`): WAL checkpoint + `VACUUM INTO` do `<data_dir>/mcp_backups/`, rotacja 20 najnowszych. Rejestr sesji: mapa `session_id → info` w globalnym `OnceLock` (wzorzec `webui::auth()`, `webui/mod.rs:13`).

- [ ] **Step 1: Napisz failing testy (rotacja — czysta logika na plikach temp)**

W `dashboard/src-tauri/src/mcp/backup.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time moves forward")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "timeflow-mcp-backup-test-{}-{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn rotate_keeps_only_newest_files() {
        let dir = temp_dir();
        for i in 0..25 {
            let name = format!("timeflow_mcp_backup_2026-01-{:02}_00-00-00.db", i + 1);
            std::fs::write(dir.join(name), b"x").expect("write");
        }
        rotate_backups(&dir, 20).expect("rotate");
        let left = std::fs::read_dir(&dir).expect("read dir").count();
        assert_eq!(left, 20);
        // Najstarsze (01..05) usunięte, najnowszy (25) zostaje.
        assert!(!dir
            .join("timeflow_mcp_backup_2026-01-01_00-00-00.db")
            .exists());
        assert!(dir
            .join("timeflow_mcp_backup_2026-01-25_00-00-00.db")
            .exists());
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn rotate_ignores_foreign_files() {
        let dir = temp_dir();
        std::fs::write(dir.join("unrelated.txt"), b"keep me").expect("write");
        for i in 0..21 {
            let name = format!("timeflow_mcp_backup_2026-02-{:02}_00-00-00.db", i + 1);
            std::fs::write(dir.join(name), b"x").expect("write");
        }
        rotate_backups(&dir, 20).expect("rotate");
        assert!(dir.join("unrelated.txt").exists());
        std::fs::remove_dir_all(dir).expect("cleanup");
    }
}
```

- [ ] **Step 2: Testy failują (brak rotate_backups)**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml mcp::backup`
Expected: FAIL

- [ ] **Step 3: Implementacja backup.rs**

```rust
use std::path::Path;

use tauri::AppHandle;

pub const MAX_MCP_BACKUPS: usize = 20;
const BACKUP_PREFIX: &str = "timeflow_mcp_backup_";

/// Backup bazy przed sesją MCP: WAL checkpoint + VACUUM INTO (spójna kopia,
/// jak backup_before_sync w commands/sync_markers.rs). Zwraca ścieżkę pliku.
pub async fn perform_mcp_backup(app: AppHandle) -> Result<String, String> {
    let data_dir = crate::commands::helpers::timeflow_data_dir()?;
    let backup_dir = data_dir.join("mcp_backups");
    if !backup_dir.exists() {
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create mcp backup dir: {e}"))?;
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dest_path = backup_dir.join(format!("{BACKUP_PREFIX}{timestamp}.db"));
    let dest_path_string = dest_path.to_string_lossy().to_string();
    let dest_for_task = dest_path_string.clone();

    crate::commands::helpers::run_db_blocking(app, move |conn| {
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("WAL checkpoint failed: {e}"))?;
        let quoted_path: String = conn
            .query_row("SELECT quote(?1)", [&dest_for_task], |row| row.get(0))
            .map_err(|e| format!("Failed to escape backup path: {e}"))?;
        conn.execute_batch(&format!("VACUUM INTO {quoted_path}"))
            .map_err(|e| format!("Backup failed: {e}"))?;
        Ok(())
    })
    .await?;

    rotate_backups(&backup_dir, MAX_MCP_BACKUPS)?;
    Ok(dest_path_string)
}

fn rotate_backups(dir: &Path, keep: usize) -> Result<(), String> {
    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(BACKUP_PREFIX) && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    // Timestamp w nazwie sortuje się leksykograficznie == chronologicznie.
    backups.sort();
    while backups.len() > keep {
        let oldest = backups.remove(0);
        if let Err(e) = std::fs::remove_file(&oldest) {
            log::warn!("[mcp] failed to remove old backup {}: {e}", oldest.display());
        }
    }
    Ok(())
}
```

**Uwaga:** sprawdź, czy `run_db_blocking` w `commands/helpers.rs` jest `pub` (używany w `commands/*`). Jeśli jest `pub(crate)` lub prywatny — zmień na `pub(crate)` (moduł `mcp` jest w tym samym crate, więc `pub(crate)` wystarczy). Sprawdź: `grep -n "fn run_db_blocking" dashboard/src-tauri/src/commands/helpers.rs`.

- [ ] **Step 4: Rozbuduj `mcp/mod.rs` o rejestr sesji i status**

Zastąp zawartość `dashboard/src-tauri/src/mcp/mod.rs`:

```rust
pub mod backup;
pub mod config;
pub mod protocol;
pub mod tools;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

/// Sesja klienta MCP (Claude Code / Codex). Tworzona przy `initialize`,
/// usuwana przy DELETE /mcp lub po 24h nieaktywności (prune).
#[derive(Debug, Clone, Serialize)]
pub struct McpSessionInfo {
    pub id: String,
    pub client_name: String,
    pub created_at: u64,
    pub last_seen: u64,
    pub backup_path: String,
}

const SESSION_IDLE_TTL_SECS: u64 = 60 * 60 * 24;

#[derive(Default)]
pub struct McpSessions {
    sessions: Mutex<HashMap<String, McpSessionInfo>>,
}

impl McpSessions {
    pub fn insert(&self, info: McpSessionInfo) {
        self.sessions
            .lock()
            .expect("mcp sessions mutex poisoned")
            .insert(info.id.clone(), info);
    }

    /// Aktualizuje last_seen; zwraca false gdy sesja nieznana/wygasła.
    pub fn touch(&self, id: &str, now: u64) -> bool {
        let mut map = self.sessions.lock().expect("mcp sessions mutex poisoned");
        map.retain(|_, s| now.saturating_sub(s.last_seen) < SESSION_IDLE_TTL_SECS);
        match map.get_mut(id) {
            Some(s) => {
                s.last_seen = now;
                true
            }
            None => false,
        }
    }

    pub fn remove(&self, id: &str) {
        self.sessions
            .lock()
            .expect("mcp sessions mutex poisoned")
            .remove(id);
    }

    pub fn list(&self, now: u64) -> Vec<McpSessionInfo> {
        let map = self.sessions.lock().expect("mcp sessions mutex poisoned");
        map.values()
            .filter(|s| now.saturating_sub(s.last_seen) < SESSION_IDLE_TTL_SECS)
            .cloned()
            .collect()
    }

    pub fn active_count(&self, now: u64) -> usize {
        self.list(now).len()
    }
}

static SESSIONS: OnceLock<McpSessions> = OnceLock::new();

pub fn sessions() -> &'static McpSessions {
    SESSIONS.get_or_init(McpSessions::default)
}

#[derive(Serialize)]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    pub read_write: bool,
    pub port: u16,
    pub active_sessions: usize,
    pub token: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(id: &str, last_seen: u64) -> McpSessionInfo {
        McpSessionInfo {
            id: id.to_string(),
            client_name: "test".to_string(),
            created_at: last_seen,
            last_seen,
            backup_path: String::new(),
        }
    }

    #[test]
    fn touch_known_session_updates_and_returns_true() {
        let s = McpSessions::default();
        s.insert(info("a", 100));
        assert!(s.touch("a", 200));
        assert_eq!(s.list(200)[0].last_seen, 200);
    }

    #[test]
    fn touch_unknown_or_expired_returns_false() {
        let s = McpSessions::default();
        assert!(!s.touch("missing", 100));
        s.insert(info("old", 0));
        assert!(!s.touch("old", SESSION_IDLE_TTL_SECS + 1));
    }

    #[test]
    fn remove_and_count() {
        let s = McpSessions::default();
        s.insert(info("a", 10));
        s.insert(info("b", 10));
        assert_eq!(s.active_count(10), 2);
        s.remove("a");
        assert_eq!(s.active_count(10), 1);
    }
}
```

- [ ] **Step 5: Testy przechodzą**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml mcp::`
Expected: wszystkie testy mcp:: (config+protocol+tools+backup+mod) PASS

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/mcp/
git commit -m "feat(mcp): add pre-session backup with rotation and MCP session registry"
```

---

### Task 5: Endpoint HTTP `/mcp` — `webui/server.rs`

**Files:**
- Modify: `dashboard/src-tauri/src/webui/server.rs`
- Modify: `dashboard/src-tauri/src/webui/mod.rs`

Zasady bezpieczeństwa (inne niż `/rpc`!): token Bearer **zawsze** wymagany (klient MCP to zewnętrzny proces — może ustawiać nagłówki; nie ma zaufania dla loopback), obcy `Origin` → 403 (ochrona przed DNS rebinding), stała-czasowo porównanie tokenu przez hash SHA-256.

- [ ] **Step 1: Rozszerz ParsedRequest o nagłówek Mcp-Session-Id + failing testy**

W `webui/server.rs` w struct `ParsedRequest` (linia 14-25) dodaj pole:

```rust
    pub mcp_session: Option<String>,
```

W `parse_request` (pętla nagłówków, linie 39-55) dodaj gałąź (case-insensitive, jak `x-timeflow-rpc`):

```rust
        } else if line.to_ascii_lowercase().starts_with("mcp-session-id:") {
            mcp_session = line
                .splitn(2, ':')
                .nth(1)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
```

oraz `let mut mcp_session = None;` przy pozostałych mutach i `mcp_session,` w konstruktorze `Some(ParsedRequest { ... })`.

Dodaj testy do istniejącego `mod tests` w `server.rs`:

```rust
    #[test]
    fn parses_mcp_session_header_case_insensitively() {
        let req = parse_request(concat!(
            "POST /mcp HTTP/1.1\r\nHost: x\r\nMCP-Session-ID: sess-42\r\n\r\n{}"
        ))
        .unwrap();
        assert_eq!(req.mcp_session.as_deref(), Some("sess-42"));
        let plain = parse_request("POST /mcp HTTP/1.1\r\nHost: x\r\n\r\n{}").unwrap();
        assert!(plain.mcp_session.is_none());
    }

    #[test]
    fn mcp_auth_requires_exact_bearer_token() {
        assert!(mcp_token_ok(Some("secret"), "secret"));
        assert!(!mcp_token_ok(Some("wrong"), "secret"));
        assert!(!mcp_token_ok(None, "secret"));
        assert!(!mcp_token_ok(Some(""), "")); // pusty config = brak dostępu
    }
```

Uwaga: pozostałe istniejące testy `parse_request` wymagają dodania pola — konstruktora nie używają (porównują pola), więc kompilacja przejdzie po dodaniu pola z `None`.

- [ ] **Step 2: Testy failują**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml webui::server`
Expected: FAIL (brak `mcp_token_ok`, brak pola)

- [ ] **Step 3: Implementacja trasy i handlera**

W `handle` (linia 233-240) dodaj trasy PRZED `("GET", _)`:

```rust
        ("POST", "/mcp") => handle_mcp(app, &request),
        ("DELETE", "/mcp") => handle_mcp_delete(&request),
        ("GET", "/mcp") => json_response(
            "405 Method Not Allowed",
            r#"{"ok":false,"error":"sse_not_supported"}"#,
        ),
```

Dodaj funkcje (po `handle_rpc`):

```rust
/// Porównanie tokenu MCP w stałym czasie (przez hash), pusty token w configu
/// nigdy nie autoryzuje.
fn mcp_token_ok(bearer: Option<&str>, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    match bearer {
        Some(provided) => {
            crate::webui::auth::hash_for_compare(provided)
                == crate::webui::auth::hash_for_compare(expected)
        }
        None => false,
    }
}

fn mcp_json(status: &str, body: &serde_json::Value, session_id: Option<&str>) -> Vec<u8> {
    let payload = body.to_string();
    let session_header = session_id
        .map(|s| format!("Mcp-Session-Id: {s}\r\n"))
        .unwrap_or_default();
    let mut out = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
         {session_header}X-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        payload.len(),
    )
    .into_bytes();
    out.extend_from_slice(payload.as_bytes());
    out
}

fn handle_mcp(app: &AppHandle, request: &ParsedRequest) -> Vec<u8> {
    use crate::mcp::{self, protocol, tools};

    let cfg = crate::mcp::config::load();
    if !cfg.enabled {
        return json_response("403 Forbidden", r#"{"ok":false,"error":"mcp_disabled"}"#);
    }
    if origin_is_forbidden(request) {
        return json_response("403 Forbidden", r#"{"ok":false,"error":"forbidden_origin"}"#);
    }
    if !mcp_token_ok(request.bearer.as_deref(), &cfg.token) {
        return json_response("401 Unauthorized", r#"{"ok":false,"error":"unauthorized"}"#);
    }

    let msg = match protocol::parse_message(&request.body) {
        Ok(msg) => msg,
        Err(e) => {
            let body = protocol::error_response(&None, protocol::PARSE_ERROR, &e);
            return mcp_json("400 Bad Request", &body, None);
        }
    };

    // Notyfikacje (initialized, cancelled, …): przyjmij i nie odpowiadaj treścią.
    if msg.is_notification() {
        return mcp_json("202 Accepted", &serde_json::json!({}), None);
    }

    let now = now_secs();
    match msg.method.as_str() {
        "initialize" => {
            // Backup przed każdą sesją — FAIL-CLOSED: bez backupu nie ma sesji.
            let backup_path =
                match tauri::async_runtime::block_on(mcp::backup::perform_mcp_backup(app.clone()))
                {
                    Ok(path) => path,
                    Err(e) => {
                        log::error!("[mcp] pre-session backup failed: {e}");
                        let body = protocol::error_response(
                            &msg.id,
                            protocol::INTERNAL_ERROR,
                            &format!("backup_failed: {e}"),
                        );
                        return mcp_json("200 OK", &body, None);
                    }
                };
            let client_protocol = msg.params["protocolVersion"].as_str();
            let client_name = msg.params["clientInfo"]["name"]
                .as_str()
                .unwrap_or("mcp-client")
                .to_string();
            let session_id = crate::webui::auth::random_token()[..32].to_string();
            mcp::sessions().insert(mcp::McpSessionInfo {
                id: session_id.clone(),
                client_name,
                created_at: now,
                last_seen: now,
                backup_path,
            });
            let version = app.package_info().version.to_string();
            let body = protocol::result_response(
                &msg.id,
                protocol::initialize_result(client_protocol, &version),
            );
            log::info!("[mcp] session {session_id} initialized (backup done)");
            mcp_json("200 OK", &body, Some(&session_id))
        }
        "ping" => mcp_json(
            "200 OK",
            &protocol::result_response(&msg.id, serde_json::json!({})),
            None,
        ),
        "tools/list" => {
            if let Some(sid) = request.mcp_session.as_deref() {
                mcp::sessions().touch(sid, now);
            }
            let body = protocol::result_response(
                &msg.id,
                serde_json::json!({ "tools": tools::tool_list_json(cfg.read_write) }),
            );
            mcp_json("200 OK", &body, None)
        }
        "tools/call" => {
            if let Some(sid) = request.mcp_session.as_deref() {
                mcp::sessions().touch(sid, now);
            }
            let name = msg.params["name"].as_str().unwrap_or_default().to_string();
            let args = msg.params.get("arguments").cloned().unwrap_or(serde_json::json!({}));
            let result = tools::call_tool(app, &name, args, cfg.read_write);
            let payload = match result {
                Ok(data) => protocol::tool_call_result(&data),
                Err(e) => protocol::tool_call_error(&e),
            };
            mcp_json("200 OK", &protocol::result_response(&msg.id, payload), None)
        }
        other => {
            let body = protocol::error_response(
                &msg.id,
                protocol::METHOD_NOT_FOUND,
                &format!("method not found: {other}"),
            );
            mcp_json("200 OK", &body, None)
        }
    }
}

fn handle_mcp_delete(request: &ParsedRequest) -> Vec<u8> {
    let cfg = crate::mcp::config::load();
    if !cfg.enabled || !mcp_token_ok(request.bearer.as_deref(), &cfg.token) {
        return json_response("401 Unauthorized", r#"{"ok":false,"error":"unauthorized"}"#);
    }
    if let Some(sid) = request.mcp_session.as_deref() {
        crate::mcp::sessions().remove(sid);
    }
    json_response("200 OK", r#"{"ok":true}"#)
}
```

W `webui/auth.rs` dodaj publiczny wrapper (hash_token jest prywatny):

```rust
/// Hash do porównań tokenów w stałym czasie (MCP auth).
pub fn hash_for_compare(token: &str) -> String {
    hash_token(token)
}
```

- [ ] **Step 4: `webui/mod.rs` — start serwera także gdy tylko MCP włączony + flaga running**

W `webui/mod.rs` dodaj po `static AUTH`:

```rust
static SERVER_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn server_running() -> bool {
    SERVER_RUNNING.load(std::sync::atomic::Ordering::Relaxed)
}

/// Startuje serwer HTTP jeśli jeszcze nie działa (idempotentne). Używane przy
/// starcie aplikacji i przy włączeniu MCP/Web Server z ustawień bez restartu.
pub fn ensure_started(app: &tauri::AppHandle, port: u16, lan: bool) -> Result<(), String> {
    if server_running() {
        return Ok(());
    }
    server::spawn(app.clone(), auth(), port, lan)?;
    SERVER_RUNNING.store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}
```

Zmień `start_if_enabled` (linia 39-48) na:

```rust
pub fn start_if_enabled(app: &tauri::AppHandle) {
    let cfg = config::load();
    let mcp_enabled = crate::mcp::config::load().enabled;
    if !cfg.enabled && !mcp_enabled {
        log::info!("[webui] disabled in config (webserver and MCP both off)");
        return;
    }
    // MCP: endpoint /mcp żyje na tym samym serwerze; gdy tylko MCP jest
    // włączony, serwer i tak startuje (loopback-only, chyba że webserver
    // z lan_exposure jest też włączony).
    let lan = cfg.enabled && cfg.lan_exposure;
    if let Err(e) = ensure_started(app, cfg.port, lan) {
        log::error!("[webui] failed to start: {e}");
    }
}
```

W `start_headless` po udanym `server::spawn` dodaj `SERVER_RUNNING.store(true, std::sync::atomic::Ordering::Relaxed);` (albo zamień spawn na `ensure_started(app, cfg.port, cfg.lan_exposure)` — preferowane).

**Uwaga (SPA gating):** gdy webserver jest wyłączony a MCP włączony, serwer zaczyna serwować też SPA/`/rpc`. To zmiana zachowania — dopuszczalna na loopback, ale dla czystości w `handle` dodaj na początku gate:

```rust
    // Web Server wyłączony → tylko /mcp i /healthz są dostępne (serwer mógł
    // wystartować wyłącznie dla MCP).
    if !crate::webui::config::load().enabled
        && !matches!(request.path.as_str(), "/mcp" | "/healthz")
    {
        return json_response("403 Forbidden", r#"{"ok":false,"error":"webserver_disabled"}"#);
    }
```

- [ ] **Step 5: Testy + build**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml webui:: mcp::`
Expected: PASS (w tym nowe `parses_mcp_session_header_case_insensitively`, `mcp_auth_requires_exact_bearer_token`)
Run: `cargo check --manifest-path dashboard/src-tauri/Cargo.toml`
Expected: bez błędów

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/webui/ dashboard/src-tauri/src/mcp/
git commit -m "feat(mcp): serve MCP Streamable HTTP endpoint at POST /mcp with mandatory bearer auth and pre-session backup"
```

---

### Task 6: Komendy Tauri — `commands/mcp_server.rs` + rejestracja

**Files:**
- Create: `dashboard/src-tauri/src/commands/mcp_server.rs`
- Modify: `dashboard/src-tauri/src/commands/mod.rs` (dodaj `pub mod mcp_server;` + `pub use mcp_server::*;` — dokładnie wg wzorca innych modułów, np. `webserver`)
- Modify: `dashboard/src-tauri/src/lib.rs` (dodaj 4 komendy do `generate_handler!` ~linia 170, obok `commands::webserver_status` ~linia 184)
- Modify (generated): `dashboard/src-tauri/src/webui/rpc_generated.rs` przez `node scripts/gen_webrpc.cjs`

- [ ] **Step 1: Implementacja komend**

```rust
use tauri::AppHandle;

use crate::commands::error::CommandError;
use crate::mcp::{self, config::McpConfig};
use crate::webui;

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
pub async fn mcp_status(_app: AppHandle) -> Result<mcp::McpStatus, CommandError> {
    let cfg = mcp::config::load();
    let web_cfg = webui::config::load();
    Ok(mcp::McpStatus {
        enabled: cfg.enabled,
        running: cfg.enabled && webui::server_running(),
        read_write: cfg.read_write,
        port: web_cfg.port,
        active_sessions: mcp::sessions().active_count(now_secs()),
        token: cfg.token,
    })
}

#[tauri::command]
pub async fn mcp_set_config(
    app: AppHandle,
    enabled: bool,
    read_write: bool,
) -> Result<mcp::McpStatus, CommandError> {
    let mut cfg = mcp::config::load();
    cfg.enabled = enabled;
    cfg.read_write = read_write;
    cfg.ensure_token(webui::auth::random_token);
    mcp::config::save(&cfg).map_err(CommandError::Other)?;

    if enabled {
        let web_cfg = webui::config::load();
        let lan = web_cfg.enabled && web_cfg.lan_exposure;
        webui::ensure_started(&app, web_cfg.port, lan).map_err(CommandError::Other)?;
    }
    log::info!("[mcp] config updated: enabled={enabled}, read_write={read_write}");
    mcp_status(app).await
}

#[tauri::command]
pub async fn mcp_regenerate_token(app: AppHandle) -> Result<mcp::McpStatus, CommandError> {
    let mut cfg = mcp::config::load();
    cfg.token = webui::auth::random_token();
    mcp::config::save(&cfg).map_err(CommandError::Other)?;
    log::info!("[mcp] token regenerated");
    mcp_status(app).await
}

#[tauri::command]
pub async fn mcp_list_sessions(
    _app: AppHandle,
) -> Result<Vec<mcp::McpSessionInfo>, CommandError> {
    Ok(mcp::sessions().list(now_secs()))
}
```

W `lib.rs` w `generate_handler![...]` dodaj (obok `commands::webserver_status`):

```rust
            commands::mcp_status,
            commands::mcp_set_config,
            commands::mcp_regenerate_token,
            commands::mcp_list_sessions,
```

Uwaga: `webui::auth::random_token` i `webui::config::load` muszą być osiągalne z `commands::mcp_server` — moduł `webui` jest `mod webui;` w lib.rs (prywatny dla crate — wystarczy). Jeśli kompilator zgłosi prywatność, zmień w lib.rs na `pub(crate) mod webui;` i analogicznie `pub(crate) mod mcp;`.

- [ ] **Step 2: Regeneruj mostek RPC**

Run: `node scripts/gen_webrpc.cjs`
Expected: `rpc_generated.rs` zawiera wpisy `"mcp_status"`, `"mcp_set_config"`, `"mcp_regenerate_token"`, `"mcp_list_sessions"`. Sprawdź: `grep -c '"mcp_' dashboard/src-tauri/src/webui/rpc_generated.rs` → `4`.

**Uwaga bezpieczeństwa (świadoma decyzja):** te komendy przez mostek są dostępne dla sparowanych sesji przeglądarkowych — tak jak wszystkie inne komendy (w tym `webserver_revoke_session`). Sparowana przeglądarka i tak ma pełny RPC; nie zwiększa to powierzchni ataku.

- [ ] **Step 3: Build + testy całości**

Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml`
Expected: wszystkie testy PASS
Run: `cargo check --manifest-path dashboard/src-tauri/Cargo.toml`
Expected: bez błędów i bez nowych warningów

- [ ] **Step 4: Test manualny endpointu (curl)**

Uruchom dashboard w dev (`python3 dashboard_dev.py` lub `cd dashboard && npm run tauri dev`). W innym terminalu:

```bash
TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/Library/Application Support/TIMEFLOW/mcp_settings.json')))['token'])")
# 1) initialize → oczekiwane: result.serverInfo.name == "TIMEFLOW", nagłówek Mcp-Session-Id, plik w mcp_backups/
curl -si -X POST http://127.0.0.1:47892/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"curl-test","version":"0"}}}'
# 2) tools/list → oczekiwane: 5 narzędzi w trybie read-only
curl -s -X POST http://127.0.0.1:47892/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
# 3) tools/call list_projects → oczekiwane: content[0].text z JSON-em projektów
curl -s -X POST http://127.0.0.1:47892/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}'
# 4) bez tokenu → 401; create_project w trybie read-only → isError=true "read_only_mode"
curl -si -X POST http://127.0.0.1:47892/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":4,"method":"ping"}'
ls ~/Library/Application\ Support/TIMEFLOW/mcp_backups/
```

(Wymaga wcześniejszego włączenia MCP — do czasu powstania UI ustaw ręcznie `"enabled": true` w `mcp_settings.json` i zrestartuj apkę; token wygeneruje się przy pierwszym `mcp_set_config`, więc na tym etapie wpisz dowolny testowy.)

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/ dashboard/src-tauri/src/lib.rs dashboard/src-tauri/src/webui/rpc_generated.rs
git commit -m "feat(mcp): add Tauri commands for MCP status, config, token and sessions"
```

---

### Task 7: Frontend — API, snippety, zakładka Ustawienia → MCP

**Files:**
- Create: `dashboard/src/lib/tauri/mcp.ts`
- Create: `dashboard/src/lib/mcp-snippets.ts`
- Create: `dashboard/src/lib/__tests__/mcp-snippets.test.ts`
- Create: `dashboard/src/pages/settings/SettingsMcpTab.tsx`
- Create: `dashboard/src/components/settings/McpServerCard.tsx`
- Modify: `dashboard/src/lib/tauri/index.ts` (eksport `mcpApi` — sprawdź nazwę pliku indeksu: `ls dashboard/src/lib/tauri/`; jeśli indeksem jest `dashboard/src/lib/tauri.ts`, dodaj tam)
- Modify: `dashboard/src/pages/settings/settings-page-constants.ts`
- Modify: `dashboard/src/hooks/useSettingsPageController.ts` (tabMeta)
- Modify: `dashboard/src/pages/settings/SettingsView.tsx`
- Modify: `dashboard/src/locales/en/common.json`, `dashboard/src/locales/pl/common.json`

- [ ] **Step 1: Failing test snippetów**

`dashboard/src/lib/__tests__/mcp-snippets.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import {
  buildClaudeCodeCommand,
  buildCodexConfig,
  buildMcpUrl,
} from '@/lib/mcp-snippets';

describe('mcp-snippets', () => {
  it('builds the MCP endpoint url from port', () => {
    expect(buildMcpUrl(47892)).toBe('http://127.0.0.1:47892/mcp');
  });

  it('builds a claude mcp add command with bearer header', () => {
    const cmd = buildClaudeCodeCommand(47892, 'tok123');
    expect(cmd).toBe(
      'claude mcp add --transport http timeflow http://127.0.0.1:47892/mcp --header "Authorization: Bearer tok123"',
    );
  });

  it('builds a codex config.toml block', () => {
    const cfg = buildCodexConfig(47892, 'tok123');
    expect(cfg).toContain('[mcp_servers.timeflow]');
    expect(cfg).toContain('url = "http://127.0.0.1:47892/mcp"');
    expect(cfg).toContain('Bearer tok123');
  });
});
```

- [ ] **Step 2: Test failuje**

Run: `cd dashboard && npx vitest run src/lib/__tests__/mcp-snippets.test.ts`
Expected: FAIL (moduł nie istnieje)

- [ ] **Step 3: Implementacja snippetów i API**

`dashboard/src/lib/mcp-snippets.ts`:

```typescript
export function buildMcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

export function buildClaudeCodeCommand(port: number, token: string): string {
  return `claude mcp add --transport http timeflow ${buildMcpUrl(port)} --header "Authorization: Bearer ${token}"`;
}

export function buildCodexConfig(port: number, token: string): string {
  return [
    '[mcp_servers.timeflow]',
    `url = "${buildMcpUrl(port)}"`,
    `http_headers = { "Authorization" = "Bearer ${token}" }`,
  ].join('\n');
}
```

`dashboard/src/lib/tauri/mcp.ts` (wzorzec: `webserver.ts`):

```typescript
import { invoke } from '@/lib/tauri/core';

export interface McpStatus {
  enabled: boolean;
  running: boolean;
  read_write: boolean;
  port: number;
  active_sessions: number;
  token: string;
}

export interface McpSession {
  id: string;
  client_name: string;
  created_at: number;
  last_seen: number;
  backup_path: string;
}

export const mcpApi = {
  status: () => invoke<McpStatus>('mcp_status'),
  setConfig: (enabled: boolean, readWrite: boolean) =>
    invoke<McpStatus>('mcp_set_config', { enabled, readWrite }),
  regenerateToken: () => invoke<McpStatus>('mcp_regenerate_token'),
  listSessions: () => invoke<McpSession[]>('mcp_list_sessions'),
};
```

Dodaj eksport w indeksie modułu tauri (tam, gdzie eksportowany jest `webServerApi`):

```typescript
export * from '@/lib/tauri/mcp';
```

- [ ] **Step 4: Zakładka w konstantach, tabMeta i SettingsView**

`settings-page-constants.ts` — do typu `SettingsTab` dodaj `| 'mcp'` (po `'webserver'`), do `SETTINGS_TAB_IDS` dodaj `'mcp'` (po `'webserver'`).

`useSettingsPageController.ts` — w `tabMeta` (linia 60-93) dodaj po `webserver`:

```typescript
    mcp: {
      label: t('settings_page.tab_mcp'),
      active: 'border-fuchsia-400 text-fuchsia-400',
    },
```

`SettingsView.tsx` — import + render po webserver:

```typescript
import { SettingsMcpTab } from '@/pages/settings/SettingsMcpTab';
// …
      {activeTab === 'mcp' && <SettingsMcpTab {...controller} />}
```

- [ ] **Step 5: Komponenty zakładki**

`dashboard/src/pages/settings/SettingsMcpTab.tsx`:

```typescript
import { McpServerCard } from '@/components/settings/McpServerCard';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';

type SettingsMcpTabProps = Pick<SettingsPageController, 't'>;

export function SettingsMcpTab({ t }: SettingsMcpTabProps) {
  return (
    <div className="space-y-4">
      <McpServerCard
        title={t('settings.mcp.title')}
        description={t('settings.mcp.description')}
      />
    </div>
  );
}
```

`dashboard/src/components/settings/McpServerCard.tsx` — samowystarczalna karta (jak `WebServerCard`): ładuje status, zapisuje config bezpośrednio. Przed implementacją obejrzyj `dashboard/src/components/settings/WebServerCard.tsx` i użyj tych samych komponentów UI (Card, Switch/Checkbox, Button, toast). Wymagane elementy i zachowania:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-notification';
import { mcpApi, type McpStatus } from '@/lib/tauri';
import {
  buildClaudeCodeCommand,
  buildCodexConfig,
  buildMcpUrl,
} from '@/lib/mcp-snippets';
import { logger } from '@/lib/logger';

interface McpServerCardProps {
  title: string;
  description: string;
}

export function McpServerCard({ title, description }: McpServerCardProps) {
  const { t } = useTranslation();
  const { showError, showInfo } = useToast();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    mcpApi
      .status()
      .then(setStatus)
      .catch((e) => logger.error('mcp status failed', e));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const applyConfig = async (enabled: boolean, readWrite: boolean) => {
    setSaving(true);
    try {
      setStatus(await mcpApi.setConfig(enabled, readWrite));
      showInfo(t('settings.mcp.saved'));
    } catch (e) {
      logger.error('mcp set config failed', e);
      showError(t('settings.mcp.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setSaving(true);
    try {
      setStatus(await mcpApi.regenerateToken());
      showInfo(t('settings.mcp.token_regenerated'));
    } catch (e) {
      logger.error('mcp regenerate token failed', e);
      showError(t('settings.mcp.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => showInfo(t('settings.mcp.copied')))
      .catch(() => showError(t('settings.mcp.copy_failed')));
  };

  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('ui.loading')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{t('settings.mcp.enable')}</p>
            <p className="text-xs text-muted-foreground">
              {t('settings.mcp.enable_hint', { port: status.port })}
            </p>
          </div>
          <Switch
            checked={status.enabled}
            disabled={saving}
            onCheckedChange={(v) => applyConfig(v, status.read_write)}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{t('settings.mcp.read_write')}</p>
            <p className="text-xs text-muted-foreground">
              {t('settings.mcp.read_write_hint')}
            </p>
          </div>
          <Switch
            checked={status.read_write}
            disabled={saving || !status.enabled}
            onCheckedChange={(v) => applyConfig(status.enabled, v)}
          />
        </div>

        <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs">
          {t('settings.mcp.backup_note')}
        </div>

        {status.enabled && (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('settings.mcp.token')}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
                  {status.token || t('settings.mcp.token_missing')}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(status.token)}
                  disabled={!status.token}
                  aria-label={t('settings.mcp.copy_token')}
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={regenerate}
                  disabled={saving}
                  aria-label={t('settings.mcp.regenerate_token')}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.mcp.token_hint')}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t('settings.mcp.claude_snippet')}
              </p>
              <div className="flex items-start gap-2">
                <code className="flex-1 whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                  {buildClaudeCodeCommand(status.port, status.token)}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copy(buildClaudeCodeCommand(status.port, status.token))
                  }
                  aria-label={t('settings.mcp.copy_snippet')}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t('settings.mcp.codex_snippet')}
              </p>
              <div className="flex items-start gap-2">
                <code className="flex-1 whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                  {buildCodexConfig(status.port, status.token)}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copy(buildCodexConfig(status.port, status.token))}
                  aria-label={t('settings.mcp.copy_snippet')}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.mcp.codex_hint')}
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              {t('settings.mcp.endpoint', { url: buildMcpUrl(status.port) })} ·{' '}
              {t('settings.mcp.active_sessions', {
                count: status.active_sessions,
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

(Jeśli w repo nie ma komponentu `Switch`, użyj tego, czego używa `WebServerCard` do toggli — dostosuj bez zmiany zachowania.)

- [ ] **Step 6: Klucze i18n (en i pl — OBA pliki, linter i18n to wymusza)**

Do `dashboard/src/locales/en/common.json`:
- w obiekcie `settings_page`: `"tab_mcp": "MCP"`
- nowy obiekt w `settings`: 

```json
"mcp": {
  "title": "MCP Server",
  "description": "Let AI agents (Claude Code, Codex) work with your TIMEFLOW data over the Model Context Protocol.",
  "enable": "Enable MCP server",
  "enable_hint": "Endpoint http://127.0.0.1:{{port}}/mcp — local connections only.",
  "read_write": "Allow write access",
  "read_write_hint": "Off = agents can only read projects, clients and sessions. On = they can also create and modify them.",
  "backup_note": "Before every new agent session TIMEFLOW automatically backs up the database to the mcp_backups folder (20 most recent copies are kept). A session will not start if the backup fails.",
  "token": "Access token",
  "token_hint": "Required on every request. Regenerating disconnects existing clients.",
  "token_missing": "Token will be generated when you enable the server.",
  "claude_snippet": "Claude Code — add server",
  "codex_snippet": "Codex — config.toml entry",
  "codex_hint": "Add to ~/.codex/config.toml (HTTP MCP support may vary between Codex versions).",
  "endpoint": "Endpoint: {{url}}",
  "active_sessions": "Active sessions: {{count}}",
  "saved": "MCP settings saved",
  "save_failed": "Failed to save MCP settings",
  "token_regenerated": "Token regenerated",
  "copied": "Copied to clipboard",
  "copy_failed": "Copy failed",
  "copy_token": "Copy token",
  "copy_snippet": "Copy snippet",
  "regenerate_token": "Regenerate token"
}
```

Do `dashboard/src/locales/pl/common.json` analogicznie (tłumaczenie PL):

```json
"mcp": {
  "title": "Serwer MCP",
  "description": "Pozwól agentom AI (Claude Code, Codex) pracować na danych TIMEFLOW przez protokół Model Context Protocol.",
  "enable": "Włącz serwer MCP",
  "enable_hint": "Endpoint http://127.0.0.1:{{port}}/mcp — tylko połączenia lokalne.",
  "read_write": "Zezwól na zapis",
  "read_write_hint": "Wył. = agenci mogą tylko odczytywać projekty, klientów i sesje. Wł. = mogą je też tworzyć i modyfikować.",
  "backup_note": "Przed każdą nową sesją agenta TIMEFLOW automatycznie tworzy kopię bazy w folderze mcp_backups (przechowywanych jest 20 najnowszych kopii). Sesja nie wystartuje, jeśli backup się nie powiedzie.",
  "token": "Token dostępu",
  "token_hint": "Wymagany przy każdym żądaniu. Wygenerowanie nowego odłącza istniejących klientów.",
  "token_missing": "Token zostanie wygenerowany po włączeniu serwera.",
  "claude_snippet": "Claude Code — dodaj serwer",
  "codex_snippet": "Codex — wpis w config.toml",
  "codex_hint": "Dodaj do ~/.codex/config.toml (wsparcie HTTP MCP może się różnić między wersjami Codex).",
  "endpoint": "Endpoint: {{url}}",
  "active_sessions": "Aktywne sesje: {{count}}",
  "saved": "Ustawienia MCP zapisane",
  "save_failed": "Nie udało się zapisać ustawień MCP",
  "token_regenerated": "Wygenerowano nowy token",
  "copied": "Skopiowano do schowka",
  "copy_failed": "Kopiowanie nie powiodło się",
  "copy_token": "Kopiuj token",
  "copy_snippet": "Kopiuj snippet",
  "regenerate_token": "Wygeneruj nowy token"
}
```

oraz `"tab_mcp": "MCP"` w `settings_page` (oba języki).

- [ ] **Step 7: Testy + lint**

Run: `cd dashboard && npx vitest run src/lib/__tests__/mcp-snippets.test.ts`
Expected: `3 passed`
Run: `cd dashboard && npm run lint` (jeśli skrypt nazywa się inaczej — sprawdź `package.json`; są też custom lintery i18n)
Expected: bez błędów (w szczególności linter i18n nie zgłasza brakujących kluczy)

- [ ] **Step 8: Weryfikacja manualna**

Uruchom `npm run tauri dev` (lub `python3 dashboard_dev.py`), wejdź w Ustawienia → zakładka „MCP": włącz serwer, sprawdź że token się wygenerował, skopiuj snippet, przełącz tryb zapisu. Stan loading/error karty: przy wyłączonym demonie karta ma pokazać loading, a po błędzie toast.

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/lib/ dashboard/src/pages/settings/ dashboard/src/components/settings/McpServerCard.tsx dashboard/src/hooks/useSettingsPageController.ts dashboard/src/locales/
git commit -m "feat(mcp): add Settings > MCP tab with enable/permissions toggles, token and client snippets"
```

---

### Task 8: Ikona statusu MCP w sidebarze

**Files:**
- Create: `dashboard/src/hooks/useMcpStatus.ts`
- Modify: `dashboard/src/components/layout/SidebarStatusPanel.tsx`
- Modify: `dashboard/src/locales/en/common.json`, `dashboard/src/locales/pl/common.json`

- [ ] **Step 1: Hook statusu (polling 15 s)**

`dashboard/src/hooks/useMcpStatus.ts`:

```typescript
import { useEffect, useState } from 'react';

import { mcpApi, type McpStatus } from '@/lib/tauri';

const POLL_MS = 15_000;

export function useMcpStatus(): McpStatus | null {
  const [status, setStatus] = useState<McpStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      mcpApi
        .status()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {
          /* keep last known status */
        });
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}
```

- [ ] **Step 2: Wiersz w SidebarStatusPanel**

W `SidebarStatusPanel.tsx`:
- do importów lucide (linie 1-11) dodaj `Plug`,
- dodaj import: `import { useMcpStatus } from '@/hooks/useMcpStatus';`
- w ciele komponentu (po destrukturyzacji propsów): `const mcpStatus = useMcpStatus();`
- po wierszu backupu (`ShieldCheck`, linia ~147-174) dodaj — wiersz widoczny tylko gdy MCP włączony (nie zaśmiecamy panelu wyłączoną funkcją):

```tsx
        {mcpStatus?.enabled && (
          <SidebarStatusIndicator
            collapsed={collapsed}
            icon={Plug}
            label={t('layout.status.mcp')}
            statusText={
              mcpStatus.active_sessions > 0
                ? t('layout.status.mcp_sessions', {
                    count: mcpStatus.active_sessions,
                  })
                : mcpStatus.running
                  ? t('layout.status.running')
                  : t('layout.status.stopped')
            }
            colorClass={
              mcpStatus.active_sessions > 0
                ? 'text-sky-400'
                : mcpStatus.running
                  ? 'text-emerald-500/80'
                  : 'text-red-400'
            }
            pulse={mcpStatus.active_sessions > 0}
            onClick={() => goToPage('settings')}
            title={
              mcpStatus.read_write
                ? t('layout.tooltips.mcp_read_write')
                : t('layout.tooltips.mcp_read_only')
            }
          />
        )}
```

- [ ] **Step 3: Klucze i18n (oba języki)**

en `layout.status`: `"mcp": "MCP"`, `"mcp_sessions": "{{count}} session(s)"`
en `layout.tooltips`: `"mcp_read_only": "MCP agents: read-only access"`, `"mcp_read_write": "MCP agents: read and write access"`
pl `layout.status`: `"mcp": "MCP"`, `"mcp_sessions": "{{count}} sesji"`
pl `layout.tooltips`: `"mcp_read_only": "Agenci MCP: dostęp tylko do odczytu"`, `"mcp_read_write": "Agenci MCP: odczyt i zapis"`

(`layout.status.running` / `layout.status.stopped` już istnieją — reużywamy.)

- [ ] **Step 4: Weryfikacja**

Run: `cd dashboard && npm run lint && npx vitest run`
Expected: PASS. Manualnie: przy włączonym MCP w sidebarze pojawia się wiersz „MCP" (zielony), po podłączeniu klienta (curl initialize z Task 6 Step 4) status zmienia się na „1 sesja" (niebieski, pulsuje) w ciągu 15 s.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/hooks/useMcpStatus.ts dashboard/src/components/layout/SidebarStatusPanel.tsx dashboard/src/locales/
git commit -m "feat(mcp): add MCP status indicator to sidebar status panel"
```

---

### Task 9: Sekcja Help (obowiązkowa wg CLAUDE.md §3)

**Files:**
- Create: `dashboard/src/components/help/sections/HelpMcpSection.tsx`
- Modify: `dashboard/src/pages/Help.tsx`
- Modify: `dashboard/src/lib/help-navigation.ts`
- Modify: `dashboard/src/locales/en/common.json`, `dashboard/src/locales/pl/common.json`

- [ ] **Step 1: Sekcja pomocy**

Przed implementacją obejrzyj istniejącą prostą sekcję (np. `HelpWebServerSection.tsx`) i skopiuj jej strukturę wizualną. Treść (klucze i18n `help.mcp.*`, oba języki):

`HelpMcpSection.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

export function HelpMcpSection() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <h2 className="text-lg font-semibold">{t('help.mcp.title')}</h2>
      <p>{t('help.mcp.what')}</p>
      <h3 className="font-medium">{t('help.mcp.when_title')}</h3>
      <p>{t('help.mcp.when')}</p>
      <h3 className="font-medium">{t('help.mcp.setup_title')}</h3>
      <ol className="list-decimal space-y-1 pl-5">
        <li>{t('help.mcp.setup_1')}</li>
        <li>{t('help.mcp.setup_2')}</li>
        <li>{t('help.mcp.setup_3')}</li>
      </ol>
      <h3 className="font-medium">{t('help.mcp.settings_title')}</h3>
      <ul className="list-disc space-y-1 pl-5">
        <li>{t('help.mcp.setting_enable')}</li>
        <li>{t('help.mcp.setting_permissions')}</li>
        <li>{t('help.mcp.setting_token')}</li>
      </ul>
      <h3 className="font-medium">{t('help.mcp.limits_title')}</h3>
      <p>{t('help.mcp.limits')}</p>
    </div>
  );
}
```

Klucze i18n — en (`help.mcp`):

```json
"mcp": {
  "title": "MCP Server (AI agents)",
  "what": "The MCP server lets AI coding agents such as Claude Code and Codex read your TIMEFLOW data — projects, clients and work sessions — and, if you allow it, create and update them. Agents connect locally over the Model Context Protocol; nothing is sent to the cloud by TIMEFLOW.",
  "when_title": "When to use it",
  "when": "Use it when you want an AI assistant to analyse your tracked time, prepare summaries, tidy up project/client assignments or add missing entries for you.",
  "setup_title": "How to connect an agent",
  "setup_1": "Open Settings → MCP and enable the server. A private access token is generated for you.",
  "setup_2": "Copy the ready-made snippet for Claude Code or Codex and run/paste it on your machine.",
  "setup_3": "Start a conversation with the agent — TIMEFLOW tools appear automatically. The sidebar shows active MCP sessions.",
  "settings_title": "Settings",
  "setting_enable": "Enable MCP server — turns the local endpoint on or off.",
  "setting_permissions": "Allow write access — off by default; agents can only read. Turn on to let them create projects/clients and assign sessions.",
  "setting_token": "Access token — required by every client. Regenerate it to instantly cut off all connected agents.",
  "limits_title": "Safety and limits",
  "limits": "Before every new agent session TIMEFLOW automatically saves a database backup (folder mcp_backups, 20 most recent copies). If the backup fails, the session is refused. The server accepts local connections only and always requires the token."
}
```

pl (`help.mcp`):

```json
"mcp": {
  "title": "Serwer MCP (agenci AI)",
  "what": "Serwer MCP pozwala agentom AI, takim jak Claude Code i Codex, odczytywać dane TIMEFLOW — projekty, klientów i sesje pracy — a za Twoją zgodą także je tworzyć i zmieniać. Agenci łączą się lokalnie przez protokół Model Context Protocol; TIMEFLOW niczego nie wysyła do chmury.",
  "when_title": "Kiedy używać",
  "when": "Użyj, gdy chcesz, by asystent AI przeanalizował Twój czas pracy, przygotował podsumowania, uporządkował przypisania projektów/klientów albo uzupełnił brakujące wpisy.",
  "setup_title": "Jak podłączyć agenta",
  "setup_1": "Otwórz Ustawienia → MCP i włącz serwer. Prywatny token dostępu wygeneruje się automatycznie.",
  "setup_2": "Skopiuj gotowy snippet dla Claude Code lub Codex i uruchom/wklej go na swoim komputerze.",
  "setup_3": "Rozpocznij rozmowę z agentem — narzędzia TIMEFLOW pojawią się automatycznie. Pasek boczny pokazuje aktywne sesje MCP.",
  "settings_title": "Ustawienia",
  "setting_enable": "Włącz serwer MCP — włącza lub wyłącza lokalny endpoint.",
  "setting_permissions": "Zezwól na zapis — domyślnie wyłączone; agenci mogą tylko czytać. Włącz, by mogli tworzyć projekty/klientów i przypisywać sesje.",
  "setting_token": "Token dostępu — wymagany przez każdego klienta. Wygenerowanie nowego natychmiast odcina podłączonych agentów.",
  "limits_title": "Bezpieczeństwo i ograniczenia",
  "limits": "Przed każdą nową sesją agenta TIMEFLOW automatycznie zapisuje kopię bazy (folder mcp_backups, 20 najnowszych kopii). Jeśli backup się nie powiedzie, sesja zostaje odrzucona. Serwer przyjmuje wyłącznie połączenia lokalne i zawsze wymaga tokenu."
}
```

Dodaj też `"mcp": "MCP Server"` (en) / `"mcp": "Serwer MCP"` (pl) w `help_page` (etykieta zakładki).

- [ ] **Step 2: Rejestracja zakładki**

`dashboard/src/lib/help-navigation.ts`: do `HELP_TAB_IDS` dodaj `"mcp"` (po `"webui"`), do `HELP_TAB_TO_PAGE` dodaj `mcp: "settings"`.

`dashboard/src/pages/Help.tsx`:
- import: `import { HelpMcpSection } from '@/components/help/sections/HelpMcpSection';` oraz `Plug` z lucide-react,
- w `TabsList` po zakładce `webui` (linia ~248): `<HelpTabTrigger value="mcp" icon={<Plug className="size-3.5" />} label={t18n('help_page.mcp')} />`
- odpowiadający `<TabsContent value="mcp" className="m-0 focus-visible:outline-none"><HelpMcpSection /></TabsContent>` w bloku contentów.

- [ ] **Step 3: Weryfikacja**

Run: `cd dashboard && npm run lint && npx vitest run`
Expected: PASS (lintery i18n nie zgłaszają braków). Manualnie: Help → zakładka „Serwer MCP" renderuje się w PL i EN.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/help/ dashboard/src/pages/Help.tsx dashboard/src/lib/help-navigation.ts dashboard/src/locales/
git commit -m "docs(help): add MCP server section to Help panel"
```

---

### Task 10: Weryfikacja końcowa E2E

**Files:** brak nowych — tylko weryfikacja i ewentualne poprawki.

- [ ] **Step 1: Pełne testy i lint**

```bash
cargo test --manifest-path dashboard/src-tauri/Cargo.toml
cd dashboard && npx vitest run && npm run lint
```

Expected: wszystko PASS.

- [ ] **Step 2: React Doctor (wg CLAUDE.md §5)**

Run z ROOTA repo: `npx -y react-doctor@latest . --verbose`
Expected: **100/100** (jeśli ~49/100 z błędami „security" na `.py` — nie załadował się root `doctor.config.json`).

- [ ] **Step 3: E2E z prawdziwym klientem (Claude Code)**

```bash
# port i token z Ustawienia → MCP (snippet „Claude Code")
claude mcp add --transport http timeflow http://127.0.0.1:47892/mcp --header "Authorization: Bearer <TOKEN>"
claude "List my TIMEFLOW projects using the timeflow MCP tools"
```

Expected:
1. Po połączeniu w `<data_dir>/mcp_backups/` pojawia się nowy plik `timeflow_mcp_backup_*.db`.
2. Agent widzi 5 narzędzi (read-only) lub 11 (read-write) i poprawnie listuje projekty.
3. W trybie read-only próba `create_project` zwraca błąd `read_only_mode` (agent go raportuje).
4. Sidebar pokazuje aktywną sesję MCP.
5. Po `mcp_regenerate_token` w Ustawieniach kolejne żądania klienta dostają 401.

- [ ] **Step 4: Scenariusze manualne — backup fail-closed**

Ustaw katalogowi `mcp_backups` brak praw zapisu (`chmod 444`) → `initialize` musi zwrócić błąd `backup_failed`, sesja nie powstaje. Przywróć prawa (`chmod 755`).

- [ ] **Step 5: Commit końcowy (jeśli były poprawki) i aktualizacja PARITY.md**

Sprawdź [PARITY.md](../../PARITY.md): jeśli coś w implementacji jest platform-specific (ścieżki backupów są wspólne przez `timeflow_data_dir()` — nie powinno być różnic), odnotuj. W przeciwnym razie bez zmian.

```bash
git add -A
git commit -m "test(mcp): E2E verification fixes for MCP server"
```

---

## Ryzyka i decyzje odnotowane

- **Token jawnie w `mcp_settings.json`** — świadomie (użytkownik musi go odczytać dla klientów); analogicznie do sekretu LAN. Plik leży w katalogu danych użytkownika.
- **Brak SSE** — `GET /mcp` zwraca 405; klienci Streamable HTTP (Claude Code) działają na samych odpowiedziach POST JSON. Jeśli klient wymaga SSE, to follow-up.
- **Bufor 64 KB** w `handle_connection` (pojedynczy `read`) — limit wielkości żądania MCP; wystarcza dla tools/call, odnotować przy większych payloadach (istniejące ograniczenie `/rpc`, nie pogarszamy).
- **Komendy `mcp_*` w mostku webrpc** — dostępne dla sparowanych przeglądarek jak każda inna komenda; nie zwiększa powierzchni ataku (parowanie = pełny RPC).
- **`block_on` w wątku połączenia** — wzorzec identyczny z `webui::rpc::dispatch`; każde połączenie ma własny wątek, więc blokowanie jest lokalne.
- **Włączenie MCP bez restartu** — `ensure_started` binduje port przy pierwszym włączeniu; wyłączenie NIE zatrzymuje serwera (nasłuch zostaje do restartu aplikacji, ale `/mcp` odpowiada 403 `mcp_disabled` — egzekwowane w handlerze przy każdym żądaniu).
