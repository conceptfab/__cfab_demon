use tauri::AppHandle;
use serde::Serialize;
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{Message, AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use lettre::message::{MultiPart, SinglePart, Attachment};

#[derive(Serialize)]
pub struct BugReportResponse {
    pub ok: bool,
    pub message: String,
}

#[tauri::command]
pub async fn send_bug_report(
    _app: AppHandle,
    subject: String,
    message: String,
    version: String,
    attachments: Vec<(String, Vec<u8>)>
) -> Result<BugReportResponse, String> {
    
    // --- KONFIGURACJA SMTP ---
    // Dane pobierane podczas kompilacji ze zmiennych środowiskowych.
    // Build MUSI dostarczyć SMTP_USER i SMTP_PASS — brak wartości = błąd runtime.
    let smtp_server = "host372606.hostido.net.pl";
    let smtp_user = match option_env!("SMTP_USER") {
        Some(u) if !u.is_empty() => u,
        _ => return Err("SMTP_USER not configured at build time".into()),
    };
    let smtp_pass = match option_env!("SMTP_PASS") {
        Some(p) if !p.is_empty() && p != "REPLACE_ME" => p,
        _ => return Err("SMTP_PASS not configured at build time".into()),
    };
    let recipient = "michal@conceptfab.com";
    // -------------------------

    // Sanityzacja nagłówków email — usuwamy \r i \n z subject aby zapobiec header injection
    let sanitized_subject = subject.replace(['\r', '\n'], " ");
    let email_subject = format!("TIMEFLOW ({}) - {}", version, sanitized_subject);

    // Budowanie treści maila
    let body_text = format!(
        "Bug Report from TIMEFLOW (Version: {})\n\nSubject: {}\n\nDescription:\n{}",
        version, sanitized_subject, message
    );

    let mut multipart = MultiPart::mixed()
        .singlepart(SinglePart::plain(body_text));

    // Dodawanie załączników
    for (filename, content) in attachments {
        multipart = multipart.singlepart(
            Attachment::new(filename)
                .body(content, "application/octet-stream".parse().expect("valid MIME literal"))
        );
    }

    let email = Message::builder()
        .from(smtp_user.parse().map_err(|e| format!("Invalid from: {}", e))?)
        .to(recipient.parse().map_err(|e| format!("Invalid recipient: {}", e))?)
        .subject(email_subject)
        .multipart(multipart)
        .map_err(|e| format!("Failed to build message: {}", e))?;

    let creds = Credentials::new(smtp_user.to_string(), smtp_pass.to_string());

    let tls_parameters = TlsParameters::new(smtp_server.to_string())
        .map_err(|e| format!("TLS configuration error: {}", e))?;

    // Przełączamy na 587 (STARTTLS)
    let mailer: AsyncSmtpTransport<Tokio1Executor> = AsyncSmtpTransport::<Tokio1Executor>::relay(smtp_server)
        .map_err(|e| format!("SMTP configuration error: {}", e))?
        .port(587)
        .tls(Tls::Required(tls_parameters))
        .credentials(creds)
        .authentication(vec![Mechanism::Login, Mechanism::Plain])
        .build();

    // Wysyłka
    match mailer.send(email).await {
        Ok(_) => Ok(BugReportResponse {
            ok: true,
            message: "Report sent directly via SMTP".into(),
        }),
        Err(e) => Err(format!("Failed to send email via SMTP: {}", e)),
    }
}
