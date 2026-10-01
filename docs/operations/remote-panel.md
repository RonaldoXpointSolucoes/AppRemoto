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

The panel has exactly three application-specific environment variable names. All three are public browser configuration and must be available during both the Docker build and container runtime:

| Name | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APPWRITE_ENDPOINT` | Appwrite Web SDK endpoint |
| `NEXT_PUBLIC_APPWRITE_PROJECT_ID` | Appwrite production project identifier |
| `NEXT_PUBLIC_API_BASE_URL` | Public `remote-api` HTTPS base URL |

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
9. Run the browser acceptance sequence below. Keep credentials and session material out of screenshots, console output, reports, and documentation.
10. Confirm auto-deploy remains off after validation.

## Browser acceptance

Use the dedicated authorized technician account through the public HTTPS endpoint. Never place its password in a command line, URL, report, or source-controlled fixture.

1. Open `/login` and authenticate through the Appwrite Web SDK.
2. Confirm profile verification succeeds through `GET /v1/me` and the panel reaches `/devices`.
3. Confirm the organizations and devices requests return HTTP 200 through the production API.
4. Verify the desktop table and mobile records expose only the safe device projection. They must not render tokens, passwords, API keys, ciphertext, cookies, internal IP data, or sensitive audit metadata.
5. Exercise organization, status, and search filters together, then refresh and confirm the filters remain selected.
6. Verify session expiry removes the local Appwrite session once and returns to `/login` without a redirect or refresh loop.
7. End the acceptance session and confirm it has been removed. Do not preserve browser storage as evidence.

Record only timestamps, pass/fail results, HTTP status codes, non-secret counts, commit/deployment identifiers, and redacted screenshots.

## Rollback

1. Select the last known-good reviewed commit without changing public configuration.
2. Deploy that commit explicitly and verify the resolved deployment commit.
3. Require healthy container state and the exact public HTTPS health response.
4. Repeat the complete browser acceptance sequence, including session cleanup.
5. If rollback does not restore authentication or device reads, keep the current evidence, inspect Appwrite hostname and API CORS alignment, and escalate for reviewed recovery. Do not broaden origin rules, delete production data, or copy server credentials into the panel.

A panel source rollback does not roll back Appwrite sessions, documents, API state, or agent state.

## Verified deployment record

On 2026-09-30, deployment `wtmjwdxjyo3pp2g2ouk1cfbi` finished healthy from commit `58ab8e0d22d19ecad25254865c9c2b3fc4c5c60b`. Coolify built the panel from `/apps/panel/Dockerfile`, exposed port `3000`, and served the public HTTPS endpoint with the `/health` probe passing.

The Appwrite Web platform hostname was registered and the API CORS allowlist was set to the exact HTTPS panel origin. Production browser acceptance verified Appwrite authentication, JWT-backed API access, and organizations/devices responses with HTTP 200. The acceptance session was removed afterward. No credentials or session material were retained in this record.

This record is dated evidence, not permission to skip fresh verification on a later deployment.
