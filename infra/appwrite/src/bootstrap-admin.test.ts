import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_EMAIL, bootstrapAdministrator } from './bootstrap-admin.ts';
import { FakeGateway } from './testing/fake-gateway.ts';

const artifact = '.local/remote-platform/test.dpapi';

test('new administrator gets a random strong password protected before account creation', async () => {
  const passwords = new Set<string>();
  for (let i = 0; i < 16; i++) {
    const gateway = new FakeGateway();
    let protectedValue = '';
    const report = await bootstrapAdministrator(gateway, async (value: string) => {
      assert.equal(gateway.user, null);
      protectedValue = value;
      return artifact;
    });
    const password = gateway.receivedPassword;
    passwords.add(password);
    assert.equal(password.length, 32);
    for (const pattern of [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/]) assert.match(password, pattern);
    assert.equal(protectedValue, password);
    assert.equal(gateway.user?.email, 'remote.admin@xpointsolucoes.com.br');
    assert.equal(gateway.profile?.global_role, 'super_admin');
    assert.equal(gateway.profile?.active, true);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(report, { identity: 'created', userId: 'remote-bootstrap-admin', profile: 'created',
      profileId: 'remote-bootstrap-admin', role: 'super_admin', encryptedArtifactPath: artifact });
  }
  assert.equal(passwords.size, 16);
});

test('existing identity is reused and inactive profile repaired without password reset', async () => {
  const gateway = new FakeGateway();
  gateway.user = { id: 'existing-admin', email: ADMIN_EMAIL };
  gateway.profile = { id: 'existing-profile', user_id: 'existing-admin', display_name: 'Existing', global_role: 'legacy', active: false };
  const protect = async () => { throw new Error('must not generate or protect a password'); };
  await bootstrapAdministrator(gateway, protect);
  assert.equal(gateway.profile.global_role, 'super_admin');
  assert.equal(gateway.profile.active, true);
  assert.equal(gateway.profile.display_name, 'Existing');
  assert.equal(gateway.receivedPassword, '');
  assert.deepEqual(gateway.events, ['profile-update']);
  await bootstrapAdministrator(gateway, protect);
  assert.equal(gateway.writes, 1);
});

test('interruption after user creation reuses identity and creates just the missing profile', async () => {
  const gateway = new FakeGateway();
  gateway.interruptAt = 1;
  await assert.rejects(bootstrapAdministrator(gateway, async () => artifact));
  gateway.interruptAt = Infinity;
  await bootstrapAdministrator(gateway, async () => { throw new Error('no second password'); });
  assert.deepEqual(gateway.events, ['user', 'profile']);
});

test('DPAPI failure prevents creation and neither exception nor report contains plaintext', async () => {
  const gateway = new FakeGateway();
  let secret = '';
  await assert.rejects(bootstrapAdministrator(gateway, async (password: string) => {
    secret = password;
    throw Object.assign(new Error(password), { response: { password } });
  }), (error: Error) => {
    assert.equal((String(error) + JSON.stringify(error)).includes(secret), false);
    return true;
  });
  assert.equal(gateway.writes, 0);
});

test('wrong project blocks bootstrap before any writes or secret protection', async () => {
  const gateway = new FakeGateway();
  Object.defineProperty(gateway, 'projectId', { value: 'wrong' });
  await assert.rejects(bootstrapAdministrator(gateway, async () => { assert.fail('protected'); }), /project/i);
  assert.equal(gateway.writes, 0);
});
