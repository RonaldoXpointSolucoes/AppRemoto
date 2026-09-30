import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { REMOTE_MANAGEMENT_SCHEMA, renderSchemaMarkdown } from './schema.ts';

const fields: Record<string, readonly (readonly [string, string, number | null, boolean, readonly string[] | null])[]> = {
  organizations: [
    ['name', 'string', 128, true, null], ['slug', 'string', 64, true, null], ['active', 'boolean', null, true, null],
  ],
  technician_profiles: [
    ['user_id', 'string', 36, true, null], ['display_name', 'string', 128, true, null],
    ['global_role', 'enum', null, false, ['super_admin']], ['active', 'boolean', null, true, null],
  ],
  organization_members: [
    ['organization_id', 'string', 36, true, null], ['user_id', 'string', 36, true, null],
    ['role', 'string', 64, true, null], ['can_view', 'boolean', null, true, null],
    ['can_connect', 'boolean', null, true, null], ['can_manage_devices', 'boolean', null, true, null],
  ],
  devices: [
    ['organization_id', 'string', 36, true, null], ['device_uuid', 'string', 36, true, null],
    ['display_name', 'string', 128, true, null], ['hostname', 'string', 255, true, null],
    ['rustdesk_id', 'string', 64, true, null], ['operating_system', 'string', 64, true, null],
    ['os_version', 'string', 128, true, null], ['agent_version', 'string', 64, false, null],
    ['rustdesk_version', 'string', 64, false, null], ['last_seen_at', 'datetime', null, false, null],
    ['last_ip', 'string', 45, false, null], ['enabled', 'boolean', null, true, null],
  ],
  device_tokens: [
    ['device_id', 'string', 36, true, null], ['token_hash', 'string', 64, true, null],
    ['last_used_at', 'datetime', null, false, null], ['revoked_at', 'datetime', null, false, null],
  ],
  heartbeat_guards: [
    ['device_id', 'string', 36, true, null], ['device_token_id', 'string', 36, true, null],
    ['started_at', 'datetime', null, true, null],
  ],
  device_credentials: [
    ['device_id', 'string', 36, true, null], ['password_ciphertext', 'string', 4096, true, null],
    ['password_nonce', 'string', 128, true, null], ['password_tag', 'string', 128, true, null],
    ['key_version', 'integer', null, true, null],
  ],
  enrollment_tokens: [
    ['organization_id', 'string', 36, true, null], ['token_hash', 'string', 64, true, null],
    ['expires_at', 'datetime', null, true, null], ['max_uses', 'integer', null, true, null],
    ['use_count', 'integer', null, true, null], ['active', 'boolean', null, true, null],
    ['created_by_user_id', 'string', 36, true, null],
    ['revoked_at', 'datetime', null, false, null],
  ],
  enrollment_receipts: [
    ['organization_id', 'string', 36, true, null], ['enrollment_token_id', 'string', 36, true, null],
    ['device_id', 'string', 36, true, null], ['device_uuid', 'string', 36, true, null],
    ['status', 'enum', null, true, ['pending', 'committed']],
    ['token_use_consumed', 'boolean', null, true, null],
    ['expected_use_count', 'integer', null, true, null],
    ['recovery_frozen', 'boolean', null, true, null],
  ],
  connection_sessions: [
    ['organization_id', 'string', 36, true, null], ['device_id', 'string', 36, true, null],
    ['technician_user_id', 'string', 36, true, null], ['connect_token_hash', 'string', 64, true, null],
    ['expires_at', 'datetime', null, true, null], ['redeemed_at', 'datetime', null, false, null],
    ['status', 'enum', null, true, ['pending', 'redeemed', 'expired', 'failed']],
    ['source_ip', 'string', 45, true, null],
  ],
  audit_logs: [
    ['organization_id', 'string', 36, true, null],
    ['actor_type', 'enum', null, true, ['technician', 'device', 'system']],
    ['actor_id', 'string', 36, true, null], ['device_id', 'string', 36, false, null],
    ['action', 'string', 64, true, null], ['result', 'enum', null, true, ['success', 'failure']],
    ['source_ip', 'string', 45, true, null], ['metadata_json', 'string', 16384, true, null],
  ],
};

const indexes: Record<string, readonly (readonly [string, string, readonly string[]])[]> = {
  organizations: [['u_slug', 'unique', ['slug']]],
  technician_profiles: [['u_user_id', 'unique', ['user_id']]],
  organization_members: [
    ['u_organization_id_user_id', 'unique', ['organization_id', 'user_id']],
    ['q_organization_id', 'key', ['organization_id']], ['q_user_id', 'key', ['user_id']],
  ],
  devices: [
    ['u_organization_id_device_uuid', 'unique', ['organization_id', 'device_uuid']],
    ['q_organization_id', 'key', ['organization_id']], ['q_last_seen_at', 'key', ['last_seen_at']],
    ['q_display_name', 'key', ['display_name']], ['q_hostname', 'key', ['hostname']],
    ['q_rustdesk_id', 'key', ['rustdesk_id']],
  ],
  device_tokens: [['u_token_hash', 'unique', ['token_hash']], ['q_device_id', 'key', ['device_id']]],
  heartbeat_guards: [],
  device_credentials: [['u_device_id', 'unique', ['device_id']]],
  enrollment_tokens: [['u_token_hash', 'unique', ['token_hash']], ['q_organization_id', 'key', ['organization_id']]],
  enrollment_receipts: [
    ['u_enrollment_token_id_device_uuid', 'unique', ['enrollment_token_id', 'device_uuid']],
    ['q_organization_id', 'key', ['organization_id']], ['q_device_id', 'key', ['device_id']],
    ['q_status', 'key', ['status']],
  ],
  connection_sessions: [
    ['u_connect_token_hash', 'unique', ['connect_token_hash']],
    ['q_organization_id', 'key', ['organization_id']], ['q_device_id', 'key', ['device_id']],
    ['q_technician_user_id', 'key', ['technician_user_id']],
  ],
  audit_logs: [
    ['q_organization_id', 'key', ['organization_id']], ['q_device_id', 'key', ['device_id']],
    ['q_action', 'key', ['action']],
  ],
};

test('database and collection order are stable and deny access by default', () => {
  assert.deepEqual(REMOTE_MANAGEMENT_SCHEMA.database, { id: 'remote_management', name: 'remote_management' });
  assert.deepEqual(REMOTE_MANAGEMENT_SCHEMA.collections.map((collection) => collection.id), Object.keys(fields));
  for (const collection of REMOTE_MANAGEMENT_SCHEMA.collections) {
    assert.equal(collection.name, collection.id);
    assert.deepEqual(collection.permissions, []);
    assert.equal(collection.documentSecurity, false);
  }
});

test('heartbeat guard is a server-only direct-ID collection with three required identity fields', () => {
  const guard = REMOTE_MANAGEMENT_SCHEMA.collections.find((collection) => collection.id === 'heartbeat_guards');
  assert.ok(guard);
  assert.deepEqual(guard.permissions, []);
  assert.equal(guard.documentSecurity, false);
  assert.deepEqual(guard.attributes.map((field) => [field.key, field.type, 'size' in field ? field.size : null,
    field.required]), [
    ['device_id', 'string', 36, true], ['device_token_id', 'string', 36, true],
    ['started_at', 'datetime', null, true],
  ]);
  assert.deepEqual(guard.indexes, []);
});

test('every collection has the canonical field type, size, required flag, and enum domain', () => {
  for (const collection of REMOTE_MANAGEMENT_SCHEMA.collections) {
    assert.deepEqual(collection.attributes.map((attribute) => [
      attribute.key, attribute.type, 'size' in attribute ? attribute.size : null,
      attribute.required, 'elements' in attribute ? attribute.elements : null,
    ]), fields[collection.id], collection.id);
  }
});

test('unique and query indexes have deterministic IDs, kinds, and ordered keys', () => {
  for (const collection of REMOTE_MANAGEMENT_SCHEMA.collections) {
    assert.deepEqual(collection.indexes.map((index) => [index.id, index.type, index.attributes]),
      indexes[collection.id], collection.id);
    assert.equal(new Set(collection.indexes.map((index) => index.id)).size, collection.indexes.length);
  }
});

test('the full exported schema is recursively immutable at runtime', () => {
  assert.equal(Object.isFrozen(REMOTE_MANAGEMENT_SCHEMA), true);
  assert.equal(Object.isFrozen(REMOTE_MANAGEMENT_SCHEMA.database), true);
  assert.equal(Object.isFrozen(REMOTE_MANAGEMENT_SCHEMA.collections), true);
  for (const collection of REMOTE_MANAGEMENT_SCHEMA.collections) {
    assert.equal(Object.isFrozen(collection), true);
    assert.equal(Object.isFrozen(collection.permissions), true);
    assert.equal(Object.isFrozen(collection.attributes), true);
    assert.equal(Object.isFrozen(collection.indexes), true);
    for (const attribute of collection.attributes) {
      assert.equal(Object.isFrozen(attribute), true);
      if ('elements' in attribute) assert.equal(Object.isFrozen(attribute.elements), true);
    }
    for (const index of collection.indexes) {
      assert.equal(Object.isFrozen(index), true);
      assert.equal(Object.isFrozen(index.attributes), true);
    }
  }
});

test('committed human-readable schema matches the declarative schema', () => {
  const committed = readFileSync(new URL('../schema.md', import.meta.url), 'utf8');
  assert.equal(committed, renderSchemaMarkdown(REMOTE_MANAGEMENT_SCHEMA));
});
