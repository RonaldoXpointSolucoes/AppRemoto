# Remote Panel And Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the technician panel, then verify the full production milestone including RustDesk connectivity.

**Architecture:** Next.js uses the Appwrite Web SDK for session creation and a typed API client for all operational data. Server/client boundaries prevent secret exposure; device state is rendered from safe API projections. Production acceptance combines automated browser coverage with real Windows/RustDesk evidence.

**Tech Stack:** Next.js, React, TypeScript, Appwrite Web SDK, TanStack Query, Vitest, Testing Library, Playwright, Lucide.

**Spec:** `docs/superpowers/specs/2026-09-29-remote-platform-mvp-design.md`

## Global Constraints

- No marketing landing page; `/login` is the first unauthenticated screen.
- Panel receives only public Appwrite configuration and API base URL.
- Never render or log tokens, passwords, API keys, ciphertext, or internal IP data.
- Desktop table and mobile records preserve the same information hierarchy.
- Filters persist during refresh; online threshold comes from API output.

## Review Focus

- Expired Appwrite session redirects without an infinite refresh loop.
- Slow/error refresh keeps filters and avoids stale `ONLINE` misrepresentation.
- Long names/IDs fit without overlap on mobile and desktop.
- Empty organization access and empty device lists have distinct states.
- Search and filters compose correctly and reset pagination predictably.

---

### Task 1: Panel Skeleton And Session Boundary

**Files:**
- Create: `apps/panel/package.json`
- Create: `apps/panel/next.config.ts`
- Create: `apps/panel/src/app/layout.tsx`
- Create: `apps/panel/src/lib/config.ts`
- Create: `apps/panel/src/lib/appwrite.ts`
- Create: `apps/panel/src/lib/api.ts`
- Create: `apps/panel/Dockerfile`
- Test: `apps/panel/src/lib/config.test.ts`

**Interfaces:**
- Consumes: public Appwrite endpoint/project ID and API base URL.
- Produces: validated public config, Appwrite account client, and typed API client.

- [ ] **Step 1: Write failing tests** for missing/invalid public configuration and API error normalization.
- [ ] **Step 2: Run panel tests** and verify missing modules.
- [ ] **Step 3: Implement panel skeleton, clients, styling foundation, and Dockerfile.**
- [ ] **Step 4: Run tests, typecheck, and production build.**
- [ ] **Step 5: Commit** with `git commit -m "feat: initialize remote technician panel"`.

### Task 2: Login Flow

**Files:**
- Create: `apps/panel/src/app/login/page.tsx`
- Create: `apps/panel/src/features/auth/login-form.tsx`
- Create: `apps/panel/src/features/auth/session.ts`
- Test: `apps/panel/src/features/auth/login-form.test.tsx`
- Test: `apps/panel/e2e/login.spec.ts`

**Interfaces:**
- Consumes: Appwrite account session and `/v1/me`.
- Produces: authenticated redirect to `/devices` and stable invalid/disabled/expired states.

- [ ] **Step 1: Write failing component tests** for validation, pending state, invalid credentials, disabled profile, and success.
- [ ] **Step 2: Write failing browser tests** for unauthenticated redirect and session expiry.
- [ ] **Step 3: Run focused tests** and verify failures.
- [ ] **Step 4: Implement login and session boundary.**
- [ ] **Step 5: Run panel unit and browser tests.**
- [ ] **Step 6: Commit** with `git commit -m "feat: add technician login"`.

### Task 3: Device View, Search, And Filters

**Files:**
- Create: `apps/panel/src/app/devices/page.tsx`
- Create: `apps/panel/src/features/devices/device-table.tsx`
- Create: `apps/panel/src/features/devices/device-record.tsx`
- Create: `apps/panel/src/features/devices/device-filters.tsx`
- Create: `apps/panel/src/features/devices/use-devices.ts`
- Test: `apps/panel/src/features/devices/device-table.test.tsx`
- Test: `apps/panel/e2e/devices.spec.ts`

**Interfaces:**
- Consumes: `/v1/organizations` and paginated `/v1/devices` safe projections.
- Produces: responsive device list with retained organization/status/search filters.

- [ ] **Step 1: Write failing component tests** for columns, mobile fields, long values, loading, empty, unauthorized, error, and refresh.
- [ ] **Step 2: Write failing interaction tests** for combined filters, search, pagination reset, and retained state.
- [ ] **Step 3: Run focused tests** and verify failures.
- [ ] **Step 4: Implement query hook, filters, desktop table, and mobile record layout.**
- [ ] **Step 5: Run unit and browser tests at desktop/mobile viewports.**
- [ ] **Step 6: Commit** with `git commit -m "feat: show and filter remote devices"`.

### Task 4: Visual And Accessibility Verification

**Files:**
- Modify: `apps/panel/e2e/devices.spec.ts`
- Create: `apps/panel/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: complete login/devices UI.
- Produces: screenshot and accessibility assertions at supported viewports.

- [ ] **Step 1: Add failing tests** for keyboard flow, labels, focus, color-independent status, overflow, and stable dimensions.
- [ ] **Step 2: Run browser tests and capture baseline failures.**
- [ ] **Step 3: Apply minimal UI fixes required by the tests.**
- [ ] **Step 4: Run complete panel tests/build and inspect desktop/mobile screenshots.**
- [ ] **Step 5: Commit** with `git commit -m "test: verify panel accessibility and layout"`.

### Task 5: Coolify Panel Deployment

**Files:**
- Create: `docs/operations/remote-panel.md`

**Interfaces:**
- Consumes: GitHub repository, public Appwrite config, API URL, and Coolify `Remote Platform/production`.
- Produces: healthy HTTPS panel deployment.

- [ ] **Step 1: Run full workspace tests, lint, typecheck, builds, Go tests/vet, and secret scan.**
- [ ] **Step 2: Push the reviewed branch and create/configure the Git-backed Coolify panel application.**
- [ ] **Step 3: Deploy and verify running status, clean logs, HTTPS, login, and device view.**
- [ ] **Step 4: Commit redacted deployment documentation** with `git commit -m "docs: document remote panel deployment"`.

### Task 6: Production Enrollment And Presence Acceptance

**Files:**
- Local only: `.local/remote-platform/acceptance/`
- Modify: `.local/fila-dev/reports/ca976e88-ed95-457a-83f7-b2748de1828c.json`

**Interfaces:**
- Consumes: administrator login, production API/panel, Windows agent, and test organization enrollment token.
- Produces: evidence of empty state, enrollment, `ONLINE`, `OFFLINE`, recovery, filters, and search.

- [ ] **Step 1: Log in as the dedicated administrator and verify the initial empty device state.**
- [ ] **Step 2: Create a test organization and one-use enrollment token without storing plaintext in reports.**
- [ ] **Step 3: Enroll the Windows test device and verify exactly one device appears `ONLINE`.**
- [ ] **Step 4: Verify search and organization/status filters.**
- [ ] **Step 5: Stop heartbeats for more than 90 seconds, verify `OFFLINE`, resume, and verify `ONLINE`.**

### Task 7: RustDesk And Queue Delivery Acceptance

**Files:**
- Local only: `.local/remote-platform/acceptance/rustdesk.json`
- Modify: `.local/fila-dev/reports/ca976e88-ed95-457a-83f7-b2748de1828c.json`

**Interfaces:**
- Consumes: two Windows clients/VMs, RustDesk server public address/key, and completed platform milestone.
- Produces: external port evidence, P2P/relay session evidence, final redacted card report, and confirmed transition to `testing`.

- [ ] **Step 1: Verify 21115/TCP, 21116/TCP+UDP, and 21117/TCP externally.**
- [ ] **Step 2: Configure two RustDesk clients and complete a session, including relay behavior.**
- [ ] **Step 3: Run every repository verification command fresh and record exact outcomes.**
- [ ] **Step 4: Review every acceptance criterion against evidence and keep the card in Development if any criterion is unmet.**
- [ ] **Step 5: When complete, submit the final queue report, move the card to `testing`, and confirm status by GET.**
