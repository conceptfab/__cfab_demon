fn main() {
    // Load .env from project root so option_env!() macros in bughunter.rs
    // pick up SMTP_USER / SMTP_PASS regardless of how the build is invoked.
    let root_env = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()  // dashboard/
        .and_then(|p| p.parent())  // project root
        .map(|p| p.join(".env"));

    if let Some(env_path) = root_env {
        if env_path.exists() {
            if let Ok(iter) = dotenvy::from_path_iter(&env_path) {
                for item in iter {
                    if let Ok((key, value)) = item {
                        // Only set if not already present in the environment
                        if std::env::var(&key).is_err() {
                            std::env::set_var(&key, &value);
                        }
                        // Emit cargo:rustc-env so option_env!() sees the value
                        println!("cargo:rustc-env={}={}", key, value);
                    }
                }
            }
        }
    }

    // Re-run build script if .env changes
    if let Some(env_path) = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join(".env"))
    {
        println!("cargo:rerun-if-changed={}", env_path.display());
    }

    tauri_build::build()
}
