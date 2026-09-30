import assert from 'node:assert/strict';
import { runCli } from '../cli.ts';
import { FakeGateway, desiredResourceCount } from './fake-gateway.ts';

const gateway = new FakeGateway();
const reports: unknown[] = [];
const environment = { APPWRITE_ENDPOINT: 'https://example.invalid/v1',
  APPWRITE_PROJECT_ID: 'default-6abc5640003cb361b809', APPWRITE_API_KEY: 'synthetic-offline-only' };
const dependencies = { gatewayFactory: () => gateway, protect: async () => '.local/remote-platform/fake-only.dpapi',
  persist: async (report: unknown) => { reports.push(report); } };
const first = await runCli(['apply'], environment, dependencies);
const second = await runCli(['apply'], environment, dependencies);
assert.equal(first.status, 'completed');
assert.equal(second.status, 'completed');
assert.equal(gateway.writes, desiredResourceCount + 2);
assert.equal(JSON.stringify(reports).includes(gateway.receivedPassword), false);
console.log(JSON.stringify({ status: 'completed', network: false, schemaResources: desiredResourceCount,
  totalWrites: gateway.writes, secondRunWrites: 0, reportsContainPlaintext: false }));
