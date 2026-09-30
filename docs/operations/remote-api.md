# Remote API operations

This runbook covers the `remote-api` Coolify application in the `Remote Platform/production` environment. The application UUID is `qyrjepou8xchzlfirsbrhwr9` and its public endpoint is `https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io`. Do not use this runbook to mutate the panel, RustDesk service, unrelated Coolify resources, or another Appwrite project.

## Configuration inventory

The API application has exactly the following 12 environment variable names. This inventory intentionally contains no values. `APPWRITE_API_KEY` and `MASTER_ENCRYPTION_KEY` are secrets; mark them secret in Coolify and never expose them in build output, logs, screenshots, tickets, chat, Git, or copied environment dumps. `NEXT_PUBLIC_*` variables belong to the panel and must never be configured on or copied from this API application.

| Name | Classification |
| --- | --- |
| `APPWRITE_ENDPOINT` | Configuration |
| `APPWRITE_PROJECT_ID` | Configuration |
| `APPWRITE_API_KEY` | **Secret** |
| `MASTER_ENCRYPTION_KEY` | **Secret** |
| `MASTER_ENCRYPTION_KEY_VERSION` | Configuration |
| `ALLOWED_ORIGINS` | Configuration |
| `PORT` | Configuration |
| `API_REPLICAS` | Singleton guard |
| `WEB_CONCURRENCY` | Singleton guard |
| `NODE_APP_INSTANCE` | Singleton guard |
| `TRUST_PROXY` | Network security configuration |
| `NODE_ENV` | Runtime configuration |

`ALLOWED_ORIGINS` is still a placeholder until the technician panel has its production domain. Replace it with the exact HTTPS origin before enabling browser use; do not use a wildcard. Keep the API pinned to one replica and one Node process. `TRUST_PROXY` must remain disabled or contain only explicit trusted proxy addresses/CIDRs.

## Mandatory change procedure

Enrollment and heartbeat safety currently require a singleton. Coolify auto-deploy must remain off. A normal restart was observed to use a rolling replacement with old and new containers overlapping, so **restart is not an approved deployment operation**.

1. Confirm the intended commit, reviewed diff, passing workspace tests/typecheck/build, and a production image that includes the container health probe dependencies.
2. Confirm auto-deploy is off, scaling is one replica, and no parallel worker or second API writer exists.
3. Stop the application explicitly. Verify through Coolify runtime state and the underlying container inventory that zero old application instances remain. A stopped UI state alone is not enough if a container is still running.
4. Deploy/start exactly one instance from the intended commit. Do not continue if the platform starts an overlap, a second replica, or an unexpected image.
5. Wait for healthy running status, then request `GET /health` over the public HTTPS URL. Require HTTP 200 and the exact body `{"status":"ok"}`.
6. Inspect startup and request logs for errors, crash loops, secret material, authorization headers, cookies, request bodies, or credentials. Treat any exposure as an incident and rotate the affected credential.
7. Run the production smoke sequence below. Record only pass/fail, HTTP status, timestamps, commit/deployment identifiers, and non-secret counters; never record generated data IDs or credentials.
8. Keep auto-deploy off after validation. Monitor the single instance and re-check health and logs before declaring the change complete.

Do not deploy when the old-instance count cannot be proven zero. Stop and investigate instead of accepting a rolling overlap.

## Production smoke test

Use fresh temporary test fixtures created through the authorized private workflow. Keep all tokens, device credentials, passwords, organization IDs, device IDs, and enrollment IDs out of commands that are captured, terminal output, reports, and this repository.

The required sequence is:

1. Create a temporary organization and one-use enrollment token without printing their identifiers or token value.
2. Enroll one device over HTTPS and confirm the one-time response is received only by the authorized caller.
3. Send an authenticated heartbeat using the returned device credential.
4. Read persistence through the approved Appwrite/API path and confirm the device and heartbeat metadata were stored.
5. Confirm the enrollment token `use_count` is exactly `1`.
6. Retry the same enrollment and require HTTP 403 with no credentials in the response or logs.

Clean up test fixtures only through an explicitly reviewed procedure. If cleanup is not authorized, leave them identifiable through private local evidence rather than copying their IDs into shared documentation.

## Rollback

Rollback is the same stop-first operation as a forward deployment:

1. Stop the current application explicitly and confirm zero instances remain.
2. Select the last known-good reviewed commit/image without changing environment values or secrets.
3. Deploy/start exactly one instance and verify running status, exact HTTPS health response, clean logs, and the full smoke sequence.
4. If the previous image is incompatible with current Appwrite state or credential envelopes, keep the service stopped and escalate for a reviewed recovery. Do not delete or rewrite production data to force an image rollback.

A source rollback does not roll back Appwrite documents, token consumption, audit records, or schema. Preserve redacted evidence from the failed deployment and document the selected recovery separately.

## Credential rotation and recovery

For an Appwrite API-key rotation, create the replacement in the exact production project with the reviewed scopes, mark it secret in Coolify, and keep the old key available for immediate rollback until the replacement has passed health, logs, and smoke validation. Use the mandatory stop/zero-instance/start sequence to change it. Revoke the old key only after the replacement is proven and confirm the retired key is rejected. Never print or persist either plaintext key.

Do not replace `MASTER_ENCRYPTION_KEY` or increment `MASTER_ENCRYPTION_KEY_VERSION` in place. The current service has no multi-key read path: changing either value alone prevents decryption of existing password envelopes and breaks deterministic device-token recovery. A master-key rotation requires a separately designed, tested, and reviewed migration/recovery plan that preserves the old key securely until every envelope and derived credential has been reconciled. If the master key is lost, stop enrollment and recovery; do not guess a replacement or overwrite ciphertext.

Pending or indeterminate enrollment recovery must follow the [enrollment recovery guide](../../apps/api/ENROLLMENT.md). Preserve durable receipts and safety freezes, do not re-expose one-time plaintext credentials, and do not clear administrative revocation timestamps. When provenance or exact state cannot be proven, fail closed and require manual reconciliation.

## Verified deployment record

On 2026-09-30, deployment `nf1uxzd8reb5oorpeisk2kb1` was healthy on commit `f877eac978523bd20ddedf2d420cb075bb82bfab`. The first deployment failed because the container lacked `curl` for the Coolify health probe. The dependency was added, reviewed, and redeployed.

The public HTTPS health check returned HTTP 200 with exact body `{"status":"ok"}`, and inspected logs were clean. The production smoke test passed organization setup, token creation, enrollment, heartbeat, persistence verification, `use_count=1`, and a retry returning HTTP 403 without credentials. Test-data identifiers and all secret values were intentionally omitted.

This record is dated evidence, not permission to skip the mandatory change procedure on a later deployment.
