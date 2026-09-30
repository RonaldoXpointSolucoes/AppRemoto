# Remote Platform MVP Design

## Purpose

Build the first operational milestone of the Remote Platform: a technician can authenticate, see organizations and devices, enroll a Windows device through an agent, observe heartbeats in the panel, and use the existing self-hosted RustDesk server for remote access.

This milestone runs against the production Appwrite project `default-6abc5640003cb361b809` and the Coolify project `Remote Platform`, environment `production`. Existing Appwrite, Coolify, and unrelated application resources must remain untouched unless this specification names them explicitly.

## Delivery Strategy

The system will be delivered as vertical, independently verifiable slices:

1. Repository and Appwrite foundation.
2. Minimal API and device enrollment.
3. Windows agent and heartbeat.
4. Technician panel.
5. Production deployment and end-to-end validation.

Each slice must leave working, testable software. No slice may be reported as complete based only on scaffolding or mocked acceptance evidence.

## Repository

The GitHub repository is `RonaldoXpointSolucoes/AppRemoto`. It is a monorepo with these ownership boundaries:

- `apps/api`: Fastify, Node.js, and TypeScript API.
- `apps/panel`: Next.js, React, and TypeScript technician panel.
- `services/agent`: Go Windows agent.
- `packages/contracts`: shared request, response, and validation contracts for TypeScript consumers.
- `infra/appwrite`: schema documentation and idempotent provisioning tools.
- `infra/rustdesk`: pinned RustDesk Server Compose configuration.
- `docs`: architecture, operations, testing, and delivery evidence that contains no secrets.

Secrets, generated credentials, CRM responses, and local delivery reports stay under `.local/`, which is excluded from Git.

## System Architecture

Appwrite is the identity and persistence system. The browser uses the Appwrite Web SDK only to create and maintain the technician session. All operational data is retrieved through `remote-api`; the panel never reads sensitive collections directly.

`remote-api` uses the Appwrite Server SDK with a project-specific API key stored as a Coolify secret. It validates technician sessions, enforces organization membership, handles agent enrollment and authentication, encrypts credentials, writes audit events, and returns safe data projections.

The Windows agent communicates only with `remote-api` over HTTPS. It stores its long-lived device token with Windows DPAPI, configures the local RustDesk unattended password, and sends heartbeats on a controlled retry schedule.

The existing `rustdesk-server-oss` service remains a separate Coolify service. Its pinned server image, state volumes, and public TCP/UDP ports are not coupled to API or panel deployments.

## Appwrite Project And Bootstrap Identity

The production target is Appwrite project `default-6abc5640003cb361b809`. Credentials belonging to other projects, including `chatboot-production`, must not be reused.

The initial technical administrator is `remote.admin@xpointsolucoes.com.br`. Provisioning generates a cryptographically random password. The plaintext password is never committed, posted to the board, or logged. The local bootstrap artifact is encrypted with Windows DPAPI and stored under `.local/remote-platform/`.

Creating the project-specific Appwrite API key and the initial administrator is an action-time privileged operation. It must use minimum necessary scopes and must be verified against the target project before provisioning data.

## Data Model

The database ID is `remote_management`. Collection access is deny-by-default; sensitive collections are accessible only through the Server SDK.

### `organizations`

Stores `name`, unique `slug`, and `active`. Organization IDs are immutable.

### `technician_profiles`

Stores unique `user_id`, `display_name`, `global_role`, and `active`. The supported global role for this milestone is `super_admin`; other technicians receive organization-scoped authorization through membership documents.

### `organization_members`

Stores `organization_id`, `user_id`, `role`, `can_view`, `can_connect`, and `can_manage_devices`. The pair `organization_id + user_id` is unique.

### `devices`

Stores `organization_id`, unique organization-scoped `device_uuid`, `display_name`, `hostname`, `rustdesk_id`, OS and version fields, agent and RustDesk versions, `last_seen_at`, `last_ip`, and `enabled`.

The API reports a device as `ONLINE` when `last_seen_at` is no more than 90 seconds old and the device is enabled. Otherwise it reports `OFFLINE`.

### `device_tokens`

Stores `device_id`, SHA-256 `token_hash`, `last_used_at`, and `revoked_at`. Plaintext device tokens are returned only once during enrollment.

### `device_credentials`

Stores `device_id`, AES-256-GCM `password_ciphertext`, `password_nonce`, `password_tag`, and `key_version`. The master encryption key exists only as a Coolify secret.

### `enrollment_tokens`

Stores `organization_id`, SHA-256 `token_hash`, `expires_at`, `max_uses`, `use_count`, `active`, and `created_by_user_id`. Plaintext enrollment tokens are returned only at creation.

### `connection_sessions`

Stores `organization_id`, `device_id`, `technician_user_id`, SHA-256 `connect_token_hash`, `expires_at`, `redeemed_at`, `status`, and `source_ip`.

### `audit_logs`

Stores `organization_id`, `actor_type`, `actor_id`, optional `device_id`, `action`, `result`, `source_ip`, and serialized non-secret `metadata_json`.

## Provisioning

The Appwrite provisioner is idempotent. Repeated execution must reconcile the named database, collections, attributes, indexes, and bootstrap identity without duplicating them. It must fail closed on incompatible existing attributes or indexes and report the exact conflict rather than deleting or recreating production data.

Provisioning is split into inspect, plan, and apply phases. The inspect and plan phases are read-only. Apply creates only missing compatible resources and records a redacted execution report locally.

## API

The API exposes:

- `GET /health`: returns `{ "status": "ok" }` without authentication.
- `GET /v1/me`: returns the active technician profile and effective authorization.
- `GET /v1/organizations`: returns organizations visible to the technician.
- `GET /v1/devices`: supports pagination, organization filter, `ONLINE` or `OFFLINE` filter, and search by display name, hostname, or RustDesk ID.
- `POST /v1/agent/enroll`: exchanges a valid enrollment token and stable device identity for device credentials.
- `POST /v1/agent/heartbeat`: authenticates a device token and updates presence and version metadata.

Technician routes validate the current Appwrite session on the server. Agent routes use `Authorization: Bearer <device_token>`. Authorization is evaluated for every request; the API never trusts organization identifiers supplied by a client without checking effective access.

Enrollment is idempotent for `organization_id + device_uuid`. The operation validates token activity, expiry, and remaining uses; creates or updates the device; issues and hashes a new device token; generates and encrypts the unattended password; increments token usage; and writes an audit event. Partial failure must not consume a token without producing a usable enrollment result. Retries must not create duplicate devices.

Input schemas reject unknown fields, oversized values, invalid timestamps, malformed authorization, and ambiguous filters. Errors use stable machine-readable codes and do not reveal hashes, ciphertext, secrets, or cross-organization existence.

## Windows Agent

The agent:

1. Loads or creates a stable device UUID.
2. Reads hostname and Windows version.
3. Locates RustDesk and reads its ID and version through supported local interfaces.
4. Enrolls once with an enrollment token supplied at first run.
5. Protects the returned device token with current-user Windows DPAPI.
6. Sets the RustDesk unattended password without printing it.
7. Sends heartbeats approximately every 30 seconds.

Heartbeat scheduling includes bounded jitter and exponential backoff. Successful communication resets backoff. Network loss does not erase identity or credentials, and process restart resumes from the protected local state.

The first milestone is manually executable and does not include an installer, background Windows service, automatic upgrades, or fleet-wide rollout.

## Technician Panel

The panel is an operational interface, not a marketing site.

`/login` authenticates through Appwrite and handles invalid credentials, disabled profiles, and expired sessions. `/devices` displays a stable responsive table with display name, organization, hostname, operating system, RustDesk ID, online state, and last activity.

The device view includes organization and online-state filters plus a single search field for display name, hostname, or RustDesk ID. Refreshes retain filters and do not resize or reorder the interface unexpectedly. Loading, empty, unauthorized, session-expired, and recoverable-error states are explicit.

Desktop uses a compact table. Small screens use compact record blocks that preserve the same information hierarchy. Lucide icons support familiar actions. The panel never renders device tokens, enrollment tokens, unattended passwords, internal IP data, API keys, or sensitive audit metadata.

## Deployment

`remote-api` and `remote-panel` are separate Git-backed Coolify applications in project `Remote Platform`, environment `production`. Both deploy from the repository default branch after tests and builds pass.

The API receives Appwrite endpoint, project ID, project-specific API key, master encryption key, allowed origins, and operational settings through Coolify environment variables. Secret values are marked secret and excluded from build logs. The panel receives only public Appwrite endpoint/project values and the public API base URL.

The API and panel receive separate temporary HTTPS domains managed by Coolify. The API health endpoint is used for deployment health verification. Deployment does not mutate unrelated projects, services, domains, databases, or proxy settings.

## Error Handling And Audit

Authentication and authorization failures return generic responses while recording a redacted reason in audit logs. Enrollment replay, expired tokens, disabled devices, revoked device tokens, Appwrite unavailability, encryption failure, and RustDesk command failure each have explicit behavior and tests.

Logs are structured and redact authorization headers, cookies, passwords, tokens, keys, ciphertext, and nonessential personal data. Source IP is stored only where the schema requires it for security review.

## Verification

Development follows test-driven development. Every behavioral change begins with a failing test, followed by the minimum implementation and a complete green test run.

Verification gates are:

- Appwrite: schema contract tests, dry-run output, idempotent apply, and post-apply inventory.
- API: unit and integration coverage for session validation, tenant isolation, enrollment, token lifecycle, heartbeat, online threshold, filtering, and redaction.
- Agent: Go tests for stable identity, DPAPI storage, RustDesk discovery/command invocation, heartbeat, jitter, backoff, and restart recovery; reproducible Windows build.
- Panel: component and browser tests for login, session expiry, table data, filtering, search, loading, empty, error, and responsive layouts.
- Coolify: successful builds, running applications, clean startup logs, HTTPS, and `GET /health` returning the exact expected body.
- End-to-end: create an organization and enrollment token, enroll a Windows test device, observe heartbeats and `ONLINE`, stop heartbeats for more than 90 seconds and observe `OFFLINE`, then recover to `ONLINE`.
- RustDesk: verify required TCP and UDP ports from outside the VPS and complete a real session between two configured clients, including relay behavior.

Tests requiring two Windows systems or VMs are recorded as manual acceptance evidence. They cannot be replaced by mocked results.

## Out Of Scope

- Production completion workflow beyond delivery to Testes & QA.
- Billing, subscriptions, customer self-service, and technician invitations.
- Windows installer, service manager, auto-update, or code signing.
- Browser-based remote control or embedded RustDesk client.
- Connection-session redemption UI.
- Multi-region deployment, high availability, and disaster recovery automation.
- Changes to unrelated Coolify projects or the existing ChatBoot Appwrite project.

## Acceptance Boundary

The card is ready for Testes & QA only when the production Appwrite schema and bootstrap administrator are verified, API and panel are deployed and healthy, the Windows agent completes the enrollment/heartbeat/offline-recovery flow, organization isolation and secret redaction tests pass, and the real two-client RustDesk test has evidence. Any unmet external test remains documented as a blocker while the card stays in Development.
