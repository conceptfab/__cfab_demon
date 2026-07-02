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
        let req = parse_message(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
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
