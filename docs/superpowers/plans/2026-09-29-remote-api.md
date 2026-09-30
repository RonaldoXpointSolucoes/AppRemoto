# Remote API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the authenticated Fastify API for technicians, device enrollment, and heartbeat.

**Architecture:** Fastify plugins separate configuration, Appwrite access, technician sessions, device bearer authentication, cryptography, and routes. Domain services depend on narrow repositories so tenant authorization and enrollment compensation are testable.

**Tech Stack:** Node.js 24, TypeScript, Fastify, Appwrite Node SDK, Zod, Vitest, AES-256-GCM.

**Spec:** `docs/superpowers/specs/2026-09-29-remote-platform-mvp-design.md`

## Global Constraints

- All operational data routes except `/health` require validated authentication.
- Organization IDs from requests never grant access by themselves.
- Tokens are persisted only as SHA-256 hashes; passwords use AES-256-GCM.
- Logs redact cookies, authorization, keys, tokens, and credentials.
- Online threshold is exactly 90 seconds.

## Review Focus

- Cross-organization device lookup returns generic not-found/forbidden behavior without leakage.
- Concurrent enrollment retries create one device and consume the token once.
- Expired, exhausted, inactive, or malformed enrollment tokens fail closed.
- Revoked/disabled device credentials cannot heartbeat.
- Appwrite or encryption failure does not leave a consumed token with unusable credentials.

---

### Task 1: API Skeleton And Health

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/Dockerfile`
- Test: `apps/api/src/health.test.ts`

**Interfaces:**
- Consumes: root workspace and contracts package.
- Produces: `buildApp(options): FastifyInstance` and `GET /health` exact response.

- [ ] **Step 1: Write a failing injected-request test** for status 200 and `{status:"ok"}`.
- [ ] **Step 2: Run the test** and verify missing app failure.
- [ ] **Step 3: Implement configuration validation, app factory, server entry, and production Dockerfile.**
- [ ] **Step 4: Run API tests, typecheck, and Docker build.**
- [ ] **Step 5: Commit** with `git commit -m "feat: add remote api health service"`.

### Task 2: Appwrite Repositories And Technician Authentication

**Files:**
- Create: `apps/api/src/appwrite/client.ts`
- Create: `apps/api/src/repositories/technicians.ts`
- Create: `apps/api/src/repositories/organizations.ts`
- Create: `apps/api/src/plugins/technician-auth.ts`
- Create: `apps/api/src/routes/me.ts`
- Create: `apps/api/src/routes/organizations.ts`
- Test: `apps/api/src/routes/technician-routes.test.ts`

**Interfaces:**
- Consumes: Appwrite session cookie/header and production schema IDs.
- Produces: `request.technician`, `GET /v1/me`, and `GET /v1/organizations`.

- [ ] **Step 1: Write failing route tests** for valid super admin, organization member, expired session, disabled profile, and tenant filtering.
- [ ] **Step 2: Run focused tests** and verify missing authentication behavior.
- [ ] **Step 3: Implement narrow repositories, authentication plugin, and routes.**
- [ ] **Step 4: Run focused and API suites.**
- [ ] **Step 5: Commit** with `git commit -m "feat: authenticate remote technicians"`.

### Task 3: Device Listing

**Files:**
- Create: `apps/api/src/repositories/devices.ts`
- Create: `apps/api/src/services/device-list.ts`
- Create: `apps/api/src/routes/devices.ts`
- Test: `apps/api/src/routes/devices.test.ts`

**Interfaces:**
- Consumes: effective technician authorization and `DeviceListQuerySchema`.
- Produces: paginated safe `DeviceView` records with computed status.

- [ ] **Step 1: Write failing tests** for pagination, organization filter, 90-second boundary, search fields, disabled devices, and cross-tenant attempts.
- [ ] **Step 2: Run focused tests** and verify expected failures.
- [ ] **Step 3: Implement repository projection, status calculation, filtering, and route.**
- [ ] **Step 4: Run API suite and typecheck.**
- [ ] **Step 5: Commit** with `git commit -m "feat: list authorized remote devices"`.

### Task 4: Cryptography And Token Primitives

**Files:**
- Create: `apps/api/src/security/tokens.ts`
- Create: `apps/api/src/security/credentials.ts`
- Create: `apps/api/src/security/redaction.ts`
- Test: `apps/api/src/security/security.test.ts`

**Interfaces:**
- Produces: `issueToken()`, `hashToken()`, `encryptPassword()`, `decryptPassword()`, and structured-log redaction.

- [ ] **Step 1: Write failing tests** for entropy/format, deterministic hashes, authenticated encryption round trip, wrong-key failure, and recursive redaction.
- [ ] **Step 2: Run focused tests** and verify missing primitives.
- [ ] **Step 3: Implement primitives using Node crypto with key-version envelopes.**
- [ ] **Step 4: Run focused tests and API suite.**
- [ ] **Step 5: Commit** with `git commit -m "feat: secure remote device credentials"`.

### Task 5: Enrollment Service And Route

**Files:**
- Create: `apps/api/src/repositories/enrollment.ts`
- Create: `apps/api/src/repositories/audit.ts`
- Create: `apps/api/src/services/enroll-device.ts`
- Create: `apps/api/src/routes/agent-enroll.ts`
- Test: `apps/api/src/services/enroll-device.test.ts`
- Test: `apps/api/src/routes/agent-enroll.test.ts`

**Interfaces:**
- Consumes: `EnrollRequest`, enrollment token, repositories, and crypto primitives.
- Produces: one-time `EnrollResponse` and audited idempotent device state.

- [ ] **Step 1: Write failing service tests** for success, retry, expiry, exhaustion, inactive token, duplicate device, and each partial-failure compensation point.
- [ ] **Step 2: Write failing route tests** for validation, rate-limit behavior, source IP, and redacted failures.
- [ ] **Step 3: Run focused tests** and verify expected failures.
- [ ] **Step 4: Implement repositories, service orchestration, audit, and route.**
- [ ] **Step 5: Run API suite and typecheck.**
- [ ] **Step 6: Commit** with `git commit -m "feat: enroll remote devices"`.

### Task 6: Device Authentication And Heartbeat

**Files:**
- Create: `apps/api/src/plugins/device-auth.ts`
- Create: `apps/api/src/services/record-heartbeat.ts`
- Create: `apps/api/src/routes/agent-heartbeat.ts`
- Test: `apps/api/src/routes/agent-heartbeat.test.ts`

**Interfaces:**
- Consumes: bearer device token and `HeartbeatRequest`.
- Produces: updated `last_seen_at`, metadata, token `last_used_at`, and audit event.

- [ ] **Step 1: Write failing tests** for valid heartbeat, malformed bearer token, revoked token, disabled device, metadata limits, and timestamp controlled by server.
- [ ] **Step 2: Run focused tests** and verify missing behavior.
- [ ] **Step 3: Implement authentication plugin, service, and route.**
- [ ] **Step 4: Run full workspace tests, lint, typecheck, and build.**
- [ ] **Step 5: Commit** with `git commit -m "feat: record remote device heartbeats"`.

### Task 7: Coolify Deployment

**Files:**
- Create: `docs/operations/remote-api.md`
- Modify: `apps/api/Dockerfile`

**Interfaces:**
- Consumes: GitHub repository, Appwrite production secrets, and Coolify `Remote Platform/production`.
- Produces: healthy HTTPS API deployment and redacted verification report.

- [ ] **Step 1: Run all workspace verification commands and build the production image.**
- [ ] **Step 2: Create/configure the Git-backed Coolify application and secrets after action-time approval for the new Appwrite key.**
- [ ] **Step 3: Deploy and verify running status, clean logs, HTTPS, and exact `/health` response.**
- [ ] **Step 4: Exercise enrollment and heartbeat against production with a generated test organization/token.**
- [ ] **Step 5: Commit redacted operations documentation** with `git commit -m "docs: document remote api operations"`.
