import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createGenericInstallerPackage, loadCompleteInstallerArtifact } from './generic-installer-package';

const config = { schemaVersion: 2 as const, installerId: 'installer-test', installerToken: 'a'.repeat(43) };
const base = new Uint8Array([77, 90, 1, 2, 3]);
const manifest = { version: '1.2.7', path: '/installers/xpoint-complete-1.2.7.exe',
  sha256: createHash('sha256').update(base).digest('hex'), bytes: base.length };

describe('complete installation package', () => {
  it('preserves the bundled executable and adds only the enrollment capability in a bounded V2 overlay', async () => {
    const bytes = new Uint8Array(await createGenericInstallerPackage(base, config).arrayBuffer());
    const magic = new TextEncoder().encode('XPOINT_GENERIC_V1');
    expect(bytes.slice(0, base.length)).toEqual(base);
    expect(bytes.slice(-magic.length)).toEqual(magic);
    const size = new DataView(bytes.buffer).getUint32(bytes.length - magic.length - 4, true);
    expect(bytes.length).toBe(base.length + size + 4 + magic.length);
    expect(JSON.parse(new TextDecoder().decode(bytes.slice(base.length, base.length + size)))).toEqual(config);
  });
  it.each([{ password: 'never-embed' }, { companyName: 'Client' }, { schemaVersion: 1 }, { installerToken: 'bad' }])('rejects malformed or over-scoped overlays: %j', (change) => {
    expect(() => createGenericInstallerPackage(base, { ...config, ...change } as never)).toThrow();
  });
  it('rejects executable substitutions', () => {
    expect(() => createGenericInstallerPackage(new Uint8Array([0]), config)).toThrow();
  });
  it.each([
    { path: 'https://untrusted.invalid/program.exe' },
    { path: '/installers/xpoint-setup-1.2.7.exe' },
    { version: '1.3.0' },
    { bytes: 64 * 1024 * 1024 + 1 },
  ])('rejects an unapproved manifest before downloading its executable: %j', async (change) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...manifest, ...change })));
    await expect(loadCompleteInstallerArtifact(fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('verifies size, executable signature and digest before returning a complete artifact', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(manifest))).mockResolvedValueOnce(new Response(base));
    expect(await loadCompleteInstallerArtifact(fetcher)).toEqual(base);
    expect(fetcher).toHaveBeenNthCalledWith(1, '/installers/complete-manifest.json', { cache: 'no-store', credentials: 'omit' });
    expect(fetcher).toHaveBeenNthCalledWith(2, manifest.path, { cache: 'no-store', credentials: 'omit' });
  });
  it('rejects a mismatching executable digest', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...manifest, sha256: '0'.repeat(64) }))).mockResolvedValueOnce(new Response(base));
    await expect(loadCompleteInstallerArtifact(fetcher)).rejects.toThrow();
  });
});
