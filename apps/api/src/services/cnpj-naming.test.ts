import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { mergeDataDivasIntoNotes, type NamingHistoryEvent, type NamingReservationRecord } from '@appremoto/contracts';
import type { CnpjNamingRepository, RawDeviceDocument } from '../repositories/cnpj-naming.ts';
import type { GenericInstallerRecord, GenericInstallerRepository } from '../repositories/generic-installers.ts';
import type { Organization } from '../repositories/organizations.ts';
import { hashToken } from '../security/tokens.ts';
import { CnpjNamingError, createCnpjNamingService } from './cnpj-naming.ts';

const encryptionKey = Buffer.alloc(32, 7);
const installerId = 'installer-1';
const capability = createHmac('sha256', encryptionKey)
  .update('appremoto:generic-installer-capability:v1\0')
  .update(JSON.stringify([installerId]))
  .digest('base64url');

function createInMemoryHarness() {
  const organizations = new Map<string, Organization>();
  const devices = new Map<string, RawDeviceDocument>();
  const reservations = new Map<string, NamingReservationRecord>();
  const history: NamingHistoryEvent[] = [];

  const repository: CnpjNamingRepository = {
    async listOrganizations() {
      return Array.from(organizations.values());
    },
    async getOrganization(id) {
      return organizations.get(id) ?? null;
    },
    async createOrganization(org) {
      organizations.set(org.id, { ...org });
    },
    async updateOrganization(id, patch) {
      const current = organizations.get(id);
      if (current) {
        organizations.set(id, { ...current, ...patch });
      }
    },
    async listAllDevices() {
      return Array.from(devices.values()).map((d) => ({ ...d }));
    },
    async getDevice(id) {
      const d = devices.get(id);
      return d ? { ...d } : null;
    },
    async updateDevice(id, patch) {
      const current = devices.get(id);
      if (current) {
        devices.set(id, { ...current, ...patch });
      }
    },
    async getReservation(id) {
      return reservations.get(id) ?? null;
    },
    async listReservations(groupId) {
      return Array.from(reservations.values()).filter((r) => r.groupId === groupId);
    },
    async upsertReservation(record) {
      reservations.set(record.id, { ...record });
    },
    async appendHistory(event) {
      history.unshift(event);
    },
    async listHistory(groupId) {
      return history.filter((h) => h.groupId === groupId);
    },
  };

  const installers: GenericInstallerRepository = {
    async list() {
      return [];
    },
    async get(id): Promise<GenericInstallerRecord | null> {
      if (id !== installerId) return null;
      return {
        id: installerId,
        name: 'Instalador XPoint',
        tokenHash: hashToken(capability),
        active: true,
        createdByUserId: 'admin-1',
        createdAt: '2026-10-18T10:00:00.000Z',
        revokedAt: null,
      };
    },
    async create() {
      throw new Error('not used');
    },
    async revoke() {},
    async issuerIsSuperAdmin(userId) {
      return userId === 'admin-1';
    },
    async organizations() {
      return Array.from(organizations.values());
    },
    async organization(id) {
      return organizations.get(id) ?? null;
    },
    async createOrganization(org) {
      organizations.set(org.id, { ...org });
    },
  };

  const service = createCnpjNamingService({
    repository,
    installers,
    encryptionKey,
    now: () => new Date('2026-10-18T12:00:00.000Z'),
  });

  return { organizations, devices, reservations, history, service };
}

describe('Intelligent CNPJ computer naming service', () => {
  it('creates CNPJ group on first computer and recommends exclusive SERVIDOR', async () => {
    const { service } = createInMemoryHarness();
    const ctx = await service.getInstallationContext(
      capability,
      {
        installerId,
        cnpj: '12.345.678/0001-90',
        razaoSocial: 'SUPERMERCADO XPOINT LTDA',
        nomeFantasia: 'MERCADO XPOINT',
        deviceUuid: '11111111-1111-4111-8111-111111111111',
        currentWindowsHostname: 'DESKTOP-ABC123',
      },
      '127.0.0.1',
    );

    assert.equal(ctx.cnpj, '12345678000190');
    assert.equal(ctx.totalComputers, 0);
    assert.equal(ctx.hasServer, false);
    assert.equal(ctx.recommendedRole, 'SERVIDOR');
    assert.equal(ctx.recommendedName, 'SERVIDOR');
    const srvOption = ctx.catalog.find((c) => c.code === 'SERVIDOR');
    assert.equal(srvOption?.available, true);
  });

  it('prevents a second ordinary SERVIDOR in the same CNPJ, fills sequence gaps (CAIXA-03), and keeps offline computers occupied', async () => {
    const { devices, organizations, service } = createInMemoryHarness();
    organizations.set('org-1', {
      id: 'org-1',
      name: 'MERCADO XPOINT',
      slug: 'cnpj-12345678000190',
      active: true,
    });
    // Registered SERVIDOR (online), CAIXA-01 (online), CAIXA-02 (offline), CAIXA-04 (online)
    devices.set('dev-srv', {
      id: 'dev-srv',
      createdAt: '2026-10-18T10:00:00.000Z',
      organizationId: 'org-1',
      deviceUuid: 'aaaa1111-1111-4111-8111-111111111111',
      displayName: 'SERVIDOR',
      hostname: 'SERVIDOR',
      rustdeskId: '100001',
      operatingSystem: 'Windows 11',
      osVersion: '10.0.22631',
      agentVersion: '1.2.9',
      rustdeskVersion: '1.4.9',
      lastSeenAt: '2026-10-18T11:59:50.000Z',
      enabled: true,
      notes: mergeDataDivasIntoNotes(null, {
        cnpj: '12345678000190',
        funcao: 'SERVIDOR',
        windowsHostnameDesejado: 'SERVIDOR',
        statusRenomeacao: 'CONFIRMADO',
      }),
    });
    devices.set('dev-cx1', {
      id: 'dev-cx1',
      createdAt: '2026-10-18T10:00:00.000Z',
      organizationId: 'org-1',
      deviceUuid: 'aaaa2222-1111-4111-8111-111111111111',
      displayName: 'CAIXA-01',
      hostname: 'CAIXA-01',
      rustdeskId: '100002',
      operatingSystem: 'Windows 10',
      osVersion: '10.0.19045',
      agentVersion: '1.2.9',
      rustdeskVersion: '1.4.9',
      lastSeenAt: '2026-10-18T11:59:50.000Z',
      enabled: true,
      notes: mergeDataDivasIntoNotes(null, {
        cnpj: '12345678000190',
        funcao: 'CAIXA',
        windowsHostnameDesejado: 'CAIXA-01',
      }),
    });
    devices.set('dev-cx2', {
      id: 'dev-cx2',
      createdAt: '2026-10-18T10:00:00.000Z',
      organizationId: 'org-1',
      deviceUuid: 'aaaa3333-1111-4111-8111-111111111111',
      displayName: 'CAIXA-02',
      hostname: 'CAIXA-02',
      rustdeskId: '100003',
      operatingSystem: 'Windows 10',
      osVersion: '10.0.19045',
      agentVersion: '1.2.9',
      rustdeskVersion: '1.4.9',
      lastSeenAt: '2026-10-10T10:00:00.000Z', // OFFLINE
      enabled: true,
      notes: mergeDataDivasIntoNotes(null, {
        cnpj: '12345678000190',
        funcao: 'CAIXA',
        windowsHostnameDesejado: 'CAIXA-02',
      }),
    });
    devices.set('dev-cx4', {
      id: 'dev-cx4',
      createdAt: '2026-10-18T10:00:00.000Z',
      organizationId: 'org-1',
      deviceUuid: 'aaaa4444-1111-4111-8111-111111111111',
      displayName: 'CAIXA-04',
      hostname: 'CAIXA-04',
      rustdeskId: '100004',
      operatingSystem: 'Windows 10',
      osVersion: '10.0.19045',
      agentVersion: '1.2.9',
      rustdeskVersion: '1.4.9',
      lastSeenAt: '2026-10-18T11:59:50.000Z',
      enabled: true,
      notes: mergeDataDivasIntoNotes(null, {
        cnpj: '12345678000190',
        funcao: 'CAIXA',
        windowsHostnameDesejado: 'CAIXA-04',
      }),
    });

    const ctx = await service.getInstallationContext(
      capability,
      {
        installerId,
        cnpj: '12345678000190',
        deviceUuid: 'bbbb5555-1111-4111-8111-111111111111',
      },
      '127.0.0.1',
    );

    assert.equal(ctx.hasServer, true);
    assert.equal(ctx.catalog.find((c) => c.code === 'SERVIDOR')?.available, false);
    assert.equal(ctx.recommendedRole, 'CAIXA');
    assert.equal(ctx.recommendedName, 'CAIXA-03'); // Fills gap 03 while 02 (offline) stays occupied!

    // Attempting to reserve another SERVIDOR fails with conflict
    const srvAttempt = await service.reserveName(
      capability,
      {
        installerId,
        cnpj: '12345678000190',
        role: 'SERVIDOR',
        desiredName: 'SERVIDOR',
        deviceUuid: 'bbbb5555-1111-4111-8111-111111111111',
      },
      '127.0.0.1',
    );
    assert.equal(srvAttempt.reserved, false);
    assert.equal(srvAttempt.conflictName, 'SERVIDOR');

    // Attempting to reserve offline CAIXA-02 fails and suggests CAIXA-03
    const offlineAttempt = await service.reserveName(
      capability,
      {
        installerId,
        cnpj: '12345678000190',
        role: 'CAIXA',
        desiredName: 'CAIXA-02',
        deviceUuid: 'bbbb5555-1111-4111-8111-111111111111',
      },
      '127.0.0.1',
    );
    assert.equal(offlineAttempt.reserved, false);
    assert.equal(offlineAttempt.suggestedAlternative, 'CAIXA-03');
  });

  it('prevents simultaneous installations from reserving the same name and gives the second caller the next available name', async () => {
    const { service } = createInMemoryHarness();
    const [resA, resB] = await Promise.all([
      service.reserveName(
        capability,
        {
          installerId,
          cnpj: '12345678000190',
          role: 'CAIXA',
          desiredName: 'CAIXA-01',
          deviceUuid: '11111111-1111-4111-8111-aaaaaaaaaaaa',
        },
        '127.0.0.1',
      ),
      service.reserveName(
        capability,
        {
          installerId,
          cnpj: '12345678000190',
          role: 'CAIXA',
          desiredName: 'CAIXA-01',
          deviceUuid: '22222222-2222-4222-8222-bbbbbbbbbbbb',
        },
        '127.0.0.1',
      ),
    ]);

    assert.equal(resA.reserved, true);
    assert.equal(resA.normalizedName, 'CAIXA-01');
    assert.equal(resB.reserved, false);
    assert.equal(resB.conflictName, 'CAIXA-01');
    assert.equal(resB.suggestedAlternative, 'CAIXA-02');
  });

  it('recognizes reinstallation on the same deviceUuid, preserves its name, and handles pending reboot + post-reboot sync confirmation', async () => {
    const { devices, organizations, service } = createInMemoryHarness();
    organizations.set('org-1', {
      id: 'org-1',
      name: 'MERCADO XPOINT',
      slug: 'cnpj-12345678000190',
      active: true,
    });
    const sameUuid = 'cccc3333-1111-4111-8111-111111111111';
    devices.set('dev-cx1', {
      id: 'dev-cx1',
      createdAt: '2026-10-18T10:00:00.000Z',
      organizationId: 'org-1',
      deviceUuid: sameUuid,
      displayName: 'CAIXA-01',
      hostname: 'DESKTOP-OLD',
      rustdeskId: '100009',
      operatingSystem: 'Windows 10',
      osVersion: '10.0.19045',
      agentVersion: '1.2.9',
      rustdeskVersion: '1.4.9',
      lastSeenAt: '2026-10-18T11:59:50.000Z',
      enabled: true,
      notes: mergeDataDivasIntoNotes(null, {
        cnpj: '12345678000190',
        funcao: 'CAIXA',
        windowsHostnameDesejado: 'CAIXA-01',
      }),
    });

    const ctx = await service.getInstallationContext(
      capability,
      {
        installerId,
        cnpj: '12345678000190',
        deviceUuid: sameUuid,
        currentWindowsHostname: 'DESKTOP-OLD',
      },
      '127.0.0.1',
    );
    assert.equal(ctx.operationMode, 'REINSTALL_SAME_DEVICE');
    assert.equal(ctx.recommendedName, 'CAIXA-01');

    // Reserve its own name during reinstall succeeds
    const reserved = await service.reserveName(
      capability,
      {
        installerId,
        cnpj: '12345678000190',
        role: 'CAIXA',
        desiredName: 'CAIXA-01',
        deviceUuid: sameUuid,
      },
      '127.0.0.1',
    );
    assert.equal(reserved.reserved, true);

    // Confirm rename applied with pending reboot
    const confirmed = await service.confirmName(
      capability,
      {
        installerId,
        cnpj: '12345678000190',
        deviceUuid: sameUuid,
        desiredName: 'CAIXA-01',
        actualWindowsHostname: 'DESKTOP-OLD',
        role: 'CAIXA',
        renameApplied: true,
        rebootRequired: true,
      },
      '127.0.0.1',
    );
    assert.equal(confirmed.statusRenomeacao, 'APLICADO_AGUARDANDO_REBOOT');

    // After reboot, device syncs with new Windows hostname CAIXA-01 -> promotes to CONFIRMADO
    const synced = await service.syncDevice(
      {
        deviceUuid: sameUuid,
        windowsHostnameAtual: 'CAIXA-01',
        rustdeskId: '100009',
        cnpj: '12345678000190',
      },
      '127.0.0.1',
    );
    assert.equal(synced.statusRenomeacao, 'CONFIRMADO');
  });

  it('rejects unauthorized CNPJ access when capability is invalid', async () => {
    const { service } = createInMemoryHarness();
    await assert.rejects(
      () =>
        service.getInstallationContext(
          'bad-token',
          { installerId, cnpj: '12345678000190' },
          '127.0.0.1',
        ),
      (err: unknown) => err instanceof CnpjNamingError && err.code === 'NAMING_ACCESS_DENIED',
    );
  });
});
