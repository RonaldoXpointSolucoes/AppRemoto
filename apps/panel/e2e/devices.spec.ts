import { expect, test, type Page } from '@playwright/test';

const device = {
  id: 'device-1', organizationId: 'org-a', organizationName: 'Operacao Norte',
  deviceUuid: '00000000-0000-4000-8000-000000000001',
  displayName: 'Recepcao principal com nome operacional muito longo para validar o layout responsivo',
  hostname: 'RECEPCAO-PRINCIPAL-HOSTNAME-MUITO-LONGO-SEM-QUEBRA-INDESEJADA',
  operatingSystem: 'Windows', osVersion: '11 Pro', rustdeskId: '123456789',
  agentVersion: '1.0.0', rustdeskVersion: '1.4.0',
  lastSeenAt: '2026-09-30T18:00:00.000Z', enabled: true, status: 'ONLINE',
};

async function mockAuthenticatedDevices(page: Page) {
  await page.route('**/account/jwts', (route) => route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ jwt: 'aaa.bbb.ccc' }) }));
  await page.route('**/v1/me', (route) => route.fulfill({ contentType: 'application/json', status: 200,
    body: JSON.stringify({ id: 'tech-1', displayName: 'Tecnico', globalRole: 'super_admin', authorization: [] }) }));
  await page.route('**/v1/organizations', (route) => route.fulfill({ contentType: 'application/json', status: 200,
    body: JSON.stringify({ organizations: [
      { id: 'org-a', name: 'Operacao Norte', slug: 'operacao-norte' },
      { id: 'org-b', name: 'Operacao Sul', slug: 'operacao-sul' },
    ] }) }));
}

test('desktop device table composes filters and keyset pagination without sensitive fields', async ({ page }) => {
  await mockAuthenticatedDevices(page);
  const queries: URL[] = [];
  await page.route('**/v1/devices?**', (route) => {
    const url = new URL(route.request().url());
    queries.push(url);
    const pagedDevice = url.searchParams.has('cursor')
      ? { ...device, id: 'device-2', deviceUuid: '00000000-0000-4000-8000-000000000002' }
      : device;
    return route.fulfill({ contentType: 'application/json', status: 200,
      body: JSON.stringify({ devices: [pagedDevice], nextCursor: url.searchParams.has('cursor') ? null : 'cursor-page-2' }) });
  });
  await page.goto('/devices');
  await expect(page.getByRole('table', { name: 'Dispositivos remotos' })).toBeVisible();
  await expect(page.getByRole('article', { name: device.displayName })).toBeHidden();
  await expect(page.getByRole('table', { name: 'Dispositivos remotos' }).getByText('ONLINE')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/token|password|192\.168\./i);
  await page.getByRole('button', { name: 'Proxima pagina' }).click();
  await expect.poll(() => queries.some((url) => url.searchParams.get('cursor') === 'cursor-page-2')).toBe(true);
  await page.getByRole('button', { name: 'Pagina anterior' }).click();
  await expect.poll(() => queries.filter((url) => !url.searchParams.has('cursor')).length).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Proxima pagina' }).click();
  await page.getByLabel('Organizacao').selectOption('org-b');
  await page.getByLabel('Status').selectOption('OFFLINE');
  await page.getByLabel('Buscar dispositivos').fill('caixa 02');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect.poll(() => queries.some((url) => url.searchParams.get('organizationId') === 'org-b'
    && url.searchParams.get('status') === 'OFFLINE' && url.searchParams.get('search') === 'caixa 02'
    && !url.searchParams.has('cursor'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Pagina anterior' })).toBeHidden();
});

test('failed refresh keeps filters visible and masks the cached online state', async ({ page }) => {
  await mockAuthenticatedDevices(page);
  let failRefresh = false;
  await page.route('**/v1/devices?**', (route) => failRefresh
    ? route.fulfill({ contentType: 'application/json', status: 503,
      body: JSON.stringify({ error: { code: 'DEVICES_UNAVAILABLE', message: 'private refresh detail' } }) })
    : route.fulfill({ contentType: 'application/json', status: 200,
      body: JSON.stringify({ devices: [device], nextCursor: null }) }));
  await page.goto('/devices');
  await expect(page.getByRole('table', { name: 'Dispositivos remotos' }).getByText('ONLINE')).toBeVisible();
  await page.getByLabel('Status').selectOption('ONLINE');
  await expect(page.getByRole('table', { name: 'Dispositivos remotos' }).getByText('ONLINE')).toBeVisible();
  failRefresh = true;
  await page.getByRole('button', { name: 'Atualizar dispositivos' }).click();
  await expect(page.getByText('Nao foi possivel atualizar os dispositivos. Os status estao indisponiveis.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Status')).toHaveValue('ONLINE');
  await expect(page.getByRole('table', { name: 'Dispositivos remotos' }).getByText('Indisponivel')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('private refresh detail');
});

test('mobile records preserve hierarchy and contain long values inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthenticatedDevices(page);
  await page.route('**/v1/devices?**', (route) => route.fulfill({ contentType: 'application/json', status: 200,
    body: JSON.stringify({ devices: [device], nextCursor: null }) }));
  await page.goto('/devices');
  const record = page.getByRole('article', { name: device.displayName });
  await expect(record).toBeVisible();
  await expect(page.getByRole('table', { name: 'Dispositivos remotos' })).toBeHidden();
  for (const label of ['Organizacao', 'Hostname', 'Sistema operacional', 'RustDesk ID', 'Status', 'Ultima atividade']) {
    await expect(record.getByText(label, { exact: true })).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
