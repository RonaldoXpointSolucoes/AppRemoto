import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = new URL('../public/installers/', import.meta.url);
mkdirSync(directory, { recursive: true });
const result = spawnSync(process.env.GO_BINARY || 'go', ['build', '-trimpath', '-ldflags=-s -w -H=windowsgui', '-o', fileURLToPath(new URL('xpoint-setup-1.0.0.exe', directory)), './cmd/remote-setup'], {
  cwd: new URL('../../../services/agent/', import.meta.url),
  env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' }, stdio: 'inherit',
});
if (result.error || result.status !== 0) throw new Error('Windows installer compilation failed');
await import('./write-installer-manifest.mjs');
