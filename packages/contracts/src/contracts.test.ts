import assert from 'node:assert/strict';
import { CreateEnrollmentTokenRequestSchema, CreateEnrollmentTokenResponseSchema, EnrollmentStatusResponseSchema,
  ConnectDeviceResponseSchema } from './setup.ts';
import { test } from 'node:test';
import {
  ApiErrorSchema, DeviceListQuerySchema, DeviceViewSchema,
  EnrollRequestSchema, EnrollResponseSchema, HeartbeatRequestSchema,
  ConnectDeviceRequestSchema, ConnectDeviceLaunchResponseSchema, UpdateDeviceRequestSchema, ConnectionEventRequestSchema,
  ConnectionHistoryResponseSchema,
  GenericInstallerPackageSchema, PrepareInstallationRequestSchema, PrepareInstallationResponseSchema,
  GenericPasswordRequestSchema, ConfirmGenericPasswordResponseSchema,
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

test('generic preparation binds a random request proof and never accepts password or administrator fields', () => {
  const request = { installerId: 'installer-1', requestId: uuid, requestSecret: 'a'.repeat(43),
    companyName: ' Client company ', deviceDisplayName: ' Client PC ' };
  assert.equal(PrepareInstallationRequestSchema.parse(request).companyName, 'Client company');
  assert.equal(PrepareInstallationRequestSchema.safeParse({ ...request, existingOrganizationId: 'org-1' }).success, true);
  for (const invalid of [{ ...request, requestSecret: undefined }, { ...request, requestSecret: 'short' },
    { ...request, requestId: 'invalid' }, { ...request, companyName: '' }, { ...request, password: 'private' },
    { ...request, role: 'super_admin' }]) assert.equal(PrepareInstallationRequestSchema.safeParse(invalid).success, false);
  assert.equal(GenericInstallerPackageSchema.safeParse({ schemaVersion: 2, installerId: 'installer-1', installerToken: 'a'.repeat(43) }).success, true);
  assert.equal(GenericInstallerPackageSchema.safeParse({ schemaVersion: 2, installerId: 'installer-1', installerToken: 'a'.repeat(43), rustdeskPassword: 'private' }).success, false);
});

test('generic preparation preserves provisioning v1 while password rotation requires both device and package proofs', () => {
  const response = { schemaVersion: 1, enrollmentId: 'enrollment-1', enrollmentToken: 'a'.repeat(43),
    expiresAt: '2026-10-01T12:00:00Z', organizationId: 'org-1', organizationName: 'Client company', deviceDisplayName: 'PC' };
  assert.deepEqual(PrepareInstallationResponseSchema.parse(response), response);
  assert.equal(PrepareInstallationResponseSchema.safeParse({ ...response, rustdeskPassword: 'private' }).success, false);
  assert.equal(GenericPasswordRequestSchema.safeParse(enrollment).success, false);
  assert.equal(GenericPasswordRequestSchema.safeParse({ ...enrollment, currentDeviceToken: 'a'.repeat(43) }).success, true);
  assert.equal(ConfirmGenericPasswordResponseSchema.safeParse({ deviceId: 'device-1', applied: true }).success, true);
  assert.equal(ConfirmGenericPasswordResponseSchema.safeParse({ deviceId: 'device-1', applied: false }).success, false);
});

test('connection requests never accept passwords, arbitrary event messages or mismatched launch modes', () => {
  assert.equal(ConnectDeviceRequestSchema.safeParse({ attemptId: uuid, mode: 'manual' }).success, true);
  assert.equal(ConnectDeviceRequestSchema.safeParse({ attemptId: uuid, mode: 'manual', password: 'private' }).success, false);
  assert.equal(ConnectDeviceRequestSchema.safeParse({ attemptId: 'invalid', mode: 'automatic' }).success, false);
  const launchUri = 'rustdesk://connect/123456789@179.199.142.157:21116?key=public';
  assert.equal(ConnectDeviceLaunchResponseSchema.safeParse({ attemptId: uuid, mode: 'manual', launchUri }).success, true);
  assert.equal(ConnectDeviceLaunchResponseSchema.safeParse({ attemptId: uuid, mode: 'automatic', launchUri }).success, false);
  assert.equal(ConnectDeviceLaunchResponseSchema.safeParse({ attemptId: uuid, mode: 'manual', launchUri: `${launchUri}&password=private` }).success, false);
  assert.equal(ConnectionEventRequestSchema.safeParse({ attemptId: uuid, mode: 'manual', event: 'not_opened', message: 'private' }).success, false);
  assert.equal(ConnectionEventRequestSchema.safeParse({ attemptId: uuid, mode: 'manual', event: 'not_opened', code: 'UNKNOWN_DETAIL' }).success, false);
  assert.equal(ConnectionHistoryResponseSchema.safeParse({ events: [], password: 'private' }).success, false);
});

test('operator editing accepts only name and bounded notes while identity remains immutable', () => {
  assert.deepEqual(UpdateDeviceRequestSchema.parse({ displayName: ' New name ', notes: 'one\ntwo\tthree' }),
    { displayName: 'New name', notes: 'one\ntwo\tthree' });
  assert.equal(UpdateDeviceRequestSchema.safeParse({ displayName: 'PC', notes: 'a'.repeat(2048) }).success, true);
  for (const value of [{ displayName: '', notes: '' }, { displayName: 'PC', notes: 'a'.repeat(2049) },
    { displayName: 'PC\nother', notes: '' }, { displayName: 'PC', notes: '\u0000' },
    { displayName: 'PC', notes: '', deviceUuid: uuid }, { displayName: 'PC', notes: '', enabled: false }]) {
    assert.equal(UpdateDeviceRequestSchema.safeParse(value).success, false);
  }
});

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
test('setup contracts reject unknown fields, unsafe names and non-RustDesk launch destinations', () => {
  assert.deepEqual(CreateEnrollmentTokenRequestSchema.parse({ organizationId: 'org', deviceDisplayName: ' PC ' }),
    { organizationId: 'org', deviceDisplayName: 'PC' });
  for (const invalid of [{ organizationId: 'other/path', deviceDisplayName: 'PC' },
    { organizationId: 'org', deviceDisplayName: ' ' }, { organizationId: 'org', deviceDisplayName: 'PC\nother' },
    { organizationId: 'org', deviceDisplayName: 'PC', maxUses: 5 }]) {
    assert.equal(CreateEnrollmentTokenRequestSchema.safeParse(invalid).success, false);
  }
  const issued = { enrollmentId: 'enrollment', enrollmentToken: 'a'.repeat(43), expiresAt: '2026-10-01T12:30:00Z' };
  assert.equal(CreateEnrollmentTokenResponseSchema.safeParse(issued).success, true);
  assert.equal(CreateEnrollmentTokenResponseSchema.safeParse({ ...issued, password: 'unexpected' }).success, false);
  assert.equal(EnrollmentStatusResponseSchema.safeParse({ status: 'waiting', expiresAt: issued.expiresAt, device: null }).success, true);
  assert.equal(EnrollmentStatusResponseSchema.safeParse({ status: 'online', expiresAt: issued.expiresAt, device: null }).success, false);
  for (const launchUri of ['https://evil.example', 'javascript:alert(1)', 'rustdesk://password/change',
    'rustdesk://connect/123456789@evil.example?key=abc&password=test']) {
    assert.equal(ConnectDeviceResponseSchema.safeParse({ launchUri }).success, false);
  }
});
