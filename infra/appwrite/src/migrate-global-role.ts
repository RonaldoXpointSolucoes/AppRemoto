import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAppwriteGateway, readAppwriteEnvironment } from './appwrite-adapter.ts';
import type { AppwriteAttribute, GlobalRoleMigrationGateway } from './gateway.ts';
import { redactReport } from './redact.ts';
import { requireTargetProject } from './safety.ts';

const database = 'remote_management';
const collection = 'technician_profiles';
const key = 'global_role';
const failureMessage = 'Global role migration failed; inspect the target before retrying';

type WaitOptions = { readonly attempts?: number; readonly delayMs?: number };
type ValidWaitOptions = { readonly attempts: number; readonly delayMs: number };
type MigrationResult = { readonly outcome: 'updated' | 'unchanged' };
type MigrationReport = { readonly mode: 'migrate-global-role'; readonly status: 'completed' | 'failed';
  readonly outcome?: MigrationResult['outcome']; readonly error?: string };
type CliDependencies = { readonly gatewayFactory: (environment: NodeJS.ProcessEnv) => GlobalRoleMigrationGateway;
  readonly persist: (report: MigrationReport) => Promise<void> };

function isTargetEnum(attribute: AppwriteAttribute): boolean {
  return attribute.key === key && attribute.type === 'enum' && attribute.format === 'enum' &&
    attribute.elements?.length === 1 && attribute.elements[0] === 'super_admin' &&
    attribute.default === null && attribute.array === false && typeof attribute.required === 'boolean' &&
    attribute.size === undefined && attribute.min === undefined && attribute.max === undefined &&
    attribute.encrypt === undefined;
}

async function readTarget(gateway: GlobalRoleMigrationGateway): Promise<AppwriteAttribute> {
  const databases = await gateway.listDatabases();
  const foundDatabase = databases.filter((item) => item.$id === database);
  if (foundDatabase.length !== 1 || foundDatabase[0]!.name !== database) throw new Error();
  const collections = await gateway.listCollections(database);
  const foundCollection = collections.filter((item) => item.$id === collection);
  if (foundCollection.length !== 1 || foundCollection[0]!.name !== collection ||
      foundCollection[0]!.permissions.length !== 0 || foundCollection[0]!.documentSecurity !== false) throw new Error();
  const attributes = await gateway.listAttributes(database, collection);
  const foundAttribute = attributes.filter((item) => item.key === key);
  if (foundAttribute.length !== 1 || !isTargetEnum(foundAttribute[0]!)) throw new Error();
  return foundAttribute[0]!;
}

function validWaitOptions(options: WaitOptions): ValidWaitOptions {
  const attempts = options.attempts ?? 120;
  const delayMs = options.delayMs ?? 1000;
  if (!Number.isInteger(attempts) || attempts < 1 || !Number.isFinite(delayMs) || delayMs < 0) throw new Error();
  return { attempts, delayMs };
}

async function waitForAvailability(gateway: GlobalRoleMigrationGateway, options: ValidWaitOptions): Promise<void> {
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    const status = await gateway.getAttributeStatus(database, collection, key);
    if (status === 'available') return;
    if (status !== 'processing') break;
    if (attempt + 1 < options.attempts) await setTimeout(options.delayMs);
  }
  throw new Error();
}

export async function migrateGlobalRole(gateway: GlobalRoleMigrationGateway, options: WaitOptions = {}): Promise<MigrationResult> {
  try {
    requireTargetProject(gateway.projectId);
    const waitOptions = validWaitOptions(options);
    const before = await readTarget(gateway);
    if (!before.required) return { outcome: 'unchanged' };
    await gateway.updateGlobalRoleEnum();
    await waitForAvailability(gateway, waitOptions);
    const after = await readTarget(gateway);
    if (after.required) throw new Error();
    return { outcome: 'updated' };
  } catch {
    // SDK errors can carry private request details; do not retain the cause.
    throw new Error(failureMessage);
  }
}

async function persistReport(report: MigrationReport): Promise<void> {
  const directory = fileURLToPath(new URL('../../../.local/remote-platform/', import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `migration-global-role-${randomUUID()}.json`),
    JSON.stringify(redactReport(report), null, 2) + '\n', { flag: 'wx' });
}

export async function runGlobalRoleMigrationCli(args: string[], environment: NodeJS.ProcessEnv,
  dependencies: CliDependencies = { gatewayFactory: createAppwriteGateway, persist: persistReport }): Promise<MigrationReport> {
  let report: MigrationReport;
  try {
    if (args.length !== 0) throw new Error();
    readAppwriteEnvironment(environment);
    const result = await migrateGlobalRole(dependencies.gatewayFactory(environment));
    report = { mode: 'migrate-global-role', status: 'completed', outcome: result.outcome };
  } catch {
    report = { mode: 'migrate-global-role', status: 'failed', error: failureMessage };
  }
  const redacted = redactReport(report);
  try { await dependencies.persist(redacted); } catch {
    return { mode: 'migrate-global-role', status: 'failed', error: 'Local report persistence failed; inspect the target before retrying' };
  }
  return redacted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runGlobalRoleMigrationCli(process.argv.slice(2), process.env);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.status === 'completed' ? 0 : 1;
}
