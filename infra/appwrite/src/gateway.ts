import type { SchemaAttribute, SchemaCollection, SchemaIndex } from './schema.ts';

export type AppwriteDatabase = { readonly $id: string; readonly name: string };
export type AppwriteCollection = {
  readonly $id: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly documentSecurity: boolean;
};
export type AppwriteAttribute = {
  readonly key: string;
  readonly type: string;
  readonly required: boolean;
  readonly size?: number;
  readonly elements?: readonly string[];
  readonly array?: boolean;
  readonly default?: string | number | boolean | null;
  readonly min?: number | null;
  readonly max?: number | null;
  readonly encrypt?: boolean;
  readonly format?: string | null;
};
export type AppwriteIndex = {
  readonly key: string;
  readonly type: string;
  readonly attributes: readonly string[];
  readonly orders?: readonly string[];
  readonly lengths?: readonly (number | null)[];
};
export interface AppwriteGateway {
  listDatabases(): Promise<readonly AppwriteDatabase[]>;
  listCollections(databaseId: string): Promise<readonly AppwriteCollection[]>;
  listAttributes(databaseId: string, collectionId: string): Promise<readonly AppwriteAttribute[]>;
  listIndexes(databaseId: string, collectionId: string): Promise<readonly AppwriteIndex[]>;
}

export interface ProvisioningGateway extends AppwriteGateway {
  readonly projectId: string;
  createDatabase(database: { id: string; name: string }): Promise<void>;
  createCollection(databaseId: string, collection: SchemaCollection): Promise<void>;
  createAttribute(databaseId: string, collectionId: string, attribute: SchemaAttribute): Promise<void>;
  getAttributeStatus(databaseId: string, collectionId: string, key: string): Promise<string>;
  createIndex(databaseId: string, collectionId: string, index: SchemaIndex): Promise<void>;
  getIndexStatus(databaseId: string, collectionId: string, key: string): Promise<string>;
}

export type AdminIdentity = { readonly id: string; readonly email: string };
export type AdminProfile = {
  readonly id: string; readonly user_id: string; readonly display_name: string;
  readonly global_role: string; readonly active: boolean;
};
export type AdminProfileData = {
  readonly user_id: string; readonly display_name: string;
  readonly global_role: 'super_admin'; readonly active: true;
};
export interface AdministratorGateway {
  readonly projectId: string;
  findUserByEmail(email: string): Promise<AdminIdentity | null>;
  createUser(id: string, email: string, password: string): Promise<AdminIdentity>;
  findProfileByUserId(userId: string): Promise<AdminProfile | null>;
  createProfile(id: string, data: AdminProfileData): Promise<AdminProfile>;
  updateProfile(id: string, data: Pick<AdminProfileData, 'global_role' | 'active'>): Promise<AdminProfile>;
}
