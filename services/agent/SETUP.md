# Native setup distribution interface

Version: 1.0.1. Windows x64. Build from services/agent:

```sh
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w -H=windowsgui" -o xpoint-setup-base.exe ./cmd/remote-setup
```

The panel build publishes the versioned base EXE and a manifest with the exact byte length and SHA256. No Authenticode certificate is included. The downloaded personalized EXE includes a one-use enrollment token; protect/delete that download after confirmed installation.

## Prerequisite and workflow

RustDesk must already be installed with its automatic LocalSystem Windows service, in Program Files/RustDesk or Program Files (x86)/RustDesk. Portable copies are insufficient. The configurator does not download, install, reinstall or remove RustDesk. It validates the service path and the trusted executable, starts the existing service if necessary, and fails before writing XPoint registration when the prerequisite is absent.

Double-click requests normal UAC. The window shows six stages: package/permission, installed RustDesk, XPoint service, server/access settings, enrollment/password, confirmed heartbeat. Closing the window hides progress without cancelling a service-owned operation. RustDesk commands have bounded timeouts; service startup has a 30-second limit, setup monitoring eight minutes. A stopped/failed service is reported promptly rather than waiting the full monitoring timeout.

The XPoint service is automatic LocalSystem, dependent on RustDesk, with recovery after 30/60/120 seconds. It uses dedicated Program Files/XPointRemoteAgent and ProgramData/XPointRemoteAgent directories. Only the base EXE is copied to the runtime, without provisioning data. SYSTEM enrolls and runs, keeping CurrentUser DPAPI consistent. Bootstrap uses machine DPAPI and SYSTEM/Administrators-only ACLs, and is removed after successful enrollment/password configuration. Runtime is readable/executable by Users; recovery state remains private.

## Adjacent log

Executing `XPoint-Instalar-Cliente.exe` creates/appends `XPoint-Instalar-Cliente.log` in the same directory. Renamed executables get the corresponding basename, including the browser's numeric suffix. Each entry has timestamp, version, PID, stage, operation, result and sanitized diagnostic. It includes UAC denial, lock failure, each option write/readback, enrollment/password operations, service exits, heartbeat retries and the final result. No token, password, hostname, customer name, command arguments, stdout/stderr or raw error message is written. Win32 numbers, timeout classes and known API error codes are retained.

The log writer pins non-reparse ancestor directories, refuses redirected or multiply-linked log files, appends instead of truncating, and flushes each event. If the adjacent file cannot be opened, installation does not begin: copy the executable to a writable local folder. A private bounded `setup-status.json` journal lets the SYSTEM service report progress; setup copies only matching fresh events into the adjacent log. Atomic status replacement permits readers to retain a stable old handle without blocking publication.

`BUSY` means another setup handle exists. `LOCK_ACCESS` means access denied, and `LOCK` another Win32 lock error; the numeric reason is logged. The mutex uses handle lifetime, not Go goroutine/thread ownership. The old 1.0.0 implementation classified every mutex error as BUSY and only exposed a static waiting message; the screenshot alone cannot identify which client condition triggered it.

## Provisioning and recovery

Append UTF-8 JSON with exactly schemaVersion (1), enrollmentId, enrollmentToken, expiresAt (RFC3339), organizationId, deviceDisplayName; uint32 little-endian byte length; ASCII XPOINT_SETUP_V1. Maximum JSON 16384 bytes. Unknown/duplicate fields, controls, invalid IDs and expired packages are rejected. Runtime destinations never come from the package.

A previous installation must match organization and display name before its service is stopped. After validating and stopping the exact managed service, inspect protected enrollment state:

- No pending marker and no credentials: the agent has not started an API enrollment request. A fresh package for the same customer/name can replace the unused receipt/bootstrap, including an expired 1.0.0 attempt.
- Pending marker plus saved credentials: preserve the original receipt, identity and credentials, update the runtime while stopped and resume. The new package's token is not used. The original device remains in Dispositivos; the new package's enrollment-status card does not impersonate that old receipt.
- Pending marker without credentials, or inconsistent state: RECONCILIATION. Do not replay enrollment, delete state or generate a new device identity. Follow apps/api/ENROLLMENT.md.

Runtime updates are written to a protected temporary file and atomically replace the stopped service executable. Unrelated service configurations are rejected. Success requires a new API heartbeat after the current invocation; a browser download is not success.

## RustDesk configuration

Set/read back only custom-rendezvous-server, relay-server, key, api-server (empty), approve-mode=password and verification-method=use-permanent-password. Unrelated settings remain unchanged. The agent sets a unique permanent password using the supported --password CLI. Compatibility exception: the password is briefly a SYSTEM child-process argument inspectable by privileged local administrators; no enrollment/device token enters arguments and no arguments/output are logged. CLI behavior was checked against upstream 1.4.9; older/custom builds that reject these options fail readback with the exact operation in the log.

References: https://github.com/rustdesk/rustdesk/blob/1.4.9/src/core_main.rs and https://github.com/rustdesk/rustdesk/blob/1.4.9/src/ipc/auth.rs. The configurator does not bypass IPC authorization.

Uninstall: the installed remote-agent.exe --uninstall requests UAC and removes only the exact XPoint service after checking its path. RustDesk and private identity/recovery data are preserved.

## Verification and limits

Windows Go tests cover actual named-mutex contention/release, same-directory append logs, hardlink refusal, diagnostic redaction, precise option timeout, service timeout rejection, receipt recovery/tenant isolation, fresh journal correlation and existing agent behavior. Go vet and GUI compilation are required. Browser tests cover prerequisite/log instructions, exact package overlay/integrity, receipt polling and permissions.

The user's 1.0.0 client attempt failed. Tests and compilation of 1.0.1 do not establish real-client acceptance. Installation with UAC, SYSTEM/DPAPI, reboot and a real RustDesk session still require the client run. Publishing this correction is panel-only; API/schema/server configuration is unchanged.
