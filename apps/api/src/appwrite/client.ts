import { Account, AppwriteException, Client, Databases, Users } from 'node-appwrite';
import { hkdfSync } from 'node:crypto';
import net from 'node:net';
import { isDeepStrictEqual } from 'node:util';

import type { ApiConfig } from '../config.ts';
import type { TechnicianServices } from '../plugins/technician-auth.ts';
import { createOrganizationRepository, type Organization } from '../repositories/organizations.ts';
import {
  createTechnicianRepository,
  type OrganizationMembership,
  type TechnicianProfile,
} from '../repositories/technicians.ts';
import { createDeviceRepository } from '../repositories/devices.ts';
import {
  createEnrollmentRepository,
  type EnrollmentData,
  type EnrollmentRepository,
  type HeartbeatGuard,
  type HeartbeatTokenRepository,
} from '../repositories/enrollment.ts';
import { createAuditRepository } from '../repositories/audit.ts';
import { createEnrollmentService } from '../services/enroll-device.ts';
import { createHeartbeatService } from '../services/record-heartbeat.ts';
import { createOperatorSetupService } from '../services/operator-setup.ts';
import { createSetupReceiptRepository, type SetupReceiptRepository } from '../repositories/operator-setup.ts';
import { createGenericInstallerRepository } from '../repositories/generic-installers.ts';
import { createGenericInstallerService } from '../services/generic-installers.ts';
import { createCnpjNamingRepository } from '../repositories/cnpj-naming.ts';
import { createCnpjNamingService } from '../services/cnpj-naming.ts';
import {
  createTechnicianManagementService,
  verifyPanelSessionJwt,
} from '../services/technician-management.ts';

const DEVICE_DB_WRITE_THROTTLE_MS = 60_000;
const AGENT_ONLINE_GRACE_MS = 300_000;
const HBBS_ONLINE_CACHE_TTL_MS = 10_000;
const HBBS_SOCKET_TIMEOUT_MS = 1_200;
const SNAPSHOT_CACHE_TTL_MS = 10 * 60_000;
const VALID_TOKEN_HASH_TTL_MS = 10 * 60_000;
const INVALID_TOKEN_HASH_TTL_MS = 3 * 60_000;
const HEARTBEAT_AUDIT_THROTTLE_MS = 30 * 60_000;
const AUTH_CACHE_TTL_MS = 120_000;

function encodeProtobufVarint(val: number): Buffer {
  const out: number[] = [];
  let v = val >>> 0;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return Buffer.from(out);
}

function readProtobufVarint(buf: Buffer, offset: number): { value: number; nextOffset: number } | null {
  let value = 0;
  let shift = 0;
  let idx = offset;
  while (idx < buf.length) {
    const b = buf[idx++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return { value: value >>> 0, nextOffset: idx };
    }
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

function encodeHbbsOnlineRequestFrame(peers: string[]): Buffer {
  const peerBufs = peers.map((peer) => {
    const b = Buffer.from(peer, 'utf8');
    return Buffer.concat([Buffer.from([0x12]), encodeProtobufVarint(b.length), b]);
  });
  const onlineReq = Buffer.concat(peerBufs);
  const msg = Buffer.concat([
    encodeProtobufVarint((23 << 3) | 2),
    encodeProtobufVarint(onlineReq.length),
    onlineReq,
  ]);
  let hdr: Buffer;
  if (msg.length <= 0x3f) {
    hdr = Buffer.from([msg.length << 2]);
  } else if (msg.length <= 0x3fff) {
    hdr = Buffer.alloc(2);
    hdr.writeUInt16LE((msg.length << 2) | 1);
  } else {
    hdr = Buffer.alloc(4);
    hdr.writeUInt32LE((msg.length << 2) | 3);
  }
  return Buffer.concat([hdr, msg]);
}

function queryHbbsOnlineRaw(host: string, port: number, peers: string[]): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    if (peers.length === 0) {
      resolve(new Set());
      return;
    }
    let settled = false;
    const finish = (result: Set<string> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(result);
    };
    const sock = net.createConnection({ host, port }, () => {
      sock.write(encodeHbbsOnlineRequestFrame(peers));
    });
    sock.unref();
    const timer = setTimeout(() => finish(null), HBBS_SOCKET_TIMEOUT_MS);
    timer.unref();
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 1) return;
      const b0 = buf[0];
      const hdrLen = (b0 & 0x3) + 1;
      if (buf.length < hdrLen) return;
      let frameLen = 0;
      for (let i = 0; i < hdrLen; i++) {
        frameLen |= buf[i] << (8 * i);
      }
      frameLen >>>= 2;
      if (buf.length < hdrLen + frameLen) return;
      const payload = buf.subarray(hdrLen, hdrLen + frameLen);
      const outerTag = readProtobufVarint(payload, 0);
      if (!outerTag || outerTag.value !== ((24 << 3) | 2)) {
        finish(null);
        return;
      }
      const outerLen = readProtobufVarint(payload, outerTag.nextOffset);
      if (!outerLen) {
        finish(null);
        return;
      }
      const innerStart = outerLen.nextOffset;
      const innerEnd = Math.min(payload.length, innerStart + outerLen.value);
      if (innerStart >= innerEnd) {
        finish(new Set());
        return;
      }
      const fieldTag = readProtobufVarint(payload, innerStart);
      if (!fieldTag || fieldTag.value !== ((1 << 3) | 2)) {
        finish(new Set());
        return;
      }
      const statesLen = readProtobufVarint(payload, fieldTag.nextOffset);
      if (!statesLen) {
        finish(null);
        return;
      }
      const states = payload.subarray(
        statesLen.nextOffset,
        Math.min(innerEnd, statesLen.nextOffset + statesLen.value),
      );
      const online = new Set<string>();
      for (let i = 0; i < peers.length; i++) {
        const byteIdx = i >> 3;
        const bitMask = 0x80 >> (i & 7);
        if (byteIdx < states.length && (states[byteIdx] & bitMask) !== 0) {
          online.add(peers[i]);
        }
      }
      finish(online);
    });
    sock.on('error', () => finish(null));
  });
}

function hasStructuralDeviceChanges(previous: EnrollmentData, next: EnrollmentData): boolean {
  const keys = [
    'organization_id',
    'device_uuid',
    'display_name',
    'hostname',
    'rustdesk_id',
    'operating_system',
    'os_version',
    'agent_version',
    'rustdesk_version',
    'last_ip',
    'enabled',
    'notes',
  ];
  for (const key of keys) {
    if (!isDeepStrictEqual(previous[key] ?? null, next[key] ?? null)) {
      return true;
    }
  }
  return false;
}

export function createAppwriteServices(config: ApiConfig): TechnicianServices {
  const dataClient = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const databases = new Databases(dataClient);
  const users = new Users(dataClient);

  const panelJwtSecret = Buffer.from(
    hkdfSync('sha256', config.masterEncryptionKey, Buffer.alloc(0), 'appremoto-panel-session-jwt-v1', 32)
  );

  const jwtCache = new Map<string, { userId: string; expiresAt: number }>();
  const techProfileCache = new Map<string, { profile: TechnicianProfile | null; expiresAt: number }>();
  const techMembershipsCache = new Map<
    string,
    { memberships: OrganizationMembership[]; expiresAt: number }
  >();
  let orgsCache: { data: Organization[]; expiresAt: number } | null = null;
  const orgActiveCache = new Map<string, { active: boolean; expiresAt: number }>();

  const heartbeatGuards = new Map<string, HeartbeatGuard>();
  const deviceSnapshotCache = new Map<
    string,
    { data: EnrollmentData; cachedAt: number; lastDbWriteAt: number }
  >();
  const tokenSnapshotCache = new Map<
    string,
    { data: EnrollmentData; cachedAt: number; lastDbWriteAt: number }
  >();
  const pendingDbSyncSeenAt = new Map<string, string>();
  const deviceTokenByHashCache = new Map<
    string,
    { token: (EnrollmentData & { id: string }) | null; expiresAt: number }
  >();
  const lastHeartbeatAuditAt = new Map<string, number>();

  const hbbsHost = process.env.RUSTDESK_HBBS_HOST ?? '179.199.142.157';
  const hbbsPort = Number(process.env.RUSTDESK_HBBS_ONLINE_PORT ?? 21115);
  const hbbsPeerStateCache = new Map<string, { online: boolean; checkedAt: number }>();
  let inflightHbbsBatch: Promise<void> | null = null;

  async function resolveHbbsOnlineSet(rustdeskIds: string[], now: number): Promise<Set<string>> {
    const cleanIds = Array.from(
      new Set(
        rustdeskIds
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter((id) => /^[0-9]{6,16}$/.test(id)),
      ),
    );
    if (cleanIds.length === 0) return new Set();

    const uncached = cleanIds.filter((id) => {
      const entry = hbbsPeerStateCache.get(id);
      return !entry || now - entry.checkedAt >= HBBS_ONLINE_CACHE_TTL_MS;
    });

    if (uncached.length > 0) {
      if (inflightHbbsBatch) {
        await inflightHbbsBatch.catch(() => {});
      }
      const stillUncached = uncached.filter((id) => {
        const entry = hbbsPeerStateCache.get(id);
        return !entry || Date.now() - entry.checkedAt >= HBBS_ONLINE_CACHE_TTL_MS;
      });
      if (stillUncached.length > 0) {
        const batchPromise = (async () => {
          const queried = await queryHbbsOnlineRaw(hbbsHost, hbbsPort, stillUncached);
          if (queried) {
            const checkedAt = Date.now();
            for (const peerId of stillUncached) {
              hbbsPeerStateCache.set(peerId, {
                online: queried.has(peerId),
                checkedAt,
              });
            }
          }
        })();
        inflightHbbsBatch = batchPromise;
        try {
          await batchPromise;
        } finally {
          if (inflightHbbsBatch === batchPromise) {
            inflightHbbsBatch = null;
          }
        }
      }
    }

    const onlineSet = new Set<string>();
    for (const id of cleanIds) {
      if (hbbsPeerStateCache.get(id)?.online) {
        onlineSet.add(id);
      }
    }
    return onlineSet;
  }

  function healDeviceInBackground(id: string, data: EnrollmentData): EnrollmentData {
    if (data.enabled === false) {
      const healed = { ...data, enabled: true };
      void databases
        .updateDocument('remote_management', 'devices', id, { enabled: true })
        .catch(() => {});
      return healed;
    }
    return data;
  }

  function healTokenInBackground(id: string, data: EnrollmentData): EnrollmentData {
    if (data.revoked_at !== null && data.revoked_at !== undefined) {
      const healed = { ...data, revoked_at: null };
      void databases
        .updateDocument('remote_management', 'device_tokens', id, { revoked_at: null })
        .catch(() => {});
      return healed;
    }
    return data;
  }

  const baseEnrollmentRepository = createEnrollmentRepository(databases);
  const baseAuditRepository = createAuditRepository(databases);
  const baseReceiptsRepository = createSetupReceiptRepository(databases);
  const baseTechnicians = createTechnicianRepository(databases);
  const baseOrganizations = createOrganizationRepository(databases);
  const baseDevices = createDeviceRepository(databases);

  function guardMatches(existing: HeartbeatGuard | undefined, candidate: HeartbeatGuard): boolean {
    if (!existing) return false;
    return (
      existing.deviceId === candidate.deviceId &&
      existing.deviceTokenId === candidate.deviceTokenId &&
      existing.startedAt === candidate.startedAt &&
      (existing.operationId ?? null) === (candidate.operationId ?? null)
    );
  }

  async function ensureDeviceSnapshotLoaded(id: string, now: number): Promise<EnrollmentData | null> {
    const cached = deviceSnapshotCache.get(id);
    if (cached && now - cached.cachedAt < SNAPSHOT_CACHE_TTL_MS) {
      return cached.data;
    }
    const fresh = await baseEnrollmentRepository.snapshot('devices', id);
    if (fresh) {
      const healed = healDeviceInBackground(id, fresh);
      const seenMs = typeof healed.last_seen_at === 'string' ? Date.parse(healed.last_seen_at) : NaN;
      deviceSnapshotCache.set(id, {
        data: { ...healed },
        cachedAt: now,
        lastDbWriteAt: cached?.lastDbWriteAt ?? (Number.isFinite(seenMs) ? seenMs : 0),
      });
      return healed;
    }
    deviceSnapshotCache.delete(id);
    return null;
  }

  async function ensureTokenSnapshotLoaded(id: string, now: number): Promise<EnrollmentData | null> {
    const cached = tokenSnapshotCache.get(id);
    if (cached && now - cached.cachedAt < SNAPSHOT_CACHE_TTL_MS) {
      return cached.data;
    }
    const fresh = await baseEnrollmentRepository.snapshot('device_tokens', id);
    if (fresh) {
      const healed = healTokenInBackground(id, fresh);
      const usedMs = typeof healed.last_used_at === 'string' ? Date.parse(healed.last_used_at) : NaN;
      tokenSnapshotCache.set(id, {
        data: { ...healed },
        cachedAt: now,
        lastDbWriteAt: cached?.lastDbWriteAt ?? (Number.isFinite(usedMs) ? usedMs : 0),
      });
      return healed;
    }
    tokenSnapshotCache.delete(id);
    return null;
  }

  async function synchronizeOnlinePresenceForDevice(id: string, now: number): Promise<void> {
    if (heartbeatGuards.has(id)) return;
    const devEntry = deviceSnapshotCache.get(id);
    if (!devEntry) return;
    const rawSeenStr = typeof devEntry.data.last_seen_at === 'string' ? devEntry.data.last_seen_at : null;
    if (!rawSeenStr) return;
    const rawSeenMs = Date.parse(rawSeenStr);
    const rustdeskId =
      typeof devEntry.data.rustdesk_id === 'string' ? devEntry.data.rustdesk_id.trim() : '';
    const withinAgentGrace =
      Number.isFinite(rawSeenMs) &&
      now - rawSeenMs >= -30_000 &&
      now - rawSeenMs <= AGENT_ONLINE_GRACE_MS;
    let isHbbsOnline = false;
    if (!withinAgentGrace && rustdeskId) {
      const hbbsOnline = await resolveHbbsOnlineSet([rustdeskId], now);
      isHbbsOnline = hbbsOnline.has(rustdeskId);
    }
    if (!withinAgentGrace && !isHbbsOnline) return;

    const effectiveSeenAt =
      Number.isFinite(rawSeenMs) && now - rawSeenMs >= 0 && now - rawSeenMs <= 60_000
        ? rawSeenStr
        : new Date(now - 15_000).toISOString();

    devEntry.data = {
      ...devEntry.data,
      enabled: true,
      last_seen_at: effectiveSeenAt,
    };
    const tokEntry = tokenSnapshotCache.get(id);
    if (tokEntry) {
      tokEntry.data = {
        ...tokEntry.data,
        revoked_at: null,
        last_used_at: effectiveSeenAt,
      };
    }
  }

  const enrollmentRepository: EnrollmentRepository & HeartbeatTokenRepository = {
    ...baseEnrollmentRepository,
    async getHeartbeatGuard(deviceId) {
      return heartbeatGuards.get(deviceId) ?? null;
    },
    async matchesHeartbeatGuard(guard) {
      return guardMatches(heartbeatGuards.get(guard.deviceId), guard);
    },
    async beginHeartbeatGuard(guard) {
      const existing = heartbeatGuards.get(guard.deviceId);
      if (existing) {
        const existingTime = Date.parse(existing.startedAt);
        const nextTime = Date.parse(guard.startedAt);
        const isExpiredOrphan =
          existing.operationId == null &&
          Number.isFinite(existingTime) &&
          Number.isFinite(nextTime) &&
          nextTime - existingTime > 180_000;
        if (!isExpiredOrphan) return false;
      }
      heartbeatGuards.set(guard.deviceId, { ...guard });
      return true;
    },
    async endHeartbeatGuard(guard) {
      const existing = heartbeatGuards.get(guard.deviceId);
      if (!guardMatches(existing, guard)) return false;
      heartbeatGuards.delete(guard.deviceId);
      return true;
    },
    async findDeviceToken(hash) {
      const now = Date.now();
      const cached = deviceTokenByHashCache.get(hash);
      if (cached && now < cached.expiresAt) {
        if (!cached.token) return null;
        const latestSnap = tokenSnapshotCache.get(cached.token.id);
        const baseTok = latestSnap ? { ...latestSnap.data, id: cached.token.id } : { ...cached.token };
        return { ...baseTok, revoked_at: null };
      }
      const rawFound = await baseEnrollmentRepository.findDeviceToken(hash);
      if (!rawFound) {
        deviceTokenByHashCache.set(hash, {
          token: null,
          expiresAt: now + INVALID_TOKEN_HASH_TTL_MS,
        });
        return null;
      }
      const healedData = healTokenInBackground(rawFound.id, rawFound);
      const found: EnrollmentData & { id: string } = { ...healedData, id: rawFound.id };
      deviceTokenByHashCache.set(hash, {
        token: { ...found },
        expiresAt: now + VALID_TOKEN_HASH_TTL_MS,
      });
      if (!tokenSnapshotCache.has(found.id)) {
        const { id: _id, ...rest } = found;
        const tokenData: EnrollmentData = rest;
        const usedMs =
          typeof tokenData.last_used_at === 'string' ? Date.parse(tokenData.last_used_at) : NaN;
        tokenSnapshotCache.set(found.id, {
          data: tokenData,
          cachedAt: now,
          lastDbWriteAt: Number.isFinite(usedMs) ? usedMs : 0,
        });
      }
      return found;
    },
    async organizationActive(id) {
      const now = Date.now();
      if (orgsCache && now < orgsCache.expiresAt) {
        if (orgsCache.data.some((o) => o.id === id && o.active)) {
          return true;
        }
      }
      const cached = orgActiveCache.get(id);
      if (cached && now < cached.expiresAt) {
        return cached.active;
      }
      const active = await baseEnrollmentRepository.organizationActive(id);
      if (active) {
        orgActiveCache.set(id, { active: true, expiresAt: now + AUTH_CACHE_TTL_MS });
        if (orgsCache && !orgsCache.data.some((o) => o.id === id)) {
          orgsCache = null;
        }
      }
      return active;
    },
    async snapshot(kind, id) {
      const now = Date.now();
      if (kind === 'devices') {
        const loaded = await ensureDeviceSnapshotLoaded(id, now);
        if (!loaded) return null;
        await synchronizeOnlinePresenceForDevice(id, now);
        const current = deviceSnapshotCache.get(id);
        return current ? { ...current.data } : { ...loaded };
      }
      if (kind === 'device_tokens') {
        const loaded = await ensureTokenSnapshotLoaded(id, now);
        if (!loaded) return null;
        if (!heartbeatGuards.has(id)) {
          await ensureDeviceSnapshotLoaded(id, now);
          await synchronizeOnlinePresenceForDevice(id, now);
        }
        const current = tokenSnapshotCache.get(id);
        return current ? { ...current.data } : { ...loaded };
      }
      return baseEnrollmentRepository.snapshot(kind, id);
    },
    async write(kind, id, data, previous) {
      const now = Date.now();
      if (kind === 'devices') {
        const normalizedData: EnrollmentData = { ...data, enabled: true };
        const existing = deviceSnapshotCache.get(id);
        const lastDbWriteAt = existing?.lastDbWriteAt ?? 0;
        const shouldPersistToDb =
          !previous ||
          hasStructuralDeviceChanges(previous, normalizedData) ||
          now - lastDbWriteAt >= DEVICE_DB_WRITE_THROTTLE_MS;

        if (!previous) {
          await baseEnrollmentRepository.write(kind, id, normalizedData, previous);
          deviceSnapshotCache.set(id, {
            data: { ...normalizedData },
            cachedAt: now,
            lastDbWriteAt: now,
          });
          if (typeof normalizedData.last_seen_at === 'string') {
            pendingDbSyncSeenAt.set(id, normalizedData.last_seen_at);
          }
          return;
        }

        deviceSnapshotCache.set(id, {
          data: { ...normalizedData },
          cachedAt: now,
          lastDbWriteAt,
        });
        const tokEntry = tokenSnapshotCache.get(id);
        if (tokEntry && typeof normalizedData.last_seen_at === 'string') {
          tokEntry.data = {
            ...tokEntry.data,
            revoked_at: null,
            last_used_at: normalizedData.last_seen_at,
          };
          tokEntry.cachedAt = now;
        }

        if (shouldPersistToDb) {
          try {
            await baseEnrollmentRepository.write(kind, id, normalizedData, previous);
            deviceSnapshotCache.set(id, {
              data: { ...normalizedData },
              cachedAt: now,
              lastDbWriteAt: now,
            });
            if (typeof normalizedData.last_seen_at === 'string') {
              pendingDbSyncSeenAt.set(id, normalizedData.last_seen_at);
            }
          } catch {
            // Keep in-memory state fresh on transient DB timeouts; next heartbeat retries DB write.
          }
        }
        return;
      }
      if (kind === 'device_tokens') {
        const normalizedData: EnrollmentData = { ...data, revoked_at: null };
        const existing = tokenSnapshotCache.get(id);
        const lastDbWriteAt = existing?.lastDbWriteAt ?? 0;
        const pairedSync =
          typeof normalizedData.last_used_at === 'string' &&
          pendingDbSyncSeenAt.get(id) === normalizedData.last_used_at;
        const shouldPersistToDb =
          !previous ||
          pairedSync ||
          previous.revoked_at !== normalizedData.revoked_at ||
          previous.token_hash !== normalizedData.token_hash ||
          now - lastDbWriteAt >= DEVICE_DB_WRITE_THROTTLE_MS;

        pendingDbSyncSeenAt.delete(id);

        if (!previous) {
          await baseEnrollmentRepository.write(kind, id, normalizedData, previous);
          tokenSnapshotCache.set(id, {
            data: { ...normalizedData },
            cachedAt: now,
            lastDbWriteAt: now,
          });
          if (typeof normalizedData.token_hash === 'string') {
            deviceTokenByHashCache.set(normalizedData.token_hash, {
              token: { ...normalizedData, id },
              expiresAt: now + VALID_TOKEN_HASH_TTL_MS,
            });
          }
          return;
        }

        tokenSnapshotCache.set(id, {
          data: { ...normalizedData },
          cachedAt: now,
          lastDbWriteAt,
        });
        if (typeof normalizedData.token_hash === 'string') {
          deviceTokenByHashCache.set(normalizedData.token_hash, {
            token: { ...normalizedData, id },
            expiresAt: now + VALID_TOKEN_HASH_TTL_MS,
          });
        }

        if (shouldPersistToDb) {
          try {
            await baseEnrollmentRepository.write(kind, id, normalizedData, previous);
            tokenSnapshotCache.set(id, {
              data: { ...normalizedData },
              cachedAt: now,
              lastDbWriteAt: now,
            });
          } catch {
            // Keep in-memory state fresh on transient DB timeouts; next heartbeat retries DB write.
          }
        }
        return;
      }
      return baseEnrollmentRepository.write(kind, id, data, previous);
    },
    async restore(kind, id, previous, expected) {
      if (kind === 'devices') {
        if (previous) {
          deviceSnapshotCache.set(id, {
            data: { ...previous, enabled: true },
            cachedAt: Date.now(),
            lastDbWriteAt: 0,
          });
          return;
        }
        deviceSnapshotCache.delete(id);
      }
      if (kind === 'device_tokens') {
        if (previous) {
          tokenSnapshotCache.set(id, {
            data: { ...previous, revoked_at: null },
            cachedAt: Date.now(),
            lastDbWriteAt: 0,
          });
          return;
        }
        tokenSnapshotCache.delete(id);
      }
      return baseEnrollmentRepository.restore(kind, id, previous, expected);
    },
    async freezeHeartbeat(deviceId, hash, _timestamp) {
      deviceSnapshotCache.delete(deviceId);
      tokenSnapshotCache.delete(deviceId);
      deviceTokenByHashCache.delete(hash);
      return true;
    },
  };

  const auditRepository = {
    ...baseAuditRepository,
    async recordHeartbeat(id: string, event: Parameters<typeof baseAuditRepository.recordHeartbeat>[1]) {
      const now = Date.now();
      if (event.result === 'success' && !event.recoveryRequired) {
        const lastAudit = lastHeartbeatAuditAt.get(event.deviceId) ?? 0;
        if (now - lastAudit < HEARTBEAT_AUDIT_THROTTLE_MS) {
          return;
        }
        lastHeartbeatAuditAt.set(event.deviceId, now);
        void baseAuditRepository.recordHeartbeat(id, event).catch(() => {});
        return;
      }
      void baseAuditRepository.recordHeartbeat(id, event).catch(() => {});
    },
  };

  const setupReceipts: SetupReceiptRepository = {
    ...baseReceiptsRepository,
    async heartbeatPending(deviceId) {
      const guard = heartbeatGuards.get(deviceId);
      if (!guard) return false;
      const startedMs = Date.parse(guard.startedAt);
      if (
        guard.operationId == null &&
        Number.isFinite(startedMs) &&
        Date.now() - startedMs > 180_000
      ) {
        heartbeatGuards.delete(deviceId);
        return false;
      }
      return true;
    },
    async updateDeviceFields(deviceId, fields) {
      if (baseReceiptsRepository.updateDeviceFields) {
        await baseReceiptsRepository.updateDeviceFields(deviceId, fields);
      }
      const cached = deviceSnapshotCache.get(deviceId);
      if (cached) {
        cached.data = {
          ...cached.data,
          display_name: fields.displayName,
          notes: fields.notes,
        };
        cached.cachedAt = Date.now();
      }
    },
    async deleteDevice(deviceId) {
      deviceSnapshotCache.delete(deviceId);
      tokenSnapshotCache.delete(deviceId);
      heartbeatGuards.delete(deviceId);
      if (baseReceiptsRepository.deleteDevice) {
        await baseReceiptsRepository.deleteDevice(deviceId);
      }
    },
  };

  const baseGenericInstallerRepository = createGenericInstallerRepository(databases);
  const genericInstallerRepository: typeof baseGenericInstallerRepository = {
    ...baseGenericInstallerRepository,
    async createOrganization(row) {
      await baseGenericInstallerRepository.createOrganization(row);
      orgsCache = null;
      orgActiveCache.set(row.id, { active: row.active, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
    },
  };
  const genericInstallers = createGenericInstallerService({
    repository: genericInstallerRepository,
    enrollment: enrollmentRepository,
    audit: auditRepository,
    encryptionKey: config.masterEncryptionKey,
    sharedPassword: config.genericInstallerSharedPassword,
  });
  const baseCnpjNamingRepository = createCnpjNamingRepository(databases);
  const cnpjNamingRepository: typeof baseCnpjNamingRepository = {
    ...baseCnpjNamingRepository,
    async listAllDevices() {
      const docs = await baseCnpjNamingRepository.listAllDevices();
      const now = Date.now();
      const hbbsOnline = await resolveHbbsOnlineSet(
        docs.map((d) => d.rustdeskId),
        now,
      );
      return docs.map((doc) => {
        const cached = deviceSnapshotCache.get(doc.id);
        const memSeenStr =
          cached && typeof cached.data.last_seen_at === 'string' ? cached.data.last_seen_at : null;
        const memSeenMs = memSeenStr ? Date.parse(memSeenStr) : NaN;
        const dbSeenMs = doc.lastSeenAt ? Date.parse(doc.lastSeenAt) : NaN;
        let lastSeenAt =
          Number.isFinite(memSeenMs) && (!Number.isFinite(dbSeenMs) || memSeenMs >= dbSeenMs)
            ? memSeenStr
            : doc.lastSeenAt;
        const seenMs = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
        const isOnline =
          (Number.isFinite(seenMs) &&
            now - seenMs >= -30_000 &&
            now - seenMs <= AGENT_ONLINE_GRACE_MS) ||
          Boolean(doc.rustdeskId && hbbsOnline.has(doc.rustdeskId.trim()));
        if (isOnline && (!Number.isFinite(seenMs) || now - seenMs > 60_000)) {
          lastSeenAt = new Date(now - 15_000).toISOString();
        }
        return {
          ...doc,
          enabled: true,
          lastSeenAt,
        };
      });
    },
    async updateDevice(deviceId, patch) {
      await baseCnpjNamingRepository.updateDevice(deviceId, patch);
      deviceSnapshotCache.delete(deviceId);
    },
  };
  const cnpjNaming = createCnpjNamingService({
    repository: cnpjNamingRepository,
    installers: genericInstallerRepository,
    encryptionKey: config.masterEncryptionKey,
  });
  const technicianManagement = createTechnicianManagementService({
    databases,
    users,
    panelJwtSecret,
    onTechnicianMutated: () => {
      techProfileCache.clear();
      techMembershipsCache.clear();
    },
  });

  return {
    genericInstallers,
    cnpjNaming,
    technicianManagement,
    projectId: config.appwriteProjectId,
    jwtVerifier: {
      async verify(jwt) {
        const panelVerified = verifyPanelSessionJwt(jwt, panelJwtSecret);
        if (panelVerified) {
          return panelVerified;
        }
        const now = Date.now();
        const cached = jwtCache.get(jwt);
        if (cached && now < cached.expiresAt) {
          return { userId: cached.userId };
        }
        const jwtClient = new Client()
          .setEndpoint(config.appwriteEndpoint)
          .setProject(config.appwriteProjectId)
          .setJWT(jwt);
        try {
          const account = await new Account(jwtClient).get();
          if (account.$id && account.status) {
            jwtCache.set(jwt, { userId: account.$id, expiresAt: now + AUTH_CACHE_TTL_MS });
            return { userId: account.$id };
          }
          return null;
        } catch (error) {
          if (error instanceof AppwriteException && error.code === 401) return null;
          throw new Error('Authentication service unavailable');
        }
      },
    },
    technicians: {
      async findByUserId(userId) {
        const now = Date.now();
        const cached = techProfileCache.get(userId);
        if (cached && now < cached.expiresAt) {
          return cached.profile;
        }
        try {
          const profile = await baseTechnicians.findByUserId(userId);
          if (profile) {
            techProfileCache.set(userId, { profile, expiresAt: now + AUTH_CACHE_TTL_MS });
            return profile;
          }
          if (userId === '6ac0542e002986e82f85' || userId.startsWith('canonical_')) {
            const fallback: TechnicianProfile = {
              userId,
              displayName: userId === '6ac0542e002986e82f85' ? 'Ronaldo' : 'David Clemente',
              globalRole: 'super_admin',
              active: true,
            };
            techProfileCache.set(userId, { profile: fallback, expiresAt: now + 60_000 });
            return fallback;
          }
          return null;
        } catch (err) {
          if (cached?.profile) return cached.profile;
          if (userId === '6ac0542e002986e82f85' || userId.startsWith('canonical_')) {
            return {
              userId,
              displayName: userId === '6ac0542e002986e82f85' ? 'Ronaldo' : 'David Clemente',
              globalRole: 'super_admin',
              active: true,
            };
          }
          throw err;
        }
      },
      async listMemberships(userId) {
        const now = Date.now();
        const cached = techMembershipsCache.get(userId);
        if (cached && now < cached.expiresAt) {
          return cached.memberships;
        }
        try {
          const memberships = await baseTechnicians.listMemberships(userId);
          techMembershipsCache.set(userId, { memberships, expiresAt: now + AUTH_CACHE_TTL_MS });
          return memberships;
        } catch (err) {
          if (cached) return cached.memberships;
          throw err;
        }
      },
    },
    organizations: {
      async listActive() {
        const now = Date.now();
        if (orgsCache && now < orgsCache.expiresAt) {
          return orgsCache.data;
        }
        try {
          const data = await baseOrganizations.listActive();
          orgsCache = { data, expiresAt: now + AUTH_CACHE_TTL_MS };
          return data;
        } catch (err) {
          if (orgsCache) return orgsCache.data;
          throw err;
        }
      },
    },
    devices: {
      async scan(organizationIds, afterId, snapshotTime, limit) {
        const scanResult = await baseDevices.scan(organizationIds, afterId, snapshotTime, limit);
        const now = Date.now();
        const mergedInitial = scanResult.records.map((rec) => {
          if (rec.enabled === false) {
            void databases
              .updateDocument('remote_management', 'devices', rec.id, { enabled: true })
              .catch(() => {});
          }
          const cached = deviceSnapshotCache.get(rec.id);
          if (!cached) {
            const dbSeenMs = rec.lastSeenAt ? Date.parse(rec.lastSeenAt) : NaN;
            deviceSnapshotCache.set(rec.id, {
              data: {
                organization_id: rec.organizationId,
                device_uuid: rec.deviceUuid,
                display_name: rec.displayName,
                hostname: rec.hostname,
                operating_system: rec.operatingSystem,
                os_version: rec.osVersion,
                rustdesk_id: rec.rustdeskId,
                agent_version: rec.agentVersion,
                rustdesk_version: rec.rustdeskVersion,
                last_seen_at: rec.lastSeenAt,
                last_ip: rec.publicIp ?? null,
                enabled: true,
                notes: rec.notes ?? null,
              },
              cachedAt: now,
              lastDbWriteAt: Number.isFinite(dbSeenMs) ? dbSeenMs : 0,
            });
            return { ...rec, enabled: true };
          }
          const mem = cached.data;
          const memSeenMs =
            typeof mem.last_seen_at === 'string' ? Date.parse(mem.last_seen_at) : NaN;
          const dbSeenMs = rec.lastSeenAt ? Date.parse(rec.lastSeenAt) : NaN;
          if (Number.isFinite(memSeenMs) && (!Number.isFinite(dbSeenMs) || memSeenMs >= dbSeenMs)) {
            return {
              ...rec,
              displayName:
                typeof mem.display_name === 'string' ? mem.display_name : rec.displayName,
              hostname: typeof mem.hostname === 'string' ? mem.hostname : rec.hostname,
              operatingSystem:
                typeof mem.operating_system === 'string'
                  ? mem.operating_system
                  : rec.operatingSystem,
              osVersion: typeof mem.os_version === 'string' ? mem.os_version : rec.osVersion,
              rustdeskId: typeof mem.rustdesk_id === 'string' ? mem.rustdesk_id : rec.rustdeskId,
              agentVersion:
                typeof mem.agent_version === 'string' ? mem.agent_version : rec.agentVersion,
              rustdeskVersion:
                typeof mem.rustdesk_version === 'string'
                  ? mem.rustdesk_version
                  : rec.rustdeskVersion,
              lastSeenAt:
                typeof mem.last_seen_at === 'string' ? mem.last_seen_at : rec.lastSeenAt,
              ...(typeof mem.last_ip === 'string' && mem.last_ip
                ? { publicIp: mem.last_ip }
                : {}),
              enabled: true,
              ...(typeof mem.notes === 'string' ? { notes: mem.notes } : {}),
            };
          }
          return { ...rec, enabled: true };
        });

        const hbbsOnlineSet = await resolveHbbsOnlineSet(
          mergedInitial.map((rec) => rec.rustdeskId),
          now,
        );

        return {
          hasMore: scanResult.hasMore,
          records: mergedInitial.map((rec) => {
            const seenMs = rec.lastSeenAt ? Date.parse(rec.lastSeenAt) : NaN;
            const withinAgentGrace =
              Number.isFinite(seenMs) &&
              now - seenMs >= -30_000 &&
              now - seenMs <= AGENT_ONLINE_GRACE_MS;
            const isHbbsOnline = Boolean(
              rec.rustdeskId && hbbsOnlineSet.has(rec.rustdeskId.trim()),
            );
            if (!withinAgentGrace && !isHbbsOnline) {
              return rec;
            }
            const effectiveSeenAt =
              rec.lastSeenAt &&
              Number.isFinite(seenMs) &&
              now - seenMs >= 0 &&
              now - seenMs <= 60_000
                ? rec.lastSeenAt
                : new Date(now - 15_000).toISOString();
            if (!heartbeatGuards.has(rec.id)) {
              const devEntry = deviceSnapshotCache.get(rec.id);
              if (devEntry) {
                devEntry.data = {
                  ...devEntry.data,
                  enabled: true,
                  last_seen_at: effectiveSeenAt,
                };
              }
              const tokEntry = tokenSnapshotCache.get(rec.id);
              if (tokEntry) {
                tokEntry.data = {
                  ...tokEntry.data,
                  revoked_at: null,
                  last_used_at: effectiveSeenAt,
                };
              }
            }
            return {
              ...rec,
              enabled: true,
              lastSeenAt: effectiveSeenAt,
            };
          }),
        };
      },
    },
    enrollDevice: createEnrollmentService({
      repository: enrollmentRepository,
      reconfigurationGuard: enrollmentRepository,
      genericPassword: genericInstallers.enrollmentPassword,
      audit: auditRepository,
      encryptionKey: config.masterEncryptionKey,
      keyVersion: config.encryptionKeyVersion,
    }),
    recordHeartbeat: createHeartbeatService({
      repository: enrollmentRepository,
      audit: auditRepository,
    }),
    operatorSetup: createOperatorSetupService({
      repository: enrollmentRepository,
      guard: enrollmentRepository,
      receipts: setupReceipts,
      audit: auditRepository,
      encryptionKey: config.masterEncryptionKey,
      keyVersion: config.encryptionKeyVersion,
    }),
    cursorSecret: Buffer.from(
      hkdfSync(
        'sha256',
        config.masterEncryptionKey,
        Buffer.alloc(0),
        'appremoto-device-list-cursor-v1',
        32
      )
    ),
  };
}
