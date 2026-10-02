# Native setup distribution interface

Version: 1.2.0. Windows x64. Build the runtime from services/agent:

```sh
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w -H=windowsgui" -o xpoint-setup-base.exe ./cmd/remote-setup
```

The panel build publishes both the base EXE and the complete bundle with exact
byte length and SHA256 manifests. Use `node apps/panel/scripts/build-installer.mjs`
at repository root to build both. The complete bundle contains the unchanged,
pinned RustDesk 1.4.9 executable. No Authenticode certificate is provisioned.

## Generic complete installer (1.2.0)

The same downloaded file is reusable across customer PCs. After normal UAC,
the native form asks company and display name; the hostname is only a default
label. No customer-side panel session is needed. The form also offers bounded
HTTPS/TCP diagnostics and an Open log button. Form cancellation precedes changes.

A valid installed RustDesk service is reused and reconfigured, without running
the bundled installer or downgrading the existing version. When absent, the
official payload is verified, extracted into a protected staging directory and
silently installed with a three-minute deadline and service/path readback.
Unexpected paths/accounts are reported as conflicts. XPoint remains an automatic
LocalSystem service. Only the Go runtime segment is copied into Program Files.
The official license and source/build references accompany the installation.

The public bundle contains no capability. A superadmin download appends a strict
V2 overlay with a revocable registration capability; treat the resulting file
as private distribution material. The shared permanent password requested by the
user remains in API runtime configuration and is delivered to the authorized
agent over TLS. It is absent from the distributed EXE, URLs and logs. Capability
holders can enroll a computer and thus obtain the common password; endpoint
scoping does not remove that inherent shared-password risk.

Before preparation, the installer saves a random attempt ID and secret with
machine DPAPI. Retries recover the same organization/package. The SYSTEM service
keeps its existing identity and credentials. Migration from an older per-device
password uses a separate protected journal, API stage/confirm and a durable
guard; pending work resumes before a fresh reconfiguration. Setup does not report
success before acknowledgement and a fresh heartbeat. An initial enrollment
response lost after commit still requires the documented reconciliation path.

Keyboard, clipboard, file transfer and support permissions are explicitly
configured with readback. Servers/key are compiled constants. OSS administrators
can still change their local RustDesk settings. Adaptive scaling belongs to the
technician's viewer settings, as explained in the panel.

See [generic installer operations](../../docs/operations/generic-installer.md)
for binary layout, capability revocation, API/schema release and real acceptance
limits. The following V1 configuration/recovery protocol remains compatible.

## Legacy V1 prerequisite and workflow

RustDesk must already be installed with its automatic LocalSystem Windows service, in Program Files/RustDesk or Program Files (x86)/RustDesk. Portable copies are insufficient. The configurator does not download, install, reinstall or remove RustDesk. It validates the service path and the trusted executable, starts the existing service if necessary, and fails before writing XPoint registration when the prerequisite is absent.

Double-click requests normal UAC. The window shows six stages: package/permission, installed RustDesk, XPoint service, server/access settings, enrollment/password, confirmed heartbeat. Closing the window hides progress without cancelling a service-owned operation. RustDesk commands have bounded timeouts; service startup has a 30-second limit, setup monitoring ten minutes after form submission. A stopped/failed service is reported promptly rather than waiting the full monitoring timeout.

The XPoint service is automatic LocalSystem, dependent on RustDesk, with recovery after 30/60/120 seconds. It uses dedicated Program Files/XPointRemoteAgent and ProgramData/XPointRemoteAgent directories. Only the base EXE is copied to the runtime, without provisioning data. SYSTEM enrolls and runs, keeping CurrentUser DPAPI consistent. Bootstrap uses machine DPAPI and SYSTEM/Administrators-only ACLs, and is removed after successful enrollment/password configuration. Runtime is readable/executable by Users; recovery state remains private.

## Adjacent log

Executing `XPoint-Instalar-Cliente.exe` creates/appends `XPoint-Instalar-Cliente.log` in the same directory. Renamed executables get the corresponding basename, including the browser's numeric suffix. Each entry has timestamp, version, PID, stage, operation, result and sanitized diagnostic. It includes UAC denial, lock failure, each option write/readback, enrollment/password operations, service exits, heartbeat retries and the final result. No token, password, hostname, customer name, command arguments, stdout/stderr or raw error message is written. Win32 numbers (including converted NTSTATUS), timeout classes and known API error codes are retained. Identity directory preparation, identity creation/loading, pending/credential/password-state reads and preflight publication each emit START/OK or ERROR. IDENTITY_OWNER_MISMATCH is explicit; no underlying arbitrary error text is logged.

The log writer pins non-reparse ancestor directories, refuses redirected or multiply-linked log files, appends instead of truncating, and flushes each event. If the adjacent file cannot be opened, installation does not begin: copy the executable to a writable local folder. A private bounded `setup-status.json` journal lets the SYSTEM service report progress; setup copies only matching fresh events into the adjacent log. Atomic status replacement permits readers to retain a stable old handle without blocking publication.

`BUSY` means another setup handle exists. `LOCK_ACCESS` means access denied, and `LOCK` another Win32 lock error; the numeric reason is logged. The mutex uses handle lifetime, not Go goroutine/thread ownership. The old 1.0.0 implementation classified every mutex error as BUSY and only exposed a static waiting message; the screenshot alone cannot identify which client condition triggered it.

## Provisioning and recovery

Append UTF-8 JSON with exactly schemaVersion (1), enrollmentId, enrollmentToken, expiresAt (RFC3339), organizationId, deviceDisplayName; uint32 little-endian byte length; ASCII XPOINT_SETUP_V1. Maximum JSON 16384 bytes. Unknown/duplicate fields, controls, invalid IDs and expired packages are rejected. Runtime destinations never come from the package.

A previous installation must match the organization before its service is stopped. The display name may change. After validating and stopping the exact managed service, inspect protected enrollment state:

- No pending marker and no credentials: the agent has not started an API enrollment request. A fresh package for the same customer (any display name) can replace the unused receipt/bootstrap, including an expired 1.0.0 attempt.
- Pending marker plus saved credentials: preserve identity and credentials, write the new package receipt/bootstrap, update the runtime while stopped and resume. Reconfiguration authenticates the new package, updates the same device name and creates its linked receipt so the panel tracks the current installation.
- Pending marker without credentials, or inconsistent state: RECONCILIATION. Do not replay enrollment, delete state or generate a new device identity. Follow apps/api/ENROLLMENT.md.

Runtime updates are written to a protected temporary file and atomically replace the stopped service executable. Unrelated service configurations are rejected. Success requires a new API heartbeat after the current invocation; a browser download is not success.

## RustDesk configuration

Set/read back only custom-rendezvous-server, relay-server, key, api-server (empty), approve-mode=password and verification-method=use-permanent-password. Unrelated settings remain unchanged. The agent sets a unique permanent password using the supported --password CLI. Compatibility exception: the password is briefly a SYSTEM child-process argument inspectable by privileged local administrators; no enrollment/device token enters arguments and no arguments/output are logged. CLI behavior was checked against upstream 1.4.9; older/custom builds that reject these options fail readback with the exact operation in the log.

References: https://github.com/rustdesk/rustdesk/blob/1.4.9/src/core_main.rs and https://github.com/rustdesk/rustdesk/blob/1.4.9/src/ipc/auth.rs. The configurator does not bypass IPC authorization.

Uninstall: the installed remote-agent.exe --uninstall requests UAC and removes only the exact XPoint service after checking its path. RustDesk and private identity/recovery data are preserved.

## Verification and limits

Windows Go tests cover actual named-mutex contention/release, same-directory append logs, hardlink refusal, diagnostic redaction, precise option timeout, service timeout rejection, receipt recovery/tenant isolation, fresh journal correlation and existing agent behavior. Go vet and GUI compilation are required. Browser tests cover prerequisite/log instructions, exact package overlay/integrity, receipt polling and permissions.

The user's 1.0.1 log stops at ENROLLMENT_STATE before discovery/API. A native SYSTEM regression reproduced an identity creation failure when the token defaults ownership to Administrators. Version 1.0.2 sets the actual service user as owner at creation, with a protected explicit ACL; it does not relax existing-file validation. Both SYSTEM default-owner variants now pass identity creation, real DPAPI persistence and resume with a synthetic API/RustDesk. A separate SYSTEM-to-administrator test covers recovery metadata inspection without reading credential bytes or changing their ACLs. Backup-read permission is scoped to a duplicated thread token and reverted immediately. These tests do not establish acceptance on the user's client, a reboot or a real RustDesk session. That 1.0.2 release required only the panel. The 1.0.3 flow below also changes the API.

## Reinstallation with a new name (1.0.3)

The display name is never an installation key. Download a fresh package for the same customer and choose any new name. Unsent attempts accept the new receipt/bootstrap. Saved credentials resume the same device, then authenticate `/v1/agent/reconfigure` with both the fresh package and saved device credential. The API changes only the label and links a new receipt; it returns no password/token. The local receipt always follows the new package, so its panel checklist observes the same operation. Ordinary service restarts without a bootstrap never rename anything. Rejected updates retain protected credentials for a fresh package; they never report success or remove the bootstrap. Different organizations and ambiguous initial requests without saved credentials still fail closed.

The adjacent log identifies INSTALLATION_CUSTOMER_CHECK, NEW_PACKAGE_STATE_WRITE and DEVICE_RECONFIGURE_REQUEST. Only a fresh successful heartbeat completes setup. Version 1.0.3 requires the accompanying API deployment before the panel executable is published.
