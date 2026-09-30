# Windows Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manually executable Windows agent that enrolls, protects credentials with DPAPI, configures RustDesk, and maintains heartbeats.

**Architecture:** Small Go packages isolate persisted state, Windows DPAPI, RustDesk discovery/commands, API transport, and scheduling. The command coordinates these interfaces and never logs secrets.

**Tech Stack:** Go 1.26, standard library, Windows DPAPI, Go test.

**Spec:** `docs/superpowers/specs/2026-09-29-remote-platform-mvp-design.md`

## Global Constraints

- Windows is the supported runtime for this milestone.
- Device token plaintext exists only in memory and DPAPI input/output boundaries.
- Enrollment token is accepted only on first enrollment and is never persisted.
- Heartbeat target is 30 seconds with bounded jitter and exponential backoff.
- No installer, Windows service, auto-update, or code signing in this milestone.

## Review Focus

- Corrupted DPAPI state fails safely without silently re-enrolling.
- RustDesk missing or unsupported returns an actionable non-secret error.
- API timeout and offline periods preserve identity and recover automatically.
- Process restart reuses the same UUID/token and resets no server credentials.
- Command output and errors never include enrollment token, device token, or password.

---

### Task 1: Go Module And Stable Identity

**Files:**
- Create: `services/agent/go.mod`
- Create: `services/agent/internal/state/identity.go`
- Test: `services/agent/internal/state/identity_test.go`

**Interfaces:**
- Produces: `LoadOrCreateIdentity(path string) (Identity, error)` with stable UUID.

- [ ] **Step 1: Write failing tests** for first creation, reload, atomic write, malformed state, and restrictive file permissions.
- [ ] **Step 2: Run `go test ./internal/state`** and verify missing implementation failure.
- [ ] **Step 3: Implement minimal identity persistence.**
- [ ] **Step 4: Run tests and `go vet ./...`.**
- [ ] **Step 5: Commit** with `git commit -m "feat: persist remote agent identity"`.

### Task 2: DPAPI Secret Store

**Files:**
- Create: `services/agent/internal/secret/store_windows.go`
- Create: `services/agent/internal/secret/store_stub.go`
- Test: `services/agent/internal/secret/store_windows_test.go`

**Interfaces:**
- Produces: `Protect([]byte) ([]byte,error)` and `Unprotect([]byte) ([]byte,error)` scoped to current Windows user.

- [ ] **Step 1: Write Windows-only failing tests** for round trip, tamper failure, and absence of plaintext in the saved blob.
- [ ] **Step 2: Run `go test ./internal/secret` on Windows** and verify missing implementation failure.
- [ ] **Step 3: Implement DPAPI wrappers and explicit non-Windows unsupported behavior.**
- [ ] **Step 4: Run package tests and cross-compile checks.**
- [ ] **Step 5: Commit** with `git commit -m "feat: protect agent secrets with dpapi"`.

### Task 3: RustDesk Discovery And Password Configuration

**Files:**
- Create: `services/agent/internal/rustdesk/client.go`
- Create: `services/agent/internal/rustdesk/exec.go`
- Test: `services/agent/internal/rustdesk/client_test.go`

**Interfaces:**
- Produces: `Discover(ctx) (Info,error)` and `SetUnattendedPassword(ctx,password) error` behind an injected command runner.

- [ ] **Step 1: Write failing tests** for supported install paths, missing binary, ID/version parsing, timeout, nonzero exit, and password redaction.
- [ ] **Step 2: Run focused tests** and verify missing behavior.
- [ ] **Step 3: Implement discovery and command execution without shell interpolation.**
- [ ] **Step 4: Run package and full agent tests.**
- [ ] **Step 5: Commit** with `git commit -m "feat: integrate agent with rustdesk"`.

### Task 4: API Client And Enrollment

**Files:**
- Create: `services/agent/internal/api/client.go`
- Create: `services/agent/internal/enroll/service.go`
- Test: `services/agent/internal/api/client_test.go`
- Test: `services/agent/internal/enroll/service_test.go`

**Interfaces:**
- Consumes: API contracts expressed as Go structs compatible with `packages/contracts` JSON.
- Produces: enrollment exchange and DPAPI-protected persisted device token.

- [ ] **Step 1: Write failing HTTP tests** for payload shape, deadlines, status mapping, malformed responses, and secret-free errors.
- [ ] **Step 2: Write failing enrollment orchestration tests** for first run, existing state, DPAPI failure, and RustDesk password failure.
- [ ] **Step 3: Run focused tests** and verify failures.
- [ ] **Step 4: Implement client and enrollment orchestration.**
- [ ] **Step 5: Run all agent tests and vet.**
- [ ] **Step 6: Commit** with `git commit -m "feat: enroll windows remote agent"`.

### Task 5: Heartbeat Scheduler And CLI

**Files:**
- Create: `services/agent/internal/heartbeat/scheduler.go`
- Create: `services/agent/cmd/remote-agent/main.go`
- Test: `services/agent/internal/heartbeat/scheduler_test.go`
- Test: `services/agent/cmd/remote-agent/main_test.go`

**Interfaces:**
- Consumes: protected device token, API heartbeat endpoint, and RustDesk/system metadata.
- Produces: manual command `remote-agent enroll` and long-running `remote-agent run`.

- [ ] **Step 1: Write failing deterministic-clock tests** for 30-second target, jitter bounds, exponential cap, reset after success, cancellation, and retry recovery.
- [ ] **Step 2: Write failing CLI tests** for required flags, redaction, existing enrollment, and graceful shutdown.
- [ ] **Step 3: Run focused tests** and verify failures.
- [ ] **Step 4: Implement scheduler and CLI wiring.**
- [ ] **Step 5: Run `go test ./...`, `go vet ./...`, and Windows build.**
- [ ] **Step 6: Commit** with `git commit -m "feat: send resilient agent heartbeats"`.

### Task 6: Windows Integration Verification

**Files:**
- Create: `docs/operations/windows-agent.md`
- Local only: `.local/remote-platform/agent-test/`

**Interfaces:**
- Consumes: production API, enrollment token, and installed RustDesk client.
- Produces: redacted evidence for enrollment, DPAPI persistence, heartbeat, offline/backoff, restart, and RustDesk configuration.

- [ ] **Step 1: Enroll a Windows test machine and verify one device document and protected local state.**
- [ ] **Step 2: Verify heartbeat updates and panel `ONLINE` status.**
- [ ] **Step 3: Disconnect networking, verify bounded backoff and `OFFLINE` after 90 seconds, then reconnect and verify recovery.**
- [ ] **Step 4: Restart the agent and verify identity/token reuse.**
- [ ] **Step 5: Commit redacted operations documentation** with `git commit -m "docs: document windows agent operations"`.
