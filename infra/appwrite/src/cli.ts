import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAppwriteGateway, readAppwriteEnvironment } from './appwrite-adapter.ts';
import { applyProvisionPlan } from './apply.ts';
import { bootstrapAdministrator } from './bootstrap-admin.ts';
import type { ProtectSecret } from './bootstrap-admin.ts';
import type { AdministratorGateway, ProvisioningGateway } from './gateway.ts';
import { inspectSchema } from './inspect.ts';
import type { AppwriteInventory } from './inspect.ts';
import { buildProvisionPlan } from './plan.ts';
import { protectSecret } from './protect-secret.ts';
import { redactReport } from './redact.ts';

type CliReport = { mode: string; status: 'completed' | 'failed'; result?: unknown; error?: string };
type Dependencies = {
  gatewayFactory: (env: NodeJS.ProcessEnv) => ProvisioningGateway & AdministratorGateway;
  protect: ProtectSecret;
  persist: (report: CliReport) => Promise<void>;
};

function projectInventoryReport(inventory: AppwriteInventory) {
  return { ...inventory, collections: inventory.collections.map((collection) => ({
    ...collection,
    attributes: collection.attributes.map(({ key, default: defaultValue, ...definition }) => ({
      attributeId: key, ...definition,
      // Defaults are data, and can contain private values even in schema metadata.
      ...(defaultValue === undefined ? {} : { default: defaultValue === null ? null : '[REDACTED]' }),
    })),
  })) };
}

async function persistReport(report: CliReport): Promise<void> {
  const directory = fileURLToPath(new URL('../../../.local/remote-platform/', import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `apply-${randomUUID()}.json`), JSON.stringify(redactReport(report), null, 2) + '\n', { flag: 'wx' });
}

export async function runCli(args: string[], env: NodeJS.ProcessEnv, dependencies: Dependencies = {
  gatewayFactory: createAppwriteGateway, protect: protectSecret, persist: persistReport,
}): Promise<CliReport> {
  let mode = 'invalid';
  let report: CliReport;
  try {
    if (args.length !== 1 || !['inspect', 'plan', 'apply'].includes(args[0]!)) throw new Error();
    mode = args[0]!;
    readAppwriteEnvironment(env);
    const gateway = dependencies.gatewayFactory(env);
    const inventory = await inspectSchema(gateway);
    if (mode === 'inspect') return redactReport({ mode, status: 'completed', result: projectInventoryReport(inventory) });
    const plan = buildProvisionPlan(inventory);
    if (mode === 'plan') return redactReport({ mode, status: 'completed', result: plan });
    const applied = await applyProvisionPlan(gateway, plan);
    const administrator = await bootstrapAdministrator(gateway, dependencies.protect);
    report = { mode, status: 'completed', result: { plan: applied, administrator } };
  } catch {
    report = { mode, status: 'failed', error: 'Provisioning command failed; verify configuration and inspect the target before retrying' };
  }
  const redacted = redactReport(report);
  if (mode === 'apply') {
    try { await dependencies.persist(redacted); } catch {
      return { mode, status: 'failed', error: 'Local report persistence failed; inspect the target before retrying' };
    }
  }
  return redacted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runCli(process.argv.slice(2), process.env);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.status === 'completed' ? 0 : 1;
}
