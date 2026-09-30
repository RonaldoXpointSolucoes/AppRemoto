import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { protectSecret } from './protect-secret.ts';

test('DPAPI helper persists only ciphertext under local root and CurrentUser can decrypt', { skip: process.platform !== 'win32' }, async () => {
  const secret = randomBytes(16).toString('hex');
  const artifact = await protectSecret(secret);
  assert.match(artifact, /^\.local\/remote-platform\/bootstrap-[0-9a-f-]+\.dpapi$/);
  const path = fileURLToPath(new URL('../../../' + artifact, import.meta.url));
  try {
    const encrypted = await readFile(path);
    assert.equal(encrypted.includes(Buffer.from(secret)), false);
    const verified = await new Promise<boolean>((resolve, reject) => {
      const script = "Add-Type -AssemblyName System.Security; $data = [Console]::In.ReadToEnd() | ConvertFrom-Json; $bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($data.encrypted), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes) -ceq $data.expected)";
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.resume();
      child.on('error', reject);
      child.on('close', (code) => resolve(code === 0 && output === 'True'));
      child.stdin.end(JSON.stringify({ encrypted: encrypted.toString('base64'), expected: secret }));
    });
    assert.equal(verified, true);
  } finally { await unlink(path); }
});

test('DPAPI rejects malformed input without exposing input in exceptions', { skip: process.platform !== 'win32' }, async () => {
  const invalid = 'synthetic-invalid-input';
  await assert.rejects(protectSecret(invalid), (error: Error) => {
    assert.equal((String(error) + JSON.stringify(error)).includes(invalid), false);
    return true;
  });
});
