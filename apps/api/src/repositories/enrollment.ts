import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AppwriteException, Query, type Databases } from 'node-appwrite';

export type EnrollmentKind = 'enrollment_tokens' | 'enrollment_receipts' | 'devices' | 'device_tokens' | 'device_credentials';
export type EnrollmentData = Record<string, string | number | boolean | null>;
export interface EnrollmentToken extends EnrollmentData {
  id: string;
  organization_id: string;
  token_hash: string;
  expires_at: string;
  max_uses: number;
  use_count: number;
  active: boolean;
  revoked_at: string | null;
}
export interface EnrollmentRepository {
  findToken(hash: string): Promise<EnrollmentToken | null>;
  organizationActive(id: string): Promise<boolean>;
  pendingReceipts(tokenId: string): Promise<EnrollmentData[]>;
  snapshot(kind: EnrollmentKind, id: string): Promise<EnrollmentData | null>;
  freezeToken(id: string, hash: string): Promise<EnrollmentData | null>;
  write(kind: EnrollmentKind, id: string, data: EnrollmentData, previous: EnrollmentData | null): Promise<void>;
  restore(kind: EnrollmentKind, id: string, previous: EnrollmentData | null, expected: EnrollmentData): Promise<void>;
}
export interface HeartbeatTokenRepository {
  findDeviceToken(hash: string): Promise<(EnrollmentData & { id: string }) | null>;
  freezeHeartbeat(deviceId: string, hash: string, timestamp: string): Promise<boolean>;
  beginHeartbeatGuard(guard: HeartbeatGuard): Promise<boolean>;
  endHeartbeatGuard(guard: HeartbeatGuard): Promise<boolean>;
}
export interface HeartbeatGuard {
  deviceId: string;
  deviceTokenId: string;
  startedAt: string;
}

const database = 'remote_management';
const fields: Record<EnrollmentKind, string[]> = {
  enrollment_tokens: ['organization_id', 'token_hash', 'expires_at', 'max_uses', 'use_count', 'active', 'created_by_user_id', 'revoked_at'],
  enrollment_receipts: ['organization_id', 'enrollment_token_id', 'device_id', 'device_uuid', 'status', 'token_use_consumed',
    'expected_use_count', 'recovery_frozen'],
  devices: ['organization_id', 'device_uuid', 'display_name', 'hostname', 'rustdesk_id', 'operating_system', 'os_version',
    'agent_version', 'rustdesk_version', 'last_seen_at', 'last_ip', 'enabled'],
  device_tokens: ['device_id', 'token_hash', 'last_used_at', 'revoked_at'],
  device_credentials: ['device_id', 'password_ciphertext', 'password_nonce', 'password_tag', 'key_version'],
};

export function enrollmentId(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 36);
}

function project(kind: EnrollmentKind, document: object): EnrollmentData {
  const defaults = kind === 'devices' ? { agent_version: null, rustdesk_version: null,
    last_seen_at: null, last_ip: null } : kind === 'device_tokens' ?
    { last_used_at: null, revoked_at: null } : kind === 'enrollment_tokens' ? { revoked_at: null } : {};
  const record = { ...defaults, ...document } as EnrollmentData;
  return Object.fromEntries(fields[kind].filter((field) => record[field] !== undefined).map((field) => {
    const value = record[field]!;
    return [field, ['expires_at', 'last_seen_at', 'last_used_at', 'revoked_at'].includes(field) &&
      typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : value];
  })) as EnrollmentData;
}

export function sameEnrollmentState(kind: EnrollmentKind, left: EnrollmentData | null, right: EnrollmentData | null): boolean {
  return isDeepStrictEqual(left && project(kind, left), right && project(kind, right));
}

export class IndeterminateEnrollmentWrite extends Error {
  constructor() { super('Enrollment storage unavailable'); }
}

export class RejectedEnrollmentWrite extends Error {
  constructor() { super('Enrollment storage unavailable'); }
}

export function createEnrollmentRepository(databases: Databases): EnrollmentRepository & HeartbeatTokenRepository {
  const unavailable = () => new Error('Enrollment storage unavailable');
  const guardMatches = (document: Record<string, unknown>, guard: HeartbeatGuard) =>
    document.$id === guard.deviceId && document.device_id === guard.deviceId &&
    document.device_token_id === guard.deviceTokenId && typeof document.started_at === 'string' &&
    Number.isFinite(Date.parse(document.started_at)) &&
    new Date(document.started_at).toISOString() === guard.startedAt;
  const snapshot: EnrollmentRepository['snapshot'] = async (kind, id) => {
    try { return project(kind, await databases.getDocument(database, kind, id)); }
    catch (error) {
      if (error instanceof AppwriteException && error.code === 404) return null;
      throw unavailable();
    }
  };
  const write: EnrollmentRepository['write'] = async (kind, id, data, previous) => {
    try {
      if (previous) {
        const desired = project(kind, data); const old = project(kind, previous);
        const changes = Object.fromEntries(Object.entries(desired).filter(([key, value]) =>
          !(['enrollment_tokens', 'device_tokens'].includes(kind) && key === 'revoked_at') && !isDeepStrictEqual(value, old[key])));
        if (Object.keys(changes).length) await databases.updateDocument(database, kind, id, changes);
      }
      else await databases.createDocument(database, kind, id, project(kind, data), []);
    } catch (error) {
      if (error instanceof AppwriteException && error.code >= 400 && error.code < 500 && ![408, 429].includes(error.code)) {
        throw new RejectedEnrollmentWrite();
      }
      // A prior-state read never proves the timed-out server write has finished.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (!sameEnrollmentState(kind, previous, data) && sameEnrollmentState(kind, await snapshot(kind, id), data)) return;
        } catch { /* The outcome remains unknown. */ }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new IndeterminateEnrollmentWrite();
    }
  };
  return {
    async beginHeartbeatGuard(guard) {
      try {
        await databases.getDocument(database, 'heartbeat_guards', guard.deviceId);
        return false;
      } catch (error) {
        if (!(error instanceof AppwriteException) || error.code !== 404) return false;
      }
      try {
        await databases.createDocument(database, 'heartbeat_guards', guard.deviceId, {
          device_id: guard.deviceId, device_token_id: guard.deviceTokenId, started_at: guard.startedAt,
        }, []);
      } catch { return false; }
      try { return guardMatches(await databases.getDocument(database, 'heartbeat_guards', guard.deviceId), guard); }
      catch { return false; }
    },
    async endHeartbeatGuard(guard) {
      try {
        if (!guardMatches(await databases.getDocument(database, 'heartbeat_guards', guard.deviceId), guard)) return false;
      } catch { return false; }
      try { await databases.deleteDocument(database, 'heartbeat_guards', guard.deviceId); }
      catch { /* A fresh read resolves a completed delete even if its response was lost. */ }
      try { await databases.getDocument(database, 'heartbeat_guards', guard.deviceId); return false; }
      catch (error) { return error instanceof AppwriteException && error.code === 404; }
    },
    async freezeHeartbeat(deviceId, hash, timestamp) {
      try {
        const [device, token] = await Promise.all([snapshot('devices', deviceId), snapshot('device_tokens', deviceId)]);
        if (!device || !token || token.device_id !== deviceId || token.token_hash !== hash) return false;
        if (token.revoked_at === null) {
          try { await databases.updateDocument(database, 'device_tokens', deviceId, { revoked_at: timestamp }); }
          catch { /* A fresh read below determines whether the narrow write committed. */ }
        }
        if (device.enabled === true) {
          try { await databases.updateDocument(database, 'devices', deviceId, { enabled: false }); }
          catch { /* A fresh read below determines whether the narrow write committed. */ }
        }
        for (let read = 0; read < 2; read++) {
          const [currentDevice, currentToken] = await Promise.all([
            snapshot('devices', deviceId), snapshot('device_tokens', deviceId),
          ]);
          if (!currentDevice || currentDevice.enabled !== false || !currentToken ||
              currentToken.device_id !== deviceId || currentToken.token_hash !== hash ||
              currentToken.revoked_at === null) return false;
        }
        return true;
      } catch { return false; }
    },
    async findDeviceToken(hash) {
      try {
        const page = await databases.listDocuments(database, 'device_tokens', [
          Query.equal('token_hash', hash), Query.limit(2), Query.select(['$id', ...fields.device_tokens]),
        ]);
        if (page.total > 1 || page.documents.length > 1) throw unavailable();
        const doc = page.documents[0];
        if (!doc) return null;
        if (doc.token_hash !== hash) throw unavailable();
        return { id: doc.$id, ...project('device_tokens', doc) };
      } catch { throw unavailable(); }
    },
    async findToken(hash) {
      try {
        const page = await databases.listDocuments(database, 'enrollment_tokens', [
          Query.equal('token_hash', hash), Query.limit(2), Query.select(['$id', ...fields.enrollment_tokens]),
        ]);
        if (page.total > 1 || page.documents.length > 1) throw unavailable();
        const doc = page.documents[0];
        if (!doc) return null;
        if (doc.token_hash !== hash) throw unavailable();
        return { id: doc.$id, ...project('enrollment_tokens', doc) } as EnrollmentToken;
      } catch { throw unavailable(); }
    },
    async organizationActive(id) {
      try { return (await databases.getDocument(database, 'organizations', id)).active === true; }
      catch (error) {
        if (error instanceof AppwriteException && error.code === 404) return false;
        throw unavailable();
      }
    },
    async pendingReceipts(tokenId) {
      try {
        const page = await databases.listDocuments(database, 'enrollment_receipts', [Query.equal('enrollment_token_id', tokenId),
          Query.equal('status', 'pending'), Query.limit(2), Query.select(fields.enrollment_receipts)]);
        if (page.total > 1 || page.documents.length > 1) throw unavailable();
        return page.documents.map((doc) => project('enrollment_receipts', doc));
      } catch { throw unavailable(); }
    },
    snapshot, write,
    async freezeToken(id, hash) {
      try {
        // No CAS: repeat the authoritative precondition, and preserve independent admin revocation evidence.
        for (let read = 0; read < 2; read++) {
          const current = await snapshot('enrollment_tokens', id);
          if (!current || current.token_hash !== hash || current.active !== true || current.revoked_at !== null) return null;
        }
        const response = await databases.updateDocument(database, 'enrollment_tokens', id, { active: false });
        return project('enrollment_tokens', response);
      } catch { throw unavailable(); }
    },
    async restore(kind, id, previous, expected) {
      try {
        const current = await snapshot(kind, id);
        if (sameEnrollmentState(kind, current, previous)) return;
        if (!sameEnrollmentState(kind, current, expected)) throw unavailable();
        if (previous) await write(kind, id, previous, expected);
        else await databases.deleteDocument(database, kind, id);
        if (!sameEnrollmentState(kind, await snapshot(kind, id), previous)) throw unavailable();
      } catch (error) {
        if (error instanceof IndeterminateEnrollmentWrite) throw error;
        // An unverified rollback must not permit destructive cleanup of its linkage.
        throw new IndeterminateEnrollmentWrite();
      }
    },
  };
}
