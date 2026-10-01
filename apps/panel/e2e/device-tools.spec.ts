import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
const initialDevice = {
  id: 'device-tools', organizationId: 'org-a', organizationName: 'Cliente', deviceUuid: '00000000-0000-4000-8000-000000000001',
  displayName: 'Recepção', hostname: 'CLIENT-PC', operatingSystem: 'Windows', osVersion: '11', rustdeskId: '123456789',
  agentVersion: '1.0.3', rustdeskVersion: '1.4.9', lastSeenAt: '2026-10-01T20:00:00Z', enabled: true, status: 'ONLINE',
};
async function fixture(page: Page, canManage = true) {
  let device = { ...initialDevice }; let notes = 'Andar 2';
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/account/jwts', (route) => route.fulfill({ status: 200, json: { jwt: 'aaa.bbb.ccc' } }));
  await page.route('**/v1/me', (route) => route.fulfill({ status: 200, json: {
    id: 'tech-1', displayName: 'Técnico', globalRole: null,
    authorization: [{ organizationId: 'org-a', role: 'technician', canView: true, canConnect: true, canManageDevices: canManage }],
  } }));
  await page.route('**/v1/organizations', (route) => route.fulfill({ status: 200, json: { organizations: [{ id: 'org-a', name: 'Cliente', slug: 'cliente' }] } }));
  await page.route('**/v1/devices?**', (route) => route.fulfill({ status: 200, json: { devices: [device], nextCursor: null } }));
  await page.route('**/v1/devices/device-tools/details', (route) => route.fulfill({ status: 200, json: { device, notes,
    diagnostics: { agentOnline: true, heartbeatConfirmed: true, rustdeskIdValid: true, credentialAvailable: true } } }));
  await page.route('**/v1/devices/device-tools/connection-history', (route) => route.fulfill({ status: 200, json: { events: [] } }));
  await page.route('**/v1/devices/device-tools/connect', (route) => {
    requests.push(route.request().postDataJSON());
    // Authorization failure exercises the UI and local log without ever opening a real remote session.
    return route.fulfill({ status: 503, json: { error: { code: 'CONNECT_UNAVAILABLE', message: 'private-provider-detail' } } });
  });
  await page.route('**/v1/devices/device-tools/update', (route) => {
    const body = route.request().postDataJSON(); device = { ...device, displayName: body.displayName }; notes = body.notes;
    return route.fulfill({ status: 200, json: { device, notes } });
  });
  await page.goto('/devices');
  return { requests };
}
for (const width of [1440, 360]) test(`device tools edit, manual credentials and downloadable diagnostics at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const f = await fixture(page);
  const row = width === 360 ? page.getByRole('article', { name: 'Recepção' }) : page.getByRole('table').getByRole('row').filter({ hasText: 'Recepção' });
  await row.getByRole('button', { name: 'Conectar', exact: true }).click();
  await expect(row.getByText(/Não foi possível iniciar/)).toBeVisible();
  await row.getByRole('button', { name: 'Detalhes e opções' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName('Recepção');
  await expect(dialog.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
  await expect(dialog.getByText('nos dois computadores', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Testar abertura do RustDesk' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const box = await dialog.boundingBox(); expect(box!.width).toBeLessThanOrEqual(width - 16);
  await page.screenshot({ path: testInfo.outputPath(`device-tools-${width}.png`), fullPage: true });
  await dialog.getByLabel('Senha do RustDesk', { exact: true }).fill('synthetic-password-local-only');
  await dialog.getByRole('button', { name: 'Conectar com esta senha' }).click();
  await expect(dialog.getByLabel('Senha do RustDesk', { exact: true })).toHaveValue('');
  expect(f.requests.map((request) => request.mode)).toEqual(['automatic', 'manual']);
  expect(f.requests.every((request) => typeof request.attemptId === 'string')).toBe(true);
  expect(JSON.stringify(f.requests)).not.toContain('synthetic-password');
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('synthetic-password');
  await dialog.getByRole('button', { name: 'Editar informações' }).click();
  await dialog.getByRole('textbox', { name: 'Nome do computador', exact: true }).fill('Caixa novo');
  await expect(dialog).toHaveAccessibleName('Recepção');
  await dialog.getByRole('textbox', { name: 'Observações', exact: true }).fill('Sala 12 — contato da recepção');
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Caixa novo');
  const changed = page.getByRole('dialog');
  await expect(changed.getByText('Dados do computador atualizados.')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await changed.getByRole('button', { name: 'Baixar log de conexão' }).click();
  const download = await downloadPromise;
  const log = await readFile((await download.path())!, 'utf8');
  expect(download.suggestedFilename()).toBe('XPoint-conexoes.log');
  expect(log).toContain('CONNECT_UNAVAILABLE'); expect(log).toContain('"mode":"manual"');
  expect(log).not.toContain('synthetic-password'); expect(log).not.toContain('rustdesk://'); expect(log).not.toContain('private-provider-detail');
  await expect(page.locator('body')).not.toContainText('private-provider-detail');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeHidden();
});
test('view-only device tools do not render editing controls', async ({ page }) => {
  await fixture(page, false);
  await page.getByRole('table').getByRole('button', { name: 'Detalhes e opções' }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByText('Andar 2')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Editar informações' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Baixar log de conexão' })).toBeVisible();
});

test('a session-expired connection closes sensitive tools and returns to login', async ({ page }) => {
  await fixture(page);
  let deletes = 0;
  await page.route('**/account/sessions/current', (route) => { deletes += 1; return route.fulfill({ status: 204 }); });
  await page.route('**/v1/devices/device-tools/connect', (route) => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'expired' } } }));
  await page.getByRole('table').getByRole('button', { name: 'Detalhes e opções' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Senha do RustDesk', { exact: true }).fill('synthetic-expiring-password');
  await dialog.getByRole('button', { name: 'Conectar com esta senha' }).click();
  await expect(page).toHaveURL(/\/login$/); expect(deletes).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
