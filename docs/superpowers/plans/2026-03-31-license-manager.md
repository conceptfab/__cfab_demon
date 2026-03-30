# License Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin API on the sync server + PyQt6 desktop app for generating and managing TIMEFLOW license keys.

**Architecture:** Server gets new `/api/admin/*` endpoints backed by `data/license-store.json` (same mutex pattern as session-store). PyQt6 app on local machine talks to these endpoints via `requests` library. Admin auth via dedicated `ADMIN_API_TOKEN` env var.

**Tech Stack:** Server: Next.js/TypeScript (existing), PyQt6 + Python 3.10+, requests

**Spec:** `docs/superpowers/specs/2026-03-31-license-manager-design.md`

---

## File Structure

### Server (`__server`)

| File | Purpose |
|------|---------|
| `src/lib/sync/license-contracts.ts` | Types: License, ClientGroup, DeviceRegistration, LicenseStoreFile, request/response bodies |
| `src/lib/sync/license-store.ts` | JSON file CRUD with mutex (read/write `data/license-store.json`) |
| `src/lib/sync/license-keygen.ts` | Key generation: `TF-{PLAN}-{YEAR}-{XXXX}-{XXXX}-{CRC16}` |
| `src/lib/sync/license-validation.ts` | Request body validators for admin endpoints |
| `src/lib/auth/admin-auth.ts` | Admin token authentication middleware |
| `src/app/api/admin/license/route.ts` | POST (create) + GET (list) licenses |
| `src/app/api/admin/license/[id]/route.ts` | GET (detail) + PATCH (update) + DELETE license |
| `src/app/api/admin/license/[id]/devices/route.ts` | GET devices for license |
| `src/app/api/admin/license/[id]/devices/[deviceId]/route.ts` | DELETE (deregister) device |
| `src/app/api/admin/group/route.ts` | POST (create) + GET (list) groups |
| `src/app/api/admin/group/[id]/route.ts` | PATCH (update) group |

### PyQt6 App (`tools/license-manager/`)

| File | Purpose |
|------|---------|
| `main.py` | Entry point, QApplication setup |
| `config.py` | Load/save connection config (`~/.timeflow-admin/config.json`) |
| `api_client.py` | HTTP client wrapping all admin API calls |
| `models.py` | Python dataclasses mirroring server types |
| `main_window.py` | Main window: license table + toolbar + group tab |
| `dialogs/license_dialog.py` | Create/edit license dialog |
| `dialogs/group_dialog.py` | Create/edit group dialog |
| `dialogs/device_list_dialog.py` | View devices, deregister |
| `dialogs/settings_dialog.py` | Server URL + admin token config |
| `requirements.txt` | Dependencies |

---

## Task 1: License contracts (types)

**Files:**
- Create: `src/lib/sync/license-contracts.ts`

- [ ] **Step 1: Create license-contracts.ts with all types**

```typescript
// src/lib/sync/license-contracts.ts

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type LicensePlan = "free" | "starter" | "pro" | "enterprise";

export type LicenseStatus =
  | "active"
  | "trial"
  | "expired"
  | "suspended"
  | "revoked";

export interface License {
  id: string;
  licenseKey: string;
  groupId: string;
  plan: LicensePlan;
  status: LicenseStatus;
  createdAt: string;
  expiresAt: string | null;
  maxDevices: number;
  activeDevices: string[];
}

export interface ClientGroup {
  id: string;
  name: string;
  ownerId: string;
  licenseId: string;
  storageBackendId: string;
  fixedMasterDeviceId: string | null;
  syncPriority: Record<string, number>;
  maxSyncFrequencyHours: number | null;
  maxDatabaseSizeMb: number | null;
}

export interface DeviceRegistration {
  deviceId: string;
  groupId: string;
  licenseId: string;
  deviceName: string;
  registeredAt: string;
  lastSeenAt: string;
  lastSyncAt: string | null;
  lastMarkerHash: string | null;
  isFixedMaster: boolean;
}

// ---------------------------------------------------------------------------
// Store file
// ---------------------------------------------------------------------------

export interface LicenseStoreFile {
  version: 1;
  licenses: Record<string, License>;
  groups: Record<string, ClientGroup>;
  devices: Record<string, DeviceRegistration>;
}

// ---------------------------------------------------------------------------
// Plan defaults
// ---------------------------------------------------------------------------

export const PLAN_DEFAULTS: Record<
  LicensePlan,
  { maxDevices: number; maxDatabaseSizeMb: number; maxSyncFrequencyHours: number }
> = {
  free: { maxDevices: 2, maxDatabaseSizeMb: 50, maxSyncFrequencyHours: 24 },
  starter: { maxDevices: 5, maxDatabaseSizeMb: 200, maxSyncFrequencyHours: 8 },
  pro: { maxDevices: 20, maxDatabaseSizeMb: 1024, maxSyncFrequencyHours: 1 },
  enterprise: { maxDevices: 9999, maxDatabaseSizeMb: 10240, maxSyncFrequencyHours: 0.25 },
};

// ---------------------------------------------------------------------------
// Admin API request/response bodies
// ---------------------------------------------------------------------------

export interface AdminCreateLicenseBody {
  plan: LicensePlan;
  groupId?: string;
  groupName?: string;
  ownerId?: string;
  maxDevices?: number;
  expiresAt?: string | null;
}

export interface AdminUpdateLicenseBody {
  plan?: LicensePlan;
  status?: LicenseStatus;
  maxDevices?: number;
  expiresAt?: string | null;
}

export interface AdminCreateGroupBody {
  name: string;
  ownerId: string;
  licenseId: string;
  storageBackendId?: string;
  fixedMasterDeviceId?: string | null;
  maxSyncFrequencyHours?: number | null;
  maxDatabaseSizeMb?: number | null;
}

export interface AdminUpdateGroupBody {
  name?: string;
  fixedMasterDeviceId?: string | null;
  maxSyncFrequencyHours?: number | null;
  maxDatabaseSizeMb?: number | null;
}

export interface AdminLicenseResponse {
  ok: true;
  license: License;
}

export interface AdminLicenseListResponse {
  ok: true;
  licenses: License[];
  total: number;
}

export interface AdminGroupResponse {
  ok: true;
  group: ClientGroup;
}

export interface AdminGroupListResponse {
  ok: true;
  groups: ClientGroup[];
  total: number;
}

export interface AdminDeviceListResponse {
  ok: true;
  devices: DeviceRegistration[];
  total: number;
}

export interface AdminDeleteResponse {
  ok: true;
  deleted: boolean;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd c:/_cloud/__cfab_demon/__server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd c:/_cloud/__cfab_demon/__server
git add src/lib/sync/license-contracts.ts
git commit -m "feat(license): add license domain types and admin API contracts"
```

---

## Task 2: License key generation

**Files:**
- Create: `src/lib/sync/license-keygen.ts`

- [ ] **Step 1: Create license-keygen.ts**

```typescript
// src/lib/sync/license-keygen.ts

import type { LicensePlan } from "./license-contracts";

// Characters excluding ambiguous: 0/O, 1/I/L
const CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomSegment(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => CHARSET[b % CHARSET.length])
    .join("");
}

function crc16(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

function crc16ToSegment(crc: number): string {
  // Encode CRC16 (0-65535) as 4-char segment from CHARSET (base 30)
  let result = "";
  let value = crc;
  for (let i = 0; i < 4; i++) {
    result = CHARSET[value % CHARSET.length] + result;
    value = Math.floor(value / CHARSET.length);
  }
  return result;
}

export function generateLicenseKey(plan: LicensePlan): string {
  const planCode = plan.toUpperCase().slice(0, 3); // FRE, STA, PRO, ENT
  const planMap: Record<LicensePlan, string> = {
    free: "FRE",
    starter: "STA",
    pro: "PRO",
    enterprise: "ENT",
  };
  const year = new Date().getFullYear().toString();
  const seg1 = randomSegment(4);
  const seg2 = randomSegment(4);

  const prefix = `TF-${planMap[plan]}-${year}-${seg1}-${seg2}`;
  const checksum = crc16(prefix);
  const seg3 = crc16ToSegment(checksum);

  return `${prefix}-${seg3}`;
}

export function validateKeyFormat(key: string): boolean {
  const pattern = /^TF-(FRE|STA|PRO|ENT)-\d{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/;
  if (!pattern.test(key)) return false;

  const lastDash = key.lastIndexOf("-");
  const prefix = key.slice(0, lastDash);
  const checksumSegment = key.slice(lastDash + 1);

  const expectedCrc = crc16(prefix);
  const expectedSegment = crc16ToSegment(expectedCrc);

  return checksumSegment === expectedSegment;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd c:/_cloud/__cfab_demon/__server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd c:/_cloud/__cfab_demon/__server
git add src/lib/sync/license-keygen.ts
git commit -m "feat(license): add license key generation with CRC16 checksum"
```

---

## Task 3: License store (JSON CRUD with mutex)

**Files:**
- Create: `src/lib/sync/license-store.ts`

- [ ] **Step 1: Create license-store.ts**

```typescript
// src/lib/sync/license-store.ts

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ClientGroup,
  DeviceRegistration,
  License,
  LicensePlan,
  LicenseStatus,
  LicenseStoreFile,
} from "./license-contracts";
import { PLAN_DEFAULTS } from "./license-contracts";
import { generateLicenseKey } from "./license-keygen";

const DATA_DIR =
  process.env.SYNC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "license-store.json");

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): LicenseStoreFile {
  return { version: 1, licenses: {}, groups: {}, devices: {} };
}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<LicenseStoreFile> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      "licenses" in parsed
    ) {
      return parsed as LicenseStoreFile;
    }
    return emptyStore();
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return emptyStore();
    }
    throw error;
  }
}

async function writeStore(store: LicenseStoreFile): Promise<void> {
  await ensureDataDir();
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Mutex
// ---------------------------------------------------------------------------

let mutex: Promise<void> = Promise.resolve();

async function withMutex<T>(work: () => Promise<T>): Promise<T> {
  const previous = mutex;
  let release: () => void = () => {};
  mutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// License CRUD
// ---------------------------------------------------------------------------

export async function createLicense(
  plan: LicensePlan,
  groupId: string,
  maxDevices?: number,
  expiresAt?: string | null,
): Promise<License> {
  return withMutex(async () => {
    const store = await readStore();
    const license: License = {
      id: randomUUID(),
      licenseKey: generateLicenseKey(plan),
      groupId,
      plan,
      status: "active",
      createdAt: nowIso(),
      expiresAt: expiresAt ?? null,
      maxDevices: maxDevices ?? PLAN_DEFAULTS[plan].maxDevices,
      activeDevices: [],
    };
    store.licenses[license.id] = license;
    await writeStore(store);
    return license;
  });
}

export async function getLicense(id: string): Promise<License | null> {
  return withMutex(async () => {
    const store = await readStore();
    return store.licenses[id] ?? null;
  });
}

export async function getAllLicenses(): Promise<License[]> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.licenses);
  });
}

export async function updateLicense(
  id: string,
  updates: {
    plan?: LicensePlan;
    status?: LicenseStatus;
    maxDevices?: number;
    expiresAt?: string | null;
  },
): Promise<License | null> {
  return withMutex(async () => {
    const store = await readStore();
    const license = store.licenses[id];
    if (!license) return null;

    if (updates.plan !== undefined) license.plan = updates.plan;
    if (updates.status !== undefined) license.status = updates.status;
    if (updates.maxDevices !== undefined) license.maxDevices = updates.maxDevices;
    if (updates.expiresAt !== undefined) license.expiresAt = updates.expiresAt;

    await writeStore(store);
    return license;
  });
}

export async function deleteLicense(id: string): Promise<boolean> {
  return withMutex(async () => {
    const store = await readStore();
    if (!store.licenses[id]) return false;
    delete store.licenses[id];

    // Remove associated devices
    for (const [deviceId, device] of Object.entries(store.devices)) {
      if (device.licenseId === id) {
        delete store.devices[deviceId];
      }
    }

    await writeStore(store);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Group CRUD
// ---------------------------------------------------------------------------

export async function createGroup(
  name: string,
  ownerId: string,
  licenseId: string,
  storageBackendId?: string,
  fixedMasterDeviceId?: string | null,
  maxSyncFrequencyHours?: number | null,
  maxDatabaseSizeMb?: number | null,
): Promise<ClientGroup> {
  return withMutex(async () => {
    const store = await readStore();
    const group: ClientGroup = {
      id: randomUUID(),
      name,
      ownerId,
      licenseId,
      storageBackendId: storageBackendId ?? "default",
      fixedMasterDeviceId: fixedMasterDeviceId ?? null,
      syncPriority: {},
      maxSyncFrequencyHours: maxSyncFrequencyHours ?? null,
      maxDatabaseSizeMb: maxDatabaseSizeMb ?? null,
    };
    store.groups[group.id] = group;
    await writeStore(store);
    return group;
  });
}

export async function getGroup(id: string): Promise<ClientGroup | null> {
  return withMutex(async () => {
    const store = await readStore();
    return store.groups[id] ?? null;
  });
}

export async function getAllGroups(): Promise<ClientGroup[]> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.groups);
  });
}

export async function updateGroup(
  id: string,
  updates: {
    name?: string;
    fixedMasterDeviceId?: string | null;
    maxSyncFrequencyHours?: number | null;
    maxDatabaseSizeMb?: number | null;
  },
): Promise<ClientGroup | null> {
  return withMutex(async () => {
    const store = await readStore();
    const group = store.groups[id];
    if (!group) return null;

    if (updates.name !== undefined) group.name = updates.name;
    if (updates.fixedMasterDeviceId !== undefined) group.fixedMasterDeviceId = updates.fixedMasterDeviceId;
    if (updates.maxSyncFrequencyHours !== undefined) group.maxSyncFrequencyHours = updates.maxSyncFrequencyHours;
    if (updates.maxDatabaseSizeMb !== undefined) group.maxDatabaseSizeMb = updates.maxDatabaseSizeMb;

    await writeStore(store);
    return group;
  });
}

// ---------------------------------------------------------------------------
// Device operations
// ---------------------------------------------------------------------------

export async function getDevicesForLicense(licenseId: string): Promise<DeviceRegistration[]> {
  return withMutex(async () => {
    const store = await readStore();
    return Object.values(store.devices).filter((d) => d.licenseId === licenseId);
  });
}

export async function deregisterDevice(
  licenseId: string,
  deviceId: string,
): Promise<boolean> {
  return withMutex(async () => {
    const store = await readStore();
    const device = store.devices[deviceId];
    if (!device || device.licenseId !== licenseId) return false;

    delete store.devices[deviceId];

    // Remove from license activeDevices
    const license = store.licenses[licenseId];
    if (license) {
      license.activeDevices = license.activeDevices.filter((d) => d !== deviceId);
    }

    await writeStore(store);
    return true;
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd c:/_cloud/__cfab_demon/__server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd c:/_cloud/__cfab_demon/__server
git add src/lib/sync/license-store.ts
git commit -m "feat(license): add license store with JSON CRUD and mutex"
```

---

## Task 4: Admin auth middleware

**Files:**
- Create: `src/lib/auth/admin-auth.ts`
- Modify: `src/lib/config/env.ts` (add `adminApiToken`)

- [ ] **Step 1: Add adminApiToken to env config**

In `src/lib/config/env.ts`, add to `AppEnv` interface:

```typescript
  adminApiToken: string | null;
```

Add to `buildEnv()` before `return config`:

```typescript
    adminApiToken: env.ADMIN_API_TOKEN?.trim() || null,
```

- [ ] **Step 2: Create admin-auth.ts**

```typescript
// src/lib/auth/admin-auth.ts

import { timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/config/env";
import { forbidden, unauthorized } from "@/lib/http/error";

export function authenticateAdminRequest(request: Request): void {
  const env = getEnv();

  if (!env.adminApiToken) {
    throw forbidden("Admin API not configured", "admin_not_configured");
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw unauthorized("Missing admin token", "missing_admin_token");
  }

  const token = authHeader.substring(7);

  if (token.length !== env.adminApiToken.length) {
    throw unauthorized("Invalid admin token", "invalid_admin_token");
  }

  const tokenBuf = Buffer.from(token, "utf8");
  const expectedBuf = Buffer.from(env.adminApiToken, "utf8");

  if (!timingSafeEqual(tokenBuf, expectedBuf)) {
    throw unauthorized("Invalid admin token", "invalid_admin_token");
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd c:/_cloud/__cfab_demon/__server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd c:/_cloud/__cfab_demon/__server
git add src/lib/auth/admin-auth.ts src/lib/config/env.ts
git commit -m "feat(license): add admin API token authentication"
```

---

## Task 5: Admin request validation

**Files:**
- Create: `src/lib/sync/license-validation.ts`

- [ ] **Step 1: Create license-validation.ts**

```typescript
// src/lib/sync/license-validation.ts

import { badRequest } from "@/lib/http/error";
import type {
  AdminCreateGroupBody,
  AdminCreateLicenseBody,
  AdminUpdateGroupBody,
  AdminUpdateLicenseBody,
  LicensePlan,
  LicenseStatus,
} from "./license-contracts";

const VALID_PLANS: LicensePlan[] = ["free", "starter", "pro", "enterprise"];
const VALID_STATUSES: LicenseStatus[] = ["active", "trial", "expired", "suspended", "revoked"];

function assertObject(body: unknown): asserts body is Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object");
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${field} is required and must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest("Expected string value");
  return value.trim() || undefined;
}

function optionalPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw badRequest(`${field} must be a positive integer`);
  }
  return value;
}

function optionalNullableNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${field} must be a number or null`);
  }
  return value;
}

export function validateCreateLicenseBody(body: unknown): AdminCreateLicenseBody {
  assertObject(body);
  const plan = requireString(body.plan, "plan");
  if (!VALID_PLANS.includes(plan as LicensePlan)) {
    throw badRequest(`plan must be one of: ${VALID_PLANS.join(", ")}`);
  }
  return {
    plan: plan as LicensePlan,
    groupId: optionalString(body.groupId),
    groupName: optionalString(body.groupName),
    ownerId: optionalString(body.ownerId),
    maxDevices: optionalPositiveInt(body.maxDevices, "maxDevices"),
    expiresAt: body.expiresAt === null ? null : optionalString(body.expiresAt),
  };
}

export function validateUpdateLicenseBody(body: unknown): AdminUpdateLicenseBody {
  assertObject(body);
  const result: AdminUpdateLicenseBody = {};

  if (body.plan !== undefined) {
    const plan = requireString(body.plan, "plan");
    if (!VALID_PLANS.includes(plan as LicensePlan)) {
      throw badRequest(`plan must be one of: ${VALID_PLANS.join(", ")}`);
    }
    result.plan = plan as LicensePlan;
  }

  if (body.status !== undefined) {
    const status = requireString(body.status, "status");
    if (!VALID_STATUSES.includes(status as LicenseStatus)) {
      throw badRequest(`status must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    result.status = status as LicenseStatus;
  }

  result.maxDevices = optionalPositiveInt(body.maxDevices, "maxDevices");
  if (body.expiresAt !== undefined) {
    result.expiresAt = body.expiresAt === null ? null : optionalString(body.expiresAt) ?? undefined;
  }

  return result;
}

export function validateCreateGroupBody(body: unknown): AdminCreateGroupBody {
  assertObject(body);
  return {
    name: requireString(body.name, "name"),
    ownerId: requireString(body.ownerId, "ownerId"),
    licenseId: requireString(body.licenseId, "licenseId"),
    storageBackendId: optionalString(body.storageBackendId),
    fixedMasterDeviceId: body.fixedMasterDeviceId === null ? null : optionalString(body.fixedMasterDeviceId),
    maxSyncFrequencyHours: optionalNullableNumber(body.maxSyncFrequencyHours, "maxSyncFrequencyHours"),
    maxDatabaseSizeMb: optionalNullableNumber(body.maxDatabaseSizeMb, "maxDatabaseSizeMb"),
  };
}

export function validateUpdateGroupBody(body: unknown): AdminUpdateGroupBody {
  assertObject(body);
  return {
    name: optionalString(body.name),
    fixedMasterDeviceId: body.fixedMasterDeviceId === null ? null : optionalString(body.fixedMasterDeviceId),
    maxSyncFrequencyHours: optionalNullableNumber(body.maxSyncFrequencyHours, "maxSyncFrequencyHours"),
    maxDatabaseSizeMb: optionalNullableNumber(body.maxDatabaseSizeMb, "maxDatabaseSizeMb"),
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd c:/_cloud/__cfab_demon/__server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd c:/_cloud/__cfab_demon/__server
git add src/lib/sync/license-validation.ts
git commit -m "feat(license): add admin request body validators"
```

---

## Task 6: Admin HTTP handler helper

**Files:**
- Create: `src/lib/sync/admin-http.ts`

- [ ] **Step 1: Create admin-http.ts**

Reusable POST/GET/PATCH/DELETE handler for admin routes (analogous to `http.ts` for sync routes but using admin auth).

```typescript
// src/lib/sync/admin-http.ts

import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/auth/admin-auth";
import { getEnv } from "@/lib/config/env";
import { internalServerError, isAppError } from "@/lib/http/error";
import { parseJsonBody } from "@/lib/http/request";
import { log, logError } from "@/lib/observability/logger";
import { REQUEST_ID_HEADER, getOrCreateRequestId } from "@/lib/observability/request-id";

function buildHeaders(requestId: string): HeadersInit {
  return {
    [REQUEST_ID_HEADER]: requestId,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-request-id",
    "access-control-expose-headers": REQUEST_ID_HEADER,
  };
}

function responseFromError(error: unknown, requestId: string): NextResponse {
  const env = getEnv();
  const appError = isAppError(error) ? error : internalServerError();

  if (!isAppError(error)) {
    logError("admin.request.unhandled_error", error, { requestId });
  }

  return NextResponse.json(
    {
      ok: false,
      code: appError.code,
      error: appError.expose || !env.isProduction ? appError.message : "Internal server error",
      requestId,
      ...(appError.details ? { details: appError.details } : {}),
    },
    {
      status: appError.status,
      headers: buildHeaders(requestId),
    },
  );
}

export async function handleAdminOptions(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: buildHeaders(""),
  });
}

export async function handleAdminPost<TBody, TResponse>(
  request: Request,
  route: string,
  parseBody: (body: unknown) => TBody,
  execute: (body: TBody) => Promise<TResponse>,
): Promise<NextResponse> {
  const requestId = getOrCreateRequestId(request);
  const startedAt = Date.now();

  try {
    authenticateAdminRequest(request);
    const parsed = await parseJsonBody(request, 1024 * 1024); // 1MB limit
    const body = parseBody(parsed.body);
    const result = await execute(body);

    log("info", "admin.request.success", {
      requestId,
      route,
      latencyMs: Date.now() - startedAt,
    });

    return NextResponse.json(result, { headers: buildHeaders(requestId) });
  } catch (error) {
    log(
      isAppError(error) && error.status < 500 ? "warn" : "error",
      "admin.request.failure",
      {
        requestId,
        route,
        latencyMs: Date.now() - startedAt,
        ...(isAppError(error) ? { status: error.status, code: error.code } : {}),
      },
    );
    return responseFromError(error, requestId);
  }
}

export async function handleAdminGet<TResponse>(
  request: Request,
  route: string,
  execute: () => Promise<TResponse>,
): Promise<NextResponse> {
  const requestId = getOrCreateRequestId(request);
  const startedAt = Date.now();

  try {
    authenticateAdminRequest(request);
    const result = await execute();

    log("info", "admin.request.success", {
      requestId,
      route,
      latencyMs: Date.now() - startedAt,
    });

    return NextResponse.json(result, { headers: buildHeaders(requestId) });
  } catch (error) {
    log(
      isAppError(error) && error.status < 500 ? "warn" : "error",
      "admin.request.failure",
      {
        requestId,
        route,
        latencyMs: Date.now() - startedAt,
        ...(isAppError(error) ? { status: error.status, code: error.code } : {}),
      },
    );
    return responseFromError(error, requestId);
  }
}

export async function handleAdminPatch<TBody, TResponse>(
  request: Request,
  route: string,
  parseBody: (body: unknown) => TBody,
  execute: (body: TBody) => Promise<TResponse>,
): Promise<NextResponse> {
  return handleAdminPost(request, route, parseBody, execute);
}

export async function handleAdminDelete(
  request: Request,
  route: string,
  execute: () => Promise<{ ok: true; deleted: boolean }>,
): Promise<NextResponse> {
  return handleAdminGet(request, route, execute);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd c:/_cloud/__cfab_demon/__server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd c:/_cloud/__cfab_demon/__server
git add src/lib/sync/admin-http.ts
git commit -m "feat(license): add admin HTTP handler helpers"
```

---

## Task 7: License API routes

**Files:**
- Create: `src/app/api/admin/license/route.ts`
- Create: `src/app/api/admin/license/[id]/route.ts`
- Create: `src/app/api/admin/license/[id]/devices/route.ts`
- Create: `src/app/api/admin/license/[id]/devices/[deviceId]/route.ts`

- [ ] **Step 1: Create POST + GET /api/admin/license**

```typescript
// src/app/api/admin/license/route.ts

export const runtime = "nodejs";

import type {
  AdminLicenseListResponse,
  AdminLicenseResponse,
} from "@/lib/sync/license-contracts";
import { createGroup, getAllGroups } from "@/lib/sync/license-store";
import { createLicense, getAllLicenses } from "@/lib/sync/license-store";
import { validateCreateLicenseBody } from "@/lib/sync/license-validation";
import {
  handleAdminGet,
  handleAdminOptions,
  handleAdminPost,
} from "@/lib/sync/admin-http";

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function POST(request: Request) {
  return handleAdminPost(
    request,
    "admin-license-create",
    validateCreateLicenseBody,
    async (body): Promise<AdminLicenseResponse> => {
      let groupId = body.groupId;

      // Auto-create group if groupName provided but no groupId
      if (!groupId && body.groupName) {
        const group = await createGroup(
          body.groupName,
          body.ownerId ?? "admin",
          "", // licenseId will be set below
        );
        groupId = group.id;
      }

      if (!groupId) {
        // Create default group
        const group = await createGroup(
          "Default",
          body.ownerId ?? "admin",
          "",
        );
        groupId = group.id;
      }

      const license = await createLicense(
        body.plan,
        groupId,
        body.maxDevices,
        body.expiresAt,
      );

      return { ok: true, license };
    },
  );
}

export async function GET(request: Request) {
  return handleAdminGet(
    request,
    "admin-license-list",
    async (): Promise<AdminLicenseListResponse> => {
      const licenses = await getAllLicenses();
      return { ok: true, licenses, total: licenses.length };
    },
  );
}
```

- [ ] **Step 2: Create GET + PATCH + DELETE /api/admin/license/[id]**

```typescript
// src/app/api/admin/license/[id]/route.ts

export const runtime = "nodejs";

import { badRequest } from "@/lib/http/error";
import type {
  AdminDeleteResponse,
  AdminLicenseResponse,
} from "@/lib/sync/license-contracts";
import {
  deleteLicense,
  getLicense,
  updateLicense,
} from "@/lib/sync/license-store";
import { validateUpdateLicenseBody } from "@/lib/sync/license-validation";
import {
  handleAdminDelete,
  handleAdminGet,
  handleAdminOptions,
  handleAdminPatch,
} from "@/lib/sync/admin-http";

type RouteParams = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminGet(
    request,
    "admin-license-detail",
    async (): Promise<AdminLicenseResponse> => {
      const license = await getLicense(id);
      if (!license) throw badRequest(`License not found: ${id}`);
      return { ok: true, license };
    },
  );
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminPatch(
    request,
    "admin-license-update",
    validateUpdateLicenseBody,
    async (body): Promise<AdminLicenseResponse> => {
      const license = await updateLicense(id, body);
      if (!license) throw badRequest(`License not found: ${id}`);
      return { ok: true, license };
    },
  );
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminDelete(
    request,
    "admin-license-delete",
    async (): Promise<AdminDeleteResponse> => {
      const deleted = await deleteLicense(id);
      return { ok: true, deleted };
    },
  );
}
```

- [ ] **Step 3: Create GET /api/admin/license/[id]/devices**

```typescript
// src/app/api/admin/license/[id]/devices/route.ts

export const runtime = "nodejs";

import type { AdminDeviceListResponse } from "@/lib/sync/license-contracts";
import { getDevicesForLicense } from "@/lib/sync/license-store";
import { handleAdminGet, handleAdminOptions } from "@/lib/sync/admin-http";

type RouteParams = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminGet(
    request,
    "admin-license-devices",
    async (): Promise<AdminDeviceListResponse> => {
      const devices = await getDevicesForLicense(id);
      return { ok: true, devices, total: devices.length };
    },
  );
}
```

- [ ] **Step 4: Create DELETE /api/admin/license/[id]/devices/[deviceId]**

```typescript
// src/app/api/admin/license/[id]/devices/[deviceId]/route.ts

export const runtime = "nodejs";

import type { AdminDeleteResponse } from "@/lib/sync/license-contracts";
import { deregisterDevice } from "@/lib/sync/license-store";
import { handleAdminDelete, handleAdminOptions } from "@/lib/sync/admin-http";

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
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd c:/_cloud/__cfab_demon/__server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd c:/_cloud/__cfab_demon/__server
git add src/app/api/admin/
git commit -m "feat(license): add admin license API routes"
```

---

## Task 8: Group API routes

**Files:**
- Create: `src/app/api/admin/group/route.ts`
- Create: `src/app/api/admin/group/[id]/route.ts`

- [ ] **Step 1: Create POST + GET /api/admin/group**

```typescript
// src/app/api/admin/group/route.ts

export const runtime = "nodejs";

import type {
  AdminGroupListResponse,
  AdminGroupResponse,
} from "@/lib/sync/license-contracts";
import { createGroup, getAllGroups } from "@/lib/sync/license-store";
import { validateCreateGroupBody } from "@/lib/sync/license-validation";
import {
  handleAdminGet,
  handleAdminOptions,
  handleAdminPost,
} from "@/lib/sync/admin-http";

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function POST(request: Request) {
  return handleAdminPost(
    request,
    "admin-group-create",
    validateCreateGroupBody,
    async (body): Promise<AdminGroupResponse> => {
      const group = await createGroup(
        body.name,
        body.ownerId,
        body.licenseId,
        body.storageBackendId,
        body.fixedMasterDeviceId,
        body.maxSyncFrequencyHours,
        body.maxDatabaseSizeMb,
      );
      return { ok: true, group };
    },
  );
}

export async function GET(request: Request) {
  return handleAdminGet(
    request,
    "admin-group-list",
    async (): Promise<AdminGroupListResponse> => {
      const groups = await getAllGroups();
      return { ok: true, groups, total: groups.length };
    },
  );
}
```

- [ ] **Step 2: Create PATCH /api/admin/group/[id]**

```typescript
// src/app/api/admin/group/[id]/route.ts

export const runtime = "nodejs";

import { badRequest } from "@/lib/http/error";
import type { AdminGroupResponse } from "@/lib/sync/license-contracts";
import { updateGroup } from "@/lib/sync/license-store";
import { validateUpdateGroupBody } from "@/lib/sync/license-validation";
import { handleAdminOptions, handleAdminPatch } from "@/lib/sync/admin-http";

type RouteParams = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return handleAdminOptions();
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleAdminPatch(
    request,
    "admin-group-update",
    validateUpdateGroupBody,
    async (body): Promise<AdminGroupResponse> => {
      const group = await updateGroup(id, body);
      if (!group) throw badRequest(`Group not found: ${id}`);
      return { ok: true, group };
    },
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd c:/_cloud/__cfab_demon/__server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd c:/_cloud/__cfab_demon/__server
git add src/app/api/admin/group/
git commit -m "feat(license): add admin group API routes"
```

---

## Task 9: PyQt6 app — models and config

**Files:**
- Create: `tools/license-manager/requirements.txt`
- Create: `tools/license-manager/models.py`
- Create: `tools/license-manager/config.py`

- [ ] **Step 1: Create requirements.txt**

```
PyQt6>=6.6.0
requests>=2.31.0
```

- [ ] **Step 2: Create models.py**

```python
# tools/license-manager/models.py

from dataclasses import dataclass, field


@dataclass
class License:
    id: str
    licenseKey: str
    groupId: str
    plan: str  # free | starter | pro | enterprise
    status: str  # active | trial | expired | suspended | revoked
    createdAt: str
    expiresAt: str | None
    maxDevices: int
    activeDevices: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict) -> "License":
        return cls(
            id=d["id"],
            licenseKey=d["licenseKey"],
            groupId=d["groupId"],
            plan=d["plan"],
            status=d["status"],
            createdAt=d["createdAt"],
            expiresAt=d.get("expiresAt"),
            maxDevices=d["maxDevices"],
            activeDevices=d.get("activeDevices", []),
        )


@dataclass
class ClientGroup:
    id: str
    name: str
    ownerId: str
    licenseId: str
    storageBackendId: str
    fixedMasterDeviceId: str | None
    maxSyncFrequencyHours: float | None
    maxDatabaseSizeMb: float | None

    @classmethod
    def from_dict(cls, d: dict) -> "ClientGroup":
        return cls(
            id=d["id"],
            name=d["name"],
            ownerId=d["ownerId"],
            licenseId=d["licenseId"],
            storageBackendId=d.get("storageBackendId", "default"),
            fixedMasterDeviceId=d.get("fixedMasterDeviceId"),
            maxSyncFrequencyHours=d.get("maxSyncFrequencyHours"),
            maxDatabaseSizeMb=d.get("maxDatabaseSizeMb"),
        )


@dataclass
class DeviceRegistration:
    deviceId: str
    groupId: str
    licenseId: str
    deviceName: str
    registeredAt: str
    lastSeenAt: str
    lastSyncAt: str | None
    lastMarkerHash: str | None
    isFixedMaster: bool

    @classmethod
    def from_dict(cls, d: dict) -> "DeviceRegistration":
        return cls(
            deviceId=d["deviceId"],
            groupId=d["groupId"],
            licenseId=d["licenseId"],
            deviceName=d["deviceName"],
            registeredAt=d["registeredAt"],
            lastSeenAt=d["lastSeenAt"],
            lastSyncAt=d.get("lastSyncAt"),
            lastMarkerHash=d.get("lastMarkerHash"),
            isFixedMaster=d.get("isFixedMaster", False),
        )
```

- [ ] **Step 3: Create config.py**

```python
# tools/license-manager/config.py

import json
import os
from dataclasses import dataclass
from pathlib import Path


CONFIG_DIR = Path.home() / ".timeflow-admin"
CONFIG_FILE = CONFIG_DIR / "config.json"


@dataclass
class AppConfig:
    server_url: str = ""
    admin_token: str = ""

    def is_configured(self) -> bool:
        return bool(self.server_url and self.admin_token)

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(
            json.dumps(
                {"server_url": self.server_url, "admin_token": self.admin_token},
                indent=2,
            ),
            encoding="utf-8",
        )

    @classmethod
    def load(cls) -> "AppConfig":
        if not CONFIG_FILE.exists():
            return cls()
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            return cls(
                server_url=data.get("server_url", ""),
                admin_token=data.get("admin_token", ""),
            )
        except (json.JSONDecodeError, KeyError):
            return cls()
```

- [ ] **Step 4: Commit**

```bash
cd c:/_cloud/__cfab_demon/__client
git add tools/license-manager/requirements.txt tools/license-manager/models.py tools/license-manager/config.py
git commit -m "feat(license-manager): add Python models and config"
```

---

## Task 10: PyQt6 app — API client

**Files:**
- Create: `tools/license-manager/api_client.py`

- [ ] **Step 1: Create api_client.py**

```python
# tools/license-manager/api_client.py

import requests
from models import ClientGroup, DeviceRegistration, License


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


class ApiClient:
    def __init__(self, server_url: str, admin_token: str):
        self.base_url = server_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {admin_token}"
        self.session.headers["Content-Type"] = "application/json"
        self.timeout = 10

    def _request(self, method: str, path: str, json_data: dict | None = None) -> dict:
        url = f"{self.base_url}{path}"
        resp = self.session.request(method, url, json=json_data, timeout=self.timeout)
        data = resp.json()
        if not data.get("ok"):
            raise ApiError(
                status=resp.status_code,
                code=data.get("code", "unknown"),
                message=data.get("error", "Unknown error"),
            )
        return data

    # --- Licenses ---

    def list_licenses(self) -> list[License]:
        data = self._request("GET", "/api/admin/license")
        return [License.from_dict(l) for l in data["licenses"]]

    def get_license(self, license_id: str) -> License:
        data = self._request("GET", f"/api/admin/license/{license_id}")
        return License.from_dict(data["license"])

    def create_license(
        self,
        plan: str,
        group_id: str | None = None,
        group_name: str | None = None,
        owner_id: str | None = None,
        max_devices: int | None = None,
        expires_at: str | None = None,
    ) -> License:
        body: dict = {"plan": plan}
        if group_id:
            body["groupId"] = group_id
        if group_name:
            body["groupName"] = group_name
        if owner_id:
            body["ownerId"] = owner_id
        if max_devices is not None:
            body["maxDevices"] = max_devices
        if expires_at is not None:
            body["expiresAt"] = expires_at
        data = self._request("POST", "/api/admin/license", body)
        return License.from_dict(data["license"])

    def update_license(self, license_id: str, updates: dict) -> License:
        data = self._request("PATCH", f"/api/admin/license/{license_id}", updates)
        return License.from_dict(data["license"])

    def delete_license(self, license_id: str) -> bool:
        data = self._request("DELETE", f"/api/admin/license/{license_id}")
        return data.get("deleted", False)

    # --- Devices ---

    def list_devices(self, license_id: str) -> list[DeviceRegistration]:
        data = self._request("GET", f"/api/admin/license/{license_id}/devices")
        return [DeviceRegistration.from_dict(d) for d in data["devices"]]

    def deregister_device(self, license_id: str, device_id: str) -> bool:
        data = self._request(
            "DELETE", f"/api/admin/license/{license_id}/devices/{device_id}"
        )
        return data.get("deleted", False)

    # --- Groups ---

    def list_groups(self) -> list[ClientGroup]:
        data = self._request("GET", "/api/admin/group")
        return [ClientGroup.from_dict(g) for g in data["groups"]]

    def create_group(
        self,
        name: str,
        owner_id: str,
        license_id: str,
        storage_backend_id: str | None = None,
        fixed_master_device_id: str | None = None,
    ) -> ClientGroup:
        body: dict = {"name": name, "ownerId": owner_id, "licenseId": license_id}
        if storage_backend_id:
            body["storageBackendId"] = storage_backend_id
        if fixed_master_device_id is not None:
            body["fixedMasterDeviceId"] = fixed_master_device_id
        data = self._request("POST", "/api/admin/group", body)
        return ClientGroup.from_dict(data["group"])

    def update_group(self, group_id: str, updates: dict) -> ClientGroup:
        data = self._request("PATCH", f"/api/admin/group/{group_id}", updates)
        return ClientGroup.from_dict(data["group"])

    # --- Connection test ---

    def test_connection(self) -> bool:
        try:
            self.list_licenses()
            return True
        except Exception:
            return False
```

- [ ] **Step 2: Commit**

```bash
cd c:/_cloud/__cfab_demon/__client
git add tools/license-manager/api_client.py
git commit -m "feat(license-manager): add API client"
```

---

## Task 11: PyQt6 app — Settings dialog

**Files:**
- Create: `tools/license-manager/dialogs/__init__.py`
- Create: `tools/license-manager/dialogs/settings_dialog.py`

- [ ] **Step 1: Create __init__.py (empty)**

```python
# tools/license-manager/dialogs/__init__.py
```

- [ ] **Step 2: Create settings_dialog.py**

```python
# tools/license-manager/dialogs/settings_dialog.py

from PyQt6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QVBoxLayout,
)

from api_client import ApiClient
from config import AppConfig


class SettingsDialog(QDialog):
    def __init__(self, config: AppConfig, parent=None):
        super().__init__(parent)
        self.config = config
        self.setWindowTitle("TIMEFLOW Admin — Settings")
        self.setMinimumWidth(450)
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)

        form = QFormLayout()
        self.url_input = QLineEdit(self.config.server_url)
        self.url_input.setPlaceholderText("https://your-server.com")
        form.addRow("Server URL:", self.url_input)

        self.token_input = QLineEdit(self.config.admin_token)
        self.token_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.token_input.setPlaceholderText("admin token")
        form.addRow("Admin Token:", self.token_input)

        layout.addLayout(form)

        self.status_label = QLabel("")
        layout.addWidget(self.status_label)

        buttons = QDialogButtonBox()
        self.test_btn = buttons.addButton("Test Connection", QDialogButtonBox.ButtonRole.ActionRole)
        self.test_btn.clicked.connect(self._test_connection)
        buttons.addButton(QDialogButtonBox.StandardButton.Save)
        buttons.addButton(QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self._save)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _test_connection(self):
        url = self.url_input.text().strip()
        token = self.token_input.text().strip()
        if not url or not token:
            self.status_label.setText("Fill in both fields first.")
            return

        self.status_label.setText("Testing...")
        client = ApiClient(url, token)
        if client.test_connection():
            self.status_label.setText("Connection OK!")
            self.status_label.setStyleSheet("color: green;")
        else:
            self.status_label.setText("Connection failed.")
            self.status_label.setStyleSheet("color: red;")

    def _save(self):
        url = self.url_input.text().strip()
        token = self.token_input.text().strip()
        if not url or not token:
            QMessageBox.warning(self, "Error", "Both fields are required.")
            return
        self.config.server_url = url
        self.config.admin_token = token
        self.config.save()
        self.accept()
```

- [ ] **Step 3: Commit**

```bash
cd c:/_cloud/__cfab_demon/__client
git add tools/license-manager/dialogs/
git commit -m "feat(license-manager): add settings dialog"
```

---

## Task 12: PyQt6 app — License dialog

**Files:**
- Create: `tools/license-manager/dialogs/license_dialog.py`

- [ ] **Step 1: Create license_dialog.py**

```python
# tools/license-manager/dialogs/license_dialog.py

from PyQt6.QtWidgets import (
    QApplication,
    QComboBox,
    QDateEdit,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QCheckBox,
)
from PyQt6.QtCore import QDate

from api_client import ApiClient, ApiError
from models import ClientGroup, License

PLANS = ["free", "starter", "pro", "enterprise"]
STATUSES = ["active", "trial", "expired", "suspended", "revoked"]
PLAN_MAX_DEVICES = {"free": 2, "starter": 5, "pro": 20, "enterprise": 9999}


class CreateLicenseDialog(QDialog):
    def __init__(self, client: ApiClient, groups: list[ClientGroup], parent=None):
        super().__init__(parent)
        self.client = client
        self.groups = groups
        self.created_license: License | None = None
        self.setWindowTitle("Create License")
        self.setMinimumWidth(400)
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.plan_combo = QComboBox()
        self.plan_combo.addItems(PLANS)
        self.plan_combo.currentTextChanged.connect(self._on_plan_changed)
        form.addRow("Plan:", self.plan_combo)

        self.devices_spin = QSpinBox()
        self.devices_spin.setRange(1, 9999)
        self.devices_spin.setValue(2)
        form.addRow("Max Devices:", self.devices_spin)

        # Group selection
        self.group_combo = QComboBox()
        self.group_combo.addItem("(new group)", "")
        for g in self.groups:
            self.group_combo.addItem(g.name, g.id)
        form.addRow("Group:", self.group_combo)

        self.group_name_input = QLineEdit()
        self.group_name_input.setPlaceholderText("New group name")
        form.addRow("Group Name:", self.group_name_input)

        self.owner_input = QLineEdit()
        self.owner_input.setPlaceholderText("Owner ID (optional)")
        form.addRow("Owner ID:", self.owner_input)

        self.has_expiry = QCheckBox("Set expiry date")
        form.addRow("", self.has_expiry)

        self.expiry_date = QDateEdit()
        self.expiry_date.setCalendarPopup(True)
        self.expiry_date.setDate(QDate.currentDate().addYears(1))
        self.expiry_date.setEnabled(False)
        self.has_expiry.toggled.connect(self.expiry_date.setEnabled)
        form.addRow("Expires At:", self.expiry_date)

        layout.addLayout(form)

        # Result area (shown after creation)
        self.result_group = QGroupBox("Generated License Key")
        self.result_group.setVisible(False)
        result_layout = QHBoxLayout(self.result_group)
        self.key_label = QLabel()
        self.key_label.setStyleSheet("font-size: 14px; font-weight: bold; font-family: monospace;")
        result_layout.addWidget(self.key_label)
        copy_btn = QPushButton("Copy")
        copy_btn.clicked.connect(self._copy_key)
        result_layout.addWidget(copy_btn)
        layout.addWidget(self.result_group)

        buttons = QDialogButtonBox()
        self.create_btn = buttons.addButton("Generate", QDialogButtonBox.ButtonRole.AcceptRole)
        self.create_btn.clicked.connect(self._create)
        buttons.addButton(QDialogButtonBox.StandardButton.Close)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _on_plan_changed(self, plan: str):
        self.devices_spin.setValue(PLAN_MAX_DEVICES.get(plan, 2))

    def _copy_key(self):
        if self.created_license:
            QApplication.clipboard().setText(self.created_license.licenseKey)

    def _create(self):
        try:
            group_id = self.group_combo.currentData()
            group_name = self.group_name_input.text().strip() if not group_id else None
            owner_id = self.owner_input.text().strip() or None
            expires_at = None
            if self.has_expiry.isChecked():
                expires_at = self.expiry_date.date().toString("yyyy-MM-dd") + "T23:59:59Z"

            self.created_license = self.client.create_license(
                plan=self.plan_combo.currentText(),
                group_id=group_id or None,
                group_name=group_name,
                owner_id=owner_id,
                max_devices=self.devices_spin.value(),
                expires_at=expires_at,
            )

            self.key_label.setText(self.created_license.licenseKey)
            self.result_group.setVisible(True)
            self.create_btn.setEnabled(False)

        except ApiError as e:
            QMessageBox.critical(self, "Error", f"{e.code}: {e}")
        except Exception as e:
            QMessageBox.critical(self, "Connection Error", str(e))


class EditLicenseDialog(QDialog):
    def __init__(self, client: ApiClient, license: License, parent=None):
        super().__init__(parent)
        self.client = client
        self.license = license
        self.updated = False
        self.setWindowTitle(f"Edit License — {license.licenseKey}")
        self.setMinimumWidth(400)
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        form = QFormLayout()

        form.addRow("Key:", QLabel(self.license.licenseKey))

        self.plan_combo = QComboBox()
        self.plan_combo.addItems(PLANS)
        self.plan_combo.setCurrentText(self.license.plan)
        form.addRow("Plan:", self.plan_combo)

        self.status_combo = QComboBox()
        self.status_combo.addItems(STATUSES)
        self.status_combo.setCurrentText(self.license.status)
        form.addRow("Status:", self.status_combo)

        self.devices_spin = QSpinBox()
        self.devices_spin.setRange(1, 9999)
        self.devices_spin.setValue(self.license.maxDevices)
        form.addRow("Max Devices:", self.devices_spin)

        self.has_expiry = QCheckBox("Set expiry date")
        self.has_expiry.setChecked(self.license.expiresAt is not None)
        form.addRow("", self.has_expiry)

        self.expiry_date = QDateEdit()
        self.expiry_date.setCalendarPopup(True)
        if self.license.expiresAt:
            date_str = self.license.expiresAt[:10]
            self.expiry_date.setDate(QDate.fromString(date_str, "yyyy-MM-dd"))
        else:
            self.expiry_date.setDate(QDate.currentDate().addYears(1))
        self.expiry_date.setEnabled(self.has_expiry.isChecked())
        self.has_expiry.toggled.connect(self.expiry_date.setEnabled)
        form.addRow("Expires At:", self.expiry_date)

        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._save)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _save(self):
        try:
            updates = {}
            if self.plan_combo.currentText() != self.license.plan:
                updates["plan"] = self.plan_combo.currentText()
            if self.status_combo.currentText() != self.license.status:
                updates["status"] = self.status_combo.currentText()
            if self.devices_spin.value() != self.license.maxDevices:
                updates["maxDevices"] = self.devices_spin.value()

            if self.has_expiry.isChecked():
                new_expiry = self.expiry_date.date().toString("yyyy-MM-dd") + "T23:59:59Z"
                if new_expiry != self.license.expiresAt:
                    updates["expiresAt"] = new_expiry
            elif self.license.expiresAt:
                updates["expiresAt"] = None

            if updates:
                self.client.update_license(self.license.id, updates)
                self.updated = True

            self.accept()
        except ApiError as e:
            QMessageBox.critical(self, "Error", f"{e.code}: {e}")
        except Exception as e:
            QMessageBox.critical(self, "Connection Error", str(e))
```

- [ ] **Step 2: Commit**

```bash
cd c:/_cloud/__cfab_demon/__client
git add tools/license-manager/dialogs/license_dialog.py
git commit -m "feat(license-manager): add create/edit license dialogs"
```

---

## Task 13: PyQt6 app — Group and Device dialogs

**Files:**
- Create: `tools/license-manager/dialogs/group_dialog.py`
- Create: `tools/license-manager/dialogs/device_list_dialog.py`

- [ ] **Step 1: Create group_dialog.py**

```python
# tools/license-manager/dialogs/group_dialog.py

from PyQt6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLineEdit,
    QMessageBox,
    QVBoxLayout,
)

from api_client import ApiClient, ApiError


class CreateGroupDialog(QDialog):
    def __init__(self, client: ApiClient, license_id: str, parent=None):
        super().__init__(parent)
        self.client = client
        self.license_id = license_id
        self.created = False
        self.setWindowTitle("Create Group")
        self.setMinimumWidth(350)
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("Group name")
        form.addRow("Name:", self.name_input)

        self.owner_input = QLineEdit()
        self.owner_input.setPlaceholderText("Owner user ID")
        form.addRow("Owner ID:", self.owner_input)

        self.master_input = QLineEdit()
        self.master_input.setPlaceholderText("(optional) fixed master device ID")
        form.addRow("Fixed Master:", self.master_input)

        layout.addLayout(form)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._save)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _save(self):
        name = self.name_input.text().strip()
        owner = self.owner_input.text().strip()
        if not name or not owner:
            QMessageBox.warning(self, "Error", "Name and Owner ID are required.")
            return
        try:
            fixed_master = self.master_input.text().strip() or None
            self.client.create_group(
                name=name,
                owner_id=owner,
                license_id=self.license_id,
                fixed_master_device_id=fixed_master,
            )
            self.created = True
            self.accept()
        except ApiError as e:
            QMessageBox.critical(self, "Error", f"{e.code}: {e}")
        except Exception as e:
            QMessageBox.critical(self, "Connection Error", str(e))
```

- [ ] **Step 2: Create device_list_dialog.py**

```python
# tools/license-manager/dialogs/device_list_dialog.py

from PyQt6.QtWidgets import (
    QDialog,
    QHBoxLayout,
    QHeaderView,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
)

from api_client import ApiClient, ApiError
from models import DeviceRegistration


class DeviceListDialog(QDialog):
    def __init__(self, client: ApiClient, license_id: str, parent=None):
        super().__init__(parent)
        self.client = client
        self.license_id = license_id
        self.setWindowTitle("Devices")
        self.setMinimumSize(700, 400)
        self._build_ui()
        self._load_devices()

    def _build_ui(self):
        layout = QVBoxLayout(self)

        self.table = QTableWidget()
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels(
            ["Device ID", "Name", "Registered", "Last Seen", "Last Sync", "Master"]
        )
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        layout.addWidget(self.table)

        btn_layout = QHBoxLayout()
        self.deregister_btn = QPushButton("Deregister Selected")
        self.deregister_btn.clicked.connect(self._deregister)
        btn_layout.addWidget(self.deregister_btn)
        btn_layout.addStretch()
        close_btn = QPushButton("Close")
        close_btn.clicked.connect(self.accept)
        btn_layout.addWidget(close_btn)
        layout.addLayout(btn_layout)

    def _load_devices(self):
        try:
            devices = self.client.list_devices(self.license_id)
            self.table.setRowCount(len(devices))
            for row, d in enumerate(devices):
                self.table.setItem(row, 0, QTableWidgetItem(d.deviceId))
                self.table.setItem(row, 1, QTableWidgetItem(d.deviceName))
                self.table.setItem(row, 2, QTableWidgetItem(d.registeredAt[:10]))
                self.table.setItem(row, 3, QTableWidgetItem(d.lastSeenAt[:10]))
                self.table.setItem(row, 4, QTableWidgetItem(d.lastSyncAt[:10] if d.lastSyncAt else "—"))
                self.table.setItem(row, 5, QTableWidgetItem("Yes" if d.isFixedMaster else "No"))
        except ApiError as e:
            QMessageBox.critical(self, "Error", f"{e.code}: {e}")
        except Exception as e:
            QMessageBox.critical(self, "Connection Error", str(e))

    def _deregister(self):
        row = self.table.currentRow()
        if row < 0:
            return
        device_id = self.table.item(row, 0).text()
        reply = QMessageBox.question(
            self,
            "Confirm",
            f"Deregister device {device_id}?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply == QMessageBox.StandardButton.Yes:
            try:
                self.client.deregister_device(self.license_id, device_id)
                self._load_devices()
            except ApiError as e:
                QMessageBox.critical(self, "Error", f"{e.code}: {e}")
            except Exception as e:
                QMessageBox.critical(self, "Connection Error", str(e))
```

- [ ] **Step 3: Commit**

```bash
cd c:/_cloud/__cfab_demon/__client
git add tools/license-manager/dialogs/group_dialog.py tools/license-manager/dialogs/device_list_dialog.py
git commit -m "feat(license-manager): add group and device dialogs"
```

---

## Task 14: PyQt6 app — Main window

**Files:**
- Create: `tools/license-manager/main_window.py`

- [ ] **Step 1: Create main_window.py**

```python
# tools/license-manager/main_window.py

from PyQt6.QtWidgets import (
    QApplication,
    QHBoxLayout,
    QHeaderView,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QStatusBar,
    QTableWidget,
    QTableWidgetItem,
    QToolBar,
    QVBoxLayout,
    QWidget,
)
from PyQt6.QtGui import QAction
from PyQt6.QtCore import Qt

from api_client import ApiClient, ApiError
from config import AppConfig
from models import License, ClientGroup
from dialogs.license_dialog import CreateLicenseDialog, EditLicenseDialog
from dialogs.group_dialog import CreateGroupDialog
from dialogs.device_list_dialog import DeviceListDialog
from dialogs.settings_dialog import SettingsDialog


class MainWindow(QMainWindow):
    def __init__(self, config: AppConfig):
        super().__init__()
        self.config = config
        self.client: ApiClient | None = None
        self.licenses: list[License] = []
        self.groups: list[ClientGroup] = []

        self.setWindowTitle("TIMEFLOW License Manager")
        self.setMinimumSize(900, 500)

        self._build_toolbar()
        self._build_ui()
        self._build_statusbar()

        if config.is_configured():
            self._connect()
        else:
            self._show_settings()

    def _build_toolbar(self):
        toolbar = QToolBar("Main")
        toolbar.setMovable(False)
        self.addToolBar(toolbar)

        self.new_action = QAction("New License", self)
        self.new_action.triggered.connect(self._new_license)
        toolbar.addAction(self.new_action)

        self.edit_action = QAction("Edit", self)
        self.edit_action.triggered.connect(self._edit_license)
        toolbar.addAction(self.edit_action)

        self.delete_action = QAction("Delete", self)
        self.delete_action.triggered.connect(self._delete_license)
        toolbar.addAction(self.delete_action)

        self.devices_action = QAction("Devices", self)
        self.devices_action.triggered.connect(self._show_devices)
        toolbar.addAction(self.devices_action)

        toolbar.addSeparator()

        self.refresh_action = QAction("Refresh", self)
        self.refresh_action.triggered.connect(self._refresh)
        toolbar.addAction(self.refresh_action)

        self.settings_action = QAction("Settings", self)
        self.settings_action.triggered.connect(self._show_settings)
        toolbar.addAction(self.settings_action)

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)

        self.table = QTableWidget()
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels(
            ["License Key", "Plan", "Status", "Group", "Max Devices", "Active", "Expires"]
        )
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.doubleClicked.connect(self._edit_license)
        layout.addWidget(self.table)

    def _build_statusbar(self):
        self.statusbar = QStatusBar()
        self.setStatusBar(self.statusbar)
        self.statusbar.showMessage("Not connected")

    def _connect(self):
        self.client = ApiClient(self.config.server_url, self.config.admin_token)
        self._refresh()

    def _refresh(self):
        if not self.client:
            return
        try:
            self.licenses = self.client.list_licenses()
            self.groups = self.client.list_groups()
            self._populate_table()
            self.statusbar.showMessage(
                f"Connected — {len(self.licenses)} licenses, {len(self.groups)} groups"
            )
        except ApiError as e:
            self.statusbar.showMessage(f"Error: {e.code}")
            if e.status == 401:
                QMessageBox.warning(self, "Auth Error", "Invalid admin token.")
                self._show_settings()
        except Exception as e:
            self.statusbar.showMessage("Connection failed")
            QMessageBox.critical(self, "Connection Error", str(e))

    def _populate_table(self):
        group_map = {g.id: g.name for g in self.groups}
        self.table.setRowCount(len(self.licenses))
        for row, lic in enumerate(self.licenses):
            self.table.setItem(row, 0, QTableWidgetItem(lic.licenseKey))
            self.table.setItem(row, 1, QTableWidgetItem(lic.plan))
            self.table.setItem(row, 2, QTableWidgetItem(lic.status))
            self.table.setItem(row, 3, QTableWidgetItem(group_map.get(lic.groupId, lic.groupId)))
            self.table.setItem(row, 4, QTableWidgetItem(str(lic.maxDevices)))
            self.table.setItem(row, 5, QTableWidgetItem(str(len(lic.activeDevices))))
            self.table.setItem(row, 6, QTableWidgetItem(lic.expiresAt[:10] if lic.expiresAt else "—"))

    def _selected_license(self) -> License | None:
        row = self.table.currentRow()
        if row < 0 or row >= len(self.licenses):
            return None
        return self.licenses[row]

    def _new_license(self):
        if not self.client:
            return
        dlg = CreateLicenseDialog(self.client, self.groups, self)
        dlg.exec()
        if dlg.created_license:
            self._refresh()

    def _edit_license(self):
        lic = self._selected_license()
        if not lic or not self.client:
            return
        dlg = EditLicenseDialog(self.client, lic, self)
        dlg.exec()
        if dlg.updated:
            self._refresh()

    def _delete_license(self):
        lic = self._selected_license()
        if not lic or not self.client:
            return
        reply = QMessageBox.question(
            self,
            "Confirm Delete",
            f"Delete license {lic.licenseKey}?\n\nThis will also remove all associated devices.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if reply == QMessageBox.StandardButton.Yes:
            try:
                self.client.delete_license(lic.id)
                self._refresh()
            except Exception as e:
                QMessageBox.critical(self, "Error", str(e))

    def _show_devices(self):
        lic = self._selected_license()
        if not lic or not self.client:
            return
        dlg = DeviceListDialog(self.client, lic.id, self)
        dlg.exec()
        self._refresh()

    def _show_settings(self):
        dlg = SettingsDialog(self.config, self)
        if dlg.exec() == SettingsDialog.DialogCode.Accepted:
            self._connect()
```

- [ ] **Step 2: Commit**

```bash
cd c:/_cloud/__cfab_demon/__client
git add tools/license-manager/main_window.py
git commit -m "feat(license-manager): add main window with license table"
```

---

## Task 15: PyQt6 app — Entry point

**Files:**
- Create: `tools/license-manager/main.py`

- [ ] **Step 1: Create main.py**

```python
# tools/license-manager/main.py

import sys

from PyQt6.QtWidgets import QApplication

from config import AppConfig
from main_window import MainWindow


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("TIMEFLOW License Manager")

    config = AppConfig.load()
    window = MainWindow(config)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test launch**

Run:
```bash
cd c:/_cloud/__cfab_demon/__client/tools/license-manager
pip install -r requirements.txt
python main.py
```
Expected: Window opens. If no config, settings dialog appears first.

- [ ] **Step 3: Commit**

```bash
cd c:/_cloud/__cfab_demon/__client
git add tools/license-manager/main.py
git commit -m "feat(license-manager): add entry point"
```

---

## Task 16: Server TypeScript check + final verification

- [ ] **Step 1: Verify server compiles**

Run: `cd c:/_cloud/__cfab_demon/__server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Add ADMIN_API_TOKEN to .env.example (if exists)**

Add line:
```
ADMIN_API_TOKEN=your-secret-admin-token-here
```

- [ ] **Step 3: Final commit**

```bash
cd c:/_cloud/__cfab_demon/__server
git add -A
git commit -m "feat(license): complete license management system - admin API + PyQt6 client"
```
