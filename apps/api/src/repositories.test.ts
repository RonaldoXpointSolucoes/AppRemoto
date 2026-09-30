import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Databases } from 'node-appwrite';

import { createOrganizationRepository } from './repositories/organizations.ts';
import { createTechnicianRepository } from './repositories/technicians.ts';

type ReadCall = { database: string; collection: string; queries: { method: string; attribute?: string; values?: unknown[] }[] };

test('Appwrite repositories query production collections and select only required attributes', async () => {
  const calls: ReadCall[] = [];
  const databases = {
    async listDocuments(database: string, collection: string, encoded: string[]) {
      const queries = encoded.map((query) => JSON.parse(query));
      calls.push({ database, collection, queries });
      if (collection === 'technician_profiles') return { total: 1, documents: [
        { user_id: 'user-1', display_name: 'Technician', global_role: 'super_admin', active: true, secret: 'hidden' },
      ] };
      if (collection === 'organization_members') return { total: 1, documents: [
        { organization_id: 'org-1', user_id: 'user-1', role: 'operator', can_view: true,
          can_connect: false, can_manage_devices: false, secret: 'hidden' },
      ] };
      if (collection === 'organizations') return { total: 1, documents: [
        { $id: 'org-1', name: 'Organization', slug: 'organization', active: true, secret: 'hidden' },
      ] };
      throw new Error('Unexpected collection');
    },
  } as unknown as Databases;

  const technicians = createTechnicianRepository(databases);
  const organizations = createOrganizationRepository(databases);
  assert.deepEqual(await technicians.findByUserId('user-1'), {
    userId: 'user-1', displayName: 'Technician', globalRole: 'super_admin', active: true,
  });
  assert.deepEqual(await technicians.listMemberships('user-1'), [{
    organizationId: 'org-1', userId: 'user-1', role: 'operator',
    canView: true, canConnect: false, canManageDevices: false,
  }]);
  assert.deepEqual(await organizations.listActive(), [{ id: 'org-1', name: 'Organization', slug: 'organization', active: true }]);

  assert.deepEqual(calls.map(({ database, collection }) => [database, collection]), [
    ['remote_management', 'technician_profiles'],
    ['remote_management', 'organization_members'],
    ['remote_management', 'organizations'],
  ]);
  assert.deepEqual(calls.map(({ queries }) => queries.find((query) => query.method === 'select')?.values), [
    ['user_id', 'display_name', 'global_role', 'active'],
    ['organization_id', 'user_id', 'role', 'can_view', 'can_connect', 'can_manage_devices'],
    ['$id', 'name', 'slug', 'active'],
  ]);
  assert.deepEqual(calls.map(({ queries }) => queries.find((query) => query.method === 'equal')), [
    { method: 'equal', attribute: 'user_id', values: ['user-1'] },
    { method: 'equal', attribute: 'user_id', values: ['user-1'] },
    { method: 'equal', attribute: 'active', values: [true] },
  ]);
});
