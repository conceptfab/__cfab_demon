use lettre::message::{Attachment, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::Serialize;
use tauri::AppHandle;

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
    attachments: Vec<(String, Vec<u8>)>,
) -> Result<BugReportResponse, String> {
    // --- SMTP CONFIG ---
    // Use runtime environment variables so credentials are never embedded in the binary.
    let smtp_server = std::env::var("TIMEFLOW_SMTP_SERVER")
        .or_else(|_| std::env::var("SMTP_SERVER"))
        .map_err(|_| "SMTP server not configured (TIMEFLOW_SMTP_SERVER)".to_string())?;
    let smtp_user = std::env::var("TIMEFLOW_SMTP_USER")
        .or_else(|_| std::env::var("SMTP_USER"))
        .map_err(|_| "SMTP user not configured (TIMEFLOW_SMTP_USER)".to_string())?;
    let smtp_pass = std::env::var("TIMEFLOW_SMTP_PASS")
        .or_else(|_| std::env::var("SMTP_PASS"))
        .map_err(|_| "SMTP password not configured (TIMEFLOW_SMTP_PASS)".to_string())?;
    let recipient = std::env::var("TIMEFLOW_BUGREPORT_RECIPIENT")
        .or_else(|_| std::env::var("BUGREPORT_RECIPIENT"))
        .map_err(|_| {
            "Bug report recipient not configured (TIMEFLOW_BUGREPORT_RECIPIENT)".to_string()
        })?;
    // -------------------------

    // Sanityzacja nagłówków email — usuwamy \r i \n z subject aby zapobiec header injection
    let sanitized_subject = subject.replace(['\r', '\n'], " ");
    let email_subject = format!("TIMEFLOW ({}) - {}", version, sanitized_subject);

    // Budowanie treści maila
    let body_text = format!(
        "Bug Report from TIMEFLOW (Version: {})\n\nSubject: {}\n\nDescription:\n{}",
        version, sanitized_subject, message
    );

    let mut multipart = MultiPart::mixed().singlepart(SinglePart::plain(body_text));

    // Dodawanie załączników
    for (filename, content) in attachments {
        multipart = multipart.singlepart(
            Attachment::new(filename).body(
                content,
                "application/octet-stream"
                    .parse()
                    .expect("valid MIME literal"),
            ),
        );
    }

    let email = Message::builder()
        .from(
            smtp_user
                .parse()
                .map_err(|e| format!("Invalid from: {}", e))?,
        )
        .to(recipient
            .parse()
            .map_err(|e| format!("Invalid recipient: {}", e))?)
        .subject(email_subject)
        .multipart(multipart)
        .map_err(|e| format!("Failed to build message: {}", e))?;

    let creds = Credentials::new(smtp_user.to_string(), smtp_pass.to_string());

    let tls_parameters = TlsParameters::new(smtp_server.clone())
        .map_err(|e| format!("TLS configuration error: {}", e))?;

    // Przełączamy na 587 (STARTTLS)
    let mailer: AsyncSmtpTransport<Tokio1Executor> =
        AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp_server)
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
