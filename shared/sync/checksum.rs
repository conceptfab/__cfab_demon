//! Kanoniczna checksum treści tabeli (SHA-256 → 128-bit, hex 32 znaki).
//! Jedno źródło dla daemona i dashboardu (finding #2 — wcześniej rozjazd
//! SHA-256/128 vs FNV-1a/64, plus komentarz referujący nieistniejącą fn).

use sha2::{Digest, Sha256};

/// Hash treści: SHA-256 z bajtów, obcięty do 128 bitów, sformatowany jako 32-znakowy hex.
pub fn content_hash(concat: &str) -> String {
    let digest = Sha256::digest(concat.as_bytes());
    let mut bytes16 = [0u8; 16];
    bytes16.copy_from_slice(&digest[..16]);
    format!("{:032x}", u128::from_be_bytes(bytes16))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_32_hex_chars() {
        let a = content_hash("Acme|#fff|2026-01-01 00:00:00");
        let b = content_hash("Acme|#fff|2026-01-01 00:00:00");
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn distinct_input_distinct_hash() {
        assert_ne!(content_hash("a"), content_hash("b"));
        assert_ne!(content_hash(""), content_hash("a"));
    }
}
