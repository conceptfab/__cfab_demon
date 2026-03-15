fn main() {
    // Never inject .env values into rustc-env; runtime config should come from process env.
    println!("cargo:rerun-if-changed=../../VERSION");
    tauri_build::build()
}
