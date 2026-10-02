import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const base = Buffer.from([77, 90, 1, 2, 3, 4]);
const token = 'synthetic'.padEnd(43, 't');
const enrolledDevice = {
  id: 'device-enrolled', organizationId: 'org-a', organizationName: 'Cliente A',
  deviceUuid: '00000000-0000-4000-8000-000000000099', displayName: 'Recepção',
  hostname: 'PC-CLIENTE', operatingSystem: 'Windows', osVersion: '11', rustdeskId: '123456789',
  agentVersion: '1.0.3', rustdeskVersion: '1.4.9', lastSeenAt: new Date().toISOString(), enabled: true, status: 'ONLINE',
};

async function authenticate(page: Page, canManage = true) {
  await page.route('**/account/jwts', (route) => route.fulfill({ json: { jwt: 'aaa.bbb.ccc' } }));
  await page.route('**/v1/me', (route) => route.fulfill({ json: {
    id: 'tech-1', displayName: 'Tecnico', globalRole: null,
    authorization: [{ organizationId: 'org-a', role: 'technician', canView: true, canConnect: true, canManageDevices: canManage }],
  } }));
  await page.route('**/v1/organizations', (route) => route.fulfill({ json: {
    organizations: [{ id: 'org-a', name: 'Cliente A', slug: 'cliente-a' }, { id: 'org-b', name: 'Cliente B', slug: 'cliente-b' }],
  } }));
  await page.route('**/installers/manifest.json', (route) => route.fulfill({ json: {
    version: '1.0.3', path: '/installers/xpoint-setup-1.0.3.exe', sha256: createHash('sha256').update(base).digest('hex'), bytes: base.length,
  } }));
  await page.route('**/installers/xpoint-setup-1.0.3.exe', (route) => route.fulfill({ body: base, contentType: 'application/octet-stream' }));
}

test('download contains the exact single-use enrollment and monitors its receipt without exposing the token', async ({ page }, testInfo) => {
  await authenticate(page);
  const expiresAt = new Date(Date.now() + 1_800_000).toISOString();
  let online = false;
  let creates = 0;
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/v1/enrollment-tokens', (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ organizationId: 'org-a', deviceDisplayName: 'Recepção' });
    creates++;
    return route.fulfill({ status: 201, json: { enrollmentId: 'installation-exact', enrollmentToken: token, expiresAt } });
  });
  await page.route('**/v1/enrollment-tokens/installation-exact/status', (route) => route.fulfill({ json: online
    ? { status: 'online', expiresAt, device: enrolledDevice }
    : { status: 'waiting', expiresAt, device: null } }));
  await page.goto('/setup');
  await page.getByText('Configuração avançada: RustDesk já instalado', { exact: true }).click();
  await expect(page.getByText('Pré-requisito:', { exact: true })).toBeVisible();
  await expect(page.getByText('Configurador avançado · Windows 64 bits')).toBeVisible();
  await expect(page.getByLabel('Cliente', { exact: true })).toHaveValue('org-a');
  await expect(page.getByRole('option', { name: 'Cliente B' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('automatic-setup-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('automatic-setup-client-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('textbox', { name: 'Nome do computador', exact: true }).fill('Recepção');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar instalador do cliente' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('XPoint-Instalar-Cliente.exe');
  const bytes = await readFile((await download.path())!);
  const marker = Buffer.from('XPOINT_SETUP_V1');
  expect(bytes.subarray(0, base.length)).toEqual(base);
  expect(bytes.subarray(-marker.length)).toEqual(marker);
  const size = bytes.readUInt32LE(bytes.length - marker.length - 4);
  expect(JSON.parse(bytes.subarray(base.length, base.length + size).toString())).toEqual({
    schemaVersion: 1, enrollmentId: 'installation-exact', enrollmentToken: token, expiresAt, organizationId: 'org-a', deviceDisplayName: 'Recepção',
  });
  await expect(page.getByRole('heading', { name: 'Agora, execute no computador do cliente' })).toBeVisible();
  await expect(page.getByText('XPoint-Instalar-Cliente.log', { exact: true })).toBeVisible();
  online = true;
  await expect(page.getByRole('heading', { name: 'Computador conectado ao painel' })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole('button', { name: 'Conectar', exact: true })).toBeEnabled();
  expect(creates).toBe(1);
  expect(requests.every((url) => !url.includes(token))).toBe(true);
  await expect(page.locator('body')).not.toContainText(token);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(token);
  await page.screenshot({ path: testInfo.outputPath('installation-confirmed.png'), fullPage: true });
});

test('artifact integrity failure prevents issuing a provisioning token', async ({ page }) => {
  await authenticate(page);
  await page.route('**/installers/xpoint-setup-1.0.3.exe', (route) => route.fulfill({ body: Buffer.from('bad') }));
  let issued = false;
  await page.route('**/v1/enrollment-tokens', (route) => { issued = true; return route.abort(); });
  await page.goto('/setup');
  await page.getByText('Configuração avançada: RustDesk já instalado', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome do computador', exact: true }).fill('Recepção');
  await page.getByRole('button', { name: 'Baixar instalador do cliente' }).click();
  await expect(page.getByRole('region', { name: 'Configure. O computador aparece aqui.' }).getByRole('alert')).toContainText('Não foi possível preparar o instalador');
  expect(issued).toBe(false);
});

test('a viewer cannot generate installation packages and the compact page fits mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await authenticate(page, false);
  await page.goto('/setup');
  await page.getByText('Configuração avançada: RustDesk já instalado', { exact: true }).click();
  await expect(page.getByText('Sua conta não tem clientes com permissão para cadastrar computadores.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baixar instalador do cliente' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('automatic-setup-mobile.png'), fullPage: true });
});

test('confirmed installation masks failed checks, survives provisioning expiry and clears an expired session', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await authenticate(page);
  const expiresAt = new Date(Date.now() + 10_000).toISOString();
  let phase = 'online';
  let deletedSessions = 0;
  await page.route('**/account/sessions/current', (route) => { deletedSessions++; return route.fulfill({ status: 204 }); });
  await page.route('**/v1/enrollment-tokens', (route) => route.fulfill({ status: 201, json: { enrollmentId: 'installation-exact', enrollmentToken: token, expiresAt } }));
  await page.route('**/v1/enrollment-tokens/installation-exact/status', (route) => {
    if (phase === 'error') return route.fulfill({ status: 503, json: { error: { code: 'SETUP_UNAVAILABLE', message: 'private server detail' } } });
    if (phase === 'expired') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'session expired' } } });
    return route.fulfill({ json: { status: 'online', expiresAt, device: enrolledDevice } });
  });
  await page.goto('/setup');
  await page.getByText('Configuração avançada: RustDesk já instalado', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome do computador', exact: true }).fill('Recepção');
  await page.getByRole('button', { name: 'Baixar instalador do cliente' }).click();
  await expect(page.getByRole('heading', { name: 'Computador conectado ao painel' })).toBeVisible();
  phase = 'error';
  await page.clock.fastForward(15_000);
  await expect(page.getByRole('heading', { name: 'Verificação de conexão indisponível' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Computador conectado ao painel' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Conectar', exact: true })).toBeDisabled();
  await expect(page.locator('body')).not.toContainText('private server detail');
  phase = 'online';
  await page.clock.fastForward(6_000);
  await expect(page.getByRole('heading', { name: 'Computador conectado ao painel' })).toBeVisible();
  phase = 'expired';
  await page.clock.fastForward(6_000);
  await expect(page).toHaveURL(/\/login$/);
  expect(deletedSessions).toBe(1);
  await expect(page.locator('body')).not.toContainText('Recepção');
});

test('technician can generate another installer with a new name and monitor its new receipt', async ({ page }) => {
  await authenticate(page);
  const expiresAt = new Date(Date.now() + 1_800_000).toISOString();
  let issued = 0; const names: string[] = [];
  await page.route('**/v1/enrollment-tokens', (route) => {
    names.push(route.request().postDataJSON().deviceDisplayName); issued++;
    return route.fulfill({ status: 201, json: { enrollmentId: `package-${issued}`, enrollmentToken: token, expiresAt } });
  });
  await page.route('**/v1/enrollment-tokens/*/status', (route) => route.fulfill({ json:
    route.request().url().includes('package-2')
      ? { status: 'online', expiresAt, device: { ...enrolledDevice, displayName: 'Burguer Servidor' } }
      : { status: 'waiting', expiresAt, device: null } }));
  await page.goto('/setup');
  await page.getByText('Configuração avançada: RustDesk já instalado', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome do computador', exact: true }).fill('Primeiro teste');
  await page.getByRole('button', { name: 'Baixar instalador do cliente' }).click();
  await expect(page.getByText('Você não precisa lembrar o nome anterior.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Gerar novo instalador' }).click();
  await page.getByRole('textbox', { name: 'Nome do computador', exact: true }).fill('Burguer Servidor');
  await page.getByRole('button', { name: 'Baixar instalador do cliente' }).click();
  await expect(page.getByRole('heading', { name: 'Computador conectado ao painel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar', exact: true })).toBeEnabled();
  expect(names).toEqual(['Primeiro teste', 'Burguer Servidor']);
});
