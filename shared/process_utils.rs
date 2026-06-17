#[cfg(windows)]
pub fn no_console(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
pub fn no_console(_cmd: &mut std::process::Command) {}
