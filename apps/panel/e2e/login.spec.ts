import { expect, test } from '@playwright/test';

test('an unauthenticated devices visit redirects to login without looping', async ({ page }) => {
  let jwtRequests = 0;
  await page.route('**/account/sessions/current', (route) => route.fulfill({ status: 204 }));
  await page.route('**/account/jwts', async (route) => {
    jwtRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      status: 401,
      body: JSON.stringify({ message: 'missing session', code: 401, type: 'general_unauthorized_scope' }),
    });
  });

  await page.goto('/devices');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Acesso tecnico' })).toBeVisible();
  expect(jwtRequests).toBe(1);
});

test('an API-expired session is removed once before redirecting to login', async ({ page }) => {
  let removedSessions = 0;
  await page.route('**/account/jwts', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ jwt: 'aaa.bbb.ccc' }) });
  });
  await page.route('**/v1/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      status: 401,
      body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }),
    });
  });
  await page.route('**/account/sessions/current', async (route) => {
    removedSessions += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto('/devices');

  await expect(page).toHaveURL(/\/login$/);
  expect(removedSessions).toBe(1);
});

test('a session network failure remains recoverable and does not remove the session', async ({ page }) => {
  let removedSessions = 0;
  await page.route('**/account/jwts', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      status: 503,
      body: JSON.stringify({ message: 'upstream detail', code: 503, type: 'general_server_error' }),
    });
  });
  await page.route('**/account/sessions/current', async (route) => {
    removedSessions += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto('/devices');

  await expect(page).toHaveURL(/\/devices$/);
  await expect(page.getByText('Nao foi possivel verificar sua sessao.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  expect(removedSessions).toBe(0);
});

test('a disabled profile on a protected route removes the session once and redirects', async ({ page }) => {
  let removedSessions = 0;
  await page.route('**/account/jwts', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ jwt: 'aaa.bbb.ccc' }) });
  });
  await page.route('**/v1/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      status: 403,
      body: JSON.stringify({ error: { code: 'TECHNICIAN_DISABLED', message: 'Access denied' } }),
    });
  });
  await page.route('**/account/sessions/current', async (route) => {
    removedSessions += 1;
    await route.fulfill({ status: 204 });
  });

  await page.goto('/devices');

  await expect(page).toHaveURL(/\/login$/);
  expect(removedSessions).toBe(1);
});

test('login retries only profile verification after a recoverable failure', async ({ page }) => {
  let sessionCreates = 0;
  let jwtRequests = 0;
  await page.route('**/account/sessions/email', async (route) => {
    sessionCreates += 1;
    await route.fulfill({ contentType: 'application/json', status: 201, body: JSON.stringify({ $id: 'session-id' }) });
  });
  await page.route('**/account/jwts', async (route) => {
    jwtRequests += 1;
    if (jwtRequests === 1) {
      await route.fulfill({
        contentType: 'application/json',
        status: 503,
        body: JSON.stringify({ message: 'temporary detail', code: 503, type: 'general_server_error' }),
      });
      return;
    }
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ jwt: 'aaa.bbb.ccc' }) });
  });
  await page.route('**/v1/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({
      id: 'technician-1', displayName: 'Technician', globalRole: 'super_admin', authorization: [],
    }) });
  });

  await page.goto('/login');
  await page.getByLabel('E-mail').fill('tecnico@example.com');
  await page.getByLabel('Senha').fill('senha-segura');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Nao foi possivel verificar seu acesso.', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Tentar novamente' }).click();

  await expect(page).toHaveURL(/\/devices$/);
  expect(sessionCreates).toBe(1);
  expect(jwtRequests).toBeGreaterThanOrEqual(2);
});
