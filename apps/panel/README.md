# Remote Panel

The panel embeds its public connection settings in the browser bundle. Configure all three values as Coolify build variables, not only runtime variables:

- `NEXT_PUBLIC_APPWRITE_ENDPOINT`
- `NEXT_PUBLIC_APPWRITE_PROJECT_ID`
- `NEXT_PUBLIC_API_BASE_URL`

Each URL must be an absolute HTTPS URL without credentials, query parameters, or fragments. The production build runs the configuration gate before `next build`; a missing or invalid value stops the image build.

The device directory polls every 30 seconds without overlapping an active request. Both polling and manual refresh start a new first-page snapshot while retaining organization, status, and search filters. Previous rows have their status masked during refresh and after a failure. Session transitions cancel and clear query data and use an epoch to ignore obsolete authorization failures.

`GET /health` returns `{ "status": "ok" }` without authentication. The container includes curl and checks this route on port 3000 while running the standalone server as the non-root `node` user.

`pnpm --filter @appremoto/panel test:e2e` builds with synthetic public configuration and starts the generated standalone server, including its static assets. Chromium covers desktop/mobile layouts, session transitions, snapshot refresh, and five minutes of polling with a controlled clock. API/Appwrite responses are intercepted; these tests do not replace production enrollment or RustDesk acceptance.
