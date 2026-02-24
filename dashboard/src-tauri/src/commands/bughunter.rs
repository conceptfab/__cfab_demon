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
    let smtp_server = "host372606.hostido.net.pl"; 
    let smtp_user = "bug-hunter@conceptfab.com"; 
    let smtp_pass = "bpJovGAyaGcrYJRj-ps3Y."; // DOPISANO KROPKĘ (HASŁO POTWIERDZONE)
    let recipient = "michal@conceptfab.com";
    // -------------------------

    let email_subject = format!("TIMEFLOW ({}) - {}", version, subject);
    
    // Budowanie treści maila
    let body_text = format!(
        "Bug Report from TIMEFLOW (Version: {})\n\nSubject: {}\n\nDescription:\n{}",
        version, subject, message
    );

    let mut multipart = MultiPart::mixed()
        .singlepart(SinglePart::plain(body_text));

    // Dodawanie załączników
    for (filename, content) in attachments {
        multipart = multipart.singlepart(
            Attachment::new(filename)
                .body(content, "application/octet-stream".parse().unwrap())
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

    // Wracamy na 465 (SSL) + dodajemy jawne mechanizmy logowania
    let mailer: AsyncSmtpTransport<Tokio1Executor> = AsyncSmtpTransport::<Tokio1Executor>::relay(smtp_server)
        .map_err(|e| format!("SMTP configuration error: {}", e))?
        .port(465)
        .tls(Tls::Wrapper(tls_parameters))
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
