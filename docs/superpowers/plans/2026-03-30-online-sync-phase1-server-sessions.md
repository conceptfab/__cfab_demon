# Phase 1: Server — Session-Based Sync Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the server's snapshot-based sync with a session-oriented coordinator model where the server tracks 13-step sync workflow between two devices.

**Architecture:** New endpoints (`/api/sync/session/*`) run alongside existing push/pull endpoints. Server creates sessions, assigns MASTER/SLAVE roles, tracks step progress, and manages session lifecycle (timeout, cleanup). No merge logic — server is coordinator only.

**Tech Stack:** Next.js 16 (App Router), TypeScript, file-based JSON storage (same pattern as existing `sync-store.json`)

---

## File Structure

| File | Responsibility |
|------|----------------|
| Create: `src/lib/sync/session-contracts.ts` | All new TypeScript types for sessions, steps, roles |
| Create: `src/lib/sync/session-store.ts` | Session CRUD, persistence to `session-store.json` |
| Create: `src/lib/sync/session-service.ts` | Business logic: create, join, report step, status, cancel |
| Create: `src/lib/sync/session-roles.ts` | MASTER/SLAVE role resolution logic |
| Create: `src/lib/sync/session-cleanup.ts` | Expired session cleanup (called on interval) |
| Create: `src/app/api/sync/session/create/route.ts` | POST endpoint: create or join session |
| Create: `src/app/api/sync/session/[id]/status/route.ts` | GET endpoint: poll session state |
| Create: `src/app/api/sync/session/[id]/report/route.ts` | POST endpoint: report step completion |
| Create: `src/app/api/sync/session/[id]/heartbeat/route.ts` | POST endpoint: keep-alive during transfer |
| Create: `src/app/api/sync/session/[id]/cancel/route.ts` | POST endpoint: cancel session |
| Modify: `src/lib/sync/http.ts` | Add `SyncRouteName` entries for new routes, add GET handler |

---

### Task 1: Session Contracts (Types)

**Files:**
- Create: `src/lib/sync/session-contracts.ts`

- [ ] **Step 1: Create session type definitions**

```typescript
// src/lib/sync/session-contracts.ts

export type SyncSessionStatus =
  | "awaiting_peer"
  | "negotiating"
  | "in_progress"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

export interface SyncStepLog {
  step: number;
  phase: string;
  action: string;
  deviceId: string;
  timestamp: string;
  details: Record<string, unknown>;
  status: "ok" | "error" | "warning";
}

export interface SyncSession {
  id: string;
  userId: string;
  status: SyncSessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;

  masterDeviceId: string;
  slaveDeviceId: string | null;

  syncMode: "full" | "delta" | null;
  masterMarkerHash: string | null;
  slaveMarkerHash: string | null;
  masterTableHashes: import("./contracts").TableHashes | null;
  slaveTableHashes: import("./contracts").TableHashes | null;

  currentStep: number;
  stepLog: SyncStepLog[];

  // Storage (Phase 2 will populate these)
  storageSessionPath: string | null;
  storageCredentialsSentAt: string | null;

  resultMarkerHash: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

// --- Request/Response types ---

export interface SessionCreateBody {
  deviceId: string;
  markerHash: string | null;
  tableHashes: import("./contracts").TableHashes | null;
}

export interface SessionCreateResponse {
  ok: true;
  sessionId: string;
  role: "master" | "slave";
  status: SyncSessionStatus;
  peerDeviceId: string | null;
  peerMarkerHash: string | null;
  syncMode: "full" | "delta" | null;
}

export interface SessionStatusResponse {
  ok: true;
  sessionId: string;
  status: SyncSessionStatus;
  myRole: "master" | "slave";
  currentStep: number;
  syncMode: "full" | "delta" | null;
  peerDeviceId: string | null;
  peerReady: boolean;
  nextAction: string | null;
  expiresAt: string;
  // Phase 2 adds: storageCredentials
}

export interface SessionReportBody {
  step: number;
  action: string;
  deviceId: string;
  details: Record<string, unknown>;
  status: "ok" | "error" | "warning";
}

export interface SessionReportResponse {
  ok: true;
  acknowledged: boolean;
  currentStep: number;
  sessionStatus: SyncSessionStatus;
}

export interface SessionHeartbeatBody {
  deviceId: string;
  currentStep: number;
  transferProgress?: {
    bytesTransferred: number;
    bytesTotal: number;
    percentComplete: number;
  };
}

export interface SessionHeartbeatResponse {
  ok: true;
  sessionStatus: SyncSessionStatus;
  expiresAt: string;
}

export interface SessionCancelBody {
  deviceId: string;
  reason?: string;
}

export interface SessionCancelResponse {
  ok: true;
  cancelled: boolean;
  sessionId: string;
}

// --- Store types ---

export interface SessionStoreFile {
  version: 1;
  sessions: Record<string, SyncSession>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `__server`: `npx tsc --noEmit`
Expected: No errors related to session-contracts.ts

- [ ] **Step 3: Commit**

```bash
git add src/lib/sync/session-contracts.ts
git commit -m "feat(online-sync): add session type definitions"
```

---

### Task 2: Session Store (Persistence)

**Files:**
- Create: `src/lib/sync/session-store.ts`

- [ ] **Step 1: Implement session store with file-based persistence**

```typescript
// src/lib/sync/session-store.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { SyncSession, SyncStepLog, SessionStoreFile, SyncSessionStatus } from "./session-contracts";

const STORE_FILENAME = "session-store.json";
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

let store: SessionStoreFile | null = null;
const writeMutex = new Map<string, Promise<void>>();

function getStorePath(): string {
  const dataDir = process.env.SYNC_DATA_DIR || "./data";
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return join(dataDir, STORE_FILENAME);
}

function loadStore(): SessionStoreFile {
  if (store) return store;
  const path = getStorePath();
  if (!existsSync(path)) {
    store = { version: 1, sessions: {} };
    return store;
  }
  const raw = readFileSync(path, "utf-8");
  store = JSON.parse(raw) as SessionStoreFile;
  return store;
}

function saveStore(): void {
  const path = getStorePath();
  writeFileSync(path, JSON.stringify(store, null, 2), "utf-8");
}

export function createSession(
  userId: string,
  deviceId: string,
  markerHash: string | null,
  tableHashes: import("./contracts").TableHashes | null,
): SyncSession {
  const s = loadStore();
  const now = new Date().toISOString();
  const session: SyncSession = {
    id: randomUUID(),
    userId,
    status: "awaiting_peer",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    masterDeviceId: deviceId,
    slaveDeviceId: null,
    syncMode: null,
    masterMarkerHash: markerHash,
    slaveMarkerHash: null,
    masterTableHashes: tableHashes,
    slaveTableHashes: null,
    currentStep: 1,
    stepLog: [{
      step: 1,
      phase: "discovery",
      action: "session_created",
      deviceId,
      timestamp: now,
      details: { markerHash },
      status: "ok",
    }],
    storageSessionPath: null,
    storageCredentialsSentAt: null,
    resultMarkerHash: null,
    completedAt: null,
    errorMessage: null,
  };
  s.sessions[session.id] = session;
  saveStore();
  return session;
}

export function findAwaitingSession(userId: string, excludeDeviceId: string): SyncSession | null {
  const s = loadStore();
  const now = Date.now();
  for (const session of Object.values(s.sessions)) {
    if (
      session.userId === userId &&
      session.status === "awaiting_peer" &&
      session.masterDeviceId !== excludeDeviceId &&
      new Date(session.expiresAt).getTime() > now
    ) {
      return session;
    }
  }
  return null;
}

export function joinSession(
  sessionId: string,
  slaveDeviceId: string,
  slaveMarkerHash: string | null,
  slaveTableHashes: import("./contracts").TableHashes | null,
): SyncSession {
  const s = loadStore();
  const session = s.sessions[sessionId];
  if (!session) throw new Error("Session not found");

  const now = new Date().toISOString();
  session.slaveDeviceId = slaveDeviceId;
  session.slaveMarkerHash = slaveMarkerHash;
  session.slaveTableHashes = slaveTableHashes;
  session.status = "negotiating";
  session.currentStep = 2;
  session.updatedAt = now;

  // Determine sync mode
  if (session.masterMarkerHash && slaveMarkerHash && session.masterMarkerHash === slaveMarkerHash) {
    session.syncMode = "delta";
  } else {
    session.syncMode = "full";
  }

  session.stepLog.push({
    step: 2,
    phase: "discovery",
    action: "slave_joined",
    deviceId: slaveDeviceId,
    timestamp: now,
    details: { slaveMarkerHash, syncMode: session.syncMode },
    status: "ok",
  });

  saveStore();
  return session;
}

export function getSession(sessionId: string): SyncSession | null {
  const s = loadStore();
  return s.sessions[sessionId] ?? null;
}

export function reportStep(
  sessionId: string,
  step: number,
  action: string,
  deviceId: string,
  details: Record<string, unknown>,
  status: "ok" | "error" | "warning",
): SyncSession {
  const s = loadStore();
  const session = s.sessions[sessionId];
  if (!session) throw new Error("Session not found");

  const now = new Date().toISOString();

  session.stepLog.push({
    step,
    phase: stepToPhase(step),
    action,
    deviceId,
    timestamp: now,
    details,
    status,
  });

  if (status === "error") {
    session.status = "failed";
    session.errorMessage = (details.message as string) ?? action;
  } else {
    if (step > session.currentStep) {
      session.currentStep = step;
    }
    // Update status based on step
    if (step >= 3 && session.status === "negotiating") {
      session.status = "in_progress";
    }
    if (step === 13 && action === "unfrozen") {
      // Check if both devices reported step 13
      const step13Reports = session.stepLog.filter(
        (l) => l.step === 13 && l.action === "unfrozen" && l.status === "ok"
      );
      if (step13Reports.length >= 2) {
        session.status = "completed";
        session.completedAt = now;
        if (details.final_marker_hash) {
          session.resultMarkerHash = details.final_marker_hash as string;
        }
      }
    }
  }

  session.updatedAt = now;
  saveStore();
  return session;
}

export function heartbeat(sessionId: string, deviceId: string): SyncSession {
  const s = loadStore();
  const session = s.sessions[sessionId];
  if (!session) throw new Error("Session not found");

  const now = new Date().toISOString();
  session.updatedAt = now;
  // Slide expiration by 2 minutes from now
  session.expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  saveStore();
  return session;
}

export function cancelSession(sessionId: string, deviceId: string, reason?: string): SyncSession {
  const s = loadStore();
  const session = s.sessions[sessionId];
  if (!session) throw new Error("Session not found");

  const now = new Date().toISOString();
  session.status = "cancelled";
  session.updatedAt = now;
  session.stepLog.push({
    step: session.currentStep,
    phase: "cancelled",
    action: "session_cancelled",
    deviceId,
    timestamp: now,
    details: { reason: reason ?? "user_requested" },
    status: "warning",
  });
  saveStore();
  return session;
}

export function expireSessions(): number {
  const s = loadStore();
  const now = Date.now();
  let expired = 0;
  for (const session of Object.values(s.sessions)) {
    if (
      (session.status === "awaiting_peer" ||
       session.status === "negotiating" ||
       session.status === "in_progress") &&
      new Date(session.expiresAt).getTime() < now
    ) {
      session.status = "expired";
      session.updatedAt = new Date().toISOString();
      expired++;
    }
  }
  if (expired > 0) saveStore();
  return expired;
}

export function cleanupOldSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const s = loadStore();
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [id, session] of Object.entries(s.sessions)) {
    if (
      (session.status === "completed" ||
       session.status === "failed" ||
       session.status === "expired" ||
       session.status === "cancelled") &&
      new Date(session.updatedAt).getTime() < cutoff
    ) {
      delete s.sessions[id];
      removed++;
    }
  }
  if (removed > 0) saveStore();
  return removed;
}

function stepToPhase(step: number): string {
  if (step <= 2) return "discovery";
  if (step <= 4) return "negotiation";
  if (step <= 7) return "transfer";
  if (step <= 10) return "merge";
  return "distribute";
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `__server`: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/sync/session-store.ts
git commit -m "feat(online-sync): add session store with file persistence"
```

---

### Task 3: Session Service (Business Logic)

**Files:**
- Create: `src/lib/sync/session-service.ts`

- [ ] **Step 1: Implement session service**

```typescript
// src/lib/sync/session-service.ts
import type {
  SessionCreateBody,
  SessionCreateResponse,
  SessionStatusResponse,
  SessionReportBody,
  SessionReportResponse,
  SessionHeartbeatBody,
  SessionHeartbeatResponse,
  SessionCancelBody,
  SessionCancelResponse,
  SyncSession,
} from "./session-contracts";
import {
  createSession,
  findAwaitingSession,
  joinSession,
  getSession,
  reportStep,
  heartbeat,
  cancelSession,
} from "./session-store";
import { resolveRole } from "./session-roles";

export async function handleSessionCreate(
  userId: string,
  body: SessionCreateBody,
): Promise<SessionCreateResponse> {
  const { deviceId, markerHash, tableHashes } = body;

  // Check if there's an existing awaiting session for this user
  const existing = findAwaitingSession(userId, deviceId);

  if (existing) {
    // Join as SLAVE
    const session = joinSession(existing.id, deviceId, markerHash, tableHashes);
    return {
      ok: true,
      sessionId: session.id,
      role: "slave",
      status: session.status,
      peerDeviceId: session.masterDeviceId,
      peerMarkerHash: session.masterMarkerHash,
      syncMode: session.syncMode,
    };
  }

  // Create new session as MASTER
  const session = createSession(userId, deviceId, markerHash, tableHashes);
  return {
    ok: true,
    sessionId: session.id,
    role: "master",
    status: session.status,
    peerDeviceId: null,
    peerMarkerHash: null,
    syncMode: null,
  };
}

export async function handleSessionStatus(
  userId: string,
  sessionId: string,
  deviceId: string,
): Promise<SessionStatusResponse> {
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (session.userId !== userId) throw new Error("Unauthorized");

  const myRole = session.masterDeviceId === deviceId ? "master" : "slave";
  const peerReady = session.slaveDeviceId !== null;

  return {
    ok: true,
    sessionId: session.id,
    status: session.status,
    myRole,
    currentStep: session.currentStep,
    syncMode: session.syncMode,
    peerDeviceId: myRole === "master" ? session.slaveDeviceId : session.masterDeviceId,
    peerReady,
    nextAction: determineNextAction(session, myRole),
    expiresAt: session.expiresAt,
  };
}

export async function handleSessionReport(
  userId: string,
  sessionId: string,
  body: SessionReportBody,
): Promise<SessionReportResponse> {
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (session.userId !== userId) throw new Error("Unauthorized");

  const updated = reportStep(
    sessionId,
    body.step,
    body.action,
    body.deviceId,
    body.details,
    body.status,
  );

  return {
    ok: true,
    acknowledged: true,
    currentStep: updated.currentStep,
    sessionStatus: updated.status,
  };
}

export async function handleSessionHeartbeat(
  userId: string,
  sessionId: string,
  body: SessionHeartbeatBody,
): Promise<SessionHeartbeatResponse> {
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (session.userId !== userId) throw new Error("Unauthorized");

  const updated = heartbeat(sessionId, body.deviceId);

  return {
    ok: true,
    sessionStatus: updated.status,
    expiresAt: updated.expiresAt,
  };
}

export async function handleSessionCancel(
  userId: string,
  sessionId: string,
  body: SessionCancelBody,
): Promise<SessionCancelResponse> {
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found");
  if (session.userId !== userId) throw new Error("Unauthorized");

  const updated = cancelSession(sessionId, body.deviceId, body.reason);

  return {
    ok: true,
    cancelled: true,
    sessionId: updated.id,
  };
}

function determineNextAction(session: SyncSession, role: "master" | "slave"): string | null {
  if (session.status === "awaiting_peer") return "wait_for_peer";
  if (session.status === "negotiating") {
    if (session.syncMode) return "freeze_database";
    return "wait_for_negotiation";
  }
  if (session.status === "completed") return null;
  if (session.status === "failed" || session.status === "expired" || session.status === "cancelled") return null;

  // in_progress — determine by step + role
  const step = session.currentStep;
  if (step < 5) return "freeze_database";
  if (step === 5) {
    if (role === "slave") return "upload_database";
    return "wait_for_slave_upload";
  }
  if (step === 6) {
    if (role === "master") return "download_slave_db";
    return "wait_for_master";
  }
  if (step === 7) {
    if (role === "master") return "backup_and_merge";
    return "wait_for_master";
  }
  if (step >= 8 && step <= 10) {
    if (role === "master") return "merge_and_verify";
    return "wait_for_master";
  }
  if (step === 11) {
    if (role === "slave") return "download_merged_db";
    return "wait_for_slave";
  }
  if (step === 12) return "unfreeze_database";
  if (step === 13) return "unfreeze_database";

  return null;
}
```

- [ ] **Step 2: Create role resolution module**

```typescript
// src/lib/sync/session-roles.ts

/**
 * Resolve MASTER/SLAVE roles for a session.
 * MVP: first device = MASTER, second = SLAVE.
 * Tie-break by device_id (lower = MASTER) if simultaneous.
 */
export function resolveRole(
  existingMasterDeviceId: string | null,
  newDeviceId: string,
): "master" | "slave" {
  if (!existingMasterDeviceId) return "master";
  if (existingMasterDeviceId === newDeviceId) return "master";
  return "slave";
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run from `__server`: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/sync/session-service.ts src/lib/sync/session-roles.ts
git commit -m "feat(online-sync): add session service and role resolution"
```

---

### Task 4: HTTP Handler for Session Endpoints

**Files:**
- Modify: `src/lib/sync/http.ts`

The existing `handleSyncPost` uses a `SyncRouteSpec` pattern. We need to extend it for:
1. GET requests (status polling)
2. Dynamic route params (`[id]`)

- [ ] **Step 1: Add GET handler and extend route names in http.ts**

Add after the existing `handleSyncPost` function:

```typescript
// Add to SyncRouteName type
type SyncRouteName = "status" | "push" | "pull" | "ack" | "session-create" | "session-status" | "session-report" | "session-heartbeat" | "session-cancel";

// Add new handler for GET requests
interface SyncGetRouteSpec<TResponse> {
  route: SyncRouteName;
  extractParams: (request: Request, url: URL) => { userId: string; deviceId: string; [key: string]: string };
  execute: (params: { userId: string; deviceId: string; [key: string]: string }) => Promise<TResponse>;
  summarizeResult?: (result: TResponse) => Record<string, unknown>;
}

export async function handleSyncGet<TResponse>(
  request: Request,
  spec: SyncGetRouteSpec<TResponse>,
): Promise<NextResponse> {
  const env = getEnv();
  const requestId = getOrCreateRequestId(request);
  const clientIp = getClientIp(request);
  const startedAt = Date.now();

  try {
    // Auth
    const auth = authenticateSyncRequest(request, null);

    // Rate limit
    const rateLimitKey = ["sync", spec.route, auth.userId, clientIp ?? "unknown-ip"].join(":");
    const rate = checkRateLimit(rateLimitKey, env.syncRateLimitMaxRequests, env.syncRateLimitWindowMs);
    if (!rate.allowed) {
      throw tooManyRequests("Rate limit exceeded", "rate_limited", { retryAfterMs: rate.retryAfterMs });
    }

    const url = new URL(request.url);
    const params = spec.extractParams(request, url);
    params.userId = auth.userId;

    const result = await spec.execute(params);

    const latencyMs = Date.now() - startedAt;
    log("info", "sync.request.success", {
      requestId, route: spec.route, userId: auth.userId, ip: clientIp, latencyMs,
      ...(spec.summarizeResult ? spec.summarizeResult(result) : {}),
    });

    return NextResponse.json(result, { headers: buildHeaders(requestId, request) });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    log(
      isAppError(error) && error.status < 500 ? "warn" : "error",
      "sync.request.failure",
      { requestId, route: spec.route, ip: clientIp, latencyMs },
    );
    return responseFromError(error, requestId, request);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `__server`: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/sync/http.ts
git commit -m "feat(online-sync): add GET handler to sync HTTP module"
```

---

### Task 5: Route — POST /api/sync/session/create

**Files:**
- Create: `src/app/api/sync/session/create/route.ts`

- [ ] **Step 1: Create the route handler**

```typescript
// src/app/api/sync/session/create/route.ts
import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleSessionCreate } from "@/lib/sync/session-service";
import type { SessionCreateBody } from "@/lib/sync/session-contracts";
import { badRequest } from "@/lib/http/error";

export const runtime = "nodejs";

function parseSessionCreateBody(raw: unknown): SessionCreateBody {
  if (typeof raw !== "object" || raw === null) {
    throw badRequest("Invalid body", "invalid_sync_body");
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.deviceId !== "string" || body.deviceId.trim() === "") {
    throw badRequest("deviceId is required", "invalid_sync_body");
  }
  return {
    deviceId: body.deviceId.trim(),
    markerHash: typeof body.markerHash === "string" ? body.markerHash : null,
    tableHashes: body.tableHashes && typeof body.tableHashes === "object" ? body.tableHashes as any : null,
  };
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(request: Request) {
  return handleSyncPost(request, {
    route: "session-create",
    parseBody: parseSessionCreateBody,
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) => handleSessionCreate(userId, body),
    summarizeResult: (result) => ({
      sessionId: result.sessionId,
      role: result.role,
      status: result.status,
    }),
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `__server`: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/sync/session/create/route.ts
git commit -m "feat(online-sync): add POST /api/sync/session/create endpoint"
```

---

### Task 6: Route — GET /api/sync/session/[id]/status

**Files:**
- Create: `src/app/api/sync/session/[id]/status/route.ts`

- [ ] **Step 1: Create the route handler**

```typescript
// src/app/api/sync/session/[id]/status/route.ts
import { handleSyncOptions, handleSyncGet } from "@/lib/sync/http";
import { handleSessionStatus } from "@/lib/sync/session-service";

export const runtime = "nodejs";

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deviceId = new URL(request.url).searchParams.get("deviceId") ?? "";

  return handleSyncGet(request, {
    route: "session-status",
    extractParams: () => ({ userId: "", deviceId, sessionId: id }),
    execute: ({ userId, deviceId, sessionId }) =>
      handleSessionStatus(userId, sessionId, deviceId),
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `__server`: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/sync/session/[id]/status/route.ts"
git commit -m "feat(online-sync): add GET /api/sync/session/[id]/status endpoint"
```

---

### Task 7: Route — POST /api/sync/session/[id]/report

**Files:**
- Create: `src/app/api/sync/session/[id]/report/route.ts`

- [ ] **Step 1: Create the route handler**

```typescript
// src/app/api/sync/session/[id]/report/route.ts
import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleSessionReport } from "@/lib/sync/session-service";
import type { SessionReportBody } from "@/lib/sync/session-contracts";
import { badRequest } from "@/lib/http/error";

export const runtime = "nodejs";

function parseReportBody(raw: unknown): SessionReportBody & { _sessionId: string } {
  if (typeof raw !== "object" || raw === null) {
    throw badRequest("Invalid body", "invalid_sync_body");
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.step !== "number") throw badRequest("step is required", "invalid_sync_body");
  if (typeof body.action !== "string") throw badRequest("action is required", "invalid_sync_body");
  if (typeof body.deviceId !== "string") throw badRequest("deviceId is required", "invalid_sync_body");

  return {
    step: body.step,
    action: body.action,
    deviceId: body.deviceId,
    details: (body.details && typeof body.details === "object" ? body.details : {}) as Record<string, unknown>,
    status: (body.status === "error" || body.status === "warning") ? body.status : "ok",
    _sessionId: "", // filled by route
  };
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return handleSyncPost(request, {
    route: "session-report",
    parseBody: (raw) => {
      const body = parseReportBody(raw);
      body._sessionId = id;
      return body;
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) =>
      handleSessionReport(userId, body._sessionId, body),
    summarizeResult: (result) => ({
      step: result.currentStep,
      status: result.sessionStatus,
    }),
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `__server`: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/sync/session/[id]/report/route.ts"
git commit -m "feat(online-sync): add POST /api/sync/session/[id]/report endpoint"
```

---

### Task 8: Routes — Heartbeat & Cancel

**Files:**
- Create: `src/app/api/sync/session/[id]/heartbeat/route.ts`
- Create: `src/app/api/sync/session/[id]/cancel/route.ts`

- [ ] **Step 1: Create heartbeat route**

```typescript
// src/app/api/sync/session/[id]/heartbeat/route.ts
import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleSessionHeartbeat } from "@/lib/sync/session-service";
import type { SessionHeartbeatBody } from "@/lib/sync/session-contracts";
import { badRequest } from "@/lib/http/error";

export const runtime = "nodejs";

function parseHeartbeatBody(raw: unknown): SessionHeartbeatBody & { _sessionId: string } {
  if (typeof raw !== "object" || raw === null) {
    throw badRequest("Invalid body", "invalid_sync_body");
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.deviceId !== "string") throw badRequest("deviceId required", "invalid_sync_body");

  return {
    deviceId: body.deviceId,
    currentStep: typeof body.currentStep === "number" ? body.currentStep : 0,
    transferProgress: body.transferProgress as any,
    _sessionId: "",
  };
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleSyncPost(request, {
    route: "session-heartbeat",
    parseBody: (raw) => {
      const body = parseHeartbeatBody(raw);
      body._sessionId = id;
      return body;
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) =>
      handleSessionHeartbeat(userId, body._sessionId, body),
  });
}
```

- [ ] **Step 2: Create cancel route**

```typescript
// src/app/api/sync/session/[id]/cancel/route.ts
import { handleSyncOptions, handleSyncPost } from "@/lib/sync/http";
import { handleSessionCancel } from "@/lib/sync/session-service";
import type { SessionCancelBody } from "@/lib/sync/session-contracts";
import { badRequest } from "@/lib/http/error";

export const runtime = "nodejs";

function parseCancelBody(raw: unknown): SessionCancelBody & { _sessionId: string } {
  if (typeof raw !== "object" || raw === null) {
    throw badRequest("Invalid body", "invalid_sync_body");
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.deviceId !== "string") throw badRequest("deviceId required", "invalid_sync_body");

  return {
    deviceId: body.deviceId,
    reason: typeof body.reason === "string" ? body.reason : undefined,
    _sessionId: "",
  };
}

export async function OPTIONS(request: Request) {
  return handleSyncOptions(request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleSyncPost(request, {
    route: "session-cancel",
    parseBody: (raw) => {
      const body = parseCancelBody(raw);
      body._sessionId = id;
      return body;
    },
    getBodyUserId: () => null,
    getDeviceId: (body) => body.deviceId,
    execute: ({ userId, body }) =>
      handleSessionCancel(userId, body._sessionId, body),
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run from `__server`: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/sync/session/[id]/heartbeat/route.ts" "src/app/api/sync/session/[id]/cancel/route.ts"
git commit -m "feat(online-sync): add heartbeat and cancel session endpoints"
```

---

### Task 9: Session Cleanup Job

**Files:**
- Create: `src/lib/sync/session-cleanup.ts`

- [ ] **Step 1: Create cleanup module**

```typescript
// src/lib/sync/session-cleanup.ts
import { expireSessions, cleanupOldSessions } from "./session-store";
import { log } from "@/lib/observability/logger";

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startSessionCleanup(): void {
  if (cleanupInterval) return;

  runCleanup(); // Run immediately on start

  cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  log("info", "session-cleanup.started", { intervalMs: CLEANUP_INTERVAL_MS });
}

export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log("info", "session-cleanup.stopped", {});
  }
}

function runCleanup(): void {
  try {
    const expired = expireSessions();
    const removed = cleanupOldSessions(MAX_SESSION_AGE_MS);

    if (expired > 0 || removed > 0) {
      log("info", "session-cleanup.completed", { expired, removed });
    }
  } catch (error) {
    log("error", "session-cleanup.error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `__server`: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/sync/session-cleanup.ts
git commit -m "feat(online-sync): add session cleanup job"
```

---

### Task 10: Integration — Wire Cleanup to App Startup

**Files:**
- Modify: `src/app/api/sync/session/create/route.ts` (add lazy cleanup init)

- [ ] **Step 1: Add lazy cleanup initialization to session create**

The cleanup job should start when the first session endpoint is hit. In Next.js App Router we don't have a global startup hook, so we use a lazy singleton:

Add to `src/lib/sync/session-cleanup.ts`:

```typescript
// Add at bottom of session-cleanup.ts
let initialized = false;
export function ensureCleanupRunning(): void {
  if (!initialized) {
    initialized = true;
    startSessionCleanup();
  }
}
```

Then in `src/app/api/sync/session/create/route.ts`, add at the top of the POST handler:

```typescript
import { ensureCleanupRunning } from "@/lib/sync/session-cleanup";

// Inside POST function, before handleSyncPost:
ensureCleanupRunning();
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `__server`: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/lib/sync/session-cleanup.ts src/app/api/sync/session/create/route.ts
git commit -m "feat(online-sync): wire cleanup job to first session request"
```

---

### Task 11: Manual Smoke Test

- [ ] **Step 1: Start the server**

```bash
cd __server && npm run dev
```

- [ ] **Step 2: Test session create (device A = MASTER)**

```bash
curl -X POST http://localhost:3000/api/sync/session/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"deviceId":"device-A","markerHash":"abc123","tableHashes":null}'
```

Expected: `{ ok: true, sessionId: "...", role: "master", status: "awaiting_peer" }`

- [ ] **Step 3: Test session create (device B = SLAVE joins)**

```bash
curl -X POST http://localhost:3000/api/sync/session/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"deviceId":"device-B","markerHash":"abc123","tableHashes":null}'
```

Expected: `{ ok: true, sessionId: "<same>", role: "slave", status: "negotiating", syncMode: "delta" }`

- [ ] **Step 4: Test status polling**

```bash
curl "http://localhost:3000/api/sync/session/<id>/status?deviceId=device-A" \
  -H "Authorization: Bearer <token>"
```

Expected: `{ ok: true, myRole: "master", peerReady: true, syncMode: "delta" }`

- [ ] **Step 5: Test step report**

```bash
curl -X POST http://localhost:3000/api/sync/session/<id>/report \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"step":5,"action":"frozen","deviceId":"device-A","details":{},"status":"ok"}'
```

Expected: `{ ok: true, acknowledged: true, currentStep: 5 }`

- [ ] **Step 6: Commit (if any fixes needed)**
