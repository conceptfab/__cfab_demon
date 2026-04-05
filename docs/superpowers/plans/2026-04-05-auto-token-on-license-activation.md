# Auto-Token on License Activation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatycznie generować unikalny token sync per-urządzenie podczas aktywacji licencji, eliminując konieczność ręcznego wklejania tokenów.

**Architecture:** Serwer generuje token w `registerDevice()`, zapisuje w license-store.json, zwraca w response aktywacji. Klient auto-zapisuje token w `sync_token.dat`. Auth fallback w `server-auth.ts` sprawdza device tokeny oprócz env tokenów.

**Tech Stack:** Next.js (serwer), TypeScript, Tauri/React (klient), crypto.randomBytes

**Spec:** `docs/superpowers/specs/2026-04-05-auto-token-on-license-activation-design.md`

**Repos:**
- Serwer: `f:/___APPS/__TimeFlow/__cfab_server`
- Klient: `f:/___APPS/__TimeFlow/__client`

---

### Task 1: Dodaj pole `apiToken` do `DeviceRegistration`

**Files:**
- Modify: `__cfab_server/src/lib/sync/license-contracts.ts:82-92`

- [ ] **Step 1: Dodaj pole `apiToken` do interfejsu `DeviceRegistration`**

```typescript
export interface DeviceRegistration {
  deviceId: string;
  groupId: string;
  licenseId: string;
  deviceName: string;
  apiToken: string;
  registeredAt: string;
  lastSeenAt: string;
  lastSyncAt: string | null;
  lastMarkerHash: string | null;
  isFixedMaster: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
cd f:/___APPS/__TimeFlow/__cfab_server
git add src/lib/sync/license-contracts.ts
git commit -m "feat: add apiToken field to DeviceRegistration interface"
```

---

### Task 2: Generacja tokenu w `registerDevice()` + nowe funkcje w license-store

**Files:**
- Modify: `__cfab_server/src/lib/sync/license-store.ts:308-349` (registerDevice)
- Modify: `__cfab_server/src/lib/sync/license-store.ts` (dodaj nowe funkcje na końcu)

- [ ] **Step 1: Dodaj import `randomBytes` na górze pliku**

W `__cfab_server/src/lib/sync/license-store.ts`, zmień:
```typescript
import { randomUUID } from "node:crypto";
```
na:
```typescript
import { randomBytes, randomUUID } from "node:crypto";
```

- [ ] **Step 2: Dodaj helper do generacji tokenu**

Dodaj po bloku importów, przed `const DATA_DIR`:
```typescript
function generateApiToken(): string {
  return randomBytes(32).toString("hex");
}
```

- [ ] **Step 3: Zmień `registerDevice()` — generuj token przy rejestracji**

Zmień tworzenie obiektu `device` w `registerDevice()`:
```typescript
    const group = store.groups[groupId];
    const device: DeviceRegistration = {
      deviceId,
      groupId,
      licenseId,
      deviceName,
      apiToken: generateApiToken(),
      registeredAt: nowIso(),
      lastSeenAt: nowIso(),
      lastSyncAt: null,
      lastMarkerHash: null,
      isFixedMaster: group?.fixedMasterDeviceId === deviceId,
    };
```

Uwaga: istniejące urządzenia (gałąź `if (existing && existing.licenseId === licenseId)`) zwracają istniejący obiekt bez zmian — token się nie regeneruje.

- [ ] **Step 4: Dodaj `regenerateDeviceToken()` na końcu sekcji Device operations**

Dodaj przed sekcją `// Storage backend CRUD`:
```typescript
export async function regenerateDeviceToken(
  licenseId: string,
  deviceId: string,
): Promise<DeviceRegistration | null> {
  return withMutex(async () => {
    const store = await readStore();
    const device = store.devices[deviceId];
    if (!device || device.licenseId !== licenseId) return null;

    device.apiToken = generateApiToken();
    await writeStore(store);
    return device;
  });
}
```

- [ ] **Step 5: Dodaj `findDeviceByToken()`**

Dodaj zaraz po `regenerateDeviceToken`:
```typescript
export async function findDeviceByToken(
  token: string,
): Promise<{ device: DeviceRegistration; group: ClientGroup } | null> {
  return withMutex(async () => {
    const store = await readStore();
    for (const device of Object.values(store.devices)) {
      if (device.apiToken === token) {
        const group = store.groups[device.groupId];
        if (group) {
          return { device, group };
        }
      }
    }
    return null;
  });
}
```

- [ ] **Step 6: Commit**

```bash
cd f:/___APPS/__TimeFlow/__cfab_server
git add src/lib/sync/license-store.ts
git commit -m "feat: generate apiToken in registerDevice, add regenerate and findByToken"
```

---

### Task 3: Zwróć `apiToken` w response `/api/license/activate`

**Files:**
- Modify: `__cfab_server/src/app/api/license/activate/route.ts:79-93`

- [ ] **Step 1: Dodaj `apiToken` do response JSON**

W `route.ts`, zmień blok `return NextResponse.json(...)`:
```typescript
    return NextResponse.json(
      {
        ok: true,
        licenseId: license.id,
        plan: license.plan,
        status: license.status,
        groupId: group.id,
        groupName: group.name,
        deviceId: device.deviceId,
        apiToken: device.apiToken,
        maxDevices: license.maxDevices,
        activeDevices: updatedLicense?.activeDevices.length ?? license.activeDevices.length,
        expiresAt: license.expiresAt,
      },
      { headers },
    );
```

- [ ] **Step 2: Commit**

```bash
cd f:/___APPS/__TimeFlow/__cfab_server
git add src/app/api/license/activate/route.ts
git commit -m "feat: return apiToken in license activation response"
```

---

### Task 4: Auth fallback — sprawdzaj device tokeny w `authenticateSyncRequest`

**Files:**
- Modify: `__cfab_server/src/lib/auth/server-auth.ts`

- [ ] **Step 1: Dodaj import `findDeviceByToken`**

Na górze pliku dodaj:
```typescript
import { findDeviceByToken } from "@/lib/sync/license-store";
```

- [ ] **Step 2: Zmień typ `SyncAuthContext.method`**

```typescript
export interface SyncAuthContext {
  userId: string;
  method: "token" | "device-token" | "dev-body-userid";
}
```

- [ ] **Step 3: Dodaj funkcję `resolveUserByDeviceToken`**

Dodaj po `resolveUserByToken`:
```typescript
async function resolveUserByDeviceToken(token: string): Promise<string | null> {
  const result = await findDeviceByToken(token);
  if (!result) return null;
  return result.group.ownerId;
}
```

- [ ] **Step 4: Zmień `authenticateSyncRequest` na async i dodaj fallback**

Zmień sygnaturę i ciało funkcji:
```typescript
export async function authenticateSyncRequest(
  request: Request,
  bodyUserId?: string | null,
): Promise<SyncAuthContext> {
  const env = getEnv();

  if (env.syncAuthMode === "session") {
    throw unauthorized(
      "SYNC_AUTH_MODE=session is not implemented yet on this server",
      "auth_mode_not_implemented",
    );
  }

  const token = getBearerToken(request);
  if (token) {
    // 1. Check env tokens (existing behavior)
    const envUserId = resolveUserByToken(token);
    if (envUserId) {
      if (bodyUserId && bodyUserId !== envUserId) {
        throw forbidden("Body userId does not match token user", "user_mismatch");
      }
      return { userId: envUserId, method: "token" };
    }

    // 2. Fallback: check device tokens from license-store
    const deviceUserId = await resolveUserByDeviceToken(token);
    if (deviceUserId) {
      if (bodyUserId && bodyUserId !== deviceUserId) {
        throw forbidden("Body userId does not match token user", "user_mismatch");
      }
      return { userId: deviceUserId, method: "device-token" };
    }

    throw unauthorized("Invalid API token", "invalid_token");
  }

  if (env.syncAllowInsecureDevUserIdFallback && bodyUserId) {
    return { userId: bodyUserId, method: "dev-body-userid" };
  }

  throw unauthorized("Missing Bearer token");
}
```

- [ ] **Step 5: Zaktualizuj wszystkie callsite'y `authenticateSyncRequest` — dodaj `await`**

W pliku `__cfab_server/src/lib/sync/http.ts` są dwa wywołania:

Linia ~36 w `validateTokenSyncAuth`:
```typescript
        const auth = await authenticateSyncRequest(request, null);
```

Linia ~147 w `handleSyncPost`:
```typescript
    const auth = await authenticateSyncRequest(request, bodyUserId);
```

Linia ~244 w `handleSyncGet`:
```typescript
    const auth = await authenticateSyncRequest(request, null);
```

Sprawdź czy te wywołania już używają `await` (funkcje `handleSyncPost` i `handleSyncGet` są async, więc dodanie `await` wystarczy). `validateTokenSyncAuth` jest też async. Jeśli `await` brakuje — dodaj.

- [ ] **Step 6: Commit**

```bash
cd f:/___APPS/__TimeFlow/__cfab_server
git add src/lib/auth/server-auth.ts src/lib/sync/http.ts
git commit -m "feat: add device-token auth fallback in authenticateSyncRequest"
```

---

### Task 5: Admin endpoint do regeneracji tokenu

**Files:**
- Modify: `__cfab_server/src/app/api/admin/license/[id]/devices/[deviceId]/route.ts`

- [ ] **Step 1: Dodaj endpoint POST do regeneracji tokenu**

Rozszerz istniejący plik o import i handler POST:
```typescript
export const runtime = "nodejs";

import type { AdminDeleteResponse } from "@/lib/sync/license-contracts";
import { deregisterDevice, regenerateDeviceToken } from "@/lib/sync/license-store";
import { handleAdminDelete, handleAdminOptions, handleAdminPost } from "@/lib/sync/admin-http";
import { badRequest } from "@/lib/http/error";

type RouteParams = { params: Promise<{ id: string; deviceId: string }> };

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id, deviceId } = await params;
  return handleAdminDelete(
    request,
    "admin-device-deregister",
    async (): Promise<AdminDeleteResponse> => {
      const deleted = await deregisterDevice(id, deviceId);
      return { ok: true, deleted };
    },
  );
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id, deviceId } = await params;
  return handleAdminPost(
    request,
    "admin-device-regenerate-token",
    () => ({}),
    async () => {
      const device = await regenerateDeviceToken(id, deviceId);
      if (!device) {
        throw badRequest("Device not found or does not belong to this license");
      }
      return { ok: true, device };
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd f:/___APPS/__TimeFlow/__cfab_server
git add src/app/api/admin/license/[id]/devices/[deviceId]/route.ts
git commit -m "feat: add POST endpoint to regenerate device token"
```

---

### Task 6: Backfill — istniejące urządzenia bez tokenu

**Files:**
- Modify: `__cfab_server/src/lib/sync/license-store.ts`

- [ ] **Step 1: Dodaj backfill w `readStore()`**

W funkcji `readStore()`, po linii backfillującej `storageBackends`, dodaj backfill dla brakujących tokenów:
```typescript
      // Backfill apiToken for devices registered before token generation
      for (const device of Object.values(store.devices)) {
        if (!device.apiToken) {
          device.apiToken = generateApiToken();
        }
      }
```

To automatycznie nada tokeny istniejącym urządzeniom przy pierwszym odczycie store po deployu. Token zostanie utrwalony przy następnym `writeStore()`.

- [ ] **Step 2: Commit**

```bash
cd f:/___APPS/__TimeFlow/__cfab_server
git add src/lib/sync/license-store.ts
git commit -m "feat: backfill apiToken for existing devices without one"
```

---

### Task 7: Klient — typ `LicenseActivationResult` + auto-zapis tokenu

**Files:**
- Modify: `__client/dashboard/src/lib/online-sync-types.ts:195-209`
- Modify: `__client/dashboard/src/hooks/useSettingsFormState.ts:550-604`

- [ ] **Step 1: Dodaj `apiToken` do `LicenseActivationResult`**

W `__client/dashboard/src/lib/online-sync-types.ts`, dodaj pole:
```typescript
export interface LicenseActivationResult {
  ok: boolean;
  licenseId?: string;
  plan?: string;
  status?: string;
  groupId?: string;
  groupName?: string;
  deviceId?: string;
  apiToken?: string;
  maxDevices?: number;
  activeDevices?: number;
  expiresAt?: string | null;
  error?: string;
  code?: string;
}
```

- [ ] **Step 2: Dodaj auto-zapis tokenu w `handleActivateLicense`**

W `__client/dashboard/src/hooks/useSettingsFormState.ts`, dodaj import `setSecureToken` jeśli brakuje, i dodaj auto-zapis po udanej aktywacji. Po linii `saveLicenseInfo(info);` i `setLicenseInfo(info);`:
```typescript
        saveLicenseInfo(info);
        setLicenseInfo(info);
        setLicenseKeyInput('');

        // Auto-save API token from activation response
        if (result.apiToken) {
          try {
            await setSecureToken(result.apiToken);
            setOnlineSyncSettings((prev) => ({ ...prev, apiToken: result.apiToken! }));
          } catch {
            console.warn('[license] Failed to auto-save API token');
          }
        }
```

Sprawdź czy `setSecureToken` jest importowany. Powinien być dostępny z `@/lib/tauri` (plik `__client/dashboard/src/lib/tauri/settings.ts` eksportuje go). Jeśli brak importu, dodaj:
```typescript
import { setSecureToken } from '@/lib/tauri';
```

- [ ] **Step 3: Commit**

```bash
cd f:/___APPS/__TimeFlow/__client
git add dashboard/src/lib/online-sync-types.ts dashboard/src/hooks/useSettingsFormState.ts
git commit -m "feat: auto-save API token after license activation"
```

---

### Task 8: Klient — UI info o automatycznym tokenie

**Files:**
- Modify: `__client/dashboard/src/components/settings/OnlineSyncCard.tsx:276-304`

- [ ] **Step 1: Dodaj informację pod polem tokenu gdy licencja aktywna**

W `OnlineSyncCard.tsx`, zmień opis pod polem tokenu. Zamień istniejący paragraf:
```tsx
            <p className="text-xs text-muted-foreground">{t('settings_page.enter_the_raw_token_the_app_will_add_the_bearer_header_a')}</p>
```
na:
```tsx
            <p className="text-xs text-muted-foreground">
              {settings.apiToken
                ? t('settings_page.token_set_auto', 'Token ustawiony automatycznie przy aktywacji licencji.')
                : t('settings_page.enter_the_raw_token_the_app_will_add_the_bearer_header_a')}
            </p>
```

- [ ] **Step 2: Dodaj tłumaczenia**

W `__client/dashboard/src/locales/pl/common.json`, dodaj klucz w sekcji `settings_page`:
```json
"token_set_auto": "Token ustawiony automatycznie przy aktywacji licencji."
```

W `__client/dashboard/src/locales/en/common.json`, dodaj:
```json
"token_set_auto": "Token set automatically during license activation."
```

- [ ] **Step 3: Commit**

```bash
cd f:/___APPS/__TimeFlow/__client
git add dashboard/src/components/settings/OnlineSyncCard.tsx dashboard/src/locales/pl/common.json dashboard/src/locales/en/common.json
git commit -m "feat: show auto-token info in Online Sync settings UI"
```

---

### Task 9: Weryfikacja end-to-end

- [ ] **Step 1: Build serwera**

```bash
cd f:/___APPS/__TimeFlow/__cfab_server
npm run build
```

Expected: build bez błędów TypeScript.

- [ ] **Step 2: Build klienta**

```bash
cd f:/___APPS/__TimeFlow/__client/dashboard
npm run build
```

Expected: build bez błędów.

- [ ] **Step 3: Test manualny — ścieżka aktywacji**

1. Uruchom serwer lokalnie
2. W TIMEFLOW dashboard → Settings → Online Sync:
   - Wpisz klucz licencyjny, kliknij Aktywuj
   - Sprawdź czy pole tokenu wypełniło się automatycznie
   - Sprawdź `sync_token.dat` — powinien mieć nową zawartość
3. Kliknij "Sync Now" — powinno się połączyć bez 401

- [ ] **Step 4: Test manualny — panel admina**

1. `GET /api/admin/license/{id}/devices` — sprawdź czy urządzenia mają pole `apiToken`
2. `POST /api/admin/license/{id}/devices/{deviceId}` — sprawdź regenerację tokenu

- [ ] **Step 5: Final commit**

```bash
cd f:/___APPS/__TimeFlow/__client
git add -A
git commit -m "chore: verify auto-token implementation end-to-end"
```
