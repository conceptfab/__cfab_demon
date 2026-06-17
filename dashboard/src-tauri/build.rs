fn main() {
    // Force rebuild when VERSION changes and inject version as compile-time env var.
    // Using rustc-env instead of include_str! ensures Cargo always picks up the new value.
    println!("cargo:rerun-if-changed=../../VERSION");
    let version = std::fs::read_to_string("../../VERSION")
        .expect("Cannot read ../../VERSION")
        .trim()
        .to_string();
    println!("cargo:rustc-env=TIMEFLOW_VERSION={}", version);
    tauri_build::build()
}
