# Automatic installer release acceptance

Scope: existing Remote Platform production API and panel, no schema expansion, no RustDesk server restart, no installation on the development host.

## Prepared implementation

- Panel: choose permitted customer/name, verify SHA256 of the base EXE, create a single-use 30-minute token, append the bounded overlay and download with a fixed nonsecret filename.
- Monitor the exact enrollment receipt and first heartbeat. Mask stale online indications on failed checks, recover monitoring after provisioning expiry for committed devices, clear state on terminal session errors.
- Windows: normal UAC, pinned official RustDesk installation, unattended configuration, SYSTEM enrollment/DPAPI, automatic service/recovery, fresh heartbeat before success. Preserve identities on uncertain retries.
- API: authenticated token creation and status routes, existing schema, current organization permissions, no-store responses and generic errors.

## Remaining release gates

1. The user explicitly authorized temporary password delivery through the authenticated panel to the technician's RustDesk on2026-10-01. The connection service is implemented with current permission, online/heartbeat and revocation checks, validated decryption and confirmed audit before returning the URI. This authorization does not permit displaying or persisting credentials in the browser.
2. Native corrections were reviewed: launcher-child lifecycle, unattended options and runtime/data ACL separation. The final progress window explicitly permits hiding without cancellation. Windows tests/build, panel unit/typecheck and29 browser scenarios, contracts and workspace checks passed. Connection checks include stale-session/unmount response rejection and transient handoff without rendered href or cached credential. Run the affected complete suites after final review changes. Do not interpret browser route mocks as production enrollment or real remote access.
3. Publish the reviewed commit; follow [API operations](remote-api.md) stop/underlying-zero-container/start procedure, then deploy the panel. If underlying inventory is unavailable, do not use a rolling restart as a substitute.
4. Verify the deployed commit, exact public health responses, authenticated enrollment-token creation/status, downloadable manifest/base hash and no credential leakage. Keep test identifiers and tokens only in private local evidence.
5. Run the downloaded personalized installer on an authorized Windows client with administrator approval. Confirm service startup, panel heartbeat, reboot recovery and a real session from the technician computer. The browser/OS may require confirmation to open RustDesk. This final endpoint acceptance has not been performed locally.

## Distribution notes

The executable has no Authenticode certificate. Windows can display an unknown-publisher/SmartScreen prompt. The pinned RustDesk executable is fetched during installation, so internet access is required. Each customer computer needs a fresh personalized package. A browser download or API heartbeat by itself is not proof that remote control works.

The supported RustDesk password command briefly exposes the unique password in a protected SYSTEM child process argument. Only privileged local administrators can inspect that process; no enrollment/device token enters arguments, and command/output material is not logged. See [native setup details](../../services/agent/SETUP.md).
