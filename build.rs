// TimeFlow Demon — skrypt kompilacji
// Osadza ikonę w zasobach exe

fn main() {
    let _ = embed_resource::compile("assets/app.rc", embed_resource::NONE);
}

