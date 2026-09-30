import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
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

test('Docker context excludes private files and retains API build inputs', () => {
  const dockerignore = new URL('.dockerignore', root);
  const patterns = (existsSync(dockerignore) ? readRootFile('.dockerignore') : '').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const isExcluded = (file) => {
    const parts = file.split('/');
    const paths = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    return patterns.reduce((excluded, entry) => {
      const negated = entry.startsWith('!');
      const pattern = negated ? entry.slice(1) : entry;
      return paths.some((path) => posix.matchesGlob(path, pattern)) ? !negated : excluded;
    }, false);
  };

  for (const file of [
    '.local/fila-dev/credential.bin', '.env', '.env.production',
    'apps/api/.env.local', 'packages/contracts/.local/token.bin',
    '.git/config', 'node_modules/fastify/index.js', 'docs/design.md',
  ]) {
    assert.equal(isExcluded(file), true, `${file} must be excluded`);
  }

  for (const file of [
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'apps/api/Dockerfile', 'apps/api/package.json', 'apps/api/src/app.ts',
    'apps/panel/Dockerfile', 'apps/panel/package.json', 'apps/panel/src/app/layout.tsx',
    'packages/contracts/package.json', 'packages/contracts/src/index.ts',
  ]) {
    assert.equal(isExcluded(file), false, `${file} must be available to Docker`);
  }
});

test('panel production image runs its standalone server as non-root', () => {
  const dockerfile = readRootFile('apps/panel/Dockerfile');

  assert.match(dockerfile, /^ENV NODE_ENV=production$/m);
  assert.match(dockerfile, /^EXPOSE 3000$/m);
  assert.match(dockerfile, /^USER node\s*\r?\nCMD \["node", "apps\/panel\/server\.js"\]$/m);
});

test('API production image runs as non-root and exposes a native health check', () => {
  const dockerfile = readRootFile('apps/api/Dockerfile');

  assert.match(dockerfile, /^RUN apk add --no-cache curl$/m);
  assert.match(dockerfile, /^ENV NODE_ENV=production$/m);
  assert.match(dockerfile, /^EXPOSE 3000$/m);
  assert.match(dockerfile, /^HEALTHCHECK .*process\.env\.PORT.*\/health/m);
  assert.match(dockerfile, /^USER node\s*\r?\nCMD \["node", "--experimental-strip-types", "apps\/api\/src\/server\.ts"\]$/m);
});
