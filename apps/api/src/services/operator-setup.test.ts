import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { ConnectDeviceResponseSchema } from '@appremoto/contracts';
import { createOperatorSetupService } from './operator-setup.ts';
import { encryptPassword } from '../security/credentials.ts';
import { hashToken } from '../security/tokens.ts';
import type { EnrollmentData, EnrollmentKind, EnrollmentRepository } from '../repositories/enrollment.ts';
import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';

const now = new Date('2026-10-01T12:00:00.000Z');
const key = Buffer.alloc(32, 5);
const technician: AuthenticatedTechnician = { userId: 'operator', displayName: 'Operator', globalRole: null,
  organizations: [{ id: 'org', name: 'Customer', slug: 'customer', active: true }],
  authorization: [{ organizationId: 'org', role: 'admin', canView: true, canConnect: true, canManageDevices: true }] };
function fixture() {
  const records = new Map<string, EnrollmentData>();
  const writes: EnrollmentData[] = []; const events: unknown[] = []; const reads: string[] = [];
  let receipts: EnrollmentData[] = []; let failAudit = false; let failWrite = false; let active = true; let pending = false;
  const repo = { snapshot: async (kind: EnrollmentKind, id: string) => { reads.push(kind); return records.get(`${kind}/${id}`) ?? null; },
    write: async (kind: EnrollmentKind, id: string, data: EnrollmentData) => {
      if (failWrite) throw new Error('private write error'); records.set(`${kind}/${id}`, data); writes.push(data);
    }, organizationActive: async () => active } as unknown as EnrollmentRepository;
  const service = createOperatorSetupService({ repository: repo,
    receipts: { committedReceipts: async () => receipts, heartbeatPending: async () => pending },
    audit: { recordOperator: async (_id, event) => { if (failAudit) throw new Error('private audit error'); events.push(event); } },
    encryptionKey: key, keyVersion: 1, now: () => now });
  const device = { organization_id: 'org', device_uuid: '7784f4e1-941c-45c0-8285-b84e71cf2a5a', display_name: 'PC',
    hostname: 'PC', operating_system: 'Windows', os_version: '11', rustdesk_id: '123456789', agent_version: '1',
    rustdesk_version: '1.4.9', last_seen_at: now.toISOString(), enabled: true };
  records.set('devices/device', device);
  records.set('device_tokens/device', { device_id: 'device', last_used_at: now.toISOString(), revoked_at: null });
  const envelope = encryptPassword('synthetic-password', key);
  records.set('device_credentials/device', { device_id: 'device', password_ciphertext: envelope.passwordCiphertext,
    password_nonce: envelope.passwordNonce, password_tag: envelope.passwordTag, key_version: envelope.keyVersion });
  return { service, records, events, writes, reads, device,
    deactivate: () => { active = false; }, pendingHeartbeat: () => { pending = true; },
    receipts: (value: EnrollmentData[]) => { receipts = value; }, failAudit: () => { failAudit = true; }, failWrite: () => { failWrite = true; } };
}

test('creation stores only a 256-bit token hash with one use, creator and 30-minute expiry', async () => {
  const f = fixture();
  const response = await f.service.create(technician, { organizationId: 'org', deviceDisplayName: 'PC' }, '127.0.0.1');
  assert.equal(Buffer.from(response.enrollmentToken, 'base64url').length, 32);
  assert.equal(response.expiresAt, '2026-10-01T12:30:00.000Z');
  assert.deepEqual(f.writes[0], { organization_id: 'org', token_hash: hashToken(response.enrollmentToken),
    expires_at: response.expiresAt, max_uses: 1, use_count: 0, active: true, revoked_at: null, created_by_user_id: 'operator' });
  assert.equal(f.events.length, 1);
  assert.ok(!JSON.stringify([...f.writes, ...f.events]).includes(response.enrollmentToken));
});

test('organization deactivation during a session denies creation and status before receipt or credential access', async () => {
  const f = fixture(); f.deactivate();
  f.records.set('enrollment_tokens/enrollment', { organization_id: 'org', expires_at: '2026-10-01T12:30:00.000Z' });
  await assert.rejects(f.service.create(technician, { organizationId: 'org', deviceDisplayName: 'PC' }, '127.0.0.1'));
  await assert.rejects(f.service.status(technician, 'enrollment'));
  assert.equal(f.writes.length, 0);
});

test('cross-tenant and missing manage/connect permissions never read credentials or create tokens', async () => {
  const f = fixture();
  const denied = { ...technician, authorization: [{ ...technician.authorization[0]!, canManageDevices: false, canConnect: false }] };
  await assert.rejects(f.service.create(denied, { organizationId: 'org', deviceDisplayName: 'PC' }, '127.0.0.1'));
  await assert.rejects(f.service.create(technician, { organizationId: 'other', deviceDisplayName: 'PC' }, '127.0.0.1'));
  await assert.rejects(f.service.connect(denied, 'device', '127.0.0.1'));
  f.device.organization_id = 'other';
  await assert.rejects(f.service.connect(technician, 'device', '127.0.0.1'));
  assert.equal(f.writes.length, 0); assert.ok(!f.reads.includes('device_credentials'));
});

test('uncertain creation or audit failure never returns a provisioning token', async () => {
  for (const fail of ['failAudit', 'failWrite'] as const) {
    const f = fixture(); f[fail]();
    await assert.rejects(f.service.create(technician, { organizationId: 'org', deviceDisplayName: 'PC' }, '127.0.0.1'));
  }
});

test('status correlates exact committed receipt and requires a heartbeat after enrollment', async () => {
  const f = fixture();
  f.records.set('enrollment_tokens/enrollment', { organization_id: 'org', expires_at: '2026-10-01T12:30:00.000Z', max_uses: 1, use_count: 1 });
  assert.deepEqual(await f.service.status(technician, 'enrollment'), { status: 'waiting', expiresAt: '2026-10-01T12:30:00.000Z', device: null });
  const receipt = { organization_id: 'org', enrollment_token_id: 'enrollment', device_id: 'device',
    device_uuid: f.device.device_uuid, status: 'committed', committed_at: now.toISOString(), token_use_consumed: true, recovery_frozen: false, expected_use_count: 1 };
  f.receipts([receipt]);
  assert.equal((await f.service.status(technician, 'enrollment')).status, 'online');
  f.device.enabled = false;
  assert.equal((await f.service.status(technician, 'enrollment')).status, 'offline');
  f.device.enabled = true;
  f.records.get('device_tokens/device')!.last_used_at = null;
  assert.equal((await f.service.status(technician, 'enrollment')).status, 'waiting');
  f.receipts([{ ...receipt, enrollment_token_id: 'different' }]);
  await assert.rejects(f.service.status(technician, 'enrollment'));
});

test('pending heartbeat guards cannot be presented as a confirmed installation', async () => {
  const f = fixture(); f.pendingHeartbeat();
  f.records.set('enrollment_tokens/enrollment', { organization_id: 'org', expires_at: '2026-10-01T12:30:00.000Z', max_uses: 1, use_count: 1 });
  f.receipts([{ organization_id: 'org', enrollment_token_id: 'enrollment', device_id: 'device', device_uuid: f.device.device_uuid,
    status: 'committed', committed_at: now.toISOString(), token_use_consumed: true, recovery_frozen: false, expected_use_count: 1 }]);
  assert.equal((await f.service.status(technician, 'enrollment')).status, 'waiting');
});

test('disabled, offline, future timestamps and unsafe RustDesk identifiers fail before credential reads', async () => {
  for (const mutation of [{ enabled: false }, { last_seen_at: '2026-10-01T11:58:29.000Z' },
    { last_seen_at: '2026-10-02T00:00:00.000Z' }, { rustdesk_id: '123@evil?password=leak' }]) {
    const f = fixture(); Object.assign(f.device, mutation);
    await assert.rejects(f.service.connect(technician, 'device', '127.0.0.1'));
    assert.ok(!f.reads.includes('device_credentials'));
  }
});

test('connect produces a fixed-server URI only after successful audit, rejects tampering and audit failures', async () => {
  const f = fixture(); const response = await f.service.connect(technician, 'device', '127.0.0.1');
  const uri = new URL(response.launchUri);
  assert.equal(uri.protocol, 'rustdesk:'); assert.equal(uri.hostname, 'connect');
  assert.equal(uri.pathname, '/123456789@179.199.142.157:21116');
  assert.equal(uri.searchParams.get('password'), 'synthetic-password');
  assert.equal(uri.searchParams.get('key'), '6qc86QUPst9+H4QjXyQvSLPbGU6ef25iO+ESoi3figk=');
  assert.equal(f.events.length, 1); assert.ok(!JSON.stringify(f.events).includes('synthetic-password'));
  f.failAudit(); await assert.rejects(f.service.connect(technician, 'device', '127.0.0.1'));
  const corrupted = fixture(); corrupted.records.get('device_credentials/device')!.password_tag = 'tampered';
  await assert.rejects(corrupted.service.connect(technician, 'device', '127.0.0.1'));
  assert.equal(corrupted.events.length, 0);
});

test('invalid credential version never records a successful connection audit', async () => {
  const f = fixture(); f.records.get('device_credentials/device')!.key_version = 2;
  await assert.rejects(f.service.connect(technician, 'device', '127.0.0.1'));
  assert.equal(f.events.length, 0);
});

test('response validation failure records no success and exposes no URI in the error', async () => {
  const f = fixture();
  const validation = mock.method(ConnectDeviceResponseSchema, 'parse', () => { throw new Error('synthetic validation error'); });
  try {
    await assert.rejects(f.service.connect(technician, 'device', '127.0.0.1'), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('rustdesk://'));
      assert.ok(!error.message.includes('synthetic-password'));
      return true;
    });
    assert.equal(f.events.length, 0);
  } finally { validation.mock.restore(); }
});

test('pending heartbeat and revoked tokens deny connect before credential access or audit', async () => {
  for (const state of ['pending', 'revoked', 'never-used'] as const) {
    const f = fixture();
    if (state === 'pending') f.pendingHeartbeat();
    if (state === 'revoked') f.records.get('device_tokens/device')!.revoked_at = now.toISOString();
    if (state === 'never-used') f.records.get('device_tokens/device')!.last_used_at = null;
    await assert.rejects(f.service.connect(technician, 'device', '127.0.0.1'));
    assert.ok(!f.reads.includes('device_credentials'));
    assert.equal(f.events.length, 0);
  }
});

test('reinstallation status waits for communication newer than the new receipt', async () => {
  const f = fixture();
  f.records.set('enrollment_tokens/new-package', { organization_id: 'org', expires_at: '2026-10-01T12:30:00.000Z', max_uses: 1, use_count: 1 });
  const receipt = { organization_id: 'org', enrollment_token_id: 'new-package', device_id: 'device',
    device_uuid: f.device.device_uuid, status: 'committed', committed_at: now.toISOString(), token_use_consumed: true, recovery_frozen: false, expected_use_count: 1 };
  f.receipts([receipt]);
  f.device.display_name = 'New name';
  f.device.last_seen_at = new Date(now.getTime() - 1000).toISOString();
  f.records.get('device_tokens/device')!.last_used_at = f.device.last_seen_at;
  assert.equal((await f.service.status(technician, 'new-package')).status, 'waiting');
  f.device.last_seen_at = now.toISOString();
  f.records.get('device_tokens/device')!.last_used_at = f.device.last_seen_at;
  const response = await f.service.status(technician, 'new-package');
  assert.equal(response.status, 'online'); assert.equal(response.device!.displayName, 'New name');
  assert.equal(response.device!.id, 'device');
});
