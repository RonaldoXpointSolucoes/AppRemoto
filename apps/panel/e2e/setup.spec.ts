import { expect, test, type Page } from '@playwright/test';

async function authenticate(page: Page) {
  await page.route('**/account/jwts', (route) => route.fulfill({ json: { jwt: 'aaa.bbb.ccc' } }));
  await page.route('**/v1/me', (route) => route.fulfill({ json: {
    id: 'tech-1', displayName: 'Tecnico', globalRole: 'super_admin', authorization: [],
  } }));
  await page.route('**/v1/organizations', (route) => route.fulfill({ json: {
    organizations: [{ id: 'org-a', name: 'Cliente de teste', slug: 'cliente-teste' }],
  } }));
  await page.route('**/v1/devices?**', (route) => route.fulfill({ json: { devices: [], nextCursor: null } }));
}

test('technician can open the setup guide and return to devices at desktop, tablet and mobile widths', async ({ page }, testInfo) => {
  await authenticate(page);
  for (const width of [1440, 768, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/devices');
    const help = page.getByRole('link', { name: 'Como Configurar?' });
    await expect(help).toBeVisible();
    expect((await help.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    await help.click();
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Guia de Setup do XPoint Remote e RustDesk' })).toBeVisible();
    await expect(page.locator('article pre')).toHaveCount(3);
    for (const code of await page.locator('article pre').all()) {
      expect(await code.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const target of await page.locator('main a, main button, .setup-tasks label').all()) {
      expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    }
    await page.screenshot({ path: testInfo.outputPath(`setup-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Voltar para dispositivos' }).first().click();
    await expect(page).toHaveURL(/\/devices$/);
    await expect(page.getByRole('heading', { name: 'Dispositivos', exact: true })).toBeVisible();
  }
});

test('technician can track every setup stage, resume after reload and start another device', async ({ page }, testInfo) => {
  await authenticate(page);
  await page.route('**/account/sessions/current', (route) => route.fulfill({ status: 204 }));
  await page.goto('/setup');
  await expect(page.getByRole('checkbox')).toHaveCount(20);
  const progress = page.getByRole('progressbar', { name: 'Progresso da configuração' });
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('checkbox').first().check();
  await expect(progress).toHaveAttribute('aria-valuenow', '1');
  await page.reload();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await expect(progress).toHaveAttribute('aria-valuenow', '20');
  await expect(page.getByText('6 de 6 etapas concluídas', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('checklist-complete.png'), fullPage: false });
  await page.getByRole('button', { name: 'Começar outro dispositivo' }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('link', { name: 'Voltar para dispositivos' }).first().click();
  await page.getByRole('button', { name: 'Sair da conta' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/setup');
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
});

test('checklist remains usable when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      Object.defineProperty(window.sessionStorage, method, {
        value: () => { throw new Error('storage unavailable'); },
      });
    }
  });
  await authenticate(page);
  await page.goto('/setup');
  await page.getByRole('checkbox').first().check();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await page.getByRole('button', { name: 'Começar outro dispositivo' }).click();
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
});

test('direct setup navigation requires an authenticated session', async ({ page }) => {
  await page.route('**/account/jwts', (route) => route.fulfill({ status: 401, json: { message: 'unauthorized' } }));
  await page.route('**/account/sessions/current', (route) => route.fulfill({ status: 204 }));
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Guia de Setup do XPoint Remote e RustDesk' })).toBeHidden();
});
