import { Client, Databases, Users, Query, IndexType } from 'node-appwrite';
import type { Models } from 'node-appwrite';
import type { AdministratorGateway, AdminProfile, AppwriteAttribute, ProvisioningGateway } from './gateway.ts';
import type { SchemaAttribute } from './schema.ts';
import { requireTargetProject } from './safety.ts';

export function readAppwriteEnvironment(environment: NodeJS.ProcessEnv) {
  const projectId = environment.APPWRITE_PROJECT_ID ?? '';
  requireTargetProject(projectId);
  const endpoint = environment.APPWRITE_ENDPOINT ?? '';
  const apiKey = environment.APPWRITE_API_KEY ?? '';
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1')) throw new Error();
  } catch {
    throw new Error('APPWRITE_ENDPOINT must be an HTTPS API endpoint ending in /v1');
  }
  if (!apiKey.trim()) throw new Error('APPWRITE_API_KEY is required');
  return { projectId, endpoint, apiKey };
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch { throw new Error('Appwrite operation failed'); }
}

async function paginate<T>(read: (queries: string[]) => Promise<{ total: number; items: T[] }>): Promise<T[]> {
  const items: T[] = [];
  while (true) {
    const page = await read([Query.limit(100), Query.offset(items.length)]);
    items.push(...page.items);
    if (items.length >= page.total) return items;
    if (!page.items.length) throw new Error('Incomplete Appwrite page');
  }
}

type ProfileDocument = Models.Document & Omit<AdminProfile, 'id'>;
const profileFrom = (doc: ProfileDocument): AdminProfile => ({ id: doc.$id, user_id: doc.user_id,
  display_name: doc.display_name, global_role: doc.global_role, active: doc.active });

export function createAppwriteGateway(environment: NodeJS.ProcessEnv): ProvisioningGateway & AdministratorGateway {
  const { projectId, endpoint, apiKey } = readAppwriteEnvironment(environment);
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const databases = new Databases(client);
  const users = new Users(client);
  const db = 'remote_management';
  const profiles = 'technician_profiles';

  async function createAttribute(database: string, collection: string, attribute: SchemaAttribute): Promise<void> {
    const { key, required, array } = attribute;
    switch (attribute.type) {
      case 'string':
        if (attribute.format && attribute.format !== 'string') throw new Error('Unsupported string format');
        await databases.createStringAttribute(database, collection, key, attribute.size, required, attribute.default ?? undefined, array, attribute.encrypt);
        break;
      case 'enum':
        await databases.createEnumAttribute(database, collection, key, [...attribute.elements], required, attribute.default ?? undefined, array);
        break;
      case 'boolean':
        await databases.createBooleanAttribute(database, collection, key, required, attribute.default ?? undefined, array);
        break;
      case 'datetime':
        await databases.createDatetimeAttribute(database, collection, key, required, attribute.default ?? undefined, array);
        break;
      case 'integer':
        await databases.createIntegerAttribute(database, collection, key, required, attribute.min ?? undefined, attribute.max ?? undefined, attribute.default ?? undefined, array);
        break;
      case 'float':
        await databases.createFloatAttribute(database, collection, key, required, attribute.min ?? undefined, attribute.max ?? undefined, attribute.default ?? undefined, array);
        break;
    }
  }

  return {
    projectId,
    listDatabases: () => safe(async () => paginate(async (queries) => {
      const page = await databases.list(queries);
      return { total: page.total, items: page.databases.map((item) => ({ $id: item.$id, name: item.name })) };
    })),
    listCollections: (database) => safe(async () => paginate(async (queries) => {
      const page = await databases.listCollections(database, queries);
      return { total: page.total, items: page.collections.map((item) => ({ $id: item.$id, name: item.name,
        permissions: item.$permissions, documentSecurity: item.documentSecurity })) };
    })),
    listAttributes: (database, collection) => safe(async () => paginate(async (queries) => {
      const page = await databases.listAttributes(database, collection, queries);
      const items = page.attributes.map((item): AppwriteAttribute => {
        const raw = item as AppwriteAttribute;
        const type = raw.format === 'enum' || raw.format === 'datetime' ? raw.format : raw.type;
        return { key: raw.key, type, required: raw.required,
          ...('size' in raw ? { size: raw.size } : {}), ...('elements' in raw ? { elements: raw.elements } : {}),
          ...('array' in raw ? { array: raw.array } : {}), ...('default' in raw ? { default: raw.default } : {}),
          ...('min' in raw ? { min: raw.min } : {}), ...('max' in raw ? { max: raw.max } : {}),
          ...('encrypt' in raw ? { encrypt: raw.encrypt } : {}), ...('format' in raw ? { format: raw.format } : {}) };
      });
      return { total: page.total, items };
    })),
    listIndexes: (database, collection) => safe(async () => paginate(async (queries) => {
      const page = await databases.listIndexes(database, collection, queries);
      return { total: page.total, items: page.indexes.map((item) => ({ key: item.key, type: item.type,
        attributes: item.attributes, orders: item.orders, lengths: item.lengths })) };
    })),
    createDatabase: (database) => safe(async () => { await databases.create(database.id, database.name); }),
    createCollection: (database, collection) => safe(async () => {
      await databases.createCollection(database, collection.id, collection.name, [...collection.permissions], collection.documentSecurity);
    }),
    createAttribute: (database, collection, attribute) => safe(() => createAttribute(database, collection, attribute)),
    getAttributeStatus: (database, collection, key) => safe(async () => {
      const attribute = await databases.getAttribute(database, collection, key) as { status?: unknown };
      if (typeof attribute.status !== 'string') throw new Error('Missing attribute status');
      return attribute.status;
    }),
    createIndex: (database, collection, index) => safe(async () => {
      await databases.createIndex(database, collection, index.id, index.type === 'unique' ? IndexType.Unique : IndexType.Key,
        [...index.attributes], undefined, index.lengths === undefined ? undefined : [...index.lengths]);
    }),
    getIndexStatus: (database, collection, key) => safe(async () => (await databases.getIndex(database, collection, key)).status),
    findUserByEmail: (email) => safe(async () => {
      const page = await users.list([Query.equal('email', email), Query.limit(2)]);
      if (page.total > 1) throw new Error('Ambiguous administrator identity');
      const user = page.users[0];
      if (user && user.email !== email) throw new Error('Unexpected administrator identity');
      return user ? { id: user.$id, email: user.email } : null;
    }),
    createUser: (id, email, password) => safe(async () => {
      const user = await users.create(id, email, undefined, password, 'Remote Administrator');
      return { id: user.$id, email: user.email };
    }),
    findProfileByUserId: (id) => safe(async () => {
      const page = await databases.listDocuments<ProfileDocument>(db, profiles, [Query.equal('user_id', id), Query.limit(2)]);
      if (page.total > 1) throw new Error('Ambiguous administrator profile');
      const profile = page.documents[0];
      if (profile && profile.user_id !== id) throw new Error('Unexpected administrator profile');
      return profile ? profileFrom(profile) : null;
    }),
    createProfile: (id, data) => safe(async () => profileFrom(await databases.createDocument<ProfileDocument>(db, profiles, id, data, []))),
    updateProfile: (id, data) => safe(async () => profileFrom(await databases.updateDocument<ProfileDocument>(db, profiles, id, data))),
  };
}
