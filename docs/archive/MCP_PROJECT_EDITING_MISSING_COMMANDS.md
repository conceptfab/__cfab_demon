# Missing MCP Project Editing Commands

Date: 2026-07-02

This file lists project-related backend commands that are not currently exposed through the TIMEFLOW MCP tool surface.

## Current MCP Project Tools

- `list_projects`
- `get_project`
- `create_project`
- `assign_session_to_project`
- `set_project_client`

These cover basic read/create/client assignment workflows, but they are not enough for complete project editing through MCP.

## Missing Core Editing Tools

| Proposed MCP tool | Existing backend command | Priority | Notes |
| --- | --- | --- | --- |
| `update_project_color` | `update_project` | P1 | Allows changing project color. Backend command currently edits color only. |
| `set_project_status` | `project_set_status` | P1 | Needed to edit project status from MCP. |
| `update_project_hourly_rate` | `update_project_hourly_rate` | P1 | Needed for billing/rate changes. |
| `freeze_project` | `freeze_project` | P1 | Project lifecycle control. |
| `unfreeze_project` | `unfreeze_project` | P1 | Project lifecycle control. |
| `exclude_project` | `exclude_project` | P1 | Project lifecycle control. |
| `restore_project` | `restore_project` | P1 | Project lifecycle control. |
| `merge_project` | `merge_project` | P1 | Needed for project cleanup and consolidation. |
| `unmerge_project` | `unmerge_project` | P1 | Needed to undo merge operations. |
| `delete_project` | `delete_project` | P1 | Destructive; should require write permissions and careful validation. |

## Missing Assignment And Folder Tools

| Proposed MCP tool | Existing backend command | Priority | Notes |
| --- | --- | --- | --- |
| `assign_app_to_project` | `assign_app_to_project` | P2 | Needed to edit project app mapping. |
| `list_project_folders` | `get_project_folders` | P2 | Read helper for folder-based project workflows. |
| `add_project_folder` | `add_project_folder` | P2 | Folder source management. |
| `remove_project_folder` | `remove_project_folder` | P2 | Folder source management. |
| `update_project_folder_meta` | `update_project_folder_meta` | P2 | Folder metadata editing. |
| `list_folder_project_candidates` | `get_folder_project_candidates` | P2 | Read helper before creating projects from folders. |
| `create_project_from_folder` | `create_project_from_folder` | P2 | Folder-based project creation. |

## Missing Read Helpers

| Proposed MCP tool | Existing backend command | Priority | Notes |
| --- | --- | --- | --- |
| `list_excluded_projects` | `get_excluded_projects` | P2 | Needed before restore/delete decisions. |
| `list_merged_projects` | `get_merged_projects` | P2 | Needed before unmerge decisions. |
| `list_projects_with_client` | `projects_with_client` | P2 | Useful for client/project audits. |
| `get_project_extra_info` | `get_project_extra_info` | P2 | Useful before edits that depend on extended project metadata. |
| `get_project_estimates` | `get_project_estimates` | P2 | Useful before rate/estimate changes. |

## Commands To Keep Gated Or Out Of MCP For Now

| Existing backend command | Recommendation | Reason |
| --- | --- | --- |
| `blacklist_project_names` | Gate heavily or skip | Broad destructive/behavior-changing operation. |
| `delete_all_excluded_projects` | Gate heavily or skip | Bulk destructive operation. |
| `sync_projects_from_folders` | Gate or expose later | Can create/update many records. |
| `auto_create_projects_from_detection` | Gate or expose later | Automated bulk creation. |
| `compact_project_data` | Gate heavily | Data mutation/maintenance operation. |

## Implementation Notes

- All write tools should use the existing MCP write permission checks.
- Destructive tools should validate project id existence before mutation and return a clear error if the project is missing.
- Tools should follow the current MCP pattern in `dashboard/src-tauri/src/mcp/tools.rs`.
- Any new non-`#[tauri::command]` helper used by WebRPC should be added to the fallback handlers in `dashboard/src-tauri/src/webui/rpc.rs` if needed.
- After adding tools, regenerate and verify WebRPC bindings with `node scripts/gen_webrpc.cjs --check`.
