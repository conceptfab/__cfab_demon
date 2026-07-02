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
        name: "list_manual_sessions",
        command: "mcp_list_manual_sessions",
        write: false,
        description: "List manual work sessions. Supports optional dateRange, projectId, limit, and offset filters.",
        schema: || json!({
            "type": "object",
            "properties": {
                "filters": {
                    "type": "object",
                    "properties": {
                        "dateRange": date_range_schema(),
                        "projectId": { "type": "integer" },
                        "limit": { "type": "integer" },
                        "offset": { "type": "integer" }
                    }
                }
            },
            "required": []
        }),
    },
    ToolDef {
        name: "get_manual_session",
        command: "mcp_get_manual_session",
        write: false,
        description: "Get a single manual work session by id.",
        schema: || json!({
            "type": "object",
            "properties": { "id": { "type": "integer" } },
            "required": ["id"]
        }),
    },
    ToolDef {
        name: "create_manual_session",
        command: "create_manual_session",
        write: true,
        description: "Create a manual work session. Requires title, session_type, project_id, start_time, and end_time. Times use YYYY-MM-DDTHH:MM[:SS].",
        schema: || json!({
            "type": "object",
            "properties": {
                "input": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "session_type": { "type": "string", "description": "e.g. meeting, call, other" },
                        "project_id": { "type": "integer" },
                        "app_id": { "type": ["integer", "null"] },
                        "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:MM[:SS]" },
                        "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:MM[:SS]" }
                    },
                    "required": ["title", "session_type", "project_id", "start_time", "end_time"]
                }
            },
            "required": ["input"]
        }),
    },
    ToolDef {
        name: "update_manual_session",
        command: "update_manual_session",
        write: true,
        description: "Update a manual work session by id. Changes title/comment, session_type, project_id, app_id, start_time, and end_time.",
        schema: || json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer" },
                "input": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "description": "Manual session comment/title" },
                        "session_type": { "type": "string", "description": "e.g. meeting, call, other" },
                        "project_id": { "type": "integer" },
                        "app_id": { "type": ["integer", "null"] },
                        "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:MM[:SS]" },
                        "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:MM[:SS]" }
                    },
                    "required": ["title", "session_type", "project_id", "start_time", "end_time"]
                }
            },
            "required": ["id", "input"]
        }),
    },
    ToolDef {
        name: "set_manual_session_title",
        command: "mcp_set_manual_session_title",
        write: true,
        description: "Update only the title/comment of a manual work session by id.",
        schema: || json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer" },
                "title": { "type": "string" }
            },
            "required": ["id", "title"]
        }),
    },
    ToolDef {
        name: "set_manual_session_type",
        command: "mcp_set_manual_session_type",
        write: true,
        description: "Update only the type of a manual work session by id.",
        schema: || json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer" },
                "session_type": { "type": "string", "description": "e.g. meeting, call, other" }
            },
            "required": ["id", "session_type"]
        }),
    },
    ToolDef {
        name: "set_manual_session_time",
        command: "mcp_set_manual_session_time",
        write: true,
        description: "Update only the start/end time of a manual work session by id. Duration and date are recalculated.",
        schema: || json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer" },
                "start_time": { "type": "string", "description": "YYYY-MM-DDTHH:MM[:SS]" },
                "end_time": { "type": "string", "description": "YYYY-MM-DDTHH:MM[:SS]" }
            },
            "required": ["id", "start_time", "end_time"]
        }),
    },
    ToolDef {
        name: "delete_manual_session",
        command: "delete_manual_session",
        write: true,
        description: "Delete a manual work session by id.",
        schema: || json!({
            "type": "object",
            "properties": { "id": { "type": "integer" } },
            "required": ["id"]
        }),
    },
    ToolDef {
        name: "delete_manual_sessions",
        command: "delete_manual_sessions",
        write: true,
        description: "Delete multiple manual work sessions by id.",
        schema: || json!({
            "type": "object",
            "properties": {
                "ids": {
                    "type": "array",
                    "items": { "type": "integer" }
                }
            },
            "required": ["ids"]
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
    ToolDef {
        name: "update_project_color",
        command: "update_project",
        write: true,
        description: "Update a project's hex color by numeric id (e.g. #38bdf8). This backend command edits color only.",
        schema: || json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer" },
                "color": { "type": "string", "description": "Hex color, e.g. #38bdf8" }
            },
            "required": ["id", "color"]
        }),
    },
    ToolDef {
        name: "set_project_status",
        command: "project_set_status",
        write: true,
        description: "Set a project's lifecycle status. Status is derived from frozen/excluded state: 'frozen' freezes, 'excluded'/'archived' exclude, 'active' restores.",
        schema: || json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "status": { "type": "string", "enum": ["active", "frozen", "excluded", "archived"] }
            },
            "required": ["project_id", "status"]
        }),
    },
    ToolDef {
        name: "update_project_hourly_rate",
        command: "update_project_hourly_rate",
        write: true,
        description: "Set or clear (rate=null) a project's hourly billing rate by project id.",
        schema: || json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "integer" },
                "rate": { "type": ["number", "null"] }
            },
            "required": ["project_id"]
        }),
    },
    ToolDef {
        name: "freeze_project",
        command: "freeze_project",
        write: true,
        description: "Freeze a project by id and detach its application mappings so new sessions cannot inherit it.",
        schema: || json!({
            "type": "object",
            "properties": { "id": { "type": "integer" } },
            "required": ["id"]
        }),
    },
    ToolDef {
        name: "unfreeze_project",
        command: "unfreeze_project",
        write: true,
        description: "Unfreeze a previously frozen project by id.",
        schema: || json!({
            "type": "object",
            "properties": { "id": { "type": "integer" } },
            "required": ["id"]
        }),
    },
    ToolDef {
        name: "exclude_project",
        command: "exclude_project",
        write: true,
        description: "Exclude (archive) a project by id so it is hidden from active lists.",
        schema: || json!({
            "type": "object",
            "properties": { "id": { "type": "integer" } },
            "required": ["id"]
        }),
    },
    ToolDef {
        name: "restore_project",
        command: "restore_project",
        write: true,
        description: "Restore a previously excluded project by id back to active.",
        schema: || json!({
            "type": "object",
            "properties": { "id": { "type": "integer" } },
            "required": ["id"]
        }),
    },
    ToolDef {
        name: "merge_project",
        command: "merge_project",
        write: true,
        description: "Merge a source project into a target project by numeric ids. Sessions move to the target and the source becomes a merged alias.",
        schema: || json!({
            "type": "object",
            "properties": {
                "source_id": { "type": "integer" },
                "target_id": { "type": "integer" }
            },
            "required": ["source_id", "target_id"]
        }),
    },
    ToolDef {
        name: "unmerge_project",
        command: "unmerge_project",
        write: true,
        description: "Undo a merge and restore a previously merged project by its id.",
        schema: || json!({
            "type": "object",
            "properties": { "id": { "type": "integer" } },
            "required": ["id"]
        }),
    },
    ToolDef {
        name: "delete_project",
        command: "delete_project",
        write: true,
        description: "Permanently delete a project by id. Destructive: sessions lose their project assignment.",
        schema: || json!({
            "type": "object",
            "properties": { "id": { "type": "integer" } },
            "required": ["id"]
        }),
    },
    ToolDef {
        name: "assign_app_to_project",
        command: "assign_app_to_project",
        write: true,
        description: "Map an application to a project (project_id=null clears the mapping). Future sessions of the app inherit the project.",
        schema: || json!({
            "type": "object",
            "properties": {
                "app_id": { "type": "integer" },
                "project_id": { "type": ["integer", "null"] }
            },
            "required": ["app_id"]
        }),
    },
    ToolDef {
        name: "list_project_folders",
        command: "get_project_folders",
        write: false,
        description: "List configured project source folders with their metadata.",
        schema: || json!({ "type": "object", "properties": {} }),
    },
    ToolDef {
        name: "add_project_folder",
        command: "add_project_folder",
        write: true,
        description: "Register a filesystem folder as a project source by absolute path.",
        schema: || json!({
            "type": "object",
            "properties": { "path": { "type": "string" } },
            "required": ["path"]
        }),
    },
    ToolDef {
        name: "remove_project_folder",
        command: "remove_project_folder",
        write: true,
        description: "Remove a registered project source folder by its path.",
        schema: || json!({
            "type": "object",
            "properties": { "path": { "type": "string" } },
            "required": ["path"]
        }),
    },
    ToolDef {
        name: "update_project_folder_meta",
        command: "update_project_folder_meta",
        write: true,
        description: "Update metadata (color, category, badge) of a registered project folder by its path.",
        schema: || json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "color": { "type": ["string", "null"] },
                "category": { "type": ["string", "null"] },
                "badge": { "type": ["string", "null"] }
            },
            "required": ["path"]
        }),
    },
    ToolDef {
        name: "list_folder_project_candidates",
        command: "get_folder_project_candidates",
        write: false,
        description: "List folder-based project candidates that can be turned into projects.",
        schema: || json!({ "type": "object", "properties": {} }),
    },
    ToolDef {
        name: "create_project_from_folder",
        command: "create_project_from_folder",
        write: true,
        description: "Create a new project from a registered folder candidate by its folder path.",
        schema: || json!({
            "type": "object",
            "properties": { "folder_path": { "type": "string" } },
            "required": ["folder_path"]
        }),
    },
    ToolDef {
        name: "list_excluded_projects",
        command: "get_excluded_projects",
        write: false,
        description: "List excluded (archived) projects with time statistics. Optionally limit stats to a date range.",
        schema: || json!({
            "type": "object",
            "properties": { "date_range": date_range_schema() }
        }),
    },
    ToolDef {
        name: "list_merged_projects",
        command: "get_merged_projects",
        write: false,
        description: "List merged projects with time statistics. Optionally limit stats to a date range.",
        schema: || json!({
            "type": "object",
            "properties": { "date_range": date_range_schema() }
        }),
    },
    ToolDef {
        name: "list_projects_with_client",
        command: "projects_with_client",
        write: false,
        description: "List all projects with their linked client (for client/project audits).",
        schema: || json!({ "type": "object", "properties": {} }),
    },
    ToolDef {
        name: "get_project_extra_info",
        command: "get_project_extra_info",
        write: false,
        description: "Get extended metadata and stats for a project by id over a date range.",
        schema: || json!({
            "type": "object",
            "properties": {
                "id": { "type": "integer" },
                "date_range": date_range_schema()
            },
            "required": ["id", "date_range"]
        }),
    },
    ToolDef {
        name: "get_project_estimates",
        command: "get_project_estimates",
        write: false,
        description: "Get per-project estimate/value rows for a date range (uses the hourly-rate cascade).",
        schema: || json!({
            "type": "object",
            "properties": { "date_range": date_range_schema() },
            "required": ["date_range"]
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
        assert_eq!(
            find_tool("create_manual_session").expect("known").command,
            "create_manual_session"
        );
        assert_eq!(
            find_tool("list_manual_sessions").expect("known").command,
            "mcp_list_manual_sessions"
        );
        assert_eq!(
            find_tool("update_manual_session").expect("known").command,
            "update_manual_session"
        );
        assert_eq!(
            find_tool("delete_manual_session").expect("known").command,
            "delete_manual_session"
        );
        assert_eq!(
            find_tool("delete_manual_sessions").expect("known").command,
            "delete_manual_sessions"
        );
        assert_eq!(
            find_tool("get_manual_session").expect("known").command,
            "mcp_get_manual_session"
        );
        assert_eq!(
            find_tool("set_manual_session_title")
                .expect("known")
                .command,
            "mcp_set_manual_session_title"
        );
        assert_eq!(
            find_tool("set_manual_session_type").expect("known").command,
            "mcp_set_manual_session_type"
        );
        assert_eq!(
            find_tool("set_manual_session_time").expect("known").command,
            "mcp_set_manual_session_time"
        );
        assert!(find_tool("drop_database").is_none());
    }

    #[test]
    fn manual_session_list_schema_supports_empty_filters_and_pagination() {
        let schema = (find_tool("list_manual_sessions").expect("known").schema)();
        assert_eq!(schema["required"], serde_json::json!([]));
        let filters = &schema["properties"]["filters"]["properties"];
        assert_eq!(filters["limit"]["type"], "integer");
        assert_eq!(filters["offset"]["type"], "integer");
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
