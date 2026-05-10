//! SFTP client for online sync file transfers.

use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

use crate::config;

const CHUNK_SIZE: usize = 64 * 1024; // 64 KB
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_DOWNLOAD_SIZE: u64 = 50 * 1024 * 1024; // 50 MB — safety limit for SFTP downloads
const KNOWN_HOSTS_FILE: &str = "known_sftp_hosts.json";

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
        for field in [&mut self.password, &mut self.username, &mut self.host] {
            field.clear();
            field.shrink_to_fit();
        }
        self.port = 0;
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

    fn known_hosts_path() -> Result<std::path::PathBuf, String> {
        let dir = config::config_dir().map_err(|e| e.to_string())?;
        Ok(dir.join(KNOWN_HOSTS_FILE))
    }

    fn load_known_hosts() -> HashMap<String, String> {
        let path = match Self::known_hosts_path() {
            Ok(p) => p,
            Err(_) => return HashMap::new(),
        };
        let data = match std::fs::read_to_string(&path) {
            Ok(d) => d,
            Err(_) => return HashMap::new(),
        };
        serde_json::from_str(&data).unwrap_or_default()
    }

    fn save_known_hosts(hosts: &HashMap<String, String>) {
        if let Ok(path) = Self::known_hosts_path() {
            if let Ok(data) = serde_json::to_string_pretty(hosts) {
                let _ = std::fs::write(path, data);
            }
        }
    }

    // NOTE: known_sftp_hosts.json is stored without integrity protection. An attacker
    // with write access to %APPDATA%/TimeFlow/ could replace host keys to enable MITM.
    // Consider HMAC signing or Windows Credential Store in the future.
    fn verify_host_key_tofu(&self, fingerprint: &str) -> Result<(), String> {
        let host_key = format!("{}:{}", self.host, self.port);
        let mut known = Self::load_known_hosts();

        match known.get(&host_key) {
            Some(stored) if stored == fingerprint => {
                log::debug!("SSH host key verified (TOFU) for {}", host_key);
                Ok(())
            }
            Some(stored) => {
                log::error!(
                    "SSH HOST KEY CHANGED for {}! Expected: {}, got: {}. Possible MITM attack.",
                    host_key, stored, fingerprint
                );
                Err(format!(
                    "SSH host key mismatch for {} — stored fingerprint does not match. \
                     This could indicate a man-in-the-middle attack. \
                     If the server was reinstalled, delete the entry from {:?}.",
                    host_key,
                    Self::known_hosts_path().unwrap_or_default()
                ))
            }
            None => {
                log::info!("SSH TOFU: trusting host key for {} on first use: {}", host_key, fingerprint);
                known.insert(host_key, fingerprint.to_string());
                Self::save_known_hosts(&known);
                Ok(())
            }
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

        // Trust-on-first-use (TOFU) host key verification
        if let Some(host_key) = session.host_key() {
            let fingerprint: String = host_key.0.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(":");
            self.verify_host_key_tofu(&fingerprint)?;
        }

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
