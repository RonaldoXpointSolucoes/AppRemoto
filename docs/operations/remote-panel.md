# Remote panel operations

This runbook covers the `remote-panel` Coolify application in the `Remote Platform/production` environment. The application UUID is `hr1uqo4mlsw3sm7s2mehiaa2` and its public endpoint is `https://hr1uqo4mlsw3sm7s2mehiaa2.179.199.142.157.sslip.io`. Do not use this runbook to mutate the API, RustDesk service, unrelated Coolify resources, or another Appwrite project.

## Deployment inventory

| Item | Production setting |
| --- | --- |
| Source | GitHub repository default branch |
| Dockerfile | `/apps/panel/Dockerfile` |
| Container port | `3000` |
| Health endpoint | `/health` |
| Expected health response | HTTP 200 with `{"status":"ok"}` |
| Public endpoint | `https://hr1uqo4mlsw3sm7s2mehiaa2.179.199.142.157.sslip.io` |
| Auto-deploy | Disabled |

The image is a Next.js standalone build. The final container runs as the unprivileged `node` user and uses `curl` for its container health check.

## Public configuration

The panel has exactly three application-specific environment variable names. All three are public browser configuration and must be configured with the exact values below during both the Docker build and container runtime:

| Name | Exact production value | Build time | Runtime |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APPWRITE_ENDPOINT` | `https://appwrite.xpointsolucoes.com.br/v1` | Required | Required |
| `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | `6abc5640003cb361b809` | Required | Required |
| `NEXT_PUBLIC_API_BASE_URL` | `https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io` | Required | Required |

The panel must never receive an Appwrite API key, master encryption key, enrollment token, device token, RustDesk unattended password, or another server-side credential. Do not add secrets under a `NEXT_PUBLIC_*` name: Next.js embeds these values in browser-accessible build output.

All three values must use their reviewed production targets. Both URL values must be absolute HTTPS URLs without credentials, query strings, or fragments. Configuration validation runs before `next build` and fails closed when a value is missing or malformed.

## Appwrite and API browser boundaries

The production Appwrite project has the panel hostname registered as a Web platform:

`hr1uqo4mlsw3sm7s2mehiaa2.179.199.142.157.sslip.io`

The hostname entry contains no scheme or path. Keep it aligned with the public panel domain so the Appwrite Web SDK can establish browser sessions only from the intended origin.

The API `ALLOWED_ORIGINS` value is the exact panel origin:

`https://hr1uqo4mlsw3sm7s2mehiaa2.179.199.142.157.sslip.io`

Do not replace it with `*`, add HTTP variants, or add unrelated origins. Any API environment change must follow the stop/zero-instance/start procedure in [Remote API operations](remote-api.md); an ordinary rolling restart is not approved for that application.

## Deployment procedure

1. Confirm the intended commit, reviewed diff, and fresh passing workspace tests, typecheck, build, browser tests, and secret scan.
2. Confirm the Coolify application UUID, project/environment, Dockerfile path, port, health endpoint, and public domain against the inventory above.
3. Confirm auto-deploy is off. A deployment must be an explicit, reviewed operation.
4. Configure only the three public variables listed above as build-time and runtime values. Inspect names and target hosts without copying environment dumps into logs, tickets, chat, or Git.
5. Confirm the Appwrite Web platform hostname and exact API CORS origin before deploying. Do not weaken either boundary to work around a browser failure.
6. Deploy the reviewed commit and wait for Coolify to report a finished, healthy application. Verify that the resolved deployment commit is the intended commit.
7. Request `GET /health` over public HTTPS and require HTTP 200 with exact body `{"status":"ok"}`. Also confirm the container health probe reports healthy.
8. Inspect build, startup, and request logs for errors, crash loops, secret material, authorization headers, cookies, passwords, tokens, or keys. Treat any exposure as an incident and rotate the affected credential.
9. Run the private production verifier below as the reproducible server-side authentication baseline. Interactive acceptance is permitted only after the reviewed logout commit is deployed and the procedure below is followed.
10. Confirm auto-deploy remains off after validation.

## Production authentication acceptance

The authorized production verifier is `.local/remote-platform/verify-production-panel-auth.ps1`. It loads the existing DPAPI-protected local bootstrap credential without printing it, creates the Appwrite session, verifies the Appwrite account, creates a JWT, calls the production devices API, and deletes `account/sessions/current` in the same process. The script writes only redacted status evidence to `.local/remote-platform/production-panel-auth.json`; both files remain outside Git.

Run it from the primary repository checkout that owns the private `.local` artifacts:

```powershell
& '.\.local\remote-platform\verify-production-panel-auth.ps1'

$evidence = Get-Content -Raw '.\.local\remote-platform\production-panel-auth.json' |
  ConvertFrom-Json

if ($evidence.session_deleted -ne $true) {
  throw 'Production acceptance session was not deleted'
}

$evidence | Select-Object status, account_verified, jwt_created, devices_status, session_deleted
```

Success requires `status=PASS`, `account_verified=true`, `jwt_created=true`, `devices_status=200`, `session_deleted=true`, and a successful script exit. A missing/false deletion flag or an interrupted cleanup is a failed acceptance run: do not claim cleanup, do not copy cookies or credentials for diagnosis, and revoke the session through the Appwrite Console before retrying.

The verifier's exact sequence is Appwrite `GET /account`, Appwrite `POST /account/jwts`, authenticated API `GET /v1/devices`, and Appwrite `DELETE /account/sessions/current` in one process. It does not prove an interactive browser login and must not be described as one. Record only the redacted evidence fields above, timestamps, commit/deployment identifiers, and non-secret counts.

## Interactive UI acceptance

The panel source includes a locally verified logout control that calls and awaits Appwrite `account.deleteSession('current')` in the same authenticated browser context. Only a successful deletion advances the session epoch, clears protected query data, and redirects to `/login`. While deletion is pending the control is disabled, and a concurrent authorization failure shares that in-flight operation. A failed deletion keeps the session and local state in place and shows only a redacted, retryable error.

This source behavior does not establish that a particular production deployment contains the control. Before interactive production login, require the deployed commit to include the reviewed logout change, then verify public health and container health again.

For interactive acceptance:

1. Start from a clean browser context for the exact panel and Appwrite origins, then authenticate with the approved technician account without recording credentials, cookies, JWTs, or response bodies.
2. Confirm the protected device view loads through the production API.
3. Activate `Sair da conta` once and require the Appwrite `DELETE /account/sessions/current` response to succeed before the browser reaches `/login`. A disabled control while pending is expected; a visible logout error is a failed acceptance and must not be reported as logout.
4. Close all acceptance tabs, clear cookies, storage, service workers, and cache for the exact panel origin plus residual Appwrite site data, and open `/devices` in a new tab.
5. Require the new visit to start unauthenticated and redirect to `/login`. Local cleanup or closing a tab alone never counts as server-side session revocation.

The earlier attempt with the commercial email did not authenticate successfully and its tab was closed. It created no accepted technical browser session (session A), so no browser-session cleanup is claimed or required for that attempt. The successful evidence is only the verifier's self-contained session (session B), which recorded `session_deleted=true`.

## Rollback

1. Select the last known-good reviewed commit without changing public configuration.
2. Deploy that commit explicitly and verify the resolved deployment commit.
3. Require healthy container state and the exact public HTTPS health response.
4. Repeat the private production verifier and require `session_deleted=true`.
5. If rollback does not restore authentication or device reads, keep the current evidence, inspect Appwrite hostname and API CORS alignment, and escalate for reviewed recovery. Do not broaden origin rules, delete production data, or copy server credentials into the panel.

A panel source rollback does not roll back Appwrite sessions, documents, API state, or agent state.

## Verified deployment record

On 2026-09-30, deployment `wtmjwdxjyo3pp2g2ouk1cfbi` finished healthy from commit `58ab8e0d22d19ecad25254865c9c2b3fc4c5c60b`. Coolify built the panel from `/apps/panel/Dockerfile`, exposed port `3000`, and served the public HTTPS endpoint with the `/health` probe passing.

The Appwrite Web platform hostname was registered and the API CORS allowlist was set to the exact HTTPS panel origin. Production acceptance used the private verifier to execute Appwrite `GET /account`, Appwrite `POST /account/jwts`, authenticated API `GET /v1/devices` with HTTP 200, and Appwrite `DELETE /account/sessions/current` in one process. Private redacted evidence recorded `session_deleted=true`; no credentials or session material were retained in this record. No successful interactive browser login is claimed.

This record is dated evidence, not permission to skip fresh verification on a later deployment.
