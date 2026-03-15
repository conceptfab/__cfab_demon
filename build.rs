// TimeFlow Demon — skrypt kompilacji
// Osadza ikonę w zasobach exe i wersję z pliku VERSION

fn main() {
    println!("cargo:rerun-if-changed=VERSION");
    let version = std::fs::read_to_string("VERSION")
        .expect("Cannot read VERSION")
        .trim()
        .to_string();
    println!("cargo:rustc-env=TIMEFLOW_VERSION={}", version);
    let _ = embed_resource::compile("assets/app.rc", embed_resource::NONE);
}
