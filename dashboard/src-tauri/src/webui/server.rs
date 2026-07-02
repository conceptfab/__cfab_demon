use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;

use include_dir::{include_dir, Dir};
use tauri::AppHandle;

use crate::webui::auth::AuthState;
use crate::webui::rpc::{self, RpcRequest};

static SPA: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../dist");

#[derive(Debug, PartialEq)]
pub struct ParsedRequest {
    pub method: String,
    pub path: String,
    pub bearer: Option<String>,
    pub origin: Option<String>,
    pub host: Option<String>,
    /// True when the custom `X-Timeflow-Rpc` header is present. Browsers cannot
    /// set a custom request header cross-origin without a CORS preflight, so its
    /// presence proves the request came from our own same-origin SPA.
    pub rpc_header: bool,
    pub mcp_session: Option<String>,
    pub body: String,
}

pub fn parse_request(raw: &str) -> Option<ParsedRequest> {
    let (head, body) = raw.split_once("\r\n\r\n").unwrap_or((raw, ""));
    let mut lines = head.lines();
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut bearer = None;
    let mut origin = None;
    let mut host = None;
    let mut rpc_header = false;
    let mut mcp_session = None;

    for line in lines {
        if let Some(rest) = line.strip_prefix("Authorization:") {
            let value = rest.trim();
            if let Some(token) = value.strip_prefix("Bearer ") {
                bearer = Some(token.trim().to_string());
            }
        } else if let Some(rest) = line.strip_prefix("Origin:") {
            origin = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("Host:") {
            host = Some(rest.trim().to_string());
        } else if line.to_ascii_lowercase().starts_with("x-timeflow-rpc:") {
            rpc_header = true;
        } else if line.to_ascii_lowercase().starts_with("mcp-session-id:") {
            mcp_session = line
                .splitn(2, ':')
                .nth(1)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
        }
    }

    Some(ParsedRequest {
        method,
        path,
        bearer,
        origin,
        host,
        rpc_header,
        mcp_session,
        body: body.to_string(),
    })
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// CSP header value. `nonce` whitelists exactly one inline `<script>` — the
/// language injection in `serve_index`. Every other response passes `None` and
/// gets a strict `script-src 'self'` (no inline scripts). `style-src` keeps
/// 'unsafe-inline' because Radix/Recharts inject inline styles.
fn csp_header(nonce: Option<&str>) -> String {
    let script_src = match nonce {
        Some(n) => format!("script-src 'self' 'nonce-{n}'"),
        None => "script-src 'self'".to_string(),
    };
    format!(
        "default-src 'self'; {script_src}; style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'"
    )
}

fn http(status: &str, content_type: &str, body: &[u8]) -> Vec<u8> {
    http_with_nonce(status, content_type, body, None)
}

fn http_with_nonce(status: &str, content_type: &str, body: &[u8], nonce: Option<&str>) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\
         Content-Security-Policy: {}\r\n\
         X-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\n\
         Connection: close\r\n\r\n",
        body.len(),
        csp_header(nonce)
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

fn json_response(status: &str, json: &str) -> Vec<u8> {
    http(status, "application/json", json.as_bytes())
}

/// Shared language code from language.json (written by the desktop app/daemon).
fn read_persisted_language() -> String {
    let base = match crate::commands::helpers::timeflow_data_dir() {
        Ok(b) => b,
        Err(_) => return "en".to_string(),
    };
    let raw = std::fs::read_to_string(base.join("language.json")).unwrap_or_default();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
    let code = parsed.get("code").and_then(|c| c.as_str()).unwrap_or("en");
    if code.to_lowercase().starts_with("pl") {
        "pl".to_string()
    } else {
        "en".to_string()
    }
}

/// Serve index.html with the shared language injected as a global, so the SPA
/// renders in the same language as the desktop app — synchronously, before the
/// bundle runs, with no token or async timing involved.
fn serve_index(_is_loopback: bool) -> Vec<u8> {
    let Some(index) = SPA.get_file("index.html") else {
        return http("500 Internal Server Error", "text/plain", b"bundle missing");
    };
    let html = String::from_utf8_lossy(index.contents());
    // Per-response nonce so the inline language script is allowed under the
    // strict CSP (script-src 'self' 'nonce-…'), without re-opening unsafe-inline.
    // No more loopback "trusted" flag — every browser must pair (kills the CSRF
    // vector where any site could drive 127.0.0.1 without a token).
    let nonce = crate::webui::auth::random_token();
    let inject = format!(
        "<script nonce=\"{nonce}\">window.__TIMEFLOW_LANG__=\"{}\";</script>",
        read_persisted_language()
    );
    let injected = match html.find("<head>") {
        Some(pos) => format!("{}{}{}", &html[..pos + 6], inject, &html[pos + 6..]),
        None => format!("{inject}{html}"),
    };
    http_with_nonce("200 OK", "text/html", injected.as_bytes(), Some(&nonce))
}

fn serve_spa(path: &str, is_loopback: bool) -> Vec<u8> {
    let rel = path.trim_start_matches('/');
    // Defense-in-depth: SPA is an embedded include_dir! (no disk reads), but
    // reject '..' explicitly so a traversal attempt can never resolve a file.
    if rel.contains("..") {
        return serve_index(is_loopback);
    }
    let candidate = if rel.is_empty() { "index.html" } else { rel };
    if candidate == "index.html" {
        return serve_index(is_loopback);
    }
    match SPA.get_file(candidate) {
        Some(file) => http("200 OK", mime_for(candidate), file.contents()),
        // SPA fallback: unknown route → index.html (client-side router).
        None => serve_index(is_loopback),
    }
}

fn mime_for(name: &str) -> &'static str {
    match name.rsplit('.').next() {
        Some("html") => "text/html",
        Some("js") => "text/javascript",
        Some("css") => "text/css",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

pub fn spawn(app: AppHandle, auth: Arc<AuthState>, port: u16, lan: bool) -> Result<(), String> {
    let host: std::net::IpAddr = if lan {
        std::net::Ipv4Addr::UNSPECIFIED.into() // 0.0.0.0 — reachable from LAN
    } else {
        std::net::Ipv4Addr::LOCALHOST.into() // 127.0.0.1 — loopback only (default)
    };
    let listener =
        TcpListener::bind((host, port)).map_err(|e| format!("bind {host}:{port} failed: {e}"))?;
    log::info!("[webui] listening on {host}:{port} (lan_exposure={lan})");

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            // One thread per connection: browsers open several connections in
            // parallel (incl. idle "preconnect" sockets that send no data). A
            // single-threaded accept loop would block on the first idle read and
            // starve the real request, surfacing as ERR_EMPTY_RESPONSE.
            let app = app.clone();
            let auth = auth.clone();
            std::thread::spawn(move || handle_connection(stream, &app, &auth));
        }
    });

    Ok(())
}

fn handle_connection(mut stream: std::net::TcpStream, app: &AppHandle, auth: &Arc<AuthState>) {
    // Read timeout so an idle preconnect socket can't pin a thread forever.
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(15)));
    let is_loopback = stream
        .peer_addr()
        .map(|addr| addr.ip().is_loopback())
        .unwrap_or(false);

    let mut buf = vec![0u8; 64 * 1024];
    let n = match stream.read(&mut buf) {
        Ok(0) | Err(_) => return,
        Ok(n) => n,
    };
    let raw = String::from_utf8_lossy(&buf[..n]).to_string();
    let response = handle(app, auth, &raw, is_loopback);
    let _ = stream.write_all(&response);
    let _ = stream.flush();
}

fn handle(app: &AppHandle, auth: &Arc<AuthState>, raw: &str, is_loopback: bool) -> Vec<u8> {
    let Some(request) = parse_request(raw) else {
        return json_response("400 Bad Request", r#"{"ok":false,"error":"bad_request"}"#);
    };

    // Web Server wyłączony → tylko /mcp i /healthz są dostępne (serwer mógł
    // wystartować wyłącznie dla MCP).
    if !crate::webui::config::load().enabled
        && !matches!(request.path.as_str(), "/mcp" | "/healthz")
    {
        return json_response(
            "403 Forbidden",
            r#"{"ok":false,"error":"webserver_disabled"}"#,
        );
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/healthz") => json_response("200 OK", r#"{"ok":true}"#),
        ("POST", "/auth/pair") => handle_pair(auth, &request.body),
        ("POST", "/rpc") => handle_rpc(app, auth, &request, is_loopback),
        ("POST", "/mcp") => handle_mcp(app, &request),
        ("DELETE", "/mcp") => handle_mcp_delete(&request),
        ("GET", "/mcp") => json_response(
            "405 Method Not Allowed",
            r#"{"ok":false,"error":"sse_not_supported"}"#,
        ),
        ("GET", _) => serve_spa(&request.path, is_loopback),
        _ => json_response("404 Not Found", r#"{"ok":false,"error":"not_found"}"#),
    }
}

fn handle_pair(auth: &Arc<AuthState>, body: &str) -> Vec<u8> {
    #[derive(serde::Deserialize)]
    struct PairBody {
        code: String,
        #[serde(default)]
        label: String,
    }

    let body: PairBody = match serde_json::from_str(body) {
        Ok(body) => body,
        Err(_) => {
            return json_response("400 Bad Request", r#"{"ok":false,"error":"bad_request"}"#);
        }
    };
    let label = if body.label.trim().is_empty() {
        "browser".to_string()
    } else {
        body.label
    };

    if auth.pairing_blocked(now_secs()) {
        return json_response(
            "429 Too Many Requests",
            r#"{"ok":false,"error":"too_many_attempts"}"#,
        );
    }

    // Crypto-random token (persisted as a hash) and a separate revocation id.
    match auth.redeem(
        &body.code,
        label,
        now_secs(),
        crate::webui::auth::random_token,
        crate::webui::auth::random_token,
    ) {
        Ok(session) => {
            let json = serde_json::json!({ "ok": true, "token": session.token }).to_string();
            json_response("200 OK", &json)
        }
        Err(error) => {
            let status = if error == "too_many_attempts" {
                "429 Too Many Requests"
            } else {
                "401 Unauthorized"
            };
            let json = serde_json::json!({ "ok": false, "error": error }).to_string();
            json_response(status, &json)
        }
    }
}

/// Origin obcy = obecny i niepasujący do loopback/host. Same-origin SPA albo
/// nie wysyła Origin (GET/same-origin POST), albo wysyła własny — dozwolony.
fn origin_is_forbidden(request: &ParsedRequest) -> bool {
    let Some(origin) = request.origin.as_deref() else {
        return false;
    };
    let allowed = origin.starts_with("http://127.0.0.1")
        || origin.starts_with("http://localhost")
        || request
            .host
            .as_deref()
            .map(|h| origin == format!("http://{h}"))
            .unwrap_or(false);
    !allowed
}

/// Loopback (127.0.0.1) jest zaufany BEZ tokenu — ale wyłącznie dlatego, że
/// `handle_rpc` woła tę funkcję DOPIERO po `origin_is_forbidden` i
/// `request_has_rpc_header`. Obca strona nie ustawi nagłówka `X-Timeflow-Rpc`
/// cross-origin bez preflightu (serwer go nie zwraca) ani nie poda naszego
/// Origin — więc „loopback + te bramki” = nasz same-origin SPA, nie CSRF.
/// Token wymagany tylko dla połączeń NIE-loopback (LAN / inne urządzenia).
fn rpc_is_authorized(
    request: &ParsedRequest,
    auth: &AuthState,
    now: u64,
    is_loopback: bool,
) -> bool {
    if is_loopback {
        return true;
    }
    request
        .bearer
        .as_deref()
        .map(|token| auth.is_authorized(token, now))
        .unwrap_or(false)
}

/// Wymagany niestandardowy nagłówek niemożliwy do ustawienia cross-origin bez
/// preflightu — dodatkowa bariera CSRF niezależna od tokenu.
fn request_has_rpc_header(request: &ParsedRequest) -> bool {
    request.rpc_header
}

fn handle_rpc(
    app: &AppHandle,
    auth: &Arc<AuthState>,
    request: &ParsedRequest,
    is_loopback: bool,
) -> Vec<u8> {
    if origin_is_forbidden(request) {
        return json_response(
            "403 Forbidden",
            r#"{"ok":false,"error":"forbidden_origin"}"#,
        );
    }
    if !request_has_rpc_header(request) {
        return json_response(
            "400 Bad Request",
            r#"{"ok":false,"error":"missing_rpc_header"}"#,
        );
    }
    if !rpc_is_authorized(request, auth, now_secs(), is_loopback) {
        return json_response("401 Unauthorized", r#"{"ok":false,"error":"unauthorized"}"#);
    }

    let parsed = match RpcRequest::parse(&request.body) {
        Ok(parsed) => parsed,
        Err(error) => {
            let json = serde_json::json!({ "ok": false, "error": error }).to_string();
            return json_response("400 Bad Request", &json);
        }
    };

    match rpc::dispatch(app, parsed) {
        Ok(data) => {
            let json = serde_json::json!({ "ok": true, "data": data }).to_string();
            json_response("200 OK", &json)
        }
        Err(error) => {
            let json = serde_json::json!({ "ok": false, "error": error }).to_string();
            json_response("200 OK", &json)
        }
    }
}

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

fn require_active_mcp_session(request: &ParsedRequest, now: u64) -> Result<(), &'static str> {
    let Some(session_id) = request.mcp_session.as_deref() else {
        return Err("mcp_session_required");
    };
    if crate::mcp::sessions().touch(session_id, now) {
        Ok(())
    } else {
        Err("mcp_session_required")
    }
}

fn handle_mcp(app: &AppHandle, request: &ParsedRequest) -> Vec<u8> {
    use crate::mcp::{self, protocol, tools};

    let cfg = crate::mcp::config::load();
    if !cfg.enabled {
        return json_response("403 Forbidden", r#"{"ok":false,"error":"mcp_disabled"}"#);
    }
    if origin_is_forbidden(request) {
        return json_response(
            "403 Forbidden",
            r#"{"ok":false,"error":"forbidden_origin"}"#,
        );
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
            let backup_path = match tauri::async_runtime::block_on(mcp::backup::perform_mcp_backup(
                app.clone(),
            )) {
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
            if let Err(e) = require_active_mcp_session(request, now) {
                let body = protocol::error_response(&msg.id, protocol::INVALID_PARAMS, e);
                return mcp_json("200 OK", &body, None);
            }
            let body = protocol::result_response(
                &msg.id,
                serde_json::json!({ "tools": tools::tool_list_json(cfg.read_write) }),
            );
            mcp_json("200 OK", &body, None)
        }
        "tools/call" => {
            if let Err(e) = require_active_mcp_session(request, now) {
                let body = protocol::error_response(&msg.id, protocol::INVALID_PARAMS, e);
                return mcp_json("200 OK", &body, None);
            }
            let name = msg.params["name"].as_str().unwrap_or_default().to_string();
            let args = msg
                .params
                .get("arguments")
                .cloned()
                .unwrap_or(serde_json::json!({}));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_carry_hardened_headers_and_no_wildcard_cors() {
        let bytes = http("200 OK", "text/plain", b"x");
        let head = String::from_utf8_lossy(&bytes);
        assert!(head.contains("X-Content-Type-Options: nosniff"));
        assert!(head.contains("X-Frame-Options: DENY"));
        assert!(!head.contains("Access-Control-Allow-Origin: *"));
        // script-src must NOT allow inline scripts (XSS hardening). style-src
        // intentionally keeps 'unsafe-inline' — Radix/Recharts inject inline styles.
        assert!(head.contains("script-src 'self';"));
        assert!(!head.contains("script-src 'self' 'unsafe-inline'"));
    }

    #[test]
    fn serve_spa_rejects_dotdot() {
        let resp = String::from_utf8(serve_spa("/../secret", false)).unwrap();
        // Fallback to index.html HTML — never a file resolved via traversal.
        assert!(resp.contains("<"));
        assert!(resp.contains("text/html"));
    }

    #[test]
    fn index_never_injects_trusted_flag() {
        for loopback in [true, false] {
            let html = String::from_utf8(serve_index(loopback)).unwrap();
            assert!(!html.contains("__TIMEFLOW_WEBUI_TRUSTED__"));
        }
    }

    #[test]
    fn rpc_loopback_authorized_without_token() {
        // Loopback (127.0.0.1) NIE wymaga tokenu — bramki Origin + X-Timeflow-Rpc
        // w handle_rpc już udowodniły, że to nasz same-origin SPA, nie CSRF.
        let app_raw = concat!(
            "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:47892\r\n",
            "X-Timeflow-Rpc: 1\r\nContent-Type: text/plain\r\n\r\n",
            r#"{"command":"clients_list","args":{}}"#
        );
        let req = parse_request(app_raw).unwrap();
        assert!(rpc_is_authorized(&req, &AuthState::new(), 0, true));
    }

    #[test]
    fn rpc_non_loopback_without_token_is_unauthorized() {
        // LAN / inne urządzenie (nie-loopback) bez tokenu = 401 — kod parowania
        // jest wymagany poza loopbackiem.
        let app_raw = concat!(
            "POST /rpc HTTP/1.1\r\nHost: 192.168.1.50:47892\r\n",
            "X-Timeflow-Rpc: 1\r\nContent-Type: text/plain\r\n\r\n",
            r#"{"command":"clients_list","args":{}}"#
        );
        let req = parse_request(app_raw).unwrap();
        assert!(!rpc_is_authorized(&req, &AuthState::new(), 0, false));
    }

    #[test]
    fn rpc_rejects_foreign_origin() {
        let raw = concat!(
            "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:47892\r\n",
            "Origin: https://evil.example\r\nAuthorization: Bearer x\r\n\r\n",
            "{}"
        );
        let req = parse_request(raw).unwrap();
        assert!(origin_is_forbidden(&req));
    }

    #[test]
    fn rpc_allows_same_origin_and_loopback() {
        let loopback = parse_request(concat!(
            "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:47892\r\n",
            "Origin: http://127.0.0.1:47892\r\n\r\n{}"
        ))
        .unwrap();
        assert!(!origin_is_forbidden(&loopback));

        let no_origin = parse_request("GET /healthz HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        assert!(!origin_is_forbidden(&no_origin));
    }

    #[test]
    fn parses_rpc_header_case_insensitively() {
        let req = parse_request(concat!(
            "POST /rpc HTTP/1.1\r\nHost: x\r\nX-Timeflow-Rpc: 1\r\n\r\n{}"
        ))
        .unwrap();
        assert!(req.rpc_header);
        let plain = parse_request("POST /rpc HTTP/1.1\r\nHost: x\r\n\r\n{}").unwrap();
        assert!(!plain.rpc_header);
    }

    #[test]
    fn parses_get_with_bearer() {
        let raw = concat!(
            "GET /healthz HTTP/1.1\r\n",
            "Host: 127.0.0.1:45800\r\n",
            "Authorization: Bearer token-123\r\n",
            "\r\n"
        );

        let request = parse_request(raw).expect("request should parse");

        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/healthz");
        assert_eq!(request.bearer, Some("token-123".to_string()));
        assert_eq!(request.body, "");
    }

    #[test]
    fn parses_post_body_without_auth() {
        let raw = concat!(
            "POST /auth/pair HTTP/1.1\r\n",
            "Host: 127.0.0.1:45800\r\n",
            "Content-Type: application/json\r\n",
            "Content-Length: 34\r\n",
            "\r\n",
            r#"{"code":"123456","label":"Phone"}"#
        );

        let request = parse_request(raw).expect("request should parse");

        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/auth/pair");
        assert_eq!(request.bearer, None);
        assert_eq!(request.body, r#"{"code":"123456","label":"Phone"}"#);
    }

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
    fn mcp_requires_known_session_for_post_initialize_methods() {
        let missing = parse_request("POST /mcp HTTP/1.1\r\nHost: x\r\n\r\n{}").unwrap();
        assert_eq!(
            require_active_mcp_session(&missing, 100),
            Err("mcp_session_required")
        );

        let stale = parse_request(concat!(
            "POST /mcp HTTP/1.1\r\nHost: x\r\nMcp-Session-Id: stale-session\r\n\r\n{}"
        ))
        .unwrap();
        assert_eq!(
            require_active_mcp_session(&stale, 100),
            Err("mcp_session_required")
        );

        let id = format!("test-session-{}", std::process::id());
        crate::mcp::sessions().insert(crate::mcp::McpSessionInfo {
            id: id.clone(),
            client_name: "test".into(),
            created_at: 100,
            last_seen: 100,
            backup_path: String::new(),
        });
        let known = parse_request(&format!(
            "POST /mcp HTTP/1.1\r\nHost: x\r\nMcp-Session-Id: {id}\r\n\r\n{{}}"
        ))
        .unwrap();
        assert!(require_active_mcp_session(&known, 101).is_ok());
        crate::mcp::sessions().remove(&id);
    }

    #[test]
    fn mcp_auth_requires_exact_bearer_token() {
        assert!(mcp_token_ok(Some("secret"), "secret"));
        assert!(!mcp_token_ok(Some("wrong"), "secret"));
        assert!(!mcp_token_ok(None, "secret"));
        assert!(!mcp_token_ok(Some(""), "")); // pusty config = brak dostępu
    }
}
