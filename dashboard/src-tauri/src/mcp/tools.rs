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
        assert_eq!(
            find_tool("list_projects").expect("known").command,
            "get_projects"
        );
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
