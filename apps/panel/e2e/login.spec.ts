import { expect, test } from '@playwright/test';

test('an unauthenticated devices visit redirects to login without looping', async ({ page }) => {
  let jwtRequests = 0;
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
