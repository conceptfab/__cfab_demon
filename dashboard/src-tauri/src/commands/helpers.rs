use std::process::Command;
use std::sync::atomic::AtomicU64;

pub(crate) static LAST_PRUNE_EPOCH_SECS: AtomicU64 = AtomicU64::new(0);
pub(crate) const PRUNE_CACHE_TTL_SECS: u64 = 300; // 5 minutes

pub(crate) const DAEMON_EXE_NAME: &str = "cfab-demon.exe";
pub(crate) const DAEMON_AUTOSTART_LNK: &str = "Cfab Demon.lnk";

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Hides the CMD window when running system processes (tasklist, taskkill, powershell).
#[cfg(windows)]
pub(crate) fn no_console(cmd: &mut Command) {
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
pub(crate) fn no_console(_cmd: &mut Command) {}

pub(crate) fn cfab_demon_dir() -> Result<std::path::PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    Ok(std::path::PathBuf::from(appdata).join("conceptfab"))
}
