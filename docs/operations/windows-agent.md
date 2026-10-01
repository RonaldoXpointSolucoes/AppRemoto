# Windows Agent Operations

## Current status

The Windows agent is implemented as a manually executed binary. It supports first enrollment, DPAPI-protected credentials, trusted RustDesk discovery/password configuration, and resilient heartbeats. A Windows service, installer, auto-update, and code signing are outside this milestone.

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

Open PowerShell as the intended Windows user. The token is read from standard input and is not accepted as a command-line argument:

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
- Package the agent as a signed installer or Windows service.
- Add an operator-facing enrollment-token workflow; current token provisioning remains an authorized Appwrite operation.
