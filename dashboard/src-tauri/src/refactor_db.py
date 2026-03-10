import sys

def main():
    path = "f:\\___APPS\\__TimeFlow\\__client\\dashboard\\src-tauri\\src\\db.rs"
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    
    out = []
    in_schema = False
    in_run_migrations = False
    in_ensure_indexes = False
    
    for i, line in enumerate(lines):
        if line.startswith('const SCHEMA: &str = r#"'):
            in_schema = True
            out.append('const SCHEMA: &str = include_str!("../resources/sql/schema.sql");')
            continue
            
        if in_schema:
            if line == '"#;':
                in_schema = False
            continue
            
        if line.startswith('fn run_migrations(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {'):
            in_run_migrations = True
            out.append(line)
            out.append('    crate::db_migrations::run_migrations(db)')
            continue
            
        if in_run_migrations:
            if line == '}':
                in_run_migrations = False
                out.append('}')
            continue
            
        if line.startswith('fn ensure_post_migration_indexes(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {'):
            in_ensure_indexes = True
            out.append(line)
            out.append('    crate::db_migrations::ensure_post_migration_indexes(db)')
            continue
            
        if in_ensure_indexes:
            if line == '}':
                in_ensure_indexes = False
                out.append('}')
            continue
            
        out.append(line)
        
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

if __name__ == "__main__":
    main()
