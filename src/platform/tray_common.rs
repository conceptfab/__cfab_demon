// Cross-platform API dla tray — niezależny enum statusu wyjścia.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayExitAction {
    Exit,
    Restart,
}
