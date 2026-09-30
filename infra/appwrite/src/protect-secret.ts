import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function protectSecret(password: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Administrator secret protection requires Windows DPAPI');
  const script = fileURLToPath(new URL('../scripts/protect-secret.ps1', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const fail = () => reject(new Error('DPAPI secret protection failed'));
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stderr.resume();
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 1024) { child.kill(); fail(); }
    });
    child.on('close', (code) => {
      const path = output.trim();
      if (code !== 0 || !/^\.local\/remote-platform\/bootstrap-[0-9a-f-]{36}\.dpapi$/.test(path)) fail();
      else resolve(path);
    });
    child.stdin.end(password, 'utf8');
  });
}
