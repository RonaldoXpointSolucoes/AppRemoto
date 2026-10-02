import { AppwriteException, Query, type Databases } from 'node-appwrite';
import type { Organization } from './organizations.ts';

export interface GenericInstallerRecord { id: string; name: string; tokenHash: string; active: boolean;
  createdByUserId: string; createdAt: string; revokedAt: string | null }
export interface GenericInstallerRepository {
  list(): Promise<GenericInstallerRecord[]>;
  get(id: string): Promise<GenericInstallerRecord | null>;
  create(record: Omit<GenericInstallerRecord, 'createdAt'>): Promise<GenericInstallerRecord>;
  revoke(id: string, at: string): Promise<void>;
  issuerIsSuperAdmin(userId: string): Promise<boolean>;
  organizations(): Promise<Organization[]>;
  organization(id: string): Promise<Organization | null>;
  createOrganization(organization: Organization): Promise<void>;
}
const database = 'remote_management';
const profileFields = ['$id', '$createdAt', 'name', 'token_hash', 'active', 'created_by_user_id', 'revoked_at'];
function profile(doc: Record<string, unknown>): GenericInstallerRecord {
  if (typeof doc.$id !== 'string' || typeof doc.$createdAt !== 'string' || typeof doc.name !== 'string' ||
      typeof doc.token_hash !== 'string' || !/^[a-f0-9]{64}$/.test(doc.token_hash) || typeof doc.active !== 'boolean' ||
      typeof doc.created_by_user_id !== 'string' || doc.revoked_at != null && typeof doc.revoked_at !== 'string') throw new Error();
  return { id: doc.$id, name: doc.name, tokenHash: doc.token_hash, active: doc.active, createdByUserId: doc.created_by_user_id,
    createdAt: new Date(doc.$createdAt).toISOString(), revokedAt: typeof doc.revoked_at === 'string' ? new Date(doc.revoked_at).toISOString() : null };
}
function organization(doc: Record<string, unknown>): Organization {
  if (typeof doc.$id !== 'string' || typeof doc.name !== 'string' || typeof doc.slug !== 'string' || typeof doc.active !== 'boolean') throw new Error();
  return { id: doc.$id, name: doc.name, slug: doc.slug, active: doc.active };
}
export function createGenericInstallerRepository(databases: Databases): GenericInstallerRepository {
  const unavailable = () => new Error('Generic installer storage unavailable');
  const get: GenericInstallerRepository['get'] = async (id) => {
    try { return profile(await databases.getDocument(database, 'generic_installers', id, [Query.select(profileFields)])); }
    catch (error) { if (error instanceof AppwriteException && error.code === 404) return null; throw unavailable(); }
  };
  const getOrganization: GenericInstallerRepository['organization'] = async (id) => {
    try { return organization(await databases.getDocument(database, 'organizations', id, [Query.select(['$id', 'name', 'slug', 'active'])])); }
    catch (error) { if (error instanceof AppwriteException && error.code === 404) return null; throw unavailable(); }
  };
  return {
    get,
    async list() {
      try {
        const page = await databases.listDocuments(database, 'generic_installers', [Query.limit(100), Query.orderDesc('$createdAt'), Query.select(profileFields)]);
        return page.documents.map(profile);
      } catch { throw unavailable(); }
    },
    async create(record) {
      const data = { name: record.name, token_hash: record.tokenHash, active: true,
        created_by_user_id: record.createdByUserId, revoked_at: null };
      try {
        try { await databases.createDocument(database, 'generic_installers', record.id, data, []); }
        catch { /* A matching read can resolve a response lost after creation; never create another profile here. */ }
        const current = await get(record.id);
        if (!current || current.name !== record.name || current.tokenHash !== record.tokenHash || !current.active ||
            current.revokedAt !== null || current.createdByUserId !== record.createdByUserId) throw new Error();
        return current;
      } catch { throw unavailable(); }
    },
    async revoke(id, at) {
      try {
        const previous = await get(id); if (!previous) throw new Error();
        if (previous.revokedAt !== null && previous.active === false) return;
        try { await databases.updateDocument(database, 'generic_installers', id, { active: false, revoked_at: previous.revokedAt ?? at }); }
        catch { /* Resolve a lost response from the durable revocation fields. */ }
        const current = await get(id);
        if (!current || current.active !== false || current.revokedAt === null) throw new Error();
      } catch { throw unavailable(); }
    },
    async issuerIsSuperAdmin(userId) {
      try {
        const page = await databases.listDocuments(database, 'technician_profiles', [Query.equal('user_id', userId),
          Query.limit(2), Query.select(['user_id', 'active', 'global_role'])]);
        return page.total === 1 && page.documents.length === 1 && page.documents[0]!.user_id === userId &&
          page.documents[0]!.active === true && page.documents[0]!.global_role === 'super_admin';
      } catch { throw unavailable(); }
    },
    organization: getOrganization,
    async organizations() {
      const result: Organization[] = []; let cursor: string | undefined;
      try {
        for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
          const page = await databases.listDocuments(database, 'organizations', [Query.limit(100), Query.orderAsc('$id'),
            Query.select(['$id', 'name', 'slug', 'active']), ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
          result.push(...page.documents.map(organization));
          if (page.documents.length < 100) return result;
          cursor = page.documents.at(-1)!.$id;
        }
        throw new Error();
      } catch { throw unavailable(); }
    },
    async createOrganization(value) {
      try {
        try { await databases.createDocument(database, 'organizations', value.id,
          { name: value.name, slug: value.slug, active: value.active }, []); }
        catch { /* Deterministic ID and slug permit exact recovery, never a duplicate name-based fallback. */ }
        const current = await getOrganization(value.id);
        if (!current || current.name !== value.name || current.slug !== value.slug || current.active !== value.active) throw new Error();
      } catch { throw unavailable(); }
    },
  };
}
