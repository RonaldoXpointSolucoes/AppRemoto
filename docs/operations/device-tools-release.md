# Device connection tools

The client installation and real remote session were confirmed by the operator on 2026-10-01 after installing RustDesk on the technician computer. The panel launches that local application; an ONLINE heartbeat is independent of the remote session. Do not infer a session from browser focus changes or a successful URI assignment.

## Release order

1. Run contracts, API, panel and Appwrite tests, typechecks, the panel build and browser tests.
2. Inspect and plan the exact Appwrite project. Expected delta from the 108-resource schema: only `devices/notes`, optional string of 2048 characters, no default. Apply only that additive attribute; wait until available and verify 109 unchanged resources. Do not change users, permissions, credentials or other resources.
3. Publish the reviewed branch. Stop the single API instance, verify zero old containers, deploy the API and confirm exactly one healthy instance. The empty connect payload remains supported for the old panel.
4. Deploy the panel and verify public health, technician preparation, automatic/manual access, device details and history. Installer remains 1.0.3; existing clients need no reinstall.
5. Use an explicitly marked synthetic device in Remote Platform E2E to verify editing, identity/credential preservation, heartbeat after editing, automatic and passwordless manual handoff, attempt binding and redacted history. Never launch the synthetic URI. Disable only the fixture and close its test operator session afterward.

## Connection diagnostics

- The automatic path reuses the existing credential handoff. The manual path requests no password from the API; the technician supplies the RustDesk password in browser memory.
- The button attempts to launch RustDesk on the technician computer. A short-lived explicit retry handles browsers that require a new click after the network request. A separate `rustdesk://` check carries no device or credential.
- API authorization, browser launch request/failure and operator-reported outcomes are different events. A reported session success is not server-observed telemetry.
- History returns a bounded allowlist of identifiers, timestamps, mode, stage, code and source. Never record the launch URI, password, HTTP headers, raw errors or browser console. Chromium can include custom protocol URLs in its own console messages.
- Editing changes only display name and notes. The existing heartbeat guard prevents a concurrent name update from being mistaken for an inconsistent heartbeat. An indeterminate write keeps the guard for reconciliation.
- Only users with `can_manage_devices` can edit; viewing and connecting retain their separate permissions. Follow-up events require the original successful attempt, same device/technician/mode and a 30-minute window.

Upstream references: [RustDesk 1.4.9 URI parser](https://github.com/rustdesk/rustdesk/blob/1.4.9/flutter/lib/common.dart#L2272-L2397), [Windows protocol registration](https://github.com/rustdesk/rustdesk/blob/1.4.9/src/platform/windows.rs#L1459-L1464), [Chromium external protocol handling](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/external_protocol/external_protocol_handler.cc).
