import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const base = Buffer.from([77, 90, 1, 2, 3, 4]);
const token = 'synthetic-generic-only'.padEnd(43, 't');
const installer = { id: 'installer-a', name: 'Instalador geral XPoint', active: true, createdAt: '2026-10-01T00:00:00.000Z', revokedAt: null };
const packageFor = (installerId: string) => ({ schemaVersion: 2, installerId, installerToken: token });
async function authenticate(page: Page, admin = true) {
  await page.route('**/account/jwts', (route) => route.fulfill({ json: { jwt: 'aaa.bbb.ccc' } }));
  await page.route('**/v1/me', (route) => route.fulfill({ json: {
    id: 'tech-1', displayName: 'Tecnico', globalRole: admin ? 'super_admin' : null, authorization: [],
  } }));
  await page.route('**/installers/complete-manifest.json', (route) => route.fulfill({ json: {
    version: '1.2.1', path: '/installers/xpoint-complete-1.2.1.exe', sha256: createHash('sha256').update(base).digest('hex'), bytes: base.length,
  } }));
  await page.route('**/installers/xpoint-complete-1.2.1.exe', (route) => route.fulfill({ body: base, contentType: 'application/octet-stream' }));
}
async function download(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar instalador completo' }).click();
  const downloaded = await event;
  expect(downloaded.suggestedFilename()).toBe('XPoint-Instalar-Completo.exe');
  return readFile((await downloaded.path())!);
}
test('complete package is reusable, asks for names only inside Windows, and does not expose its capability', async ({ page }, testInfo) => {
  await authenticate(page);
  let issued = 0; let redownloads = 0;
  const urls: string[] = []; const payloads: unknown[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await page.route('**/v1/generic-installers', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { installers: issued ? [installer] : [] } });
    issued++; payloads.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { installer, package: packageFor(installer.id) } });
  });
  await page.route('**/v1/generic-installers/installer-a/package', (route) => {
    redownloads++; expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({ json: { package: packageFor(installer.id) } });
  });
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Um instalador para todos os computadores.' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Baixar instalador completo' })).toBeEnabled();
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`generic-setup-${width}.png`), fullPage: true });
  }
  const bytes = await download(page);
  const marker = Buffer.from('XPOINT_GENERIC_V1');
  expect(bytes.subarray(0, base.length)).toEqual(base); expect(bytes.subarray(-marker.length)).toEqual(marker);
  const size = bytes.readUInt32LE(bytes.length - marker.length - 4);
  expect(JSON.parse(bytes.subarray(base.length, base.length + size).toString())).toEqual(packageFor(installer.id));
  expect(await download(page)).toEqual(bytes);
  expect(issued).toBe(1); expect(redownloads).toBe(1);
  expect(payloads).toEqual([{ name: 'Instalador geral XPoint' }]);
  expect(urls.every((url) => !url.includes(token))).toBe(true);
  await expect(page.locator('body')).not.toContainText(token);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(token);
  await expect(page.getByRole('link', { name: 'RustDesk: licença e código-fonte' })).toHaveAttribute('href', 'https://github.com/rustdesk/rustdesk/tree/1.4.9');
});
test('selected authorization can be revoked and cannot issue another package after revocation', async ({ page }) => {
  await authenticate(page);
  const second = { ...installer, id: 'installer-b', name: 'Equipe B' };
  let revoked = false; const packageIds: string[] = [];
  await page.route('**/v1/generic-installers', (route) => route.fulfill({ json: { installers: [installer, second] } }));
  await page.route('**/v1/generic-installers/*/package', (route) => {
    const id = route.request().url().split('/').at(-2)!; packageIds.push(id);
    return route.fulfill({ json: { package: packageFor(id) } });
  });
  await page.route('**/v1/generic-installers/installer-b/revoke', (route) => {
    expect(route.request().postDataJSON()).toEqual({}); revoked = true;
    return route.fulfill({ json: { revoked: true } });
  });
  await page.goto('/setup');
  await page.getByLabel('Autorização do instalador').selectOption(second.id);
  await download(page);
  await page.getByText('Autorizações de instalação', { exact: true }).click();
  await page.getByRole('button', { name: 'Revogar Equipe B', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Computadores já cadastrados continuam funcionando');
  expect(revoked).toBe(true);
  await expect(page.getByRole('button', { name: 'Revogar Equipe B', exact: true })).toHaveCount(0);
  await download(page);
  expect(packageIds).toEqual(['installer-b', 'installer-a']);
});
test('a failed artifact check prevents issuing a capability', async ({ page }) => {
  await authenticate(page); let issued = false;
  await page.route('**/v1/generic-installers', (route) => {
    if (route.request().method() !== 'GET') issued = true;
    return route.fulfill({ json: { installers: [] } });
  });
  await page.route('**/installers/xpoint-complete-1.2.0.exe', (route) => route.fulfill({ body: Buffer.from('bad') }));
  await page.goto('/setup');
  await page.getByRole('button', { name: 'Baixar instalador completo' }).click();
  await expect(page.getByRole('region', { name: 'Um instalador para todos os computadores.' }).getByRole('alert')).toContainText('Não foi possível preparar o instalador');
  expect(issued).toBe(false);
});
test('an expired session during issuance redirects to login without a download', async ({ page }) => {
  await authenticate(page); let downloads = 0; let deletions = 0;
  page.on('download', () => downloads++);
  await page.route('**/account/sessions/current', (route) => { deletions++; return route.fulfill({ status: 204 }); });
  await page.route('**/v1/generic-installers', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { installers: [] } })
    : route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'expired' } } }));
  await page.goto('/setup');
  await page.getByRole('button', { name: 'Baixar instalador completo' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(downloads).toBe(0); expect(deletions).toBe(1);
});
test('ordinary technicians receive installer instructions without administrative controls', async ({ page }) => {
  await authenticate(page, false); let requested = false;
  await page.route('**/v1/generic-installers', (route) => { requested = true; return route.abort(); });
  await page.goto('/setup');
  await expect(page.getByText(/Peça a um administrador o instalador completo/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baixar instalador completo' })).toHaveCount(0);
  await expect(page.getByText('Autorizações de instalação', { exact: true })).toHaveCount(0);
  expect(requested).toBe(false);
});
