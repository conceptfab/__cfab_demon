//! Szyfrowanie payloadów online synca (AES-256-GCM).
//!
//! Używane przez store-and-forward online sync (E2E): klient szyfruje eksport
//! lokalnej bazy hasłem (`encryption_key`) zanim wyśle go na serwer — serwer
//! widzi wyłącznie szyfrogram. Funkcje `encrypt_with_passphrase` /
//! `decrypt_with_passphrase` przyjmują dowolny ciąg-hasło i wyprowadzają z niego
//! 32-bajtowy klucz AES (SHA-256), więc nie zakładamy konkretnego formatu klucza.
//!
//! Pozostałe funkcje (kredencjały/pliki) pochodzą ze starego transportu SFTP i
//! część z nich jest obecnie nieużywana — oznaczona punktowo `#[allow(dead_code)]`.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

// aes-gcm 0.10 re-exports Nonce as a type alias with the correct size
type AesNonce = aes_gcm::aead::generic_array::GenericArray<
    u8,
    aes_gcm::aead::generic_array::typenum::U12,
>;

/// Encrypted credentials as received from the server.
#[allow(dead_code)] // Stary transport SFTP.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedCredentials {
    pub encrypted_payload: String, // base64
    pub iv: String,                // base64
    pub tag: String,               // base64
}

/// Decrypted SFTP credentials.
#[allow(dead_code)] // Stary transport SFTP.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpCredentials {
    pub host: String,
    pub port: u16,
    #[allow(dead_code)] // Present in server JSON but not read directly
    pub protocol: String,
    pub username: String,
    pub password: String,
    pub upload_path: String,
    pub download_path: String,
    /// FTP: czy FTPS (AUTH TLS). Dostarczane przez serwer po fixie connection-info;
    /// `None` gdy serwer nie podał (stara wersja / SFTP) → demon auto-wykrywa.
    #[serde(default)]
    pub secure: Option<bool>,
    pub file_encryption_key: String, // base64 key
}

impl Drop for SftpCredentials {
    fn drop(&mut self) {
        // Zero sensitive fields — clear + shrink deallocates the buffer,
        // avoiding UB from as_mut_vec() invalidating String invariants.
        for field in [&mut self.password, &mut self.username, &mut self.file_encryption_key] {
            field.clear();
            field.shrink_to_fit();
        }
    }
}

/// HMAC-based key derivation matching the server's algorithm.
/// prk = HMAC-SHA256(master_key, session_id)
/// okm = HMAC-SHA256(prk, purpose)
#[allow(dead_code)] // Stary transport SFTP (derywacja klucza sesji kredencjałów).
fn derive_session_key(master_key: &str, session_id: &str, purpose: &str) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(master_key.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(session_id.as_bytes());
    let prk = mac.finalize().into_bytes();

    let mut mac2 = <HmacSha256 as Mac>::new_from_slice(&prk)
        .expect("HMAC accepts any key length");
    mac2.update(purpose.as_bytes());
    let okm = mac2.finalize().into_bytes();

    okm.into()
}

fn make_nonce(bytes: &[u8]) -> AesNonce {
    AesNonce::clone_from_slice(bytes)
}

/// Wyprowadza 32-bajtowy klucz AES-256 z dowolnego ciągu-hasła (SHA-256).
/// Dzięki temu `encryption_key` może być dowolnym tekstem — nie zakładamy
/// konkretnego formatu (np. base64 32B). Deterministyczne: ten sam passphrase
/// → ten sam klucz (warunek konieczny round-tripu między urządzeniami).
fn derive_key_from_passphrase(passphrase: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(passphrase.as_bytes());
    hasher.finalize().into()
}

/// Szyfruje dowolne bajty hasłem (AES-256-GCM, klucz = SHA-256(passphrase)).
/// Format wyjścia: [12 bajtów losowego IV][ciphertext + 16-bajtowy tag GCM].
/// IV losowy per wywołanie (brak nonce reuse) i doklejony na początek, więc
/// `decrypt_with_passphrase` odzyskuje go samodzielnie. NIE kompresuje —
/// warstwa wyżej (serwer) i tak gzipuje całe archiwum.
pub fn encrypt_with_passphrase(plaintext: &[u8], passphrase: &str) -> Result<Vec<u8>, String> {
    let key_bytes = derive_key_from_passphrase(passphrase);

    let mut iv_arr = [0u8; 12];
    getrandom::getrandom(&mut iv_arr)
        .map_err(|e| format!("Failed to generate random IV: {}", e))?;

    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = make_nonce(&iv_arr);

    let encrypted = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut result = Vec::with_capacity(12 + encrypted.len());
    result.extend_from_slice(&iv_arr);
    result.extend_from_slice(&encrypted);
    Ok(result)
}

/// Odwrotność `encrypt_with_passphrase`. Wejście: [12B IV][ciphertext+tag].
/// Zły klucz / uszkodzony szyfrogram → Err (autentykacja GCM), nigdy panic
/// ani „cichy śmieć", który mógłby zepsuć merge.
pub fn decrypt_with_passphrase(data: &[u8], passphrase: &str) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("Dane za krótkie na IV (min 12 bajtów)".to_string());
    }
    let iv = &data[..12];
    let ciphertext = &data[12..];

    let key_bytes = derive_key_from_passphrase(passphrase);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = make_nonce(iv);

    cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))
}

/// Decrypt credentials received from the server.
#[allow(dead_code)] // Stary transport SFTP — pozostaje pod ewentualny powrót.
pub fn decrypt_credentials(
    encrypted: &EncryptedCredentials,
    session_id: &str,
    master_key: &str,
) -> Result<SftpCredentials, String> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;

    let key_bytes = derive_session_key(master_key, session_id, "credential-encryption");
    let iv_bytes = engine
        .decode(&encrypted.iv)
        .map_err(|e| format!("IV decode: {}", e))?;
    let tag_bytes = engine
        .decode(&encrypted.tag)
        .map_err(|e| format!("Tag decode: {}", e))?;
    let ciphertext = engine
        .decode(&encrypted.encrypted_payload)
        .map_err(|e| format!("Payload decode: {}", e))?;

    // AES-GCM expects ciphertext + tag concatenated
    let mut combined = ciphertext;
    combined.extend_from_slice(&tag_bytes);

    if iv_bytes.len() != 12 {
        return Err(format!("Invalid IV length: {} (expected 12)", iv_bytes.len()));
    }

    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = make_nonce(&iv_bytes);

    let plaintext = cipher
        .decrypt(&nonce, combined.as_ref())
        .map_err(|e| format!("Decryption failed: {}", e))?;

    let json_str =
        String::from_utf8(plaintext).map_err(|e| format!("UTF-8 decode: {}", e))?;

    serde_json::from_str(&json_str).map_err(|e| format!("JSON parse: {}", e))
}

/// Encrypt file data: gzip compress then AES-256-GCM encrypt.
/// Output format: [12 bytes IV][ciphertext + 16-byte GCM tag]
#[allow(dead_code)] // Stary transport SFTP (E2E używa encrypt_with_passphrase).
pub fn encrypt_file_data(data: &[u8], key_base64: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    let engine = base64::engine::general_purpose::STANDARD;

    // 1. Gzip compress
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(data)
        .map_err(|e| format!("Gzip compress: {}", e))?;
    let compressed = encoder
        .finish()
        .map_err(|e| format!("Gzip finish: {}", e))?;

    // 2. Decode key
    let key_bytes = engine
        .decode(key_base64)
        .map_err(|e| format!("Key decode: {}", e))?;
    if key_bytes.len() != 32 {
        return Err(format!(
            "Invalid key length: {} (expected 32)",
            key_bytes.len()
        ));
    }

    // 3. Generate cryptographically random 12-byte IV
    let mut iv_arr = [0u8; 12];
    getrandom::getrandom(&mut iv_arr)
        .map_err(|e| format!("Failed to generate random IV: {}", e))?;

    // 4. AES-256-GCM encrypt
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = make_nonce(&iv_arr);

    let encrypted = cipher
        .encrypt(&nonce, compressed.as_ref())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // 5. Prepend IV
    let mut result = Vec::with_capacity(12 + encrypted.len());
    result.extend_from_slice(&iv_arr);
    result.extend_from_slice(&encrypted);
    Ok(result)
}

/// Decrypt file data: AES-256-GCM decrypt then gzip decompress.
/// Expects input format: [12 bytes IV][ciphertext + 16-byte GCM tag]
#[allow(dead_code)] // Stary transport SFTP (E2E używa decrypt_with_passphrase).
pub fn decrypt_file_data(data: &[u8], key_base64: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    use flate2::read::GzDecoder;
    use std::io::Read;

    let engine = base64::engine::general_purpose::STANDARD;

    if data.len() < 12 {
        return Err("Data too short for IV".to_string());
    }

    // Extract IV (first 12 bytes) and ciphertext+tag
    let iv = &data[..12];
    let ciphertext = &data[12..];

    let key_bytes = engine
        .decode(key_base64)
        .map_err(|e| format!("Key decode: {}", e))?;
    if key_bytes.len() != 32 {
        return Err(format!(
            "Invalid key length: {} (expected 32)",
            key_bytes.len()
        ));
    }

    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = make_nonce(iv);

    let compressed = cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    // Gzip decompress with size limit to prevent gzip bomb attacks
    const MAX_DECOMPRESSED_SIZE: usize = 200 * 1024 * 1024; // 200 MB
    let mut decoder = GzDecoder::new(&compressed[..]);
    let mut decompressed = Vec::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = decoder.read(&mut buf)
            .map_err(|e| format!("Gzip decompress: {}", e))?;
        if n == 0 {
            break;
        }
        if decompressed.len() + n > MAX_DECOMPRESSED_SIZE {
            return Err(format!(
                "Gzip decompressed data exceeds {} MB limit — possible gzip bomb",
                MAX_DECOMPRESSED_SIZE / (1024 * 1024)
            ));
        }
        decompressed.extend_from_slice(&buf[..n]);
    }

    Ok(decompressed)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Klucz: 32 bajty zerowe zakodowane jako base64
    // = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    const TEST_KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    #[test]
    fn file_data_roundtrip_utf8_empty_and_large() {
        for payload in [
            "żółć ąęś — €".as_bytes().to_vec(),
            Vec::<u8>::new(),
            b"with\0null\0bytes".to_vec(),
            vec![7u8; 1024 * 1024], // 1 MB — wystarczy do weryfikacji dużego payloadu
        ] {
            let enc = encrypt_file_data(&payload, TEST_KEY).unwrap();
            let dec = decrypt_file_data(&enc, TEST_KEY).unwrap();
            assert_eq!(dec, payload, "roundtrip musi zachować bajty 1:1");
        }
    }

    #[test]
    fn file_data_nonce_is_random_per_call() {
        let a = encrypt_file_data(b"x", TEST_KEY).unwrap();
        let b = encrypt_file_data(b"x", TEST_KEY).unwrap();
        assert_ne!(a[..12], b[..12], "IV losowy per wywołanie (brak nonce reuse)");
    }

    const E2E_TEST_VECTOR: &str = "tf-e2e-test-vector-1";

    #[test]
    fn passphrase_roundtrip_utf8_empty_and_large() {
        for payload in [
            "żółć ąęś — € {\"data\":1}".as_bytes().to_vec(),
            Vec::<u8>::new(),
            b"with\0null\0bytes".to_vec(),
            vec![7u8; 512 * 1024],
        ] {
            let enc = encrypt_with_passphrase(&payload, E2E_TEST_VECTOR).unwrap();
            let dec = decrypt_with_passphrase(&enc, E2E_TEST_VECTOR).unwrap();
            assert_eq!(dec, payload, "roundtrip musi zachować bajty 1:1");
        }
    }

    #[test]
    fn passphrase_nonce_is_random_per_call() {
        let a = encrypt_with_passphrase(b"x", E2E_TEST_VECTOR).unwrap();
        let b = encrypt_with_passphrase(b"x", E2E_TEST_VECTOR).unwrap();
        assert_ne!(a[..12], b[..12], "IV losowy per wywołanie (brak nonce reuse)");
        assert_ne!(a, b, "szyfrogram różny przy losowym nonce");
    }

    #[test]
    fn passphrase_wrong_key_returns_err_not_garbage() {
        let enc = encrypt_with_passphrase(b"sekret", E2E_TEST_VECTOR).unwrap();
        let r = decrypt_with_passphrase(&enc, "tf-e2e-test-vector-2");
        assert!(r.is_err(), "zły passphrase musi dać Err (autentykacja GCM), nie śmieci");
    }

    #[test]
    fn passphrase_truncated_input_returns_err_not_panic() {
        let r = decrypt_with_passphrase(b"short", E2E_TEST_VECTOR);
        assert!(r.is_err(), "za krótkie wejście (bez IV) musi dać Err, nie panic");
    }

    #[test]
    fn decrypt_credentials_rejects_bad_iv_without_panic() {
        use base64::Engine;
        let e = base64::engine::general_purpose::STANDARD;
        let bad = EncryptedCredentials {
            iv: e.encode([0u8; 8]), // 8 bajtów zamiast 12 — zły IV
            tag: e.encode([0u8; 16]),
            encrypted_payload: e.encode([0u8; 4]),
        };
        let r = decrypt_credentials(
            &bad,
            "sess",
            "0123456789abcdef0123456789abcdef",
        );
        assert!(r.is_err(), "zły IV musi dać Err, nie panic");
    }
}
