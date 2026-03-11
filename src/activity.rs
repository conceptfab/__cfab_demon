#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityType {
    Coding,
    Browsing,
    Design,
}

impl ActivityType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Coding => "coding",
            Self::Browsing => "browsing",
            Self::Design => "design",
        }
    }
}
