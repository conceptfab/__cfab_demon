use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("validation: {0}")]
    Validation(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("db: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("{0}")]
    Other(String),
}

impl From<String> for CommandError {
    fn from(s: String) -> Self {
        CommandError::Other(s)
    }
}
impl From<&str> for CommandError {
    fn from(s: &str) -> Self {
        CommandError::Other(s.to_string())
    }
}
// Needed by rpc_generated.rs, which wraps commands in Result<Value, String> and
// uses `?` to propagate command errors. CommandError::to_string() preserves the
// full human-readable message (identical to what String-returning commands produced).
impl From<CommandError> for String {
    fn from(e: CommandError) -> Self {
        e.to_string()
    }
}

#[derive(Serialize)]
struct WireError {
    code: String,
    message: String,
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let code = match self {
            CommandError::NotFound(_) => "not_found",
            CommandError::Conflict(_) => "conflict",
            CommandError::Validation(_) => "validation",
            CommandError::Io(_) => "io",
            CommandError::Db(_) => "db",
            CommandError::Other(_) => "error",
        };
        WireError {
            code: code.into(),
            message: self.to_string(),
        }
        .serialize(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_code() {
        let json = serde_json::to_string(&CommandError::NotFound("x".into())).unwrap();
        assert!(json.contains("\"code\":\"not_found\""));
        assert!(json.contains("x"));
    }

    #[test]
    fn string_and_str_convert_to_other() {
        let a: CommandError = "boom".into();
        let b: CommandError = String::from("boom").into();
        let ja = serde_json::to_string(&a).unwrap();
        assert!(ja.contains("\"code\":\"error\""));
        assert!(ja.contains("boom"));
        assert!(serde_json::to_string(&b).unwrap().contains("boom"));
    }
}
