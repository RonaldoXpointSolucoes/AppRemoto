import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from 'node-appwrite';
import type { Payload } from 'node-appwrite';
import { createAppwriteGateway, readAppwriteEnvironment } from './appwrite-adapter.ts';

const environment = { APPWRITE_ENDPOINT: 'https://example.invalid/v1',
  APPWRITE_PROJECT_ID: 'default-6abc5640003cb361b809', APPWRITE_API_KEY: 'fake-key-never-real' };

test('environment rejects wrong project, absent key, unsafe endpoint without exposing values', () => {
  for (const env of [{ ...environment, APPWRITE_PROJECT_ID: 'wrong' },
    { ...environment, APPWRITE_API_KEY: '' }, { ...environment, APPWRITE_ENDPOINT: 'http://example.invalid/v1' }]) {
    assert.throws(() => readAppwriteEnvironment(env), (error: Error) => {
      assert.equal(String(error).includes(environment.APPWRITE_API_KEY), false);
      return true;
    });
  }
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
  assert.equal(await gateway.findUserByEmail('remote.admin@xpointsolucoes.com.br'), null);
  assert.deepEqual(requests[0]?.body, { collectionId: 'test', name: 'test', permissions: [], documentSecurity: false });
  assert.deepEqual(requests[1]?.body, { key: 'role', elements: ['super_admin'], required: true });
  assert.deepEqual(requests[2]?.body, { key: 'u_role', type: 'unique', attributes: ['role'] });
  assert.ok(decodeURIComponent(requests[3]!.query).includes('remote.admin@xpointsolucoes.com.br'));
});

test('SDK failure cannot expose raw response or key in serialized error', async (t) => {
  t.mock.method(Client.prototype, 'call', async () => { throw Object.assign(new Error(environment.APPWRITE_API_KEY), { response: environment.APPWRITE_API_KEY }); });
  await assert.rejects(createAppwriteGateway(environment).listDatabases(), (error: Error) => {
    assert.equal((String(error) + JSON.stringify(error)).includes(environment.APPWRITE_API_KEY), false);
    return true;
  });
});
