import { REMOTE_MANAGEMENT_SCHEMA } from '../schema.ts';
import type { SchemaAttribute, SchemaCollection, SchemaIndex } from '../schema.ts';

export class FakeGateway {
  readonly projectId = '6abc5640003cb361b809';
  database: { $id: string; name: string } | null = null;
  collections = new Map<string, SchemaCollection>();
  attributes = new Map<string, SchemaAttribute[]>();
  indexes = new Map<string, SchemaIndex[]>();
  events: string[] = [];
  writes = 0;
  interruptAt = Infinity;
  attributeState = 'available';
  indexState = 'available';
  user: { id: string; email: string } | null = null;
  profile: { id: string; user_id: string; display_name: string; global_role: string; active: boolean } | null = null;
  receivedPassword = '';
  failure: Error | null = null;

  async listDatabases() { return this.database ? [this.database] : []; }
  async listCollections() { return [...this.collections.values()].map((c) => ({ ...c, $id: c.id })); }
  async listAttributes(_database: string, collection: string) { return this.attributes.get(collection) ?? []; }
  async listIndexes(_database: string, collection: string) {
    return (this.indexes.get(collection) ?? []).map((i) => ({ ...i, key: i.id }));
  }
  write(event: string) {
    if (this.writes === this.interruptAt) throw new Error('interrupted');
    if (this.failure) throw this.failure;
    this.writes++;
    this.events.push(event);
  }
  async createDatabase(database: { id: string; name: string }) {
    this.write('database');
    if (this.database) throw new Error('duplicate database');
    this.database = { $id: database.id, name: database.name };
  }
  async createCollection(_database: string, collection: SchemaCollection) {
    this.write('collection');
    if (this.collections.has(collection.id)) throw new Error('duplicate collection');
    this.collections.set(collection.id, collection);
  }
  async createAttribute(_database: string, collection: string, attribute: SchemaAttribute) {
    this.write('attribute');
    const attributes = this.attributes.get(collection) ?? [];
    if (attributes.some((a) => a.key === attribute.key)) throw new Error('duplicate attribute');
    this.attributes.set(collection, [...attributes, attribute]);
  }
  async getAttributeStatus() { this.events.push('attribute-ready'); return this.attributeState; }
  async createIndex(_database: string, collection: string, index: SchemaIndex) {
    this.write('index');
    const indexes = this.indexes.get(collection) ?? [];
    if (indexes.some((i) => i.id === index.id)) throw new Error('duplicate index');
    this.indexes.set(collection, [...indexes, index]);
  }
  async getIndexStatus() { this.events.push('index-ready'); return this.indexState; }
  async findUserByEmail(email: string) { return this.user?.email === email ? this.user : null; }
  async createUser(id: string, email: string, password: string) {
    this.write('user');
    this.receivedPassword = password;
    this.user = { id, email };
    return this.user;
  }
  async findProfileByUserId(id: string) { return this.profile?.user_id === id ? this.profile : null; }
  async createProfile(id: string, data: { user_id: string; display_name: string; global_role: 'super_admin'; active: true }) {
    this.write('profile'); this.profile = { id, ...data }; return this.profile;
  }
  async updateProfile(id: string, data: { global_role: 'super_admin'; active: true }) {
    this.write('profile-update'); this.profile = { ...this.profile!, id, ...data }; return this.profile;
  }
}

export const desiredResourceCount = 1 + REMOTE_MANAGEMENT_SCHEMA.collections.reduce(
  (count, collection) => count + 1 + collection.attributes.length + collection.indexes.length, 0);
