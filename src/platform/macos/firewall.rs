// macOS nie wymaga własnych reguł — system sam wyświetla prompt użytkownikowi
// przy pierwszej próbie bindowania portu LAN. Zostawiamy log dla symetrii.

pub fn ensure_firewall_rules() {
    log::info!(
        "Firewall: macOS — system prompt użytkownika przy pierwszym bindzie \
         TCP 47891 / UDP 47892 (nic nie konfigurujemy automatycznie)"
    );
}
