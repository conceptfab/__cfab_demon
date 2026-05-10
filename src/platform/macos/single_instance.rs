// Single instance lock na macOS — advisory flock() na pliku w
// ~/Library/Application Support/TimeFlow/timeflow.lock.
// Plik zostaje otwarty na cały czas życia guarda — drop zwalnia blokadę
// (fs2 zwalnia lock automatycznie przy zamknięciu File handle).

use std::fs::{File, OpenOptions};
use std::path::PathBuf;

use fs2::FileExt;

const LOCK_FILE_NAME: &str = "timeflow.lock";

/// RAII guard trzymający otwarty, zablokowany plik.
/// Upuszczenie guarda zamyka plik i zwalnia flock.
pub struct SingleInstanceGuard {
    _file: File,
}

fn lock_path() -> Result<PathBuf, String> {
    let base = crate::config::config_dir().map_err(|e| format!("config_dir: {e}"))?;
    std::fs::create_dir_all(&base)
        .map_err(|e| format!("create {}: {e}", base.display()))?;
    Ok(base.join(LOCK_FILE_NAME))
}

pub fn try_acquire() -> Result<SingleInstanceGuard, String> {
    let path = lock_path()?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|e| format!("open lock {}: {e}", path.display()))?;

    match file.try_lock_exclusive() {
        Ok(()) => Ok(SingleInstanceGuard { _file: file }),
        Err(_) => Err(crate::i18n::load_language()
            .t(crate::i18n::TrayText::AlreadyRunning)
            .to_string()),
    }
}
