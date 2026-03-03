fn main() {
    // Never inject .env values into rustc-env; runtime config should come from process env.
    tauri_build::build()
}
