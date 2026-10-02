import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createGenericInstallerService } from './generic-installers.ts';
import { createEnrollmentService } from './enroll-device.ts';
import { decryptPassword } from '../security/credentials.ts';
import { hashToken, issueToken } from '../security/tokens.ts';
import type { GenericInstallerRepository, GenericInstallerRecord } from '../repositories/generic-installers.ts';
import { enrollmentId, IndeterminateEnrollmentWrite, RejectedEnrollmentWrite,
  type EnrollmentRepository, type EnrollmentData, type EnrollmentToken, type HeartbeatGuard } from '../repositories/enrollment.ts';
import type { Organization } from '../repositories/organizations.ts';
import type { AuthenticatedTechnician } from '../plugins/technician-auth.ts';
import type { AuditRepository, OperatorAuditRepository } from '../repositories/audit.ts';

const time = new Date('2026-10-02T00:00:00.000Z'); const key = Buffer.alloc(32, 6);
const shared = 'synthetic-common-password-1234';
const admin: AuthenticatedTechnician = { userId: 'superadmin', displayName: 'Administrator', globalRole: 'super_admin', organizations: [], authorization: [] };
const input = () => ({ requestId: randomUUID(), requestSecret: issueToken(), companyName: 'Customer', deviceDisplayName: 'PC' });
function fixture(password: string | undefined = shared) {
  const profiles = new Map<string, GenericInstallerRecord>(); const organizations = new Map<string, Organization>();
  const rows = new Map<string, EnrollmentData>(); const audits: unknown[] = [];
  let date = time; let issuerActive = true; let heldGuard: HeartbeatGuard | null = null;
  const genericRepo: GenericInstallerRepository = {
    get: async (id) => structuredClone(profiles.get(id) ?? null), list: async () => [...profiles.values()].map((row) => structuredClone(row)),
    create: async (record) => { const row = { ...record, createdAt: date.toISOString() }; profiles.set(row.id, row); return row; },
    revoke: async (id, at) => { Object.assign(profiles.get(id)!, { active: false, revokedAt: at }); },
    issuerIsSuperAdmin: async () => issuerActive,
    organizations: async () => [...organizations.values()].map((row) => structuredClone(row)),
    organization: async (id) => structuredClone(organizations.get(id) ?? null),
    createOrganization: async (row) => {
      if (organizations.has(row.id)) { assert.deepEqual(organizations.get(row.id), row); return; }
      organizations.set(row.id, structuredClone(row));
    },
  };
  const repo: EnrollmentRepository = {
    findToken: async (hash) => {
      const found = [...rows].find(([id, row]) => id.startsWith('enrollment_tokens/') && row.token_hash === hash);
      return found ? { id: found[0].split('/')[1]!, ...structuredClone(found[1]) } as EnrollmentToken : null;
    }, organizationActive: async (id) => organizations.get(id)?.active === true,
    pendingReceipts: async (id) => [...rows].filter(([key, value]) => key.startsWith('enrollment_receipts/') &&
      value.enrollment_token_id === id && value.status === 'pending').map(([, value]) => structuredClone(value)),
    snapshot: async (kind, id) => structuredClone(rows.get(`${kind}/${id}`) ?? null),
    write: async (kind, id, row) => { rows.set(`${kind}/${id}`, structuredClone(row)); },
    restore: async (kind, id, previous) => { if (previous) rows.set(`${kind}/${id}`, previous); else rows.delete(`${kind}/${id}`); },
    freezeToken: async (id) => { const row = rows.get(`enrollment_tokens/${id}`); if (!row) return null; row.active = false; return structuredClone(row); },
  };
  const guard = { beginHeartbeatGuard: async (value: HeartbeatGuard) => {
    if (heldGuard) return false; heldGuard = structuredClone(value); return true;
  }, endHeartbeatGuard: async (value: HeartbeatGuard) => {
    if (JSON.stringify(heldGuard) !== JSON.stringify(value)) return false; heldGuard = null; return true;
  }, matchesHeartbeatGuard: async (value: HeartbeatGuard) => JSON.stringify(heldGuard) === JSON.stringify(value),
    getHeartbeatGuard: async () => structuredClone(heldGuard) };
  const audit: AuditRepository & OperatorAuditRepository = { record: async (_id, event) => { audits.push(event); }, remove: async () => {},
    recordOperator: async (_id, event) => { audits.push(event); } };
  const createGeneric = (value: string | undefined = password) => createGenericInstallerService({ repository: genericRepo, enrollment: repo, audit,
    encryptionKey: key, ...(value !== undefined ? { sharedPassword: value } : {}), now: () => date });
  const generic = createGeneric();
  const createEnroll = (service = generic) => createEnrollmentService({ repository: repo, audit, encryptionKey: key, keyVersion: 1,
    reconfigurationGuard: guard, genericPassword: service.enrollmentPassword, now: () => date });
  return { profiles, organizations, rows, audits, genericRepo, repo, guard, audit, generic, enroll: createEnroll(), createEnroll, createGeneric,
    advance: (minutes: number) => { date = new Date(time.getTime() + minutes * 60_000); },
    disableIssuer: () => { issuerActive = false; }, held: () => heldGuard,
    storedPassword: (deviceId: string) => {
      const value = rows.get(`device_credentials/${deviceId}`)!;
      return decryptPassword({ passwordCiphertext: value.password_ciphertext, passwordNonce: value.password_nonce,
        passwordTag: value.password_tag, keyVersion: value.key_version }, key, 1);
    } };
}
async function provision(f: ReturnType<typeof fixture>) {
  const created = await f.generic.create(admin, { name: 'Technician package' });
  const request = { ...input(), installerId: created.installer.id };
  const prepared = await f.generic.prepare(created.package.installerToken, request, '127.0.0.1');
  return { created, request, prepared };
}
function agentRequest(enrollmentToken: string) {
  return { enrollmentToken, deviceUuid: randomUUID(), displayName: 'PC', hostname: 'PC', operatingSystem: 'Windows', osVersion: '11',
    agentVersion: '1.0.4', rustdeskId: '123456789', rustdeskVersion: '1.4.9' };
}
async function legacyReinstall(f: ReturnType<typeof fixture>) {
  f.organizations.set('organization', { id: 'organization', name: 'Customer', slug: 'customer', active: true });
  const legacyToken = issueToken();
  f.rows.set('enrollment_tokens/legacy', { organization_id: 'organization', token_hash: hashToken(legacyToken), expires_at: '2026-10-02T00:30:00Z',
    max_uses: 1, use_count: 0, active: true, created_by_user_id: 'superadmin', revoked_at: null });
  const request = agentRequest(legacyToken); const enrolled = await f.enroll(request, '127.0.0.1');
  const p = await provision(f);
  const reconfigure = { ...request, enrollmentToken: p.prepared.enrollmentToken, currentDeviceToken: enrolled.deviceToken };
  await f.enroll.reconfigure!(reconfigure, '127.0.0.1');
  return { ...p, reconfigure, enrolled };
}

test('only superadmins issue/list/download/revoke enrollment-only capabilities; storage and views contain no plaintext', async () => {
  const f = fixture(); const regular = { ...admin, globalRole: null };
  await assert.rejects(f.generic.create(regular, { name: 'Package' }), { code: 'GENERIC_INSTALLER_DENIED' });
  const created = await f.generic.create(admin, { name: 'Package' });
  assert.equal(created.package.installerToken.length, 43);
  assert.equal(f.profiles.get(created.installer.id)!.tokenHash, hashToken(created.package.installerToken));
  const downloaded = await f.generic.download(admin, created.installer.id); assert.deepEqual(downloaded.package, created.package);
  const list = await f.generic.list(admin); assert.equal(list.installers.length, 1);
  for (const operation of [() => f.generic.list(regular), () => f.generic.download(regular, created.installer.id),
    () => f.generic.revoke(regular, created.installer.id)]) await assert.rejects(operation());
  for (const value of [JSON.stringify([...f.profiles.values()]), JSON.stringify(list), JSON.stringify(f.audits)]) {
    assert.ok(!value.includes(created.package.installerToken)); assert.ok(!value.includes(shared));
  }
  await f.generic.revoke(admin, created.installer.id); await f.generic.revoke(admin, created.installer.id);
  await assert.rejects(f.generic.download(admin, created.installer.id), { code: 'GENERIC_INSTALLER_DENIED' });
});

test('unconfigured shared password prevents issuing or preparing generic packages, without affecting legacy enrollment', async () => {
  const f = fixture(undefined);
  // Explicitly construct an unconfigured service because undefined selects the fixture default.
  const unconfigured = createGenericInstallerService({ repository: f.genericRepo, enrollment: f.repo, audit: f.audit, encryptionKey: key });
  await assert.rejects(unconfigured.create(admin, { name: 'Package' }), { code: 'PASSWORD_NOT_CONFIGURED' });
  assert.equal(await unconfigured.enrollmentPassword({ generic_installer_id: null, bootstrap_request_hash: null } as unknown as EnrollmentToken), undefined);
});

test('prepare survives restart and duplicate calls with identical request proof without duplicate organization or token', async () => {
  const f = fixture(); const p = await provision(f);
  const repeated = await Promise.all([f.generic.prepare(p.created.package.installerToken, p.request, '127.0.0.1'),
    f.generic.prepare(p.created.package.installerToken, p.request, '127.0.0.2')]);
  const restarted = await f.createGeneric().prepare(p.created.package.installerToken, p.request, '127.0.0.3');
  assert.deepEqual(repeated, [p.prepared, p.prepared]); assert.deepEqual(restarted, p.prepared);
  assert.equal(f.organizations.size, 1); assert.equal(f.rows.size, 1);
  assert.ok(!JSON.stringify([...f.rows.values(), ...f.audits]).includes(p.prepared.enrollmentToken));
  assert.ok(!JSON.stringify([...f.rows.values(), ...f.audits]).includes(p.request.requestSecret));
  for (const change of [{ requestSecret: issueToken() }, { deviceDisplayName: 'Another' }, { companyName: 'Another' }]) {
    await assert.rejects(f.generic.prepare(p.created.package.installerToken, { ...p.request, ...change }, '127.0.0.1'),
      { code: 'GENERIC_INSTALLER_REQUEST_CONFLICT' });
  }
  assert.equal(f.organizations.size, 1);
});

test('company normalization reuses active company and creates new company if not found', async () => {
  const f = fixture(); f.organizations.set('org', { id: 'org', name: 'CUSTOMER', slug: 'customer', active: true });
  const p = await provision(f); assert.equal(p.prepared.organizationId, 'org'); assert.equal(f.organizations.size, 1);
  const p2 = await f.generic.prepare(p.created.package.installerToken, { ...input(), installerId: p.created.installer.id,
    companyName: 'Nova Empresa', existingOrganizationId: 'org' }, '127.0.0.1');
  assert.equal(p2.organizationName, 'Nova Empresa');
  assert.notEqual(p2.organizationId, 'org');
  assert.equal(f.organizations.size, 2);
  f.organizations.set('duplicate', { id: 'duplicate', name: 'customer', slug: 'second', active: true });
  const p3 = await f.generic.prepare(p.created.package.installerToken, { ...input(), installerId: p.created.installer.id,
    companyName: 'CUSTOMER' }, '127.0.0.1');
  assert.equal(p3.organizationId, 'org');
});

test('revocation, issuer disablement, wrong capability and expired one-use package fail closed', async () => {
  const f = fixture(); const p = await provision(f);
  await assert.rejects(f.generic.prepare(issueToken(), p.request, '127.0.0.1'), { code: 'GENERIC_INSTALLER_DENIED' });
  f.advance(31); await assert.rejects(f.generic.prepare(p.created.package.installerToken, p.request, '127.0.0.1'), { code: 'GENERIC_INSTALLER_EXPIRED' });
  f.advance(0); await f.generic.revoke(admin, p.created.installer.id);
  await assert.rejects(f.generic.prepare(p.created.package.installerToken, p.request, '127.0.0.1'), { code: 'GENERIC_INSTALLER_DENIED' });
  await assert.rejects(f.enroll(agentRequest(p.prepared.enrollmentToken), '127.0.0.1'));
  const active = fixture(); const other = await provision(active); active.disableIssuer();
  await assert.rejects(active.generic.prepare(other.created.package.installerToken, other.request, '127.0.0.1'));
});

test('generic enrollment uses the shared password for new machines while preserving legacy secret replay rules', async () => {
  const f = fixture(); const p = await provision(f); const request = agentRequest(p.prepared.enrollmentToken);
  const enrolled = await f.enroll(request, '127.0.0.1');
  assert.equal(enrolled.rustdeskPassword, shared); assert.equal(f.storedPassword(enrolled.deviceId), shared);
  await assert.rejects(f.enroll(request, '127.0.0.1'));
  const p2 = await f.generic.prepare(p.created.package.installerToken, { ...input(), installerId: p.created.installer.id }, '127.0.0.1');
  const second = await f.enroll(agentRequest(p2.enrollmentToken), '127.0.0.1');
  assert.equal(second.rustdeskPassword, shared); assert.notEqual(second.deviceId, enrolled.deviceId);
});

test('generic reinstall rotates only the proven existing device, keeps ID/token and blocks connections until confirmation', async () => {
  const f = fixture(); const p = await legacyReinstall(f);
  const originalToken = structuredClone(f.rows.get(`device_tokens/${p.enrolled.deviceId}`));
  assert.notEqual(p.enrolled.rustdeskPassword, shared);
  const stage = await f.enroll.stageGenericPassword!(p.reconfigure, '127.0.0.1');
  assert.equal(stage.rustdeskPassword, shared); assert.equal(stage.deviceId, p.enrolled.deviceId); assert.ok(f.held());
  assert.equal(f.storedPassword(stage.deviceId), p.enrolled.rustdeskPassword);
  const confirmed = await f.enroll.confirmGenericPassword!(p.reconfigure, '127.0.0.1');
  assert.deepEqual(confirmed, { deviceId: p.enrolled.deviceId, applied: true });
  assert.equal(f.held(), null); assert.equal(f.storedPassword(stage.deviceId), shared);
  assert.deepEqual(f.rows.get(`device_tokens/${stage.deviceId}`), originalToken);
  assert.deepEqual(await f.createEnroll().confirmGenericPassword!(p.reconfigure, '127.0.0.1'), confirmed);
});

test('already-started rotation survives API restart, package expiry and capability revocation but still requires original device proof', async () => {
  const f = fixture(); const p = await legacyReinstall(f);
  const first = await f.enroll.stageGenericPassword!(p.reconfigure, '127.0.0.1');
  f.advance(61); await f.generic.revoke(admin, p.created.installer.id);
  const restarted = f.createEnroll();
  assert.deepEqual(await restarted.stageGenericPassword!(p.reconfigure, '127.0.0.1'), first);
  await assert.rejects(restarted.confirmGenericPassword!({ ...p.reconfigure, currentDeviceToken: issueToken() }, '127.0.0.1'), { code: 'GENERIC_PASSWORD_DENIED' });
  await restarted.confirmGenericPassword!(p.reconfigure, '127.0.0.1'); assert.equal(f.held(), null);
  assert.equal(f.storedPassword(p.enrolled.deviceId), shared);
  const fresh = fixture(); const p2 = await legacyReinstall(fresh); fresh.advance(31);
  await assert.rejects(fresh.enroll.stageGenericPassword!(p2.reconfigure, '127.0.0.1'), { code: 'GENERIC_PASSWORD_DENIED' });
  assert.equal(fresh.held(), null);
});

test('rotation cannot target another device, a revoked device token, a personalized package or an unapplied confirmation', async () => {
  const f = fixture(); const p = await legacyReinstall(f);
  await assert.rejects(f.enroll.confirmGenericPassword!(p.reconfigure, '127.0.0.1'), { code: 'GENERIC_PASSWORD_DENIED' });
  await assert.rejects(f.enroll.stageGenericPassword!({ ...p.reconfigure, deviceUuid: randomUUID() }, '127.0.0.1'), { code: 'GENERIC_PASSWORD_DENIED' });
  const token = f.rows.get(`device_tokens/${p.enrolled.deviceId}`)!; token.revoked_at = time.toISOString();
  await assert.rejects(f.enroll.stageGenericPassword!(p.reconfigure, '127.0.0.1'), { code: 'GENERIC_PASSWORD_DENIED' });
  assert.equal(f.held(), null); assert.equal(f.storedPassword(p.enrolled.deviceId), p.enrolled.rustdeskPassword);
});

test('pending rotation rejects a different password policy without silently applying another password', async () => {
  const f = fixture(); const p = await legacyReinstall(f);
  await f.enroll.stageGenericPassword!(p.reconfigure, '127.0.0.1');
  const changed = f.createEnroll(f.createGeneric('another-synthetic-password-6789'));
  await assert.rejects(changed.confirmGenericPassword!(p.reconfigure, '127.0.0.1'), { code: 'GENERIC_PASSWORD_POLICY_CHANGED' });
  assert.ok(f.held()); assert.equal(f.storedPassword(p.enrolled.deviceId), p.enrolled.rustdeskPassword);
});

test('uncertain credential write is never blindly repeated; observed target allows exact recovery and guard release', async () => {
  const f = fixture(); const p = await legacyReinstall(f);
  await f.enroll.stageGenericPassword!(p.reconfigure, '127.0.0.1');
  const original = f.repo.write; let pending: EnrollmentData | undefined; let writes = 0;
  f.repo.write = async (kind, id, row, old) => {
    if (kind === 'device_credentials') { writes++; pending = structuredClone(row); throw new IndeterminateEnrollmentWrite(); }
    return original(kind, id, row, old);
  };
  await assert.rejects(f.enroll.confirmGenericPassword!(p.reconfigure, '127.0.0.1'));
  await assert.rejects(f.createEnroll().confirmGenericPassword!(p.reconfigure, '127.0.0.1'));
  assert.equal(writes, 1); assert.ok(f.held());
  f.rows.set(`device_credentials/${p.enrolled.deviceId}`, pending!);
  await f.createEnroll().confirmGenericPassword!(p.reconfigure, '127.0.0.1');
  assert.equal(writes, 1); assert.equal(f.held(), null); assert.equal(f.storedPassword(p.enrolled.deviceId), shared);
});

test('a definitely rejected rotation PATCH can retry while local failure keeps its durable pending target', async () => {
  const f = fixture(); const p = await legacyReinstall(f);
  await f.enroll.stageGenericPassword!(p.reconfigure, '127.0.0.1');
  const original = f.repo.write; let failed = false;
  f.repo.write = async (kind, id, row, old) => {
    if (kind === 'device_credentials' && !failed) { failed = true; throw new RejectedEnrollmentWrite(); }
    return original(kind, id, row, old);
  };
  await assert.rejects(f.enroll.confirmGenericPassword!(p.reconfigure, '127.0.0.1')); assert.ok(f.held());
  await f.createEnroll().confirmGenericPassword!(p.reconfigure, '127.0.0.1'); assert.equal(f.held(), null);
  const receipt = f.rows.get(`enrollment_receipts/${enrollmentId('receipt', p.prepared.enrollmentId, p.reconfigure.deviceUuid)}`)!;
  assert.equal(receipt.password_rotation_completed, true);
});

test('late rotation initialization cannot change guard ownership or regress completion after a restart', async () => {
  const f = fixture(); const p = await legacyReinstall(f); const original = f.repo.write;
  let late: { id: string; started: string; target: string } | undefined;
  f.repo.write = async (kind, id, row, old) => {
    if (kind === 'enrollment_receipts' && row.password_rotation_started_at && !old?.password_rotation_started_at && !late) {
      late = { id, started: row.password_rotation_started_at as string, target: row.password_rotation_target_hash as string };
      throw new IndeterminateEnrollmentWrite();
    }
    return original(kind, id, row, old);
  };
  await assert.rejects(f.enroll.stageGenericPassword!(p.reconfigure, '127.0.0.1'));
  const originalGuard = structuredClone(f.held()); assert.ok(originalGuard?.operationId);
  f.advance(1);
  const stage = await f.createEnroll().stageGenericPassword!(p.reconfigure, '127.0.0.1');
  assert.equal(stage.rustdeskPassword, shared); assert.deepEqual(f.held(), originalGuard);
  const applyLate = () => Object.assign(f.rows.get(`enrollment_receipts/${late!.id}`)!, {
    password_rotation_started_at: late!.started, password_rotation_target_hash: late!.target,
  });
  applyLate();
  await f.createEnroll().confirmGenericPassword!(p.reconfigure, '127.0.0.1'); assert.equal(f.held(), null);
  applyLate();
  assert.equal(f.rows.get(`enrollment_receipts/${late!.id}`)!.password_rotation_completed, true);
  await f.createEnroll().confirmGenericPassword!(p.reconfigure, '127.0.0.1'); assert.equal(f.held(), null);
});

test('a crash after credential write intent but before submission remains guarded for explicit reconciliation', async () => {
  const f = fixture(); const p = await legacyReinstall(f); const original = f.repo.write;
  await f.enroll.stageGenericPassword!(p.reconfigure, '127.0.0.1');
  let credentialWrites = 0;
  f.repo.write = async (kind, id, row, old) => {
    if (kind === 'device_credentials') credentialWrites++;
    await original(kind, id, row, old);
    if (kind === 'enrollment_receipts' && row.password_rotation_write_started === true && old?.password_rotation_write_started !== true) {
      throw new Error('synthetic process interruption');
    }
  };
  await assert.rejects(f.enroll.confirmGenericPassword!(p.reconfigure, '127.0.0.1'));
  await assert.rejects(f.createEnroll().confirmGenericPassword!(p.reconfigure, '127.0.0.1'), { code: 'GENERIC_PASSWORD_UNAVAILABLE' });
  assert.equal(credentialWrites, 0); assert.ok(f.held());
});

test('late capability revocation observed during reconfigure prevents a successful acknowledgement', async () => {
  const f = fixture(); f.organizations.set('organization', { id: 'organization', name: 'Customer', slug: 'customer', active: true });
  const initial = await provision(f); const request = agentRequest(initial.prepared.enrollmentToken);
  const device = await f.enroll(request, '127.0.0.1');
  const next = await f.generic.prepare(initial.created.package.installerToken, { ...input(), installerId: initial.created.installer.id }, '127.0.0.1');
  const original = f.repo.write;
  f.repo.write = async (kind, id, row, old) => {
    await original(kind, id, row, old);
    if (kind === 'enrollment_receipts' && row.status === 'committed') {
      Object.assign(f.profiles.get(initial.created.installer.id)!, { active: false, revokedAt: time.toISOString() });
    }
  };
  await assert.rejects(f.enroll.reconfigure!({ ...request, enrollmentToken: next.enrollmentToken,
    currentDeviceToken: device.deviceToken }, '127.0.0.1'));
});
