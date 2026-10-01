# Remote Panel

The panel embeds its public connection settings in the browser bundle. Configure all three values as Coolify build variables, not only runtime variables:

- `NEXT_PUBLIC_APPWRITE_ENDPOINT`
- `NEXT_PUBLIC_APPWRITE_PROJECT_ID`
- `NEXT_PUBLIC_API_BASE_URL`

Each URL must be an absolute HTTPS URL without credentials, query parameters, or fragments. The production build runs the configuration gate before `next build`; a missing or invalid value stops the image build.

The device directory polls every 30 seconds without overlapping an active request. Both polling and manual refresh start a new first-page snapshot while retaining organization, status, and search filters. Previous rows have their status masked during refresh and after a failure. Session transitions cancel and clear query data and use an epoch to ignore obsolete authorization failures.

The device header includes an accessible logout command. It awaits deletion of the current Appwrite session before advancing the session epoch, clearing protected query data, and returning to login. A failed deletion keeps the active state intact and presents a redacted, retryable error; concurrent clicks and authorization failures share the same in-flight deletion.

`GET /health` returns `{ "status": "ok" }` without authentication. The container includes curl and checks this route on port 3000 while running the standalone server as the non-root `node` user.

`pnpm --filter @appremoto/panel test:e2e` builds with synthetic public configuration and starts the generated standalone server, including its static assets. Chromium covers desktop/mobile layouts, session transitions, snapshot refresh, and five minutes of polling with a controlled clock. API/Appwrite responses are intercepted; these tests do not replace production enrollment or RustDesk acceptance.

## Guia manual de setup

O botao `Como Configurar?` em `/devices` abre `/setup`, protegido pelo mesmo
`SessionBoundary` do painel. O conteudo Markdown fica em
`src/features/setup/setup-guide.ts` e utiliza `NEXT_PUBLIC_API_BASE_URL` para
os comandos PowerShell. A renderizacao usa `react-markdown` sem HTML bruto.

O guia documenta o agente manual existente; nao emite enrollment tokens,
instala RustDesk, registra servico Windows nem inicia conexoes. O binario e
o token continuam sendo fornecidos pela equipe pelo fluxo autorizado.

Validacao focada: `pnpm --filter @appremoto/panel test:e2e setup.spec.ts devices.spec.ts`.
Os testes de navegador usam respostas sinteticas de Appwrite/API. Eles nao
substituem a homologacao com RustDesk, token valido e dispositivo Windows real.
