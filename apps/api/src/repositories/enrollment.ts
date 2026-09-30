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
}
export interface EnrollmentRepository {
  findToken(hash: string): Promise<EnrollmentToken | null>;
  organizationActive(id: string): Promise<boolean>;
  snapshot(kind: EnrollmentKind, id: string): Promise<EnrollmentData | null>;
  write(kind: EnrollmentKind, id: string, data: EnrollmentData, previous: EnrollmentData | null): Promise<void>;
  restore(kind: EnrollmentKind, id: string, previous: EnrollmentData | null, expected: EnrollmentData): Promise<void>;
}

const database = 'remote_management';
const fields: Record<EnrollmentKind, string[]> = {
  enrollment_tokens: ['organization_id', 'token_hash', 'expires_at', 'max_uses', 'use_count', 'active', 'created_by_user_id'],
  enrollment_receipts: ['organization_id', 'enrollment_token_id', 'device_id', 'device_uuid', 'status', 'token_use_consumed'],
  devices: ['organization_id', 'device_uuid', 'display_name', 'hostname', 'rustdesk_id', 'operating_system', 'os_version',
    'agent_version', 'rustdesk_version', 'last_seen_at', 'last_ip', 'enabled'],
  device_tokens: ['device_id', 'token_hash', 'last_used_at', 'revoked_at'],
  device_credentials: ['device_id', 'password_ciphertext', 'password_nonce', 'password_tag', 'key_version'],
};

export function enrollmentId(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 36);
}

function project(kind: EnrollmentKind, document: object): EnrollmentData {
  const record = document as EnrollmentData;
  return Object.fromEntries(fields[kind].filter((field) => record[field] !== undefined).map((field) => [field, record[field]!])) as EnrollmentData;
}

export function createEnrollmentRepository(databases: Databases): EnrollmentRepository {
  const unavailable = () => new Error('Enrollment storage unavailable');
  const snapshot: EnrollmentRepository['snapshot'] = async (kind, id) => {
    try { return project(kind, await databases.getDocument(database, kind, id)); }
    catch (error) {
      if (error instanceof AppwriteException && error.code === 404) return null;
      throw unavailable();
    }
  };
  const write: EnrollmentRepository['write'] = async (kind, id, data, previous) => {
    try {
      if (previous) await databases.updateDocument(database, kind, id, project(kind, data));
      else await databases.createDocument(database, kind, id, project(kind, data), []);
    } catch { throw unavailable(); }
  };
  return {
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
    snapshot, write,
    async restore(kind, id, previous, expected) {
      try {
        const current = await snapshot(kind, id);
        if (isDeepStrictEqual(current, previous)) return;
        if (!isDeepStrictEqual(current, expected)) throw unavailable();
        if (previous) await databases.updateDocument(database, kind, id, project(kind, previous));
        else await databases.deleteDocument(database, kind, id);
      } catch { throw unavailable(); }
    },
  };
}
