import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const readRootFile = (path) => readFileSync(new URL(path, root), 'utf8');

test('workspace includes each TypeScript package location', () => {
  const workspace = readRootFile('pnpm-workspace.yaml');
  for (const location of ['apps/*', 'packages/*', 'infra/*']) {
    assert.match(workspace, new RegExp(`^\\s*- ['\"]?${location.replace('*', '\\*')}['\"]?\\s*$`, 'm'));
  }
});

test('root package requires Node.js 24 and exposes workspace commands', () => {
  const manifest = JSON.parse(readRootFile('package.json'));
  assert.equal(manifest.engines.node, '>=24 <25');
  assert.equal(manifest.private, true);
  for (const command of ['lint', 'typecheck', 'test', 'build']) {
    assert.equal(typeof manifest.scripts?.[command], 'string', `missing ${command} script`);
    assert.ok(manifest.scripts[command].trim(), `empty ${command} script`);
  }
});

test('local private files stay outside Git', () => {
  assert.match(readRootFile('.gitignore'), /^\.local\/$/m);
});
