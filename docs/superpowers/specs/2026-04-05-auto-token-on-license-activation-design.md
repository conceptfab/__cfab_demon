# Auto-token przy aktywacji licencji

**Data:** 2026-04-05
**Status:** Zatwierdzony

## Problem

Tokeny sync online są statyczne, zdefiniowane w zmiennej `SYNC_API_TOKENS` na serwerze Railway. Urządzenia wymagają ręcznego wklejania tokenu w Settings. Prowadzi to do sytuacji, w której nowe urządzenia (np. system V) nie mają tokenu i sync online nie działa (błąd 401).

## Rozwiązanie

Automatyczne generowanie unikalnego tokenu per-urządzenie podczas aktywacji licencji. Token zwracany w response `/api/license/activate` i automatycznie zapisywany przez klienta.

## Architektura

### Serwer (`__cfab_server`)

#### 1. Token w DeviceRegistration

Plik: `src/lib/sync/license-contracts.ts`

Dodać pole `apiToken: string` do interfejsu `DeviceRegistration`. Token generowany jako `crypto.randomBytes(32).toString('hex')` (64 znaki hex). Przechowywany w `license-store.json` razem z resztą danych urządzenia.

#### 2. Generacja tokenu w registerDevice

Plik: `src/lib/sync/license-store.ts`

Funkcja `registerDevice()`:
- Nowe urządzenie: generuje `apiToken` i zapisuje w `DeviceRegistration`
- Istniejące urządzenie (ponowna aktywacja): zwraca istniejący token (nie regeneruje)

Nowa funkcja `regenerateDeviceToken(licenseId, deviceId)`:
- Generuje nowy token, nadpisuje stary
- Do użytku z panelu admina

#### 3. Endpoint /api/license/activate — rozszerzenie response

Plik: `src/app/api/license/activate/route.ts`

Response rozszerzony o pole `apiToken`:
```json
{
  "ok": true,
  "licenseId": "...",
  "apiToken": "a1b2c3d4...",
  ...
}
```

#### 4. authenticateSyncRequest — fallback do device tokens

Plik: `src/lib/auth/server-auth.ts`

Flow autoryzacji:
1. Sprawdź env tokens (`SYNC_API_TOKENS`) — jak dotychczas
2. Jeśli brak matcha → przeszukaj `devices` w license-store po polu `apiToken`
3. Jeśli znaleziono → ustal userId: device → group (via groupId) → group.ownerId
4. Zwróć `{ userId: ownerId, method: "device-token" }`

Nowa funkcja w license-store: `findDeviceByToken(token: string): { device, group } | null`

Optymalizacja: cache reverse mapy (token → deviceId) w pamięci, invalidacja przy każdym `writeStore()`.

#### 5. Admin: widoczność tokenów

Endpoint `GET /api/admin/license/[id]/devices` — już zwraca urządzenia z license-store. Pole `apiToken` automatycznie pojawi się w response (jest częścią `DeviceRegistration`). Token wyświetlony w panelu admina przy każdym urządzeniu.

Nowy endpoint: `POST /api/admin/license/[id]/devices/[deviceId]/regenerate-token`
- Wywołuje `regenerateDeviceToken()`
- Zwraca nowy token

### Klient (`__client/dashboard`)

#### 6. activateLicense — auto-zapis tokenu

Plik: `dashboard/src/lib/online-sync.ts`

Typ `LicenseActivationResult` rozszerzony o opcjonalne pole `apiToken?: string`.

Plik: `dashboard/src/hooks/useSettingsFormState.ts`

W `handleActivateLicense()`, po udanej aktywacji:
```
if (result.apiToken) {
  await setSecureToken(result.apiToken);
}
```

Token ląduje zaszyfrowany (DPAPI) w `sync_token.dat`. Daemon odczytuje go stamtąd.

#### 7. UI — pole tokenu po aktywacji

Plik: `dashboard/src/components/settings/OnlineSyncCard.tsx`

Po aktywacji licencji pole "API Token (Bearer)" pokazuje zamaskowany token z informacją "ustawiony automatycznie przy aktywacji". Pole nadal edytowalne (ręczne nadpisanie jako edge case).

## Backward compatibility

- `SYNC_API_TOKENS` z env dalej działa (priorytet nad device tokens)
- Daemon (Rust, `src/online_sync.rs`) — bez zmian, czyta token z `sync_token.dat`
- Istniejące urządzenia bez `apiToken` w license-store działają dalej przez env tokens

## Pliki do zmiany

### Serwer (`__cfab_server`)
1. `src/lib/sync/license-contracts.ts` — pole `apiToken` w `DeviceRegistration`
2. `src/lib/sync/license-store.ts` — generacja tokenu w `registerDevice()`, nowe: `regenerateDeviceToken()`, `findDeviceByToken()`
3. `src/app/api/license/activate/route.ts` — `apiToken` w response
4. `src/lib/auth/server-auth.ts` — fallback lookup po device tokens
5. `src/app/api/admin/license/[id]/devices/[deviceId]/route.ts` — endpoint regenerate-token (nowy lub rozszerzenie istniejącego)

### Klient (`__client/dashboard`)
6. `src/lib/online-sync-types.ts` — `apiToken` w `LicenseActivationResult`
7. `src/lib/online-sync.ts` — bez zmian (już zwraca pełny JSON)
8. `src/hooks/useSettingsFormState.ts` — auto-zapis tokenu po aktywacji
9. `src/components/settings/OnlineSyncCard.tsx` — info "token ustawiony automatycznie"

## Bezpieczeństwo

- Tokeny 256-bit (64 hex) — odporność na brute-force
- Timing-safe comparison (istniejący `safeStringEqual`) dla device tokens
- Token zaszyfrowany DPAPI na kliencie (istniejący mechanizm)
- Token nigdy nie logowany w pełnej formie (trunkacja w logach)
