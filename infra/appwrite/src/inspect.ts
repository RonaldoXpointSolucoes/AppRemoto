import type { AppwriteAttribute, AppwriteGateway } from './gateway.ts';
import { REMOTE_MANAGEMENT_SCHEMA } from './schema.ts';
import type { RemoteManagementSchema } from './schema.ts';

export type InventoryAttribute = AppwriteAttribute;
export type InventoryIndex = { readonly id: string; readonly type: string; readonly attributes: readonly string[]; readonly orders?: readonly string[]; readonly lengths?: readonly (number | null)[] };
export type InventoryCollection = {
  readonly id: string; readonly name: string; readonly permissions: readonly string[];
  readonly documentSecurity: boolean; readonly attributes: readonly InventoryAttribute[];
  readonly indexes: readonly InventoryIndex[];
};
export type AppwriteInventory = {
  readonly database: { readonly id: string; readonly name: string } | null;
  readonly collections: readonly InventoryCollection[];
};

function normalizeAttributeType(type: string): string {
  switch (type.toLowerCase()) {
    case 'bool': return 'boolean';
    case 'int': return 'integer';
    case 'double': return 'float';
    case 'datetime': return 'datetime';
    default: return type.toLowerCase();
  }
}

export async function inspectSchema(gateway: AppwriteGateway, desired: RemoteManagementSchema = REMOTE_MANAGEMENT_SCHEMA): Promise<AppwriteInventory> {
  const database = (await gateway.listDatabases()).find((item) => item.$id === desired.database.id);
  if (!database) return { database: null, collections: [] };

  const available = await gateway.listCollections(database.$id);
  const collections: InventoryCollection[] = [];
  for (const wanted of desired.collections) {
    const item = available.find((candidate) => candidate.$id === wanted.id);
    if (!item) continue;
    const [attributes, indexes] = await Promise.all([
      gateway.listAttributes(database.$id, item.$id),
      gateway.listIndexes(database.$id, item.$id),
    ]);
    collections.push({
      id: item.$id, name: item.name, permissions: [...item.permissions],
      documentSecurity: item.documentSecurity,
      attributes: attributes.map((attribute) => ({
        key: attribute.key, type: normalizeAttributeType(attribute.type), required: attribute.required,
        ...(attribute.size === undefined ? {} : { size: attribute.size }),
        ...(attribute.elements === undefined ? {} : { elements: [...attribute.elements] }),
        ...(attribute.array === undefined ? {} : { array: attribute.array }),
        ...(attribute.default === undefined ? {} : { default: attribute.default }),
        ...(attribute.min === undefined ? {} : { min: attribute.min }),
        ...(attribute.max === undefined ? {} : { max: attribute.max }),
        ...(attribute.encrypt === undefined ? {} : { encrypt: attribute.encrypt }),
        ...(attribute.format === undefined ? {} : { format: attribute.format }),
      })),
      indexes: indexes.map((index) => ({
        id: index.key, type: index.type.toLowerCase(), attributes: [...index.attributes],
        ...(index.orders === undefined ? {} : { orders: [...index.orders] }),
        ...(index.lengths === undefined ? {} : { lengths: [...index.lengths] }),
      })),
    });
  }
  return { database: { id: database.$id, name: database.name }, collections };
}
