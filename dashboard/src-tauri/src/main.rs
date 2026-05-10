// Prevents additional console window on Windows, DO NOT REMOVE!!
// Na innych platformach atrybut jest no-op, ale conditionally go nakładamy
// dla jawności.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    app_lib::run();
}
