import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEnrollmentService, EnrollmentError } from './enroll-device.ts';
import { enrollmentId, type EnrollmentRepository, type EnrollmentToken, type EnrollmentData } from '../repositories/enrollment.ts';
import type { AuditRepository, EnrollmentAudit } from '../repositories/audit.ts';
import { hashToken } from '../security/tokens.ts';
import { decryptPassword } from '../security/credentials.ts';
import type { EnrollRequest } from '@appremoto/contracts';

export const request: EnrollRequest = { enrollmentToken: 'synthetic-enrollment-secret-000000000',
  deviceUuid: '00000000-0000-4000-8000-000000000001', displayName: 'Test PC', hostname: 'test-pc',
  operatingSystem: 'Windows', osVersion: '11', agentVersion: '1', rustdeskId: '123', rustdeskVersion: '1' };
const now = new Date('2026-09-30T12:00:00Z');
const key = Buffer.alloc(32, 9);

function fixture() {
  const token: EnrollmentToken = { id: 'enroll-1', organization_id: 'org-1', token_hash: hashToken(request.enrollmentToken),
    expires_at: '2026-10-01T00:00:00Z', max_uses: 1, use_count: 0, active: true };
  const rows = new Map<string, EnrollmentData>();
  rows.set('enrollment_tokens/enroll-1', structuredClone(token));
  const events = new Map<string, EnrollmentAudit>();
  const calls: string[] = [];
  let fail = ''; let after = false; let restoreFail = '';
  const repo: EnrollmentRepository = {
    findToken: async (hash) => {
      const current = rows.get('enrollment_tokens/enroll-1') as EnrollmentToken;
      return current.token_hash === hash ? structuredClone(current) : null;
    },
    organizationActive: async () => true,
    pendingReceipts: async (tokenId) => [...rows].filter(([path, data]) => path.startsWith('enrollment_receipts/') &&
      data.enrollment_token_id === tokenId && data.status === 'pending').map(([, data]) => structuredClone(data)),
    snapshot: async (kind, id) => structuredClone(rows.get(`${kind}/${id}`) ?? null),
    write: async (kind, id, data, previous) => {
      calls.push(`write:${kind}`);
      const failing = fail === kind || (fail === 'receipt_commit' && kind === 'enrollment_receipts' && data.status === 'committed');
      if (failing && !after) throw new Error('private-secret-error');
      assert.deepEqual(rows.get(`${kind}/${id}`) ?? null, previous);
      rows.set(`${kind}/${id}`, structuredClone(data));
      if (failing && after) throw new Error('private-secret-error');
    },
    restore: async (kind, id, previous, expected) => {
      calls.push(`restore:${kind}`);
      if (restoreFail === kind) throw new Error('private-secret-restore');
      const current = rows.get(`${kind}/${id}`) ?? null;
      if (JSON.stringify(current) === JSON.stringify(previous)) return;
      assert.deepEqual(current, expected);
      if (previous) rows.set(`${kind}/${id}`, structuredClone(previous)); else rows.delete(`${kind}/${id}`);
    },
  };
  const audit: AuditRepository = {
    record: async (id, event) => {
      calls.push(`audit:${event.result}`);
      if (fail === 'audit' && !after) throw new Error('private-secret-audit');
      events.set(id, structuredClone(event));
      if (fail === 'audit' && after) throw new Error('private-secret-audit');
    },
    remove: async (id) => { calls.push('restore:audit'); if (restoreFail === 'audit') throw new Error('private'); events.delete(id); },
  };
  const enroll = createEnrollmentService({ repository: repo, audit, encryptionKey: key, keyVersion: 2, now: () => now });
  return { rows, token, events, calls, repo, enroll,
    failAt: (point: string, post = false) => { fail = point; after = post; },
    failRestore: (point: string) => { restoreFail = point; } };
}

test('enrollment persists hashes, authenticated envelope, linkage and consumed use before audit', async () => {
  const f = fixture(); const result = await f.enroll(request, '127.0.0.1');
  assert.equal(result.rustdeskPassword.length, 32);
  for (const pattern of [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/]) assert.match(result.rustdeskPassword, pattern);
  assert.equal(result.heartbeatIntervalSeconds, 30);
  assert.equal(f.rows.get('enrollment_tokens/enroll-1')!.use_count, 1);
  const credential = f.rows.get(`device_credentials/${result.deviceId}`)!;
  assert.equal(decryptPassword({ passwordCiphertext: credential.password_ciphertext,
    passwordNonce: credential.password_nonce, passwordTag: credential.password_tag, keyVersion: credential.key_version }, key, 2), result.rustdeskPassword);
  assert.equal(f.rows.get(`device_tokens/${result.deviceId}`)!.token_hash, hashToken(result.deviceToken));
  const receipt = f.rows.get(`enrollment_receipts/${enrollmentId('receipt', 'enroll-1', request.deviceUuid)}`)!;
  assert.equal(receipt.status, 'committed'); assert.equal(receipt.token_use_consumed, true);
  const persisted = JSON.stringify([...f.rows, ...f.events]);
  for (const secret of [request.enrollmentToken, result.deviceToken, result.rustdeskPassword]) assert.ok(!persisted.includes(secret));
  assert.deepEqual(f.calls.filter((call) => !call.startsWith('restore')), [
    'write:enrollment_receipts', 'write:devices', 'write:device_tokens', 'write:device_credentials',
    'write:enrollment_tokens', 'write:enrollment_receipts', 'audit:success']);
});

test('sequential committed retry rotates usable credentials without another use', async () => {
  const f = fixture(); const first = await f.enroll(request, '127.0.0.1');
  const second = await f.enroll(request, '127.0.0.1');
  assert.equal(first.deviceId, second.deviceId); assert.notEqual(first.deviceToken, second.deviceToken);
  assert.notEqual(first.rustdeskPassword, second.rustdeskPassword);
  assert.equal(f.rows.get('enrollment_tokens/enroll-1')!.use_count, 1);
  assert.equal(f.rows.get(`device_tokens/${second.deviceId}`)!.token_hash, hashToken(second.deviceToken));
});

test('concurrent identical calls share one promise and one usable response', async () => {
  const f = fixture(); const a = f.enroll(request, '127.0.0.1'); const b = f.enroll({ ...request }, '127.0.0.1');
  assert.equal(a, b); const [first, second] = await Promise.all([a, b]); assert.deepEqual(first, second);
  assert.equal(f.events.size, 1); assert.equal(f.rows.get('enrollment_tokens/enroll-1')!.use_count, 1);
});

test('concurrent identical payloads from different source IPs still share usable credentials', async () => {
  const f = fixture(); const a = f.enroll(request, '127.0.0.1'); const b = f.enroll({ ...request }, '192.0.2.1');
  assert.equal(a, b); assert.deepEqual(await a, await b); assert.equal(f.events.size, 1);
});

test('same device enrolled with another token never uses the first token receipt', async () => {
  const f = fixture(); await f.enroll(request, '127.0.0.1');
  const other = { ...f.token, id: 'enroll-2', token_hash: hashToken('x'.repeat(32)) };
  f.repo.findToken = async () => other;
  const before = structuredClone([...f.rows]);
  await assert.rejects(f.enroll({ ...request, enrollmentToken: 'x'.repeat(32) }, '127.0.0.1'), EnrollmentError);
  assert.deepEqual([...f.rows], before);
});

test('storage reads fail generically before any enrollment mutation', async () => {
  for (const method of ['findToken', 'organizationActive', 'snapshot'] as const) {
    const f = fixture(); f.repo[method] = async () => { throw new Error(request.enrollmentToken); };
    await assert.rejects(f.enroll(request, '127.0.0.1'), /^Error: Enrollment unavailable$/);
    assert.equal(f.calls.length, 0);
  }
});

test('compensation failure quarantines the token so it cannot consume another use', async () => {
  const f = fixture(); f.failAt('audit', true); f.failRestore('enrollment_tokens');
  await assert.rejects(f.enroll(request, '127.0.0.1'), EnrollmentError);
  const before = structuredClone([...f.rows]); f.failAt(''); f.failRestore('');
  await assert.rejects(f.enroll(request, '127.0.0.1'), /^Error: Enrollment unavailable$/);
  assert.deepEqual([...f.rows], before);
});

for (const artifact of ['devices', 'device_tokens', 'device_credentials', 'consumed']) {
  test(`pending receipt with ${artifact} is ambiguous and must not be recovered`, async () => {
    const f = fixture(); const deviceId = enrollmentId('device', 'org-1', request.deviceUuid);
    f.rows.set(`enrollment_receipts/${enrollmentId('receipt', 'enroll-1', request.deviceUuid)}`, {
      organization_id: 'org-1', enrollment_token_id: 'enroll-1', device_id: deviceId,
      device_uuid: request.deviceUuid, status: 'pending', token_use_consumed: false });
    if (artifact === 'consumed') f.rows.get('enrollment_tokens/enroll-1')!.use_count = 1;
    else f.rows.set(`${artifact}/${deviceId}`, { device_id: deviceId });
    const before = structuredClone([...f.rows]); await assert.rejects(f.enroll(request, '127.0.0.1'), EnrollmentError);
    assert.deepEqual([...f.rows], before);
  });
}

test('different concurrent devices cannot exceed the token maximum', async () => {
  const f = fixture(); const results = await Promise.allSettled([f.enroll(request, '127.0.0.1'),
    f.enroll({ ...request, deviceUuid: '00000000-0000-4000-8000-000000000002' }, '127.0.0.1')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(f.rows.get('enrollment_tokens/enroll-1')!.use_count, 1);
});

test('different concurrent devices use the same token serially when capacity permits', async () => {
  const f = fixture(); f.rows.get('enrollment_tokens/enroll-1')!.max_uses = 2;
  const results = await Promise.all([f.enroll(request, '127.0.0.1'),
    f.enroll({ ...request, deviceUuid: '00000000-0000-4000-8000-000000000002' }, '127.0.0.1')]);
  assert.notEqual(results[0]!.deviceId, results[1]!.deviceId);
  assert.equal(f.rows.get('enrollment_tokens/enroll-1')!.use_count, 2);
});

for (const changes of [{ active: false }, { expires_at: now.toISOString() }, { expires_at: 'invalid' },
  { use_count: 1 }, { use_count: -1 }, { max_uses: 0 }]) {
  test(`rejects invalid enrollment token ${JSON.stringify(changes)}`, async () => {
    const f = fixture(); Object.assign(f.rows.get('enrollment_tokens/enroll-1')!, changes);
    await assert.rejects(f.enroll(request, '127.0.0.1'), EnrollmentError); assert.ok(!f.calls.some((call) => call.startsWith('write:')));
  });
}

test('unknown token and inactive organization fail without writes', async () => {
  const f = fixture(); await assert.rejects(f.enroll({ ...request, enrollmentToken: 'x'.repeat(32) }, '127.0.0.1'), EnrollmentError);
  f.repo.organizationActive = async () => false;
  await assert.rejects(f.enroll(request, '127.0.0.1'), EnrollmentError); assert.ok(!f.calls.some((call) => call.startsWith('write:')));
});

test('known authentication and replay denials record fixed-field audit without changing enrollment state', async () => {
  for (const changes of [{ active: false }, { expires_at: now.toISOString() }, { use_count: 1 }]) {
    const f = fixture(); Object.assign(f.rows.get('enrollment_tokens/enroll-1')!, changes);
    const before = structuredClone([...f.rows]);
    await assert.rejects(f.enroll(request, '127.0.0.1'), (e: unknown) => e instanceof EnrollmentError && e.code === 'ENROLLMENT_DENIED');
    const event = [...f.events.values()][0]!; assert.equal(event.result, 'failure'); assert.ok(event.reason);
    assert.equal(event.organizationId, 'org-1'); assert.deepEqual([...f.rows], before);
    assert.ok(!JSON.stringify(event).includes(request.enrollmentToken));
  }
  const f = fixture(); await f.enroll(request, '127.0.0.1'); f.events.clear();
  f.rows.get(`enrollment_receipts/${enrollmentId('receipt', 'enroll-1', request.deviceUuid)}`)!.device_id = 'other';
  const before = structuredClone([...f.rows]); await assert.rejects(f.enroll(request, '127.0.0.1'), EnrollmentError);
  assert.equal([...f.events.values()][0]!.reason, 'identity_mismatch'); assert.deepEqual([...f.rows], before);
});

test('denial audit failure preserves stable denial and unknown tokens never create organization audit', async () => {
  const f = fixture(); f.rows.get('enrollment_tokens/enroll-1')!.active = false; f.failAt('audit');
  const before = structuredClone([...f.rows]);
  await assert.rejects(f.enroll(request, '127.0.0.1'), (e: unknown) => e instanceof EnrollmentError && e.code === 'ENROLLMENT_DENIED');
  assert.deepEqual([...f.rows], before);
  const unknown = fixture(); await assert.rejects(unknown.enroll({ ...request, enrollmentToken: 'z'.repeat(32) }, '127.0.0.1'), EnrollmentError);
  assert.equal(unknown.events.size, 0);
});

test('device existence without a committed receipt never permits credential rotation', async () => {
  const f = fixture(); const result = await f.enroll(request, '127.0.0.1');
  f.rows.delete(`enrollment_receipts/${enrollmentId('receipt', 'enroll-1', request.deviceUuid)}`);
  f.rows.get('enrollment_tokens/enroll-1')!.use_count = 0;
  const before = structuredClone([...f.rows]);
  await assert.rejects(f.enroll(request, '127.0.0.1'), EnrollmentError);
  assert.deepEqual([...f.rows], before); assert.ok(result.deviceToken);
});

for (const changes of [{ organization_id: 'other' }, { device_id: 'other' }, { device_uuid: 'other' },
  { enrollment_token_id: 'other' }, { token_use_consumed: false }, { status: 'pending' }]) {
  test(`retry rejects broken receipt ${JSON.stringify(changes)}`, async () => {
    const f = fixture(); await f.enroll(request, '127.0.0.1');
    Object.assign(f.rows.get(`enrollment_receipts/${enrollmentId('receipt', 'enroll-1', request.deviceUuid)}`)!, changes);
    const before = structuredClone([...f.rows]); await assert.rejects(f.enroll(request, '127.0.0.1'), EnrollmentError);
    assert.deepEqual([...f.rows], before);
  });
}

test('committed retry still requires active unexpired token and matching enabled device', async () => {
  for (const target of ['active', 'expires_at', 'organization_id', 'device_uuid', 'enabled']) {
    const f = fixture(); const result = await f.enroll(request, '127.0.0.1');
    if (target === 'active') f.rows.get('enrollment_tokens/enroll-1')!.active = false;
    else if (target === 'expires_at') f.rows.get('enrollment_tokens/enroll-1')!.expires_at = now.toISOString();
    else f.rows.get(`devices/${result.deviceId}`)![target] = target === 'enabled' ? false : 'other';
    await assert.rejects(f.enroll(request, '127.0.0.1'), EnrollmentError);
  }
});

test('pending receipt with unobserved target stays pending and does not guess the consumption outcome', async () => {
  const f = fixture(); const deviceId = enrollmentId('device', 'org-1', request.deviceUuid);
  f.rows.set(`enrollment_receipts/${enrollmentId('receipt', 'enroll-1', request.deviceUuid)}`, {
    organization_id: 'org-1', enrollment_token_id: 'enroll-1', device_id: deviceId,
    device_uuid: request.deviceUuid, status: 'pending', token_use_consumed: false, expected_use_count: 1 });
  await assert.rejects(f.enroll(request, '127.0.0.1'), EnrollmentError);
  assert.ok(!f.rows.has(`devices/${deviceId}`));
});

for (const point of ['enrollment_receipts', 'devices', 'device_tokens', 'device_credentials', 'enrollment_tokens', 'receipt_commit', 'audit']) {
  for (const after of [false, true]) test(`compensates ${point}, failure ${after ? 'after' : 'before'} persistence`, async () => {
    const f = fixture(); const before = structuredClone([...f.rows]); f.failAt(point, after);
    await assert.rejects(f.enroll(request, '127.0.0.1'), (error: unknown) => error instanceof EnrollmentError && !error.message.includes('private'));
    assert.deepEqual([...f.rows], before); assert.equal([...f.events.values()].filter((e) => e.result === 'success').length, 0);
  });
}

test('a late failed retry restores previous working credentials and committed receipt', async () => {
  const f = fixture(); await f.enroll(request, '127.0.0.1'); const before = structuredClone([...f.rows]);
  f.failAt('audit', true); await assert.rejects(f.enroll(request, '127.0.0.1'), EnrollmentError);
  assert.deepEqual([...f.rows], before);
});

for (const point of ['enrollment_receipts', 'devices', 'device_tokens', 'device_credentials', 'enrollment_tokens', 'audit']) {
  test(`compensation failure at ${point} remains generic and attempts remaining rollback`, async () => {
    const f = fixture(); f.failAt('audit', true); f.failRestore(point);
    await assert.rejects(f.enroll(request, '127.0.0.1'), /^Error: Enrollment unavailable$/);
    assert.ok(f.calls.includes('restore:enrollment_receipts'));
    assert.ok(f.calls.includes('audit:failure'));
    assert.ok(!JSON.stringify([...f.events]).includes('private'));
  });
}
