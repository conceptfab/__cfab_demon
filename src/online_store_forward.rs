/// Stan widziany przez klienta przed decyzją.
#[derive(Debug, Clone)]
pub struct SyncView {
    pub client_revision: i64,
    pub server_revision: i64,
    pub local_hash: String,
    pub server_hash: Option<String>,
    /// czy lokalna baza ma niezsynchronizowane zmiany (local_hash != hash z ostatniego sync)
    pub local_dirty: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SyncDecision {
    Idle,
    Pull,            // serwer ma nowszą rewizję — pobierz + merge
    Push,            // mamy lokalne zmiany do wypchnięcia
    PullThenPush,    // jesteśmy w tyle i mamy lokalne zmiany — najpierw pull+merge, potem push unii
}

/// Czysta decyzja, bez sieci. Reguły:
/// - server_revision > client_revision => musimy pull (i jeśli local_dirty, potem push).
/// - server_revision == client_revision && local_dirty => push.
/// - inaczej => idle.
pub fn decide(view: &SyncView) -> SyncDecision {
    if view.server_revision > view.client_revision {
        if view.local_dirty { SyncDecision::PullThenPush } else { SyncDecision::Pull }
    } else if view.local_dirty {
        SyncDecision::Push
    } else {
        SyncDecision::Idle
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(cr: i64, sr: i64, dirty: bool) -> SyncView {
        SyncView { client_revision: cr, server_revision: sr,
            local_hash: "h".into(), server_hash: Some("s".into()), local_dirty: dirty }
    }
    #[test] fn idle_when_in_sync_and_clean() { assert_eq!(decide(&v(5,5,false)), SyncDecision::Idle); }
    #[test] fn push_when_clean_behind_false_but_dirty() { assert_eq!(decide(&v(5,5,true)), SyncDecision::Push); }
    #[test] fn pull_when_behind_and_clean() { assert_eq!(decide(&v(4,5,false)), SyncDecision::Pull); }
    #[test] fn pull_then_push_when_behind_and_dirty() { assert_eq!(decide(&v(4,5,true)), SyncDecision::PullThenPush); }
}
