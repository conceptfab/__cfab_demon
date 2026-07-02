use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::commands::{
    clients_archive, clients_create, clients_delete, clients_list, clients_update,
    get_clients_summary, mcp_get_manual_session, mcp_list_manual_sessions,
    mcp_set_manual_session_time, mcp_set_manual_session_title, mcp_set_manual_session_type,
    DateRange,
};

#[derive(Debug, Deserialize, PartialEq)]
pub struct RpcRequest {
    pub command: String,
    #[serde(default)]
    pub args: Value,
}

impl RpcRequest {
    pub fn parse(body: &str) -> Result<RpcRequest, String> {
        serde_json::from_str(body).map_err(|e| format!("bad_request: {e}"))
    }
}

fn args_into<T: serde::de::DeserializeOwned>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("bad_args: {e}"))
}

fn ok<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| format!("bad_response: {e}"))
}

#[derive(Deserialize)]
struct ClientWriteArgs {
    name: String,
    contact: Option<String>,
    address: Option<String>,
    #[serde(rename = "taxId", alias = "tax_id")]
    tax_id: Option<String>,
    currency: Option<String>,
    #[serde(rename = "defaultHourlyRate", alias = "default_hourly_rate")]
    default_hourly_rate: Option<f64>,
    color: Option<String>,
}

#[derive(Deserialize)]
struct ClientUpdateArgs {
    id: i64,
    #[serde(flatten)]
    input: ClientWriteArgs,
}

#[derive(Deserialize)]
struct ClientArchiveArgs {
    id: i64,
    archived: bool,
}

#[derive(Deserialize)]
struct ClientDeleteArgs {
    id: i64,
    name: String,
}

#[derive(Deserialize)]
struct ClientsSummaryArgs {
    #[serde(rename = "dateRange", alias = "date_range")]
    date_range: DateRange,
}

#[derive(Deserialize)]
struct ManualSessionIdArgs {
    id: i64,
}

#[derive(Default, Deserialize)]
struct ManualSessionsListArgs {
    #[serde(default)]
    filters: Option<crate::commands::ManualSessionFilters>,
    #[serde(flatten)]
    direct: crate::commands::ManualSessionFilters,
}

#[derive(Deserialize)]
struct ManualSessionTitleArgs {
    id: i64,
    title: String,
}

#[derive(Deserialize)]
struct ManualSessionTypeArgs {
    id: i64,
    #[serde(rename = "sessionType", alias = "session_type")]
    session_type: String,
}

#[derive(Deserialize)]
struct ManualSessionTimeArgs {
    id: i64,
    #[serde(rename = "startTime", alias = "start_time")]
    start_time: String,
    #[serde(rename = "endTime", alias = "end_time")]
    end_time: String,
}

pub fn dispatch(app: &AppHandle, req: RpcRequest) -> Result<Value, String> {
    // Auto-generated bridge covers every registered command (see scripts/gen_webrpc.cjs).
    if let Some(result) =
        crate::webui::rpc_generated::dispatch_generated(app, &req.command, &req.args)
    {
        return result;
    }
    match req.command.as_str() {
        "clients_list" => {
            let result = tauri::async_runtime::block_on(clients_list(app.clone()))?;
            ok(result)
        }
        "clients_create" => {
            let args: ClientWriteArgs = args_into(req.args)?;
            let result = tauri::async_runtime::block_on(clients_create(
                app.clone(),
                args.name,
                args.contact,
                args.address,
                args.tax_id,
                args.currency,
                args.default_hourly_rate,
                args.color,
            ))?;
            ok(result)
        }
        "clients_update" => {
            let args: ClientUpdateArgs = args_into(req.args)?;
            let result = tauri::async_runtime::block_on(clients_update(
                app.clone(),
                args.id,
                args.input.name,
                args.input.contact,
                args.input.address,
                args.input.tax_id,
                args.input.currency,
                args.input.default_hourly_rate,
                args.input.color,
            ))?;
            ok(result)
        }
        "clients_archive" => {
            let args: ClientArchiveArgs = args_into(req.args)?;
            let result = tauri::async_runtime::block_on(clients_archive(
                app.clone(),
                args.id,
                args.archived,
            ))?;
            ok(result)
        }
        "clients_delete" => {
            let args: ClientDeleteArgs = args_into(req.args)?;
            tauri::async_runtime::block_on(clients_delete(app.clone(), args.id, args.name))?;
            ok(())
        }
        "get_clients_summary" => {
            let args: ClientsSummaryArgs = args_into(req.args)?;
            let result =
                tauri::async_runtime::block_on(get_clients_summary(app.clone(), args.date_range))?;
            ok(result)
        }
        "mcp_list_manual_sessions" => {
            let args: ManualSessionsListArgs = args_into(req.args)?;
            let filters = args.filters.unwrap_or(args.direct);
            let result =
                tauri::async_runtime::block_on(mcp_list_manual_sessions(app.clone(), filters))?;
            ok(result)
        }
        "mcp_get_manual_session" => {
            let args: ManualSessionIdArgs = args_into(req.args)?;
            let result =
                tauri::async_runtime::block_on(mcp_get_manual_session(app.clone(), args.id))?;
            ok(result)
        }
        "mcp_set_manual_session_title" => {
            let args: ManualSessionTitleArgs = args_into(req.args)?;
            let result = tauri::async_runtime::block_on(mcp_set_manual_session_title(
                app.clone(),
                args.id,
                args.title,
            ))?;
            ok(result)
        }
        "mcp_set_manual_session_type" => {
            let args: ManualSessionTypeArgs = args_into(req.args)?;
            let result = tauri::async_runtime::block_on(mcp_set_manual_session_type(
                app.clone(),
                args.id,
                args.session_type,
            ))?;
            ok(result)
        }
        "mcp_set_manual_session_time" => {
            let args: ManualSessionTimeArgs = args_into(req.args)?;
            let result = tauri::async_runtime::block_on(mcp_set_manual_session_time(
                app.clone(),
                args.id,
                args.start_time,
                args.end_time,
            ))?;
            ok(result)
        }
        other => Err(format!("unknown_command: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Debug, Deserialize, PartialEq)]
    struct TypedArgs {
        id: i64,
        name: String,
    }

    #[test]
    fn parses_command_and_args() {
        let req =
            RpcRequest::parse(r#"{"command":"clients_delete","args":{"id":7,"name":"ACME"}}"#)
                .expect("request should parse");

        assert_eq!(req.command, "clients_delete");
        assert_eq!(req.args, json!({ "id": 7, "name": "ACME" }));
    }

    #[test]
    fn args_default_to_null_when_absent() {
        let req = RpcRequest::parse(r#"{"command":"clients_list"}"#).expect("request should parse");

        assert_eq!(req.args, Value::Null);
    }

    #[test]
    fn rejects_non_json() {
        let err = RpcRequest::parse("not json").expect_err("invalid JSON should be rejected");

        assert!(err.starts_with("bad_request:"));
    }

    #[test]
    fn args_into_typed_struct() {
        let args: TypedArgs =
            args_into(json!({ "id": 42, "name": "TIMEFLOW" })).expect("args should decode");

        assert_eq!(
            args,
            TypedArgs {
                id: 42,
                name: "TIMEFLOW".to_string()
            }
        );
    }

    #[test]
    fn create_args_accept_camel_case_and_optional_nulls() {
        let args: ClientWriteArgs = args_into(json!({
            "name": "ACME",
            "contact": null,
            "address": null,
            "taxId": null,
            "currency": "PLN",
            "defaultHourlyRate": null,
            "color": "#38bdf8"
        }))
        .expect("create args should decode");

        assert_eq!(args.name, "ACME");
        assert_eq!(args.contact, None);
        assert_eq!(args.address, None);
        assert_eq!(args.tax_id, None);
        assert_eq!(args.currency, Some("PLN".to_string()));
        assert_eq!(args.default_hourly_rate, None);
        assert_eq!(args.color, Some("#38bdf8".to_string()));
    }

    #[test]
    fn update_args_accept_camel_case_and_optional_nulls() {
        let args: ClientUpdateArgs = args_into(json!({
            "id": 9,
            "name": "ACME",
            "contact": null,
            "address": "Street 1",
            "taxId": "123",
            "currency": null,
            "defaultHourlyRate": 150.5,
            "color": null
        }))
        .expect("update args should decode");

        assert_eq!(args.id, 9);
        assert_eq!(args.input.name, "ACME");
        assert_eq!(args.input.contact, None);
        assert_eq!(args.input.address, Some("Street 1".to_string()));
        assert_eq!(args.input.tax_id, Some("123".to_string()));
        assert_eq!(args.input.currency, None);
        assert_eq!(args.input.default_hourly_rate, Some(150.5));
        assert_eq!(args.input.color, None);
    }

    #[test]
    fn summary_args_accept_date_range() {
        let args: ClientsSummaryArgs = args_into(json!({
            "dateRange": {
                "start": "2026-06-01",
                "end": "2026-06-14"
            }
        }))
        .expect("summary args should decode");

        assert_eq!(args.date_range.start, "2026-06-01");
        assert_eq!(args.date_range.end, "2026-06-14");
    }

    #[test]
    fn archive_args_accept_id_and_archived() {
        let args: ClientArchiveArgs =
            args_into(json!({ "id": 7, "archived": true })).expect("archive args should decode");

        assert_eq!(args.id, 7);
        assert!(args.archived);
    }

    #[test]
    fn delete_args_accept_id_and_name() {
        let args: ClientDeleteArgs =
            args_into(json!({ "id": 7, "name": "ACME" })).expect("delete args should decode");

        assert_eq!(args.id, 7);
        assert_eq!(args.name, "ACME");
    }

    struct BadResponse;

    impl serde::ser::Serialize for BadResponse {
        fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
        where
            S: serde::Serializer,
        {
            Err(serde::ser::Error::custom("boom"))
        }
    }

    #[test]
    fn response_serialization_errors_are_prefixed() {
        let err = ok(BadResponse).expect_err("bad response should be rejected");

        assert_eq!(err, "bad_response: boom");
    }
}
