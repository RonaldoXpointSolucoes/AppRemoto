import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ApiErrorSchema, DeviceListQuerySchema, DeviceViewSchema,
  EnrollRequestSchema, EnrollResponseSchema, HeartbeatRequestSchema,
} from './index.ts';

const uuid = '550e8400-e29b-41d4-a716-446655440000';
const enrollment = {
  enrollmentToken: 't'.repeat(32), deviceUuid: uuid, displayName: 'Office PC',
  hostname: 'OFFICE-PC', operatingSystem: 'Windows', osVersion: '11',
  agentVersion: '1.0.0', rustdeskId: '123456789', rustdeskVersion: '1.4.0',
};
const heartbeat = {
  agentVersion: '1.0.0', rustdeskVersion: '1.4.0', rustdeskId: '123456789',
  operatingSystem: 'Windows', osVersion: '11',
};
const device = {
  id: 'device-1', organizationId: 'org-1', organizationName: 'Organization',
  deviceUuid: uuid, displayName: 'Office PC', hostname: 'OFFICE-PC',
  operatingSystem: 'Windows', osVersion: '11', rustdeskId: '123456789',
  agentVersion: null, rustdeskVersion: null, lastSeenAt: null,
  enabled: true, status: 'OFFLINE',
};

test('device list query validates filters and pagination boundaries', () => {
  assert.deepEqual(DeviceListQuerySchema.parse({}), { limit: 50 });
  assert.deepEqual(DeviceListQuerySchema.parse({ organizationId: 'org-1', status: 'ONLINE', search: '  office  ', cursor: 'next', limit: 100 }),
    { organizationId: 'org-1', status: 'ONLINE', search: 'office', cursor: 'next', limit: 100 });
  assert.deepEqual(DeviceListQuerySchema.parse({ limit: '20' }), { limit: 20 });
  assert.equal(DeviceListQuerySchema.safeParse({ cursor: 'a'.repeat(400) }).success, true);
  for (const invalid of [
    { organizationId: '' }, { organizationId: 'x'.repeat(37) },
    { status: 'online' }, { search: '  ' }, { search: 'x'.repeat(129) },
    { cursor: '' }, { cursor: 'x'.repeat(1025) },
    { limit: 0 }, { limit: 101 }, { limit: 1.5 },
    { limit: '' }, { limit: '1.5' }, { limit: '+20' }, { limit: '2e1' }, { limit: ['20'] },
    { unknown: true },
  ]) assert.equal(DeviceListQuerySchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test('device view validates the safe projection and status enum', () => {
  assert.equal(DeviceViewSchema.safeParse(device).success, true);
  assert.equal(DeviceViewSchema.safeParse({ ...device, agentVersion: '1.0.0', lastSeenAt: '2026-09-29T12:00:00Z' }).success, true);
  for (const invalid of [
    { ...device, status: 'PENDING' }, { ...device, deviceUuid: 'not-a-uuid' },
    { ...device, organizationName: 'x'.repeat(129) }, { ...device, hostname: 'x'.repeat(256) },
    { ...device, agentVersion: '' }, { ...device, lastSeenAt: 'not-a-date' },
    { ...device, lastIp: '192.0.2.1' }, { ...device, deviceToken: 'secret' },
  ]) assert.equal(DeviceViewSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test('enrollment accepts complete device identity and rejects malformed payloads', () => {
  assert.equal(EnrollRequestSchema.safeParse(enrollment).success, true);
  for (const invalid of [
    { ...enrollment, enrollmentToken: 'x'.repeat(31) }, { ...enrollment, enrollmentToken: 'x'.repeat(513) },
    { ...enrollment, deviceUuid: 'bad' }, { ...enrollment, displayName: '' },
    { ...enrollment, displayName: 'x'.repeat(129) }, { ...enrollment, hostname: 'x'.repeat(256) },
    { ...enrollment, operatingSystem: 'x'.repeat(65) }, { ...enrollment, osVersion: 'x'.repeat(129) },
    { ...enrollment, agentVersion: 'x'.repeat(65) }, { ...enrollment, rustdeskId: 'x'.repeat(65) },
    { ...enrollment, rustdeskVersion: 'x'.repeat(65) }, { ...enrollment, organizationId: 'org-1' },
  ]) assert.equal(EnrollRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test('enrollment response validates credentials and heartbeat interval', () => {
  const response = { deviceId: 'device-1', deviceToken: 't'.repeat(32), rustdeskPassword: 'password', heartbeatIntervalSeconds: 30 };
  assert.equal(EnrollResponseSchema.safeParse(response).success, true);
  for (const invalid of [
    { ...response, deviceToken: 'x'.repeat(31) }, { ...response, rustdeskPassword: 'short' },
    { ...response, heartbeatIntervalSeconds: 9 }, { ...response, heartbeatIntervalSeconds: 301 },
    { ...response, heartbeatIntervalSeconds: 10.5 }, { ...response, tokenHash: 'secret' },
  ]) assert.equal(EnrollResponseSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test('heartbeat requires bounded version metadata and rejects client timestamps', () => {
  assert.equal(HeartbeatRequestSchema.safeParse(heartbeat).success, true);
  for (const invalid of [
    { ...heartbeat, agentVersion: '' }, { ...heartbeat, agentVersion: 'x'.repeat(65) },
    { ...heartbeat, rustdeskVersion: 'x'.repeat(65) }, { ...heartbeat, rustdeskId: 'x'.repeat(65) },
    { ...heartbeat, operatingSystem: 'x'.repeat(65) }, { ...heartbeat, osVersion: 'x'.repeat(129) },
    { ...heartbeat, timestamp: '2026-09-29T12:00:00Z' },
  ]) assert.equal(HeartbeatRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test('API errors expose only bounded public fields and stable codes', () => {
  assert.equal(ApiErrorSchema.safeParse({ code: 'NOT_FOUND', message: 'Device not found', requestId: 'req-1' }).success, true);
  for (const invalid of [
    { code: 'not_found', message: 'Device not found' }, { code: 'AB', message: 'Device not found' },
    { code: 'X'.repeat(65), message: 'Device not found' }, { code: 'NOT_FOUND', message: '' },
    { code: 'NOT_FOUND', message: 'x'.repeat(257) },
    { code: 'NOT_FOUND', message: 'Device not found', requestId: '' },
    { code: 'NOT_FOUND', message: 'Device not found', details: { tokenHash: 'secret' } },
  ]) assert.equal(ApiErrorSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});
