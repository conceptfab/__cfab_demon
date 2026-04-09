//! SFTP client for online sync file transfers.

use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

const CHUNK_SIZE: usize = 64 * 1024; // 64 KB
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_DOWNLOAD_SIZE: u64 = 50 * 1024 * 1024; // 50 MB — safety limit for SFTP downloads

pub struct SftpClient {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

impl Drop for SftpClient {
    fn drop(&mut self) {
        // Zero sensitive fields — clear + shrink deallocates the buffer,
        // avoiding UB from as_mut_vec() invalidating String invariants.
        for field in [&mut self.password, &mut self.username] {
            field.clear();
            field.shrink_to_fit();
        }
    }
}

impl SftpClient {
    pub fn new(host: &str, port: u16, username: &str, password: &str) -> Self {
        Self {
            host: host.to_string(),
            port,
            username: username.to_string(),
            password: password.to_string(),
        }
    }

    fn connect(&self) -> Result<Session, String> {
        let addr = format!("{}:{}", self.host, self.port);
        let tcp = TcpStream::connect_timeout(
            &addr.parse().map_err(|e| format!("Invalid address {}: {}", addr, e))?,
            CONNECT_TIMEOUT,
        ).map_err(|e| format!("SFTP connect failed: {}", e))?;

        let mut session = Session::new()
            .map_err(|e| format!("SSH session init failed: {}", e))?;
        session.set_tcp_stream(tcp);
        session.handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;
        session.userauth_password(&self.username, &self.password)
            .map_err(|e| format!("SSH auth failed: {}", e))?;

        if !session.authenticated() {
            return Err("SSH authentication failed".to_string());
        }

        Ok(session)
    }

    /// Upload data to remote path with progress callback.
    /// cb(bytes_sent, total_bytes)
    pub fn upload_data(
        &self,
        data: &[u8],
        remote_path: &str,
        cb: impl Fn(u64, u64),
    ) -> Result<(), String> {
        let session = self.connect()?;
        let sftp = session.sftp()
            .map_err(|e| format!("SFTP subsystem failed: {}", e))?;

        let mut remote_file = sftp.create(Path::new(remote_path))
            .map_err(|e| format!("SFTP create file failed: {}", e))?;

        let total = data.len() as u64;
        let mut sent: u64 = 0;

        for chunk in data.chunks(CHUNK_SIZE) {
            remote_file.write_all(chunk)
                .map_err(|e| format!("SFTP write failed: {}", e))?;
            sent += chunk.len() as u64;
            cb(sent, total);
        }

        Ok(())
    }

    /// Download from remote path with progress callback.
    /// cb(bytes_received, total_bytes) — total may be 0 if unknown.
    pub fn download_data(
        &self,
        remote_path: &str,
        cb: impl Fn(u64, u64),
    ) -> Result<Vec<u8>, String> {
        let session = self.connect()?;
        let sftp = session.sftp()
            .map_err(|e| format!("SFTP subsystem failed: {}", e))?;

        // Get file size for progress
        let stat = sftp.stat(Path::new(remote_path))
            .map_err(|e| format!("SFTP stat failed: {}", e))?;
        let total = stat.size.unwrap_or(0);

        let mut remote_file = sftp.open(Path::new(remote_path))
            .map_err(|e| format!("SFTP open failed: {}", e))?;

        if total > MAX_DOWNLOAD_SIZE {
            return Err(format!(
                "SFTP download aborted: file size {} bytes exceeds {} MB limit",
                total, MAX_DOWNLOAD_SIZE / (1024 * 1024)
            ));
        }

        let mut result = Vec::with_capacity(total as usize);
        let mut buf = [0u8; CHUNK_SIZE];
        let mut received: u64 = 0;

        loop {
            match remote_file.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    received += n as u64;
                    if received > MAX_DOWNLOAD_SIZE {
                        return Err(format!(
                            "SFTP download aborted: received {} bytes exceeds limit",
                            received
                        ));
                    }
                    result.extend_from_slice(&buf[..n]);
                    cb(received, total);
                }
                Err(e) => return Err(format!("SFTP read failed: {}", e)),
            }
        }

        Ok(result)
    }
}
