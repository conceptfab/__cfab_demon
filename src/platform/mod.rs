// Warstwa platformowa — enkapsuluje kod zależny od systemu operacyjnego.
// Wspólne API: single_instance, firewall, foreground, process_snapshot, tray.
// Każda platforma dostarcza identyczny zestaw modułów pod tą samą nazwą.

pub mod foreground_signal;
pub mod process_info;
pub mod tray_common;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;
