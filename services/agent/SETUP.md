# Native setup distribution interface

Version: 1.0.0. Build from services/agent:

```sh
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w -H=windowsgui" -o xpoint-setup-base.exe ./cmd/remote-setup
```

Distribution manifest produced by the panel build must contain version, base EXE URL and SHA256 of those exact bytes. Do not claim Authenticode signing: no certificate is included.

Append UTF-8 JSON with exactly schemaVersion (1), enrollmentId, enrollmentToken, expiresAt (RFC3339), organizationId, deviceDisplayName; uint32 little-endian JSON byte length; ASCII XPOINT_SETUP_V1. Maximum JSON 16384 bytes. Reject unknown or duplicate fields, control characters, invalid IDs and expired packages. No runtime destinations come from the package. Enrollment tokens are present in the downloaded EXE; protect/delete that download after confirmed installation.

Double-click elevates with normal UAC. Approved installation writes only dedicated Program Files/XPointRemoteAgent and ProgramData/XPointRemoteAgent directories, installs official RustDesk if missing and creates XPointRemoteAgent as automatic LocalSystem, dependent on RustDesk. Recovery restarts after 30,60,120 seconds. It copies only the base executable bytes; provisioning data is not retained in the runtime. SYSTEM enrolls and runs so CurrentUser DPAPI has a consistent account. Bootstrap uses machine DPAPI and SYSTEM/Administrators-only ACLs and is removed after successful enrollment/password configuration. The original enrollment recovery markers and credentials remain immutable.

A preexisting XPoint receipt must match enrollment ID, organization and display name. Different packages cannot move an existing identity to another customer. Uncertain enrollment is deliberately not replayed. Re-running the same unexpired package resumes installation; a different runtime base reports VERSION_CONFLICT instead of overwriting a running binary. Existing managed upgrades, tenant moves and expired-package recovery require explicit support reconciliation.

Success requires a new API heartbeat later than the current setup invocation. Error dialogs contain only fixed stage codes. FIRST_HEARTBEAT can mean a startup/configuration/expired bootstrap or API problem; preserved state permits diagnosis, not destructive retries. No token/password is logged.

Public server options are set individually using the pinned upstream supported --option CLI and read back, preserving unrelated settings. The existing agent sets the unique permanent password via the supported --password CLI. **Exception accepted for compatibility:** this password appears briefly in a SYSTEM RustDesk process argument and privileged local administrators may inspect it. Enrollment/device tokens never enter arguments. The existing trusted runner protects the child process, clears argument references/output buffers, and redacts failures. Pinned 1.4.9 main IPC rejects foreign executable peers, so the installer does not bypass IPC authorization or import a full private config.

Official release 1.4.9 x86_64 SHA256 from GitHub asset digest:
eaedeb0088e687bf46f7c46a9c6ea5493ce51f3134dfd6acbedb47b5b9136274
https://api.github.com/repos/rustdesk/rustdesk/releases/tags/1.4.9
CLI reference: https://github.com/rustdesk/rustdesk/blob/1.4.9/src/core_main.rs
IPC identity policy: https://github.com/rustdesk/rustdesk/blob/1.4.9/src/ipc/auth.rs

Uninstall: run the installed remote-agent.exe --uninstall and approve UAC. This stops/deletes only the exact XPoint service after checking its binary path. It leaves RustDesk and recovery/identity files in place, intentionally. Deleting private state or removing RustDesk is not part of this command.

Verification performed: offline Go tests for all agent packages, bounded overlay/expiry/duplicate/unknown fields, retry receipt isolation, public configuration readback and preserved unrelated options, configuration error redaction, existing password argv/output redaction; Windows GUI compilation. Not performed: executing installer, UAC/SCM acceptance, LocalSystem DPAPI roundtrip, reboot, real RustDesk session, production enrollment. Those require an authorized Windows test endpoint. Compilation and mocks do not establish endpoint acceptance.


Review fixes (2026-10-01): the dedicated installer runner waits for the portable launcher's direct installer child, not just the launcher. It keeps the job bounded by context and cleans up any contained tray grandchild after installation; the existing password runner behavior is unchanged. Post-install confirmation requires the exact RustDesk SCM binary path, LocalSystem account, automatic startup and RUNNING state. Windows nonprivileged launcher/child/tray fixtures verify child completion and timeout cleanup without installing RustDesk.

Setup explicitly sets and reads back approve-mode=password and verification-method=use-permanent-password, including when an existing installation previously required clicks or temporary passwords. A rejected policy yields RUSTDESK_UNATTENDED and preserves state. Only the dedicated public runtime directory and clean EXE grant Users read/execute; ProgramData, bootstrap, identities and secrets remain SYSTEM/Administrators-only. A responsive modeless progress window explains that closing it only hides progress: installation continues in the background and a final result is shown. Closing never announces or attempts cancellation of a service-owned enrollment. The setup wait remains bounded to eight minutes; no intermediate step is labelled complete without evidence. UI/SCM/installation acceptance remains unperformed on this host.
