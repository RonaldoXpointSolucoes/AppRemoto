import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installerVersion } from './installer-artifacts.mjs';

const directory = new URL('../public/installers/', import.meta.url);
const prebuiltDir = new URL('../../../services/agent/prebuilt/', import.meta.url);
const agentDir = fileURLToPath(new URL('../../../services/agent/', import.meta.url));
mkdirSync(directory, { recursive: true });
mkdirSync(prebuiltDir, { recursive: true });

const goBin = process.env.GO_BINARY || 'go';
const envRes = spawnSync(goBin, ['env', 'GOROOT'], { encoding: 'utf8' });
if (envRes.error || envRes.status !== 0) {
  throw new Error('Failed to determine GOROOT for Windows 7 compatibility overlay');
}
const goroot = envRes.stdout.trim();
const overlayConfigPath = join(agentDir, '_win7overlay', 'overlay.generated.json');
writeFileSync(
  overlayConfigPath,
  JSON.stringify(
    {
      Replace: {
        [join(goroot, 'src', 'runtime', 'os_windows.go')]: join(agentDir, '_win7overlay', 'os_windows.go'),
        [join(goroot, 'src', 'syscall', 'dll_windows.go')]: join(agentDir, '_win7overlay', 'dll_windows.go'),
        [join(goroot, 'src', 'internal', 'syscall', 'windows', 'zsyscall_windows.go')]: join(
          agentDir,
          '_win7overlay',
          'zsyscall_windows.go',
        ),
      },
    },
    null,
    2,
  ),
);

const targets = [
  { goarch: 'amd64', filename: `xpoint-setup-${installerVersion}.exe` },
  { goarch: '386', filename: `xpoint-setup-${installerVersion}-x86.exe` },
  { goarch: '386', filename: `xpoint-setup-${installerVersion}-win7.exe` },
];

try {
  for (const target of targets) {
    const outPath = fileURLToPath(new URL(target.filename, directory));
    const result = spawnSync(
      goBin,
      ['build', '-overlay', overlayConfigPath, '-trimpath', '-ldflags=-s -w -H=windowsgui', '-o', outPath, './cmd/remote-setup'],
      {
        cwd: agentDir,
        env: { ...process.env, GOOS: 'windows', GOARCH: target.goarch, CGO_ENABLED: '0' },
        stdio: 'inherit',
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error(`Windows installer compilation failed (${target.filename})`);
    }
    copyFileSync(outPath, fileURLToPath(new URL(target.filename, prebuiltDir)));
  }
} finally {
  rmSync(overlayConfigPath, { force: true });
}

await import('./package-installer.mjs');
