import os
path = "src-tauri/src/commands/sessions.rs"
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

old_block = """                    if overlap_ms * 2 >= span_ms {
                        inferred_project_id = Some(pid);
                        session.project_name = Some(name);
                        session.project_color = Some(color);
                    }"""

new_block = """                    if overlap_ms * 2 >= span_ms {
                        inferred_project_id = Some(pid);
                        session.suggested_project_id = Some(pid);
                        session.suggested_project_name = Some(name.clone());
                        session.suggested_confidence = Some(1.0);
                    }"""

if old_block in text:
    text = text.replace(old_block, new_block)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print("Replaced!")
else:
    print("Not found!")
