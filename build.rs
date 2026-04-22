// TIMEFLOW Demon — skrypt kompilacji
// Na Windows osadza ikonę w zasobach exe; wersja z pliku VERSION czytana na każdej platformie.

fn main() {
    println!("cargo:rerun-if-changed=VERSION");
    let version = std::fs::read_to_string("VERSION")
        .expect("Cannot read VERSION")
        .trim()
        .to_string();
    println!("cargo:rustc-env=TIMEFLOW_VERSION={}", version);

    #[cfg(windows)]
    {
        let _ = embed_resource::compile("assets/app.rc", embed_resource::NONE);
    }
}
