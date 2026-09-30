import type { AppwriteInventory } from './inspect.ts';
import type { InventoryAttribute, InventoryIndex } from './inspect.ts';
import { REMOTE_MANAGEMENT_SCHEMA } from './schema.ts';
import type { RemoteManagementSchema, SchemaAttribute, SchemaIndex } from './schema.ts';

export type ProvisionAction = {
  readonly resource: 'database' | 'collection' | 'attribute' | 'index';
  readonly id: string;
  readonly outcome: 'create' | 'unchanged' | 'conflict';
  readonly reason?: 'definition_mismatch' | 'duplicate_definition';
};
export type ProvisionPlan = { readonly actions: readonly ProvisionAction[] };

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((item, index) => item === sortedRight[index]);
}

function sameAttribute(actual: InventoryAttribute, desired: SchemaAttribute): boolean {
  if (actual.type !== desired.type || actual.required !== desired.required) return false;
  if ((actual.array ?? false) !== (desired.array ?? false)) return false;
  if ((actual.default ?? null) !== (desired.default ?? null)) return false;
  if (desired.type === 'string') {
    return actual.size === desired.size &&
      (actual.encrypt ?? false) === (desired.encrypt ?? false) &&
      sameFormat(actual.format, desired.format, desired.type);
  }
  if (desired.type === 'enum') {
    return actual.elements !== undefined && sameSet(actual.elements, desired.elements) &&
      sameFormat(actual.format, desired.format, desired.type);
  }
  if (desired.type === 'integer' || desired.type === 'float') {
    return (actual.min ?? null) === (desired.min ?? null) &&
      (actual.max ?? null) === (desired.max ?? null);
  }
  if (desired.type === 'datetime') return sameFormat(actual.format, desired.format, desired.type);
  return true;
}

function sameFormat(actual: string | null | undefined, desired: string | null | undefined, type: string): boolean {
  const normalize = (format: string | null | undefined) => {
    const value = format?.toLowerCase() ?? '';
    return value === type || value === '' ? null : value;
  };
  return normalize(actual) === normalize(desired);
}

function sameIndexAttributes(actual: InventoryIndex, desired: SchemaIndex): boolean {
  return actual.attributes.length === desired.attributes.length &&
    actual.attributes.every((item, index) => item === desired.attributes[index]);
}

function sameIndex(actual: InventoryIndex, desired: SchemaIndex): boolean {
  return actual.type === desired.type && sameIndexAttributes(actual, desired) &&
    (actual.orders === undefined || actual.orders.every((order) => order.toUpperCase() === 'ASC')) &&
    (actual.lengths === undefined || actual.lengths.every((length) => length === null));
}

function action(resource: ProvisionAction['resource'], id: string, outcome: ProvisionAction['outcome'], reason?: ProvisionAction['reason']): ProvisionAction {
  return reason ? { resource, id, outcome, reason } : { resource, id, outcome };
}

export function buildProvisionPlan(actual: AppwriteInventory, desired: RemoteManagementSchema = REMOTE_MANAGEMENT_SCHEMA): ProvisionPlan {
  const actions: ProvisionAction[] = [];
  const database = actual.database;
  actions.push(action('database', desired.database.id,
    !database ? 'create' : database.id === desired.database.id && database.name === desired.database.name ? 'unchanged' : 'conflict',
    database && (database.id !== desired.database.id || database.name !== desired.database.name) ? 'definition_mismatch' : undefined));

  for (const wanted of desired.collections) {
    const existing = actual.collections.find((item) => item.id === wanted.id);
    const compatible = existing && existing.name === wanted.name &&
      existing.documentSecurity === wanted.documentSecurity && sameSet(existing.permissions, wanted.permissions);
    actions.push(action('collection', wanted.id, !existing ? 'create' : compatible ? 'unchanged' : 'conflict',
      existing && !compatible ? 'definition_mismatch' : undefined));

    for (const attribute of wanted.attributes) {
      const id = `${wanted.id}/${attribute.key}`;
      const found = existing?.attributes.find((item) => item.key === attribute.key);
      const compatibleAttribute = found && sameAttribute(found, attribute);
      actions.push(action('attribute', id, !found ? 'create' : compatibleAttribute ? 'unchanged' : 'conflict',
        found && !compatibleAttribute ? 'definition_mismatch' : undefined));
    }
    for (const index of wanted.indexes) {
      const id = `${wanted.id}/${index.id}`;
      const found = existing?.indexes.find((item) => item.id === index.id);
      const duplicate = !found && existing?.indexes.some((item) => sameIndexAttributes(item, index));
      const compatibleIndex = found && sameIndex(found, index);
      actions.push(action('index', id,
        found ? compatibleIndex ? 'unchanged' : 'conflict' : duplicate ? 'conflict' : 'create',
        found && !compatibleIndex ? 'definition_mismatch' : duplicate ? 'duplicate_definition' : undefined));
    }
  }
  return { actions };
}
