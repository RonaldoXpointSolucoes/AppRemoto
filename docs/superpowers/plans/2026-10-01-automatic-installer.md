# Automatic installation implementation plan

Spec: docs/superpowers/specs/2026-10-01-automatic-installer-design.md

Global constraints: existing production project only; no schema expansion; no secrets in logs or source; single API writer; production evidence separate from simulations. Direct user request authorizes implementation of the complete installation and connection flow. Reuse managed setup-guide checkout and preserve preceding published work.

## Task1 — Operator API (independent ownership apps/api and packages/contracts)
- Implement strict creation/status/connect contracts and routes described in spec; wire production repositories/services.
- Reuse existing enrollment repository and encrypted credentials; authorize current active organization permissions before reads returning sensitive data.
- Add focused tests for unauthorized/cross-organization, disabled/offline device, uncertain persistence/audit failure, exact receipt correlation and no-store/no-secret logs.
- Run contracts/API tests and typecheck. No external writes or deploy from implementer.

## Task2 — Windows installer/service (independent ownership services/agent)
- Implement bounded overlay parser, fixed release settings, installer and automatic LocalSystem Windows service using current agent.
- Obtain pinned official RustDesk SHA256 and verify download; configure server automatically and retain safe current-user manual behavior.
- Use service-owned DPAPI state, secure bootstrap handoff and final first-heartbeat evidence. Preserve identity on retries, uninstall own service explicitly.
- Add focused tests and Windows build; do not install on the host, create production credentials or deploy from implementer.
- Publish machine-readable build/interface notes: command path, build command, manifest version and exact overlay parser expectations.

## Task3 — Panel/distribution (parent ownership apps/panel and docs)
- Replace primary setup checklist with customer/name/download/wait flow; manual guide remains troubleshooting disclosure.
- API methods match Task1 contracts. Generate EXE Blob from hash-checked versioned base and exact bounded overlay, then discard token; no localStorage provisioning data.
- Poll by enrollmentId with bounded lifecycle and stop on expiry/unmount. Connect controls reuse authorization and current online snapshot; launch URI transiently without logging/DOM href. Include technician RustDesk install prerequisite/fallback.
- Build Go artifact in controlled panel Docker stage and serve immutable baseEXE/manifest. Add focused browser tests for downloads without secret leakage, wrong tenant, waiting/online states and connection action.

## Task4 — Integrate/review/release
- Check interface consistency and native artifact hash/overlay. Review security-sensitive boundaries with independent reviewer and fix material findings.
- Run appropriate tests/typechecks/builds once per affected subsystem; update canonical docs/runbooks with implemented and unverified states.
- Publish reviewed commit and deploy API via stop/zero/start exactly one instance, then panel. Validate live setup generation/status and browser connect behavior without retaining credentials. Validate real installation only in an authorized admin-capable Windows environment; ask for concrete user interaction only if that final prerequisite cannot be satisfied locally.

Review focus: duplicate installs/recovery, expiry while installer downloads, cross-tenant provisioning/connection, failed clipboard/protocol handler, non-admin/UAC cancellation and preserving unrelated RustDesk installations.
