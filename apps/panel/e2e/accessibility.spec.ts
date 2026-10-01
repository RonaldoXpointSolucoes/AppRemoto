import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const devices = [
  {
    id: 'device-online', organizationId: 'org-a', organizationName: 'Operacao Norte',
    deviceUuid: '00000000-0000-4000-8000-000000000001',
    displayName: 'Recepcao principal com nome operacional extraordinariamente longo e sem abreviacoes',
    hostname: 'RECEPCAO-PRINCIPAL-HOSTNAME-EXTREMAMENTE-LONGO-SEM-SEPARADORES',
    operatingSystem: 'Windows', osVersion: '11 Pro', rustdeskId: '123456789012345678901234567890',
    agentVersion: '1.0.0', rustdeskVersion: '1.4.0',
    lastSeenAt: '2026-09-30T18:00:00.000Z', enabled: true, status: 'ONLINE',
  },
  {
    id: 'device-offline', organizationId: 'org-a', organizationName: 'Operacao Norte',
    deviceUuid: '00000000-0000-4000-8000-000000000002',
    displayName: 'Expedicao', hostname: 'EXPEDICAO-02', operatingSystem: 'Windows', osVersion: '10 Pro',
    rustdeskId: '987654321', agentVersion: '1.0.0', rustdeskVersion: '1.4.0',
    lastSeenAt: '2026-09-30T17:00:00.000Z', enabled: true, status: 'OFFLINE',
  },
] as const;

async function mockAuthenticatedDevices(page: Page) {
  await page.route('**/account/jwts', (route) => route.fulfill({
    contentType: 'application/json', status: 200, body: JSON.stringify({ jwt: 'aaa.bbb.ccc' }),
  }));
  await page.route('**/v1/me', (route) => route.fulfill({ contentType: 'application/json', status: 200,
    body: JSON.stringify({ id: 'tech-1', displayName: 'Tecnico', globalRole: 'super_admin', authorization: [] }) }));
  await page.route('**/v1/organizations', (route) => route.fulfill({ contentType: 'application/json', status: 200,
    body: JSON.stringify({ organizations: [{ id: 'org-a', name: 'Operacao Norte', slug: 'operacao-norte' }] }) }));
  await page.route('**/v1/devices?**', (route) => route.fulfill({ contentType: 'application/json', status: 200,
    body: JSON.stringify({ devices, nextCursor: null }) }));
}

async function expectVisibleFocus(locator: Locator) {
  await expect(locator).toBeFocused();
  const outline = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThanOrEqual(2);
}

test('login exposes labels, keyboard order, visible focus, and a responsive 360px layout', async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/login');

  const email = page.getByRole('textbox', { name: 'E-mail' });
  const password = page.getByLabel('Senha');
  const submit = page.getByRole('button', { name: 'Entrar' });
  await page.keyboard.press('Tab');
  await expectVisibleFocus(email);
  await page.keyboard.press('Tab');
  await expectVisibleFocus(password);
  await page.keyboard.press('Tab');
  await expectVisibleFocus(submit);
  await page.keyboard.press('Enter');
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Informe um e-mail valido.')).toBeVisible();

  const geometry = await page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    panel: document.querySelector('.login-panel')?.getBoundingClientRect().toJSON(),
  }));
  expect(geometry.documentOverflow).toBeLessThanOrEqual(0);
  expect(geometry.panel?.x).toBeGreaterThanOrEqual(0);
  expect((geometry.panel?.right ?? 361)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: testInfo.outputPath('login-mobile-360.png'), fullPage: true });
});

test('device controls have accessible names, keyboard focus, touch-sized targets, and textual status', async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthenticatedDevices(page);
  await page.goto('/devices');

  const organization = page.getByRole('combobox', { name: 'Organizacao' });
  const status = page.getByRole('combobox', { name: 'Status' });
  const search = page.getByRole('textbox', { name: 'Buscar dispositivos' });
  const searchButton = page.getByRole('button', { name: 'Buscar', exact: true });
  const refreshButton = page.getByRole('button', { name: 'Atualizar dispositivos' });
  await organization.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  for (const [index, control] of [organization, status, search, searchButton, refreshButton].entries()) {
    if (index > 0) await page.keyboard.press('Tab');
    await expectVisibleFocus(control);
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  const table = page.getByRole('table', { name: 'Dispositivos remotos' });
  await expect(table.getByText('ONLINE', { exact: true })).toBeVisible();
  await expect(table.getByText('OFFLINE', { exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveCount(8);
  await page.screenshot({ path: testInfo.outputPath('devices-desktop-1440.png'), fullPage: true });
});
