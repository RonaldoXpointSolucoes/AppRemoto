import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'node-appwrite';
import type { Payload } from 'node-appwrite';
import { readFile } from 'node:fs/promises';
import { createAppwriteGateway, readAppwriteEnvironment } from './appwrite-adapter.ts';
import { applyProvisionPlan } from './apply.ts';
import { inspectSchema } from './inspect.ts';
import { buildProvisionPlan } from './plan.ts';
import { FakeGateway } from './testing/fake-gateway.ts';
import type { AppwriteAttribute } from './gateway.ts';
import type { RemoteManagementSchema } from './schema.ts';

const environment = { APPWRITE_ENDPOINT: 'https://appwrite.xpointsolucoes.com.br/v1',
  APPWRITE_PROJECT_ID: '6abc5640003cb361b809', APPWRITE_API_KEY: 'fake-key-never-real' };

test('environment rejects wrong project, absent key, unsafe endpoint without exposing values', () => {
  for (const env of [{ ...environment, APPWRITE_PROJECT_ID: 'wrong' },
    { ...environment, APPWRITE_PROJECT_ID: 'default-6abc5640003cb361b809' },
    { ...environment, APPWRITE_API_KEY: '' }, { ...environment, APPWRITE_ENDPOINT: 'http://example.invalid/v1' }]) {
    assert.throws(() => readAppwriteEnvironment(env), (error: Error) => {
      assert.equal(String(error).includes(environment.APPWRITE_API_KEY), false);
      return true;
    });
  }
});

test('endpoint guard rejects non-target URLs before configuring the SDK client', (t) => {
  t.mock.method(Client.prototype, 'setEndpoint', () => { assert.fail('SDK client must not be configured'); });
  t.mock.method(Client.prototype, 'call', async () => { assert.fail('SDK must not be called'); });
  const endpoints = [
    'https://unrelated.example/v1',
    'https://appwrite.xpointsolucoes.com.br/other/v1',
    'http://appwrite.xpointsolucoes.com.br/v1',
    'https://user:password@appwrite.xpointsolucoes.com.br/v1',
    'https://@appwrite.xpointsolucoes.com.br/v1',
    'https://appwrite.xpointsolucoes.com.br/v1?token=private',
    'https://appwrite.xpointsolucoes.com.br/v1?',
    'https://appwrite.xpointsolucoes.com.br/v1#private',
    'https://appwrite.xpointsolucoes.com.br/v1#',
    'https://appwrite.xpointsolucoes.com.br:8443/v1',
    'https://appwrite.xpointsolucoes.com.br:443/v1',
    'https://appwrite.xpointsolucoes.com.br/v1/../v1',
    'https://appwrite.xpointsolucoes.com.br/v1/.',
    String.raw`https://appwrite.xpointsolucoes.com.br\v1`,
    'https://APPWRITE.xpointsolucoes.com.br/v1',
    'HTTPS://appwrite.xpointsolucoes.com.br/v1',
    ' https://appwrite.xpointsolucoes.com.br/v1',
    'https://appwrite.xpointsolucoes.com.br/v1 ',
  ];
  for (const endpoint of endpoints) {
    assert.throws(() => createAppwriteGateway({ ...environment, APPWRITE_ENDPOINT: endpoint }),
      /APPWRITE_ENDPOINT/);
  }
});

test('only the two allowed endpoint strings reach the SDK as one canonical URL', (t) => {
  const configured: string[] = [];
  t.mock.method(Client.prototype, 'setEndpoint', function (this: Client, endpoint: string) {
    configured.push(endpoint);
    return this;
  });
  for (const endpoint of [environment.APPWRITE_ENDPOINT, 'https://appwrite.xpointsolucoes.com.br/v1/']) {
    assert.equal(readAppwriteEnvironment({ ...environment, APPWRITE_ENDPOINT: endpoint }).endpoint,
      'https://appwrite.xpointsolucoes.com.br/v1');
    createAppwriteGateway({ ...environment, APPWRITE_ENDPOINT: endpoint });
  }
  assert.deepEqual(configured, [environment.APPWRITE_ENDPOINT, environment.APPWRITE_ENDPOINT]);
});

test('official SDK adapter paginates and maps enum metadata and collection permissions', async (t) => {
  let pages = 0;
  t.mock.method(Client.prototype, 'call', async (_method: string, url: URL, _headers: unknown, params: Payload) => {
    if (url.pathname.endsWith('/collections')) {
      pages++;
      const offset = (params.queries as string[]).map((query) => JSON.parse(query)).find((query) => query.method === 'offset').values[0];
      return { total: 2, collections: [{ $id: offset === 1 ? 'second' : 'first', name: 'name', $permissions: [], documentSecurity: false }] };
    }
    return { total: 1, attributes: [{ key: 'global_role', type: 'string', format: 'enum', required: true, elements: ['super_admin'], status: 'available', error: '', array: false, default: null }] };
  });
  const gateway = createAppwriteGateway(environment);
  const collections = await gateway.listCollections('remote_management');
  assert.equal(pages, 2);
  assert.deepEqual(collections.map((c) => c.$id), ['first', 'second']);
  assert.deepEqual(collections[0]?.permissions, []);
  const attributes = await gateway.listAttributes('remote_management', 'technician_profiles');
  assert.equal(attributes[0]?.type, 'enum');
});

test('SDK adapter sends empty permissions, exact enum/index payload and filters admin by email', async (t) => {
  const requests: { path: string; body: Record<string, unknown>; query: string }[] = [];
  t.mock.method(Client.prototype, 'call', async (_method: string, url: URL, _headers: unknown, params: Payload) => {
    requests.push({ path: url.pathname, body: params, query: JSON.stringify(params.queries ?? []) });
    if (url.pathname.endsWith('/users')) return { total: 0, users: [] };
    return {};
  });
  const gateway = createAppwriteGateway(environment);
  await gateway.createCollection('remote_management', { id: 'test', name: 'test', permissions: [], documentSecurity: false, attributes: [], indexes: [] });
  await gateway.createAttribute('remote_management', 'test', { key: 'role', type: 'enum', elements: ['super_admin'], required: true });
  await gateway.createIndex('remote_management', 'test', { id: 'u_role', type: 'unique', attributes: ['role'] });
  await gateway.createIndex('remote_management', 'test', { id: 'u_role_prefix', type: 'unique',
    attributes: ['role', 'name'], lengths: [8, 0] });
  assert.equal(await gateway.findUserByEmail('remote.admin@xpointsolucoes.com.br'), null);
  assert.deepEqual(requests[0]?.body, { collectionId: 'test', name: 'test', permissions: [], documentSecurity: false });
  assert.deepEqual(requests[1]?.body, { key: 'role', elements: ['super_admin'], required: true });
  assert.deepEqual(requests[2]?.body, { key: 'u_role', type: 'unique', attributes: ['role'] });
  assert.deepEqual(requests[3]?.body, { key: 'u_role_prefix', type: 'unique',
    attributes: ['role', 'name'], lengths: [8, 0] });
  assert.ok(decodeURIComponent(requests[4]!.query).includes('remote.admin@xpointsolucoes.com.br'));
});

test('SDK failure cannot expose raw response or key in serialized error', async (t) => {
  t.mock.method(Client.prototype, 'call', async () => { throw Object.assign(new Error(environment.APPWRITE_API_KEY), { response: environment.APPWRITE_API_KEY }); });
  await assert.rejects(createAppwriteGateway(environment).listDatabases(), (error: Error) => {
    assert.equal((String(error) + JSON.stringify(error)).includes(environment.APPWRITE_API_KEY), false);
    return true;
  });
});

test('SDK adapter sends only the scoped enum update with a null default', async (t) => {
  const requests: { method: string; path: string; body: Payload }[] = [];
  t.mock.method(Client.prototype, 'call', async (method: string, url: URL, _headers: unknown, body: Payload) => {
    requests.push({ method, path: url.pathname, body });
    return {};
  });
  await createAppwriteGateway(environment).updateGlobalRoleEnum();
  assert.deepEqual(requests, [{ method: 'patch',
    path: '/v1/databases/remote_management/collections/technician_profiles/attributes/enum/global_role',
    body: { elements: ['super_admin'], required: false, default: null } }]);
});

test('full Appwrite 1.7 post-apply inventory plans 103 unchanged resources and zero writes', async (t) => {
  const fixture = JSON.parse(await readFile(new URL('./testing/appwrite-1.7-numeric-attributes.json', import.meta.url), 'utf8'));
  const indexFixture = JSON.parse(await readFile(new URL('./testing/appwrite-1.7-indexes.json', import.meta.url), 'utf8'));
  const created = new FakeGateway();
  await applyProvisionPlan(created, buildProvisionPlan(await inspectSchema(created)));
  let postCount = 0;
  t.mock.method(Client.prototype, 'call', async (method: string, url: URL) => {
    if (method !== 'get') { postCount++; assert.fail('Converged apply must not write'); }
    if (url.pathname.endsWith('/databases')) return { total: 1, databases: await created.listDatabases() };
    if (url.pathname.endsWith('/collections')) return { total: created.collections.size,
      collections: (await created.listCollections()).map((item) => ({ ...item, $permissions: item.permissions })) };
    const collection = url.pathname.split('/')[5]!;
    if (url.pathname.endsWith('/attributes')) {
      const attributes = (await created.listAttributes('remote_management', collection)).map((attribute) =>
        attribute.type === 'integer' ? { ...fixture.attributes[0], key: attribute.key } : attribute);
      return { total: attributes.length, attributes };
    }
    if (url.pathname.endsWith('/indexes')) {
      const indexes = await created.listIndexes('remote_management', collection);
      return { total: indexes.length, indexes: indexes.map((index) => ({
        ...indexFixture.indexes[index.attributes.length === 1 ? 0 : 1],
        key: index.key, type: index.type, attributes: index.attributes,
      })) };
    }
    return { status: 'available' };
  });
  const gateway = createAppwriteGateway(environment);
  const plan = buildProvisionPlan(await inspectSchema(gateway));
  assert.equal(plan.actions.length, 103);
  assert.equal(plan.actions.filter((action) => action.resource === 'index').length, 27);
  assert.deepEqual(plan.actions.filter((action) => action.outcome !== 'unchanged'), []);
  await applyProvisionPlan(gateway, plan);
  assert.equal(postCount, 0);
});

test('Appwrite 1.7 float response defaults match unconstrained float schema', async (t) => {
  const fixture = JSON.parse(await readFile(new URL('./testing/appwrite-1.7-numeric-attributes.json', import.meta.url), 'utf8'));
  const desired: RemoteManagementSchema = { database: { id: 'remote_management', name: 'remote_management' },
    collections: [{ id: 'ratios', name: 'ratios', permissions: [], documentSecurity: false,
      attributes: [{ key: 'ratio', type: 'float', required: false }], indexes: [] }] };
  t.mock.method(Client.prototype, 'call', async (_method: string, url: URL) => {
    if (url.pathname.endsWith('/databases')) return { total: 1, databases: [{ $id: 'remote_management', name: 'remote_management' }] };
    if (url.pathname.endsWith('/collections')) return { total: 1, collections: [{ $id: 'ratios', name: 'ratios', $permissions: [], documentSecurity: false }] };
    if (url.pathname.endsWith('/attributes')) return { total: 1, attributes: [fixture.attributes[1] as AppwriteAttribute] };
    return { total: 0, indexes: [] };
  });
  const plan = buildProvisionPlan(await inspectSchema(createAppwriteGateway(environment), desired), desired);
  assert.deepEqual(plan.actions.map((action) => action.outcome), ['unchanged', 'unchanged', 'unchanged']);
});
