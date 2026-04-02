use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

// aes-gcm 0.10 re-exports Nonce as a type alias with the correct size
type AesNonce = aes_gcm::aead::generic_array::GenericArray<
    u8,
    aes_gcm::aead::generic_array::typenum::U12,
>;

/// Encrypted credentials as received from the server.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedCredentials {
    pub encrypted_payload: String, // base64
    pub iv: String,                // base64
    pub tag: String,               // base64
}

/// Decrypted SFTP credentials.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpCredentials {
    pub host: String,
    pub port: u16,
    pub protocol: String,
    pub username: String,
    pub password: String,
    pub upload_path: String,
    pub download_path: String,
    pub file_encryption_key: String, // base64 key
}

/// HMAC-based key derivation matching the server's algorithm.
/// prk = HMAC-SHA256(master_key, session_id)
/// okm = HMAC-SHA256(prk, purpose)
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

/// Decrypt credentials received from the server.
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

    // Gzip decompress
    let mut decoder = GzDecoder::new(&compressed[..]);
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|e| format!("Gzip decompress: {}", e))?;

    Ok(decompressed)
}
