# Remote Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the monorepo, shared contracts, idempotent Appwrite schema provisioning, and the encrypted bootstrap administrator artifact.

**Architecture:** A pnpm workspace owns TypeScript contracts and provisioning. Provisioning has inspect, plan, and apply phases behind an Appwrite gateway so reconciliation logic can be tested without production writes. Production apply uses only project `default-6abc5640003cb361b809`.

**Tech Stack:** Node.js 24, TypeScript, pnpm, Vitest, Zod, Appwrite Node SDK, PowerShell DPAPI wrapper.

**Spec:** `docs/superpowers/specs/2026-09-29-remote-platform-mvp-design.md`

## Global Constraints

- Never reuse credentials from `chatboot-production`.
- Never print or commit API keys, passwords, tokens, ciphertext, or DPAPI payload plaintext.
- Appwrite production changes require an inspect/plan result before apply.
- Provisioning must fail closed on incompatible existing schema.
- `.local/` remains excluded from Git.

## Review Focus

- Existing incompatible attribute: plan reports conflict and apply performs no deletion.
- Interrupted provisioning: rerun converges without duplicate resources.
- Wrong Appwrite project ID: command aborts before writes.
- Existing administrator email: bootstrap links the profile without resetting credentials.
- Redaction: reports contain resource IDs and outcomes but no secret values.

---

### Task 1: Repository Workspace And Toolchain

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.editorconfig`
- Modify: `.gitignore`
- Test: `tests/workspace.test.mjs`

**Interfaces:**
- Consumes: none.
- Produces: workspace commands `lint`, `typecheck`, `test`, and `build` used by later plans.

- [ ] **Step 1: Write `tests/workspace.test.mjs`** asserting workspace package globs, Node 24 engine, and required root scripts.
- [ ] **Step 2: Run `node --test tests/workspace.test.mjs`** and verify failure because root manifests do not exist.
- [ ] **Step 3: Add the minimal workspace manifests and scripts.**
- [ ] **Step 4: Run `node --test tests/workspace.test.mjs`** and verify pass.
- [ ] **Step 5: Commit** with `git commit -m "build: initialize remote platform workspace"`.

### Task 2: Shared HTTP Contracts

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/devices.ts`
- Create: `packages/contracts/src/agent.ts`
- Test: `packages/contracts/src/contracts.test.ts`

**Interfaces:**
- Consumes: workspace TypeScript configuration.
- Produces: `DeviceListQuerySchema`, `DeviceViewSchema`, `EnrollRequestSchema`, `EnrollResponseSchema`, `HeartbeatRequestSchema`, and `ApiErrorSchema`.

- [ ] **Step 1: Write failing contract tests** for unknown-field rejection, length limits, status enum, enrollment payload, and heartbeat versions.
- [ ] **Step 2: Run `pnpm --filter @appremoto/contracts test`** and verify failure because schemas are missing.
- [ ] **Step 3: Implement the exported Zod schemas and inferred types.**
- [ ] **Step 4: Run the package tests and root `pnpm typecheck`** and verify pass.
- [ ] **Step 5: Commit** with `git commit -m "feat: define remote platform contracts"`.

### Task 3: Declarative Appwrite Schema

**Files:**
- Create: `infra/appwrite/package.json`
- Create: `infra/appwrite/src/schema.ts`
- Create: `infra/appwrite/schema.md`
- Test: `infra/appwrite/src/schema.test.ts`

**Interfaces:**
- Consumes: exact collection names and fields from the spec.
- Produces: immutable `REMOTE_MANAGEMENT_SCHEMA` with database, collection, attribute, and index definitions.

- [ ] **Step 1: Write failing schema tests** asserting all nine collections, required types, uniqueness rules, and deny-by-default permissions.
- [ ] **Step 2: Run `pnpm --filter @appremoto/appwrite test -- schema.test.ts`** and verify missing schema failure.
- [ ] **Step 3: Implement `REMOTE_MANAGEMENT_SCHEMA` and generate matching human-readable `schema.md`.**
- [ ] **Step 4: Run package tests and verify the generated documentation is current.**
- [ ] **Step 5: Commit** with `git commit -m "feat: define appwrite remote management schema"`.

### Task 4: Inspect And Reconciliation Planner

**Files:**
- Create: `infra/appwrite/src/gateway.ts`
- Create: `infra/appwrite/src/inspect.ts`
- Create: `infra/appwrite/src/plan.ts`
- Create: `infra/appwrite/src/redact.ts`
- Test: `infra/appwrite/src/plan.test.ts`

**Interfaces:**
- Consumes: `REMOTE_MANAGEMENT_SCHEMA` and `AppwriteGateway` inventory methods.
- Produces: `buildProvisionPlan(actual, desired): ProvisionPlan` with `create`, `unchanged`, and `conflict` actions.

- [ ] **Step 1: Write failing tests** for empty project, partial compatible schema, incompatible attribute, duplicate index, and redacted report output.
- [ ] **Step 2: Run the focused Vitest file** and verify failures are caused by missing planner behavior.
- [ ] **Step 3: Implement the gateway interface, inventory normalization, planner, and redactor.**
- [ ] **Step 4: Run focused and package tests** and verify pass.
- [ ] **Step 5: Commit** with `git commit -m "feat: plan idempotent appwrite provisioning"`.

### Task 5: Apply Provisioning And Bootstrap Administrator

**Files:**
- Create: `infra/appwrite/src/apply.ts`
- Create: `infra/appwrite/src/bootstrap-admin.ts`
- Create: `infra/appwrite/src/cli.ts`
- Create: `infra/appwrite/scripts/protect-secret.ps1`
- Test: `infra/appwrite/src/apply.test.ts`
- Test: `infra/appwrite/src/bootstrap-admin.test.ts`

**Interfaces:**
- Consumes: conflict-free `ProvisionPlan`, project-scoped Appwrite key, and email `remote.admin@xpointsolucoes.com.br`.
- Produces: idempotent schema apply, administrator/profile reconciliation, and DPAPI artifact under `.local/remote-platform/`.

- [ ] **Step 1: Write failing apply tests** proving ordered resource creation, no writes on conflicts, and safe rerun after interruption.
- [ ] **Step 2: Write failing bootstrap tests** proving random password generation, existing-user behavior, profile creation, and absence of plaintext in reports.
- [ ] **Step 3: Run both focused test files** and verify expected failures.
- [ ] **Step 4: Implement apply, bootstrap, CLI modes `inspect|plan|apply`, and the DPAPI helper.**
- [ ] **Step 5: Run package tests, root typecheck, and a non-production fake-gateway apply.**
- [ ] **Step 6: Commit** with `git commit -m "feat: provision appwrite foundation safely"`.

### Task 6: Production Foundation Verification

**Files:**
- Create: `docs/operations/appwrite-provisioning.md`
- Local only: `.local/remote-platform/appwrite-plan.json`
- Local only: `.local/remote-platform/bootstrap-admin.dpapi`

**Interfaces:**
- Consumes: approved project-specific Appwrite API key.
- Produces: verified production inventory and encrypted bootstrap login artifact.

- [ ] **Step 1: Run the CLI in `inspect` and `plan` mode** against project `default-6abc5640003cb361b809`; verify no unrelated resource appears in the plan.
- [ ] **Step 2: Review conflicts and stop if any destructive reconciliation would be required.**
- [ ] **Step 3: Run `apply` once approved at action time, then rerun `plan`.**
- [ ] **Step 4: Verify the second plan contains only `unchanged` actions and the administrator profile is `super_admin`.**
- [ ] **Step 5: Add redacted operational instructions and commit** with `git commit -m "docs: document appwrite provisioning"`.
