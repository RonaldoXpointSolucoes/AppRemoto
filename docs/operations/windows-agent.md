# Windows Agent Operations

## Current status

Two entry points now exist. The original manually executed agent supports enrollment, DPAPI-protected credentials, trusted RustDesk discovery/password configuration and resilient heartbeats. The new `cmd/remote-setup` implements an automatic installer and LocalSystem service; see [the distribution and recovery interface](../../services/agent/SETUP.md). Real client endpoint acceptance is still required; consult release evidence before claiming UAC/SCM/reboot/session validation. Auto-update and code signing remain outside this delivery.

Build the panel artifact from the repository root with `node apps/panel/scripts/build-installer.mjs` (Go 1.26 on PATH or `GO_BINARY` pointing to it). The Docker build performs the Windows cross-compilation automatically and writes its SHA256 manifest. The base executable alone cannot enroll: the authenticated panel adds a bounded, single-use provisioning overlay after operator authorization. No server secret or master key is embedded.

The personalized download authorizes one registration into the selected customer for 30 minutes. Keep it private and delete it after confirmed installation. The service uses its own SYSTEM-owned state; do not copy manual CurrentUser DPAPI state into it. Retrying a different customer's package is rejected. Preserve uncertain enrollment state and use the existing recovery guide.

The instructions below describe the original manual entry point for support.

The local build produced during acceptance is intentionally outside Git:

```text
.local/remote-platform/bin/remote-agent.exe
```

Production API:

```text
https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io
```

## Prerequisites

- Install an official, supported RustDesk client on the Windows machine.
- Configure the client to use the approved hbbs/hbbr server and public key.
- Obtain a short-lived enrollment token through the authorized Appwrite operator workflow. Never store the token in Git, command history, documentation, or logs.
- Run from the Windows user account that will own the agent state. DPAPI binds protected credentials to that account.

## Enroll

Open PowerShell with **Run as administrator** as the intended Windows user.
RustDesk must be installed: its unattended password command requires elevated
privileges, and the agent inherits the shell's token without requesting UAC.
If UAC asks for another account's credentials, agree on the owning account
before enrollment. The same account/profile and state directory must be used
for subsequent heartbeats because DPAPI is scoped to that user.
The token is read from standard input and is not accepted as a command-line argument:

```powershell
$Agent = 'C:\path\to\remote-agent.exe'
$State = Join-Path $env:LOCALAPPDATA 'XPoint\RemoteAgent'
$Api = 'https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io'

Read-Host 'Enrollment token' | & $Agent enroll `
  -api-url $Api `
  -state-dir $State `
  -display-name $env:COMPUTERNAME
```

Use `-rustdesk-path 'C:\absolute\path\RustDesk.exe'` only when the official installation is outside the supported discovery paths. The executable must pass the agent's path, owner, ACL, and final-path checks.

Successful output is `device enrolled`. A repeated command against completed state returns `device already enrolled` and does not request fresh server credentials.

If enrollment reports failure after a network or local persistence interruption, do not delete the state directory and retry blindly. Preserve the directory for reconciliation because the server may already have consumed the one-time token.

## Run

Start the long-running heartbeat loop with the same API and state directory:

```powershell
& $Agent run -api-url $Api -state-dir $State
```

Add the same `-rustdesk-path` override used during enrollment when applicable. Stop with `Ctrl+C`; the process performs graceful cancellation. This milestone does not install or register a Windows service, so an operator must start the process after login or later add an explicitly reviewed service wrapper.

## Expected behavior

- The device identity remains stable across restarts.
- Device credentials remain DPAPI-protected at rest.
- Heartbeats target the interval returned by enrollment, with bounded jitter and backoff during outages.
- Console output contains only generic status and redacted errors.
- The production panel displays the enrolled device and updates its online state from heartbeats.

## Deferred validation

The following integration work is intentionally deferred to keep this delivery focused:

- Install RustDesk on the host and complete a real production enrollment.
- Provision a second Windows client or VM and prove direct and relayed RustDesk sessions.
- Exercise the 90-second offline transition and network recovery against production.
- Sign the installer with a real certificate and validate automatic service installation/reboot on an authorized endpoint.
- Publish and exercise the new operator-facing enrollment-token workflow after its complete connection flow is authorized and reviewed.
