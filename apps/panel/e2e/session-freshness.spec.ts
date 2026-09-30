import { expect, test, type Page } from '@playwright/test';

const device = {
  id: 'device-1', organizationId: 'org-a', organizationName: 'Norte',
  deviceUuid: '00000000-0000-4000-8000-000000000001', displayName: 'Recepcao',
  hostname: 'RECEPCAO', operatingSystem: 'Windows', osVersion: '11', rustdeskId: '123456789',
  agentVersion: '1.0.0', rustdeskVersion: '1.4.0', lastSeenAt: '2026-09-30T18:00:00Z', enabled: true, status: 'ONLINE',
};
const profile = { id: 'tech-1', displayName: 'Tecnico', globalRole: 'super_admin', authorization: [] };
const organizations = { organizations: [{ id: 'org-a', name: 'Norte', slug: 'norte' }] };
async function authenticate(page: Page) {
  await page.route('**/account/jwts', route => route.fulfill({ json: { jwt: 'aaa.bbb.ccc' } }));
  await page.route('**/v1/me', route => route.fulfill({ json: profile }));
  await page.route('**/v1/organizations', route => route.fulfill({ json: organizations }));
  await page.route('**/account/sessions/email', route => route.fulfill({ status: 201, json: { $id: 'new-session' } }));
}

for (const width of [1440, 390]) {
  test(`refresh and polling replace old snapshots and recover presence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install();
    await authenticate(page);
    const queries: URL[] = [];
    let status = 'ONLINE';
    let fail = false;
    await page.route('**/v1/devices?**', route => {
      const url = new URL(route.request().url());
      queries.push(url);
      return route.fulfill(fail ? { status: 503, json: { error: { code: 'UNAVAILABLE', message: 'temporary' } } }
        : { json: { devices: [{ ...device, status }], nextCursor: url.searchParams.has('cursor') ? null : 'old-snapshot-cursor' } });
    });
    await page.goto('/devices');
    const results = width > 600 ? page.getByRole('table') : page.getByRole('article');
    await expect(results.getByText('ONLINE', { exact: true })).toBeVisible();
    await page.getByLabel('Organizacao').selectOption('org-a');
    await expect(results.getByText('ONLINE', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Proxima pagina' }).click();
    await expect(page.getByRole('button', { name: 'Pagina anterior' })).toBeVisible();
    status = 'OFFLINE';
    await page.getByRole('button', { name: 'Atualizar dispositivos' }).click();
    await expect.poll(() => queries.at(-1)?.searchParams.has('cursor')).toBe(false);
    await expect(page.getByRole('button', { name: 'Pagina anterior' })).toBeHidden();
    await expect(results.getByText('OFFLINE', { exact: true })).toBeVisible();
    for (let tick = 0; tick < 10; tick += 1) {
      const count = queries.length;
      status = tick >= 4 ? 'ONLINE' : 'OFFLINE';
      await page.clock.runFor(30_000);
      await expect.poll(() => queries.length).toBe(count + 1);
      await expect(results.getByText(status, { exact: true })).toBeVisible();
      expect(queries.at(-1)?.searchParams.has('cursor')).toBe(false);
      expect(queries.at(-1)?.searchParams.get('organizationId')).toBe('org-a');
    }
    fail = true;
    await page.clock.runFor(30_000);
    await expect(results.getByText('Indisponivel', { exact: true })).toBeVisible();
    fail = false;
    await page.clock.runFor(30_000);
    await expect(results.getByText('ONLINE', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Organizacao')).toHaveValue('org-a');
  });
}

for (const endpoint of ['jwt', 'profile']) {
  test(`${endpoint} 401 on profile retry restores usable login and clears the session`, async ({ page }) => {
    await authenticate(page);
    let calls = 0;
    let deletes = 0;
    await page.route('**/account/sessions/current', route => { deletes += 1; return route.fulfill({ status: 204 }); });
    await page.route(endpoint === 'jwt' ? '**/account/jwts' : '**/v1/me', route => {
      calls += 1;
      return route.fulfill({ status: calls === 1 ? 503 : 401, json: endpoint === 'jwt'
        ? { message: 'upstream', code: calls === 1 ? 503 : 401, type: 'general_unauthorized_scope' }
        : { error: { code: 'UNAUTHENTICATED', message: 'upstream' } } });
    });
    await page.goto('/login');
    await page.getByLabel('E-mail').fill('tech@example.com');
    await page.getByLabel('Senha').fill('test-password');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.locator('.login-form').getByRole('alert')).toHaveText('Sessao expirada. Entre novamente.');
    await expect(page.getByLabel('Senha')).toBeEnabled();
    await expect(page.getByLabel('E-mail')).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled();
    expect(deletes).toBe(1);
  });
}

test('an expired device cache cannot sign out a newly authenticated session', async ({ page }) => {
  await authenticate(page);
  let fail = false;
  let deletes = 0;
  let finishNewOrganizations!: () => void;
  await page.route('**/account/sessions/current', route => { deletes += 1; return route.fulfill({ status: 204 }); });
  await page.route('**/v1/organizations', async route => {
    if (deletes > 0) await new Promise<void>(resolve => { finishNewOrganizations = resolve; });
    return route.fulfill({ json: organizations });
  });
  await page.route('**/v1/devices?**', route => route.fulfill(fail
    ? { status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'expired' } } }
    : { json: { devices: [device], nextCursor: null } }));
  await page.goto('/devices');
  await expect(page.getByRole('table').getByText('ONLINE')).toBeVisible();
  fail = true;
  await page.getByRole('button', { name: 'Atualizar dispositivos' }).click();
  await expect(page).toHaveURL(/\/login$/);
  fail = false;
  await page.getByLabel('E-mail').fill('b@example.com');
  await page.getByLabel('Senha').fill('password-b');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect.poll(() => Boolean(finishNewOrganizations)).toBe(true);
  expect(deletes).toBe(1);
  finishNewOrganizations();
  await expect(page.getByRole('table').getByText('ONLINE')).toBeVisible();
  expect(deletes).toBe(1);
});

test('health endpoint is available without session or public credentials', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('a delayed session A device 401 cannot delete session B after client navigation', async ({ page }) => {
  await authenticate(page);
  let expireA = false;
  let deletes = 0;
  let finishOldDevices!: () => void;
  let markOldRequestStarted!: () => void;
  const oldRequestStarted = new Promise<void>(resolve => { markOldRequestStarted = resolve; });
  await page.route('**/account/sessions/current', route => { deletes += 1; return route.fulfill({ status: 204 }); });
  await page.route('**/v1/organizations', async route => {
    if (expireA) {
      await oldRequestStarted;
      return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'expired A' } } });
    }
    return route.fulfill({ json: organizations });
  });
  await page.route('**/v1/devices?**', async route => {
    if (expireA) {
      markOldRequestStarted();
      await new Promise<void>(resolve => { finishOldDevices = resolve; });
      return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'late A' } } });
    }
    return route.fulfill({ json: { devices: [{ ...device, displayName: deletes ? 'Sessao B' : 'Sessao A' }], nextCursor: null } });
  });
  await page.goto('/devices');
  await expect(page.getByRole('table').getByText('Sessao A')).toBeVisible();
  expireA = true;
  await page.getByRole('button', { name: 'Atualizar dispositivos' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expireA = false;
  await page.getByLabel('E-mail').fill('b@example.com');
  await page.getByLabel('Senha').fill('password-b');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('table').getByText('Sessao B')).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.url().includes('/v1/devices?') && response.status() === 401);
  finishOldDevices();
  await oldResponse;
  await page.getByRole('button', { name: 'Atualizar dispositivos' }).click();
  await expect(page.getByRole('table').getByText('Sessao B')).toBeVisible();
  expect(deletes).toBe(1);
});
