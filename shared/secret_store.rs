//! Wspólny dostęp do sekretów przez natywny keychain OS (macOS/Windows/Linux).
//! Używany przez dashboard (Tauri) i demon — oba czytają TE SAME wpisy
//! (service = "TIMEFLOW").

const SERVICE: &str = "TIMEFLOW";

/// Pobierz sekret; None gdy brak wpisu.
pub fn get_secret(account: &str) -> Option<String> {
    let entry = keyring::Entry::new(SERVICE, account).ok()?;
    match entry.get_password() {
        Ok(v) => Some(v),
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            log::warn!("[secret_store] get '{account}' failed: {e}");
            None
        }
    }
}

/// Zapisz/zastąp sekret. Pusty string = usuń wpis.
pub fn set_secret(account: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
    if value.is_empty() {
        return delete_secret(account);
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

/// Usuń sekret (idempotentnie — brak wpisu nie jest błędem).
pub fn delete_secret(account: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_set_get_delete() {
        let acct = "test.timeflow.roundtrip";
        set_secret(acct, "sekret-123").expect("set");
        assert_eq!(get_secret(acct).as_deref(), Some("sekret-123"));
        delete_secret(acct).expect("delete");
        assert_eq!(get_secret(acct), None);
    }
}
