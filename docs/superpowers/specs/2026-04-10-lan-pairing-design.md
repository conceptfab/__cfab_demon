# LAN Device Pairing — Design Spec

## Problem

Mechanizm `X-TimeFlow-Secret` używa per-maszynowego sekretu (`lan_secret.txt`). Gdy maszyna A syncuje z maszyną B, wysyła SWÓJ secret — ale B oczekuje SWOJEGO. Rezultat: 401 Unauthorized na każdym zdalnym sync.

## Rozwiązanie

Parowanie przez 6-cyfrowy kod. Master generuje kod, user wpisuje go na slave. Po weryfikacji master przekazuje swój `lan_secret`, slave zapisuje go w mapie `device_id → secret`. Przy sync slave wysyła secret CELU, nie swój.

## 1. Generowanie i walidacja kodu

- Master generuje 6-cyfrowy kod numeryczny (losowy).
- Kod przechowywany w pamięci (nie na dysku), TTL = 5 minut.
- Maksymalnie jeden aktywny kod w danym momencie — nowy anuluje poprzedni.
- Walidacja: maks. 5 błędnych prób → kod unieważniony, trzeba wygenerować nowy.
- Po sukcesie: kod konsumowany (jednorazowy).

## 2. Przechowywanie sparowanych sekretów

Plik `lan_paired_devices.json` w config dir:

```json
{
  "DESKTOP-ABC-123456789abcd-5678": {
    "secret": "a1b2c3...",
    "machine_name": "MICZ_",
    "paired_at": "2026-04-10T14:30:00Z"
  }
}
```

- Slave przechowuje secret mastera per `device_id`.
- Lokalna komunikacja (dashboard ↔ daemon) nadal używa lokalnego `lan_secret.txt`.

## 3. Zmiana w sync flow

1. Przed sync: ping → pobierz `device_id` celu.
2. Lookup secret w `lan_paired_devices.json` dla tego `device_id`.
3. Jeśli znaleziony → wyślij w `X-TimeFlow-Secret`.
4. Jeśli brak → sync nie rusza, UI: "Urządzenie nie jest sparowane".

## 4. Re-parowanie

- Gdy sync dostaje 401 od sparowanego urządzenia → status `pairing_invalid`.
- UI: badge "pairing expired" + przycisk "Re-pair" → dialog wpisania kodu.
- Po wpisaniu nowego kodu → stary secret nadpisany w `lan_paired_devices.json`.
- Usuwanie parowania: przycisk "Unpair" → usuwa wpis.

## 5. Nowy endpoint

### `POST /lan/pair` (bez auth)

- Body: `{"code": "482715"}`
- Sukces: `{"ok": true, "device_id": "...", "secret": "..."}`
- Błędy: `{"ok": false, "error": "invalid_code" | "code_expired" | "too_many_attempts"}`

### Istniejące endpointy — bez zmian

Zmiana jest po stronie klienta: wysyła secret celu zamiast swojego.

## 6. Nowe Tauri commands

- `generate_pairing_code` → generuje kod, zwraca do UI, timer 5 min.
- `submit_pairing_code(ip, port, code)` → wysyła na `/lan/pair`, zapisuje secret.
- `unpair_device(device_id)` → usuwa wpis z `lan_paired_devices.json`.
- `get_paired_devices` → lista sparowanych urządzeń.

## 7. Zmiany w `lan_sync_orchestrator.rs`

- Przed sync: ping → `device_id` → lookup paired secret → użyj jako header.
- Przy 401 od sparowanego urządzenia: zwróć `pairing_invalid`.

## 8. UI flow

### Master (generowanie kodu)
- Przycisk "Generate pairing code" w ustawieniach LAN sync.
- Wyświetla kod dużą czcionką z odliczaniem (5:00 → 0:00).
- Po wygaśnięciu/sparowaniu → komunikat sukcesu/timeout.

### Slave (wpisywanie kodu)
- Niesparowane urządzenie: przycisk "Pair" zamiast "Sync".
- Dialog z 6 polami na cyfry (autofocus).
- Po sparowaniu: "Pair" → "Sync".

### Sparowane urządzenie
- Badge "paired" obok nazwy.
- Przyciski sync jak dotychczas + "Unpair" (z potwierdzeniem).

### Błąd parowania (401)
- Badge "pairing expired" (żółty).
- Przycisk "Re-pair" → dialog wpisania kodu.
