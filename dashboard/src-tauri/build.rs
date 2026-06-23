fn main() {
    // Force rebuild when VERSION changes and inject version as compile-time env var.
    // Using rustc-env instead of include_str! ensures Cargo always picks up the new value.
    println!("cargo:rerun-if-changed=../../VERSION");
    let version = std::fs::read_to_string("../../VERSION")
        .expect("Cannot read ../../VERSION")
        .trim()
        .to_string();
    println!("cargo:rustc-env=TIMEFLOW_VERSION={}", version);

    // Soft drift check: warn if rpc_generated.rs is out of sync with the generator.
    // Non-fatal — node may be absent in some build environments.
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=scripts/gen_webrpc.cjs");
    let status = std::process::Command::new("node")
        .arg("scripts/gen_webrpc.cjs")
        .arg("--check")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .status();
    if let Ok(s) = status {
        if !s.success() {
            println!(
                "cargo:warning=rpc_generated.rs jest nieaktualny — uruchom: node scripts/gen_webrpc.cjs"
            );
        }
    }

    tauri_build::build()
}
