import { copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installerVersion } from './installer-artifacts.mjs';

const directory = new URL('../public/installers/', import.meta.url);
const prebuiltDir = new URL('../../../services/agent/prebuilt/', import.meta.url);
mkdirSync(directory, { recursive: true });
mkdirSync(prebuiltDir, { recursive: true });

const targets = [
  { goarch: 'amd64', filename: `xpoint-setup-${installerVersion}.exe` },
  { goarch: '386', filename: `xpoint-setup-${installerVersion}-x86.exe` },
];

for (const target of targets) {
  const outPath = fileURLToPath(new URL(target.filename, directory));
  const result = spawnSync(
    process.env.GO_BINARY || 'go',
    ['build', '-trimpath', '-ldflags=-s -w -H=windowsgui', '-o', outPath, './cmd/remote-setup'],
    {
      cwd: new URL('../../../services/agent/', import.meta.url),
      env: { ...process.env, GOOS: 'windows', GOARCH: target.goarch, CGO_ENABLED: '0' },
      stdio: 'inherit',
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`Windows installer compilation failed (${target.goarch})`);
  }
  copyFileSync(outPath, fileURLToPath(new URL(target.filename, prebuiltDir)));
}

await import('./package-installer.mjs');
