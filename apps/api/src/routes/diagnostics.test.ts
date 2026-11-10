import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../app.ts';
import { createSystemDiagnosticsService } from '../services/system-diagnostics.ts';

function buildDiagnosticsTestApp() {
  const systemDiagnostics = createSystemDiagnosticsService({
    hbbsHost: '127.0.0.1',
    hbbsOnlinePort: 21115,
    probeAppwriteLatency: async () => ({ ok: true, latencyMs: 14 }),
    getCacheSnapshot: () => ({
      deviceSnapshots: 12,
      tokenSnapshots: 12,
      jwtEntries: 3,
      hbbsPeers: 12,
      activeGuards: 0,
      totalDevicesCount: 12,
      onlineDevicesCount: 9,
    }),
    executeInternalSelfHeal: async () => ({
      orphanGuardsPurged: 2,
      cachesEvicted: 5,
      devicesReconciled: 1,
      hbbsOnlineSynced: 9,
    }),
  });

  const app = buildApp(
    { logger: false },
    {
      projectId: 'proj-1',
      jwtVerifier: {
        verify: async (jwt) => (jwt === 'valid.jwt.token' ? { userId: 'tech-1' } : null),
      },
      technicians: {
        findByUserId: async () => ({
          userId: 'tech-1',
          displayName: 'Ronaldo',
          globalRole: 'super_admin',
          active: true,
        }),
        listMemberships: async () => [],
      },
      organizations: {
        listActive: async () => [{ id: 'org-1', name: 'X-Point', slug: 'x-point', active: true }],
      },
      systemDiagnostics,
    },
  );

  return { app, systemDiagnostics };
}

test('GET /v1/diagnostics/telemetry rejects unauthenticated calls and returns structured telemetry for technicians', async () => {
  const { app, systemDiagnostics } = buildDiagnosticsTestApp();

  const unauthRes = await app.inject({
    method: 'GET',
    url: '/v1/diagnostics/telemetry',
  });
  assert.equal(unauthRes.statusCode, 401);

  systemDiagnostics.recordHeartbeatMetric('success', 18);
  systemDiagnostics.recordAutoHealCounter('dbFallback', 1);

  const authRes = await app.inject({
    method: 'GET',
    url: '/v1/diagnostics/telemetry',
    headers: { authorization: 'Bearer valid.jwt.token' },
  });
  assert.equal(authRes.statusCode, 200);
  const body = authRes.json();
  assert.equal(body.version, 'v1.8.7');
  assert.equal(body.appwrite.status, 'online');
  assert.equal(body.appwrite.latencyMs, 14);
  assert.equal(body.appwrite.totalDevicesCount, 12);
  assert.equal(body.appwrite.onlineDevicesCount, 9);
  assert.equal(body.api.recentHeartbeatsSuccess, 1);
  assert.equal(body.selfHealing.dbFallbackActivations, 1);
  assert.ok(Array.isArray(body.events));
  assert.ok(body.events.length >= 1);

  await app.close();
});

test('POST /v1/diagnostics/self-heal executes reconciliation actions and records self-healing telemetry', async () => {
  const { app } = buildDiagnosticsTestApp();

  const res = await app.inject({
    method: 'POST',
    url: '/v1/diagnostics/self-heal',
    headers: { authorization: 'Bearer valid.jwt.token' },
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.overallStatus, 'remediated');
  assert.equal(body.actions.length, 4);
  assert.equal(body.actions[0].action, 'ORPHAN_GUARD_RECONCILIATION');
  assert.equal(body.actions[0].status, 'healed');
  assert.equal(body.actions[1].action, 'MEMORY_CACHE_SANITATION');
  assert.equal(body.actions[1].status, 'healed');
  assert.ok(body.telemetry.events.some((e: { operation: string }) => e.operation === 'SELF_HEAL_CYCLE_COMPLETED'));

  await app.close();
});
