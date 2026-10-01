# Technician Setup Design

## Purpose

Turn the existing device directory into a usable technician workflow. An authorized technician must be able to prepare a Windows customer computer, register it in the correct organization, wait for it to become available, and start a RustDesk connection from the device list with one command-driven setup and one connection action.

This design extends the deployed AppRemoto MVP. It does not replace Appwrite, Coolify, the existing API authorization model, or the self-hosted RustDesk OSS server.

## Current State

The operational panel currently contains `/login` and `/devices`. It can list devices and report heartbeat-derived status, but it has no enrollment-token creation route, no guided setup page, no downloadable installation workflow, and no connect action.

The Windows agent can enroll, protect its device token with DPAPI, configure the RustDesk unattended password, and send heartbeats. It does not install RustDesk, apply the self-hosted server configuration, install itself for automatic startup, or expose a technician-facing setup package.

The supporting administration consoles remain separate:

- AppRemoto panel: daily technician operations.
- Appwrite Console: identity, database, and project administration.
- Coolify: deployments, services, configuration, and logs.

The AppRemoto panel will link to the two administration consoles for super administrators, but it will not embed or duplicate them.

## Chosen Approach

Implement an integrated Setup wizard in AppRemoto. The alternatives rejected for this milestone are a documentation-only wizard, which does not produce the requested operational result, and a signed MSI package, which adds packaging and certificate work that can follow after the core flow is proven.

The integrated flow uses:

1. An operator API for creating a short-lived, single-use enrollment token.
2. A generated PowerShell bootstrap script that keeps the token out of URLs and command-line arguments.
3. The official RustDesk Windows distribution and supported command-line configuration.
4. The existing AppRemoto Windows agent, extended to support machine installation and automatic heartbeat startup.
5. A live completion check in the Setup page.
6. A guarded connection API and a RustDesk protocol launch from the device directory.

## Navigation And Roles

The authenticated header has two primary destinations: `Dispositivos` and `Setup`. Logout remains an icon action on the right.

`Setup` is visible only when the effective technician authorization includes `canManageDevices` for at least one active organization or the technician is a `super_admin`. The API independently enforces the same rule. A technician with `canConnect` can use connection actions for authorized organizations even when Setup is unavailable.

Super administrators also receive a compact administration menu containing external links to the Appwrite Console and Coolify. These links open in a new tab and are not presented as additional AppRemoto panels.

## Setup Wizard

The wizard is a focused page at `/setup`, not a marketing page. It uses a stable stepper and keeps completed steps visible.

### Step 1: Customer

The technician selects an authorized organization and enters the customer-facing device name. The page explains only the information required to make the choice; it does not expose internal IDs.

### Step 2: Installation Package

The technician selects `Gerar instalacao`. The panel calls the operator enrollment endpoint and receives a plaintext enrollment token exactly once. The token expires after 30 minutes, has `max_uses=1`, and is scoped to the selected organization.

The browser creates a local PowerShell setup file from a fixed reviewed template plus the one-time token. The token is placed inside the downloaded script body, never in a query string, filename, analytics event, console message, or visible command. The API response and page use `Cache-Control: no-store`; the in-memory token is cleared when the download is created or the wizard is abandoned.

The page presents one primary instruction: run the downloaded script as Administrator on the customer computer. Manual commands remain behind a troubleshooting disclosure.

### Step 3: Automated Windows Setup

The PowerShell bootstrap performs a bounded, fail-fast sequence:

1. Verify Administrator elevation and supported 64-bit Windows.
2. Download the pinned official RustDesk installer from its official release source over HTTPS.
3. Verify the pinned SHA-256 digest before execution.
4. Install RustDesk silently when a supported installation is not already present.
5. Download the versioned AppRemoto agent from the panel origin and verify its pinned SHA-256 digest.
6. Apply the approved RustDesk self-hosted configuration using its supported command line, including the ID server and public encryption key.
7. Enroll the machine by piping the one-time token to the agent through standard input.
8. Install the agent under `%ProgramFiles%\XPoint\AppRemoto` and store state under `%ProgramData%\XPoint\AppRemoto`.
9. Register a Windows startup task running as `SYSTEM` so heartbeats resume after restart without an interactive user session.
10. Start the heartbeat process and verify that both RustDesk ID discovery and the first API heartbeat succeed.

The installed agent uses machine-scoped DPAPI for the system-owned state and restrictive Windows ACLs. Existing current-user state remains readable only by the existing manual mode; setup does not silently migrate or delete it.

The bootstrap prints only concise progress and a final success or stable error code. It never prints the enrollment token, device token, unattended password, RustDesk key material beyond the already-public server key, or API response bodies.

### Step 4: Availability

After generating the package, the panel polls only the selected organization for a matching newly enrolled device. Polling has a fixed timeout and stops when the device appears `ONLINE`, the page is left, or the technician cancels.

The completion view shows the device name, hostname, RustDesk ID, and `Disponivel`. It provides `Abrir dispositivo` and `Conectar` actions. If installation fails or times out, the page shows the last non-secret setup stage and a retry path that creates a new token; it never reuses an uncertain one-time token.

## API Changes

### Create Enrollment Token

`POST /v1/enrollment-tokens`

Input:

```json
{
  "organizationId": "organization-id",
  "deviceDisplayName": "Recepcao"
}
```

The endpoint requires `canManageDevices` for the target organization. It generates at least 256 bits of cryptographic randomness, stores only the SHA-256 hash, sets a 30-minute expiry and one use, records the creating technician, writes a redacted audit entry, and returns the plaintext once.

### Create Connection Launch

`POST /v1/devices/:deviceId/connect`

The endpoint requires `canConnect` for the device organization and an enabled device with a valid RustDesk ID. It decrypts the stored unattended password only after authorization, writes an audit entry, and returns the RustDesk launch URI in a `Cache-Control: no-store` response.

The panel immediately passes the URI to the operating system and does not render, persist, log, or cache it. The URI may contain the password because the RustDesk desktop protocol requires it for unattended one-action connection. This is an explicit boundary: the authorized technician's workstation receives the credential transiently at connection time. The implementation must never place the URI in an ordinary HTTP link destination, browser history entry, server log, or analytics payload.

The browser or Windows may ask the technician to approve opening RustDesk. AppRemoto cannot bypass that operating-system confirmation. If the protocol handler is unavailable, the panel offers `Copiar ID` and a short instruction to install RustDesk on the technician workstation.

## Device Directory Changes

Each desktop row and mobile record gains a stable action area:

- `Conectar` for technicians with `canConnect`.
- `Copiar ID` as a fallback.

`Conectar` is disabled when the RustDesk ID is absent or the current API refresh is unavailable. An offline device remains visible; its connection action explains that the customer computer must be online.

The existing background-refresh failure shown in production is treated as a blocking functional defect for this milestone. The implementation must identify and correct its concrete cause so current status and connection authorization are fetched from the API. Cached rows may remain visible during a transient failure, but they must not be presented as current or connectable.

## Distribution

The panel deployment exposes only two immutable, versioned public artifacts:

- the Windows AppRemoto agent executable;
- the setup template metadata containing artifact version and SHA-256 digests.

The agent is cross-compiled from the repository during the controlled release build. The RustDesk binary is downloaded from the official pinned release URL rather than redistributed by AppRemoto. Updating either version requires updating its expected digest in source and passing the focused setup verification.

The generated script is user-specific because it contains a one-time token and therefore is created in the browser, not stored on the server or committed to Git.

## Failure Handling

Every setup stage is idempotent where practical. Existing compatible RustDesk and agent installations are reused. Incompatible or untrusted executables stop the process with a stable error instead of being replaced silently.

Enrollment uncertainty is fail-closed. The technician generates a new setup package after an uncertain failure; server-side replay and receipt logic remains responsible for preventing duplicate devices or credential divergence.

The startup task is created only after successful enrollment and removed if final local verification fails. The installer does not alter unrelated scheduled tasks, services, firewall rules, applications, Appwrite resources, or Coolify applications.

## Minimal Verification

Verification is deliberately bounded to the requested completion path:

1. Focused contract and API tests for enrollment-token creation, authorization, connection launch, redaction, and no-store behavior.
2. Focused agent tests for RustDesk configuration, machine DPAPI state, and startup-task command generation.
3. Focused panel tests for Setup authorization, package generation, availability completion, and connect fallback.
4. One production build/deploy check for API and panel.
5. One real Windows setup from generated package, confirmation that the device becomes `ONLINE`, and one real connection attempt from the panel.

Load tests, multi-OS setup, repeated deployment cycles, installer signing, auto-update, broad refactoring, and exhaustive edge-case validation remain deferred unless a concrete failure blocks this flow.

## Known Limits And Deferred Work

- Initial setup supports Windows x64 only.
- The AppRemoto agent and generated script are not code-signed in this milestone, so Windows may show a trust warning.
- The browser or operating system may ask before opening the RustDesk protocol.
- A signed MSI, automatic upgrades, uninstall UI, fleet policy management, technician invitations, connection history screens, and browser-embedded remote control are deferred.
- Appwrite and Coolify remain technical administration consoles rather than customer-facing panels.

## Acceptance

The feature is ready for user testing when an authorized technician can open `/setup`, choose an organization and device name, generate and run the package on one Windows x64 computer, observe that computer become `ONLINE` in AppRemoto, and invoke the RustDesk connection from the corresponding device action.

The release summary must state the production links, exact tested flow, any Windows warning encountered, known limitations, and intentionally deferred validations.
