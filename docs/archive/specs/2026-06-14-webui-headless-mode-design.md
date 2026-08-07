# TIMEFLOW — tryb Web UI bez okna (headless) — design

Data: 2026-06-14
Status: zaakceptowany do planowania

## Cel

Udostępnić UI aplikacji **wyłącznie przez przeglądarkę (LAN/localhost), bez okna desktop**, uruchamiane z menu demona. Ta sama dystrybucja co dziś — nie powstaje osobny build. Reużywamy istniejący web server, RPC bridge (201 komend) i auth, które już żyją w procesie `timeflow-dashboard`.

## Decyzje (ustalone z użytkownikiem)

1. **Tryb istniejącej aplikacji**, nie osobny build headless.
2. **W pełni headless**: żadne okno desktop się nie pokazuje; na macOS brak ikony w Docku (`ActivationPolicy::Accessory`).
3. **Toggle Start/Stop** w menu demona; menu pokazuje adres LAN.
4. **Auto-otwarcie przeglądarki** na hoscie (`http://127.0.0.1:port`) po starcie.
5. **Auto-login na hoscie przez zaufany loopback**: żądania z `127.0.0.1`/`::1` pomijają parowanie (sprawdzany realny `peer_addr()` gniazda, nie nagłówek). Urządzenia z LAN dalej wymagają 6-cyfrowego kodu.

## Architektura

**Wybrane podejście:** demon spawnuje ukryty proces `timeflow-dashboard --headless`.

Uzasadnienie: web server, RPC dispatcher i auth zależą od runtime Tauri i żyją w procesie dashboard. Przeniesienie ich do demona oznaczałoby przepisanie całego bridge'a 201 komend poza Tauri — duży refaktor i ryzyko regresji. Tryb headless reużywa istniejący kod 1:1; nowy jest tylko sposób startu procesu i ścieżka auth dla loopbacka.

### Komponenty i odpowiedzialności

| Komponent | Plik (orientacyjnie) | Co robi |
|---|---|---|
| Flaga CLI `--headless` | `dashboard/src-tauri/src/main.rs`, `lib.rs` | Wykrywa tryb; w `setup()` tworzy okno programowo jako niewidoczne (zamiast auto-create z `tauri.conf.json`, by nie było mignięcia) i ustawia `ActivationPolicy::Accessory` na macOS. |
| Start serwera (gated `enabled`) | `dashboard/src-tauri/src/webui/mod.rs` | W trybie headless serwer startuje na porcie z `webserver_settings.json` (domyślnie 47892) **tylko gdy `enabled=true`**. Gdy Web Server jest wyłączony, proces headless kończy się bez startu serwera (brak sieroty). Demon (`webui_host_ctl::start`) przed spawnem sprawdza `enabled` i zajętość portu, a przy niepowodzeniu pokazuje natywne powiadomienie. |
| Zaufany loopback | `dashboard/src-tauri/src/webui/server.rs` | Jeśli `stream.peer_addr().is_loopback()` → żądanie traktowane jako uwierzytelnione (pomija Bearer/parowanie). Pozostałe adresy bez zmian. |
| Plik statusu hosta | nowy `webui_host.json` w data dir | Headless proces zapisuje `{pid, port, started_at}` przy starcie, usuwa przy zamknięciu. Źródło prawdy o stanie toggle'a dla demona. |
| Menu demona (macOS) | `src/platform/macos/tray.rs` | Blok Web UI: status z adresem LAN, toggle Start/Stop, „Pokaż kod parowania". |
| Menu demona (Windows) | `src/platform/windows/tray.rs` | Lustrzany blok (te same pozycje i zachowanie). |
| Sterowanie procesem | `src/...` (sync_trigger-podobny helper) | Start: spawn binarki `--headless` + auto-open przeglądarki na `127.0.0.1:port`. Stop: ubicie PID z `webui_host.json` (macOS SIGTERM, Windows taskkill). |

### Przepływ — Start
1. User klika „Uruchom Web UI" w menu demona.
2. Demon spawnuje `timeflow-dashboard --headless`.
3. Proces: tworzy ukryte okno, accessory policy, start serwera **tylko gdy `enabled=true`** (inaczej proces kończy się), zapis `webui_host.json`.
4. Demon czeka aż plik/`port` gotowy, otwiera `http://127.0.0.1:port` w domyślnej przeglądarce.
5. Przeglądarka na loopbacku → auto-login → pełne UI.
6. Menu pokazuje `Web UI: http://192.168.x.x:port`, toggle → „Zatrzymaj Web UI".

### Przepływ — parowanie urządzenia LAN
1. Na hoscie: menu demona → „Pokaż kod parowania" → generuje 6-cyfrowy kod (TTL 180 s) i pokazuje w powiadomieniu/dialogu.
   - Alternatywnie: z zalogowanej lokalnej przeglądarki, zakładka „Web Server" → generuj kod (istniejąca funkcja).
2. Urządzenie LAN otwiera `http://192.168.x.x:port` → ekran logowania (WebLoginGate) → wpisuje kod → token zapisany, sesja 30 dni.

### Przepływ — Stop
1. User klika „Zatrzymaj Web UI".
2. Demon ubija PID z `webui_host.json`; proces sprząta plik.
3. Sesje przeglądarek (token-hash w `webui_sessions.json`) zostają — po ponownym starcie nadal ważne.
4. Menu → `Web UI: wyłączone`, toggle → „Uruchom Web UI".

## Bezpieczeństwo

- Zaufanie loopbacka opiera się na realnym adresie gniazda TCP (`peer_addr().is_loopback()`), którego nie da się sfałszować nagłówkiem HTTP z LAN. Założenie: operator hosta = właściciel danych (host jednoużytkownikowy).
- Urządzenia LAN bez zmian: parowanie kodem + Bearer token, rate-limit i TTL jak dziś.
- Serwer dalej bind `0.0.0.0:port` (dostęp z LAN), ale tylko loopback jest auto-zaufany.

## Obsługa stanów / błędów

- Port zajęty: serwer loguje błąd; demon pokazuje powiadomienie „nie udało się uruchomić Web UI (port zajęty)" i nie zmienia toggle'a.
- Proces headless padł (PID martwy, plik został): demon traktuje jako „wyłączone", czyści nieaktualny `webui_host.json`.
- Brak adresu LAN (offline): menu pokazuje tylko `http://127.0.0.1:port`.
- Podwójny start: jeśli `webui_host.json` wskazuje żywy PID, „Uruchom" jest no-op (lub tylko ponownie otwiera przeglądarkę).

## Dokumentacja (Help.tsx) — obowiązkowe

Nowa sekcja „TIMEFLOW Web UI (tryb bez okna)":
- co robi: udostępnia UI przez przeglądarkę bez otwierania okna aplikacji;
- kiedy użyć: dostęp z innych urządzeń w sieci / praca bez okna na hoscie;
- parowanie: localhost loguje się automatycznie; urządzenia LAN wymagają kodu z menu demona;
- jak zatrzymać: „Zatrzymaj Web UI" w menu demona;
- ograniczenia: host jednoużytkownikowy (loopback zaufany), wymaga włączonego serwera/portu.

Terminologia spójna: nazwa funkcji identyczna w menu demona, Help i logach.

## Testy

**Rust unit:**
- parsowanie flagi `--headless`;
- start headless respektuje `enabled` (nie startuje serwera przy `enabled=false`); `start()` zwraca `StartOutcome` (Disabled/PortBusy/AlreadyRunning/Spawned);
- zapis/odczyt/sprzątanie `webui_host.json` (w tym wykrycie martwego PID-u);
- klasyfikacja loopback vs nie-loopback dla decyzji auth (na poziomie funkcji pomocniczej, bez realnego gniazda).

**Manualne (macOS, realnie):**
- start z menu → brak okna i brak ikony w Docku;
- auto-otwarcie przeglądarki na localhost → zalogowane bez kodu;
- parowanie 2. urządzenia w LAN kodem z „Pokaż kod parowania";
- toggle „Zatrzymaj Web UI" ubija proces, menu wraca do stanu wyłączonego;
- port zajęty → powiadomienie o błędzie.

**Windows:** kod implementowany lustrzanie; shippuje niezweryfikowany z maca (znane ograniczenie cross-buildu — patrz pamięć projektu).

## Poza zakresem (YAGNI)

- Osobny build/dystrybucja headless.
- Przeniesienie web servera do demona.
- Wielodostęp/role na hoscie loopback.
- Zmiana mechanizmu parowania urządzeń LAN.
