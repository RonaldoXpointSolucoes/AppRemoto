import type { ProvisionAction, ProvisionPlan } from './plan.ts';
import { buildProvisionPlan } from './plan.ts';
import type { ProvisioningGateway } from './gateway.ts';
import { inspectSchema } from './inspect.ts';
import { REMOTE_MANAGEMENT_SCHEMA } from './schema.ts';
import { requireTargetProject } from './safety.ts';
import { setTimeout } from 'node:timers/promises';

export type WaitOptions = { readonly attempts?: number; readonly delayMs?: number };

type SafeConflict = Pick<ProvisionAction, 'resource' | 'id' | 'outcome' | 'reason'>;

export class ProvisionPlanConflictError extends Error {
  readonly conflicts: readonly SafeConflict[];

  constructor(plan: ProvisionPlan) {
    super('Provision plan has conflicts');
    this.conflicts = plan.actions.filter((action) => action.outcome === 'conflict').map(
      ({ resource, id, outcome, reason }) => ({ resource, id, outcome, ...(reason ? { reason } : {}) }));
  }
}

async function waitUntilAvailable(read: () => Promise<string>, options: WaitOptions): Promise<void> {
  const attempts = options.attempts ?? 120;
  const delayMs = options.delayMs ?? 1000;
  if (!Number.isInteger(attempts) || attempts < 1 || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error('Invalid readiness wait options');
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const status = await read();
    if (status === 'available') return;
    if (status !== 'processing') break;
    if (attempt + 1 < attempts) await setTimeout(delayMs);
  }
  throw new Error('Resources are not ready');
}

export async function applyProvisionPlan(gateway: ProvisioningGateway, plan: ProvisionPlan, options: WaitOptions = {}): Promise<ProvisionPlan> {
  requireTargetProject(gateway.projectId);
  if (plan.actions.some((action) => action.outcome === 'conflict')) throw new ProvisionPlanConflictError(plan);
  let current: ProvisionPlan;
  try {
    current = buildProvisionPlan(await inspectSchema(gateway));
  } catch {
    throw new Error('Provision inspection failed');
  }
  if (current.actions.some((action) => action.outcome === 'conflict')) throw new ProvisionPlanConflictError(current);
  const creates = new Set(current.actions.filter((action) => action.outcome === 'create').map((action) => `${action.resource}:${action.id}`));
  const schema = REMOTE_MANAGEMENT_SCHEMA;
  const db = schema.database.id;
  try {
    if (creates.has(`database:${db}`)) await gateway.createDatabase(schema.database);
    for (const collection of schema.collections) {
      if (creates.has(`collection:${collection.id}`)) await gateway.createCollection(db, collection);
    }
    for (const collection of schema.collections) {
      for (const attribute of collection.attributes) {
        if (creates.has(`attribute:${collection.id}/${attribute.key}`)) await gateway.createAttribute(db, collection.id, attribute);
      }
    }
    // Existing attributes may still be processing after an interrupted apply.
    for (const collection of schema.collections) {
      for (const attribute of collection.attributes) {
        await waitUntilAvailable(() => gateway.getAttributeStatus(db, collection.id, attribute.key), options);
      }
    }
    for (const collection of schema.collections) {
      for (const index of collection.indexes) {
        if (creates.has(`index:${collection.id}/${index.id}`)) await gateway.createIndex(db, collection.id, index);
      }
    }
    for (const collection of schema.collections) {
      for (const index of collection.indexes) {
        await waitUntilAvailable(() => gateway.getIndexStatus(db, collection.id, index.id), options);
      }
    }
  } catch {
    // SDK errors may include request payloads and credentials. Never attach a cause.
    throw new Error('Provision apply failed or resources are not ready; inspect and plan before retrying');
  }
  return current;
}
