import { describe, expect, it, vi } from 'vitest';
import { createInstallerPackage, loadInstallerArtifact } from './installer-package';

const config = { schemaVersion: 1 as const, enrollmentId: 'enroll-test', enrollmentToken: 'a'.repeat(43),
  expiresAt: '2026-10-01T18:00:00.000Z', organizationId: 'customer-a', deviceDisplayName: 'Recepção "01"' };

describe('native installation package', () => {
  it('appends an exact bounded UTF-8 overlay while preserving the executable', async () => {
    const base = new Uint8Array([77, 90, 1, 2, 3]);
    const bytes = new Uint8Array(await createInstallerPackage(base, config).arrayBuffer());
    const magic = new TextEncoder().encode('XPOINT_SETUP_V1');
    expect(bytes.slice(0, base.length)).toEqual(base);
    expect(bytes.slice(-magic.length)).toEqual(magic);
    const size = new DataView(bytes.buffer).getUint32(bytes.length - magic.length - 4, true);
    expect(JSON.parse(new TextDecoder().decode(bytes.slice(base.length, base.length + size)))).toEqual(config);
  });
  it('rejects unsupported versions, executable substitutions and oversized names', () => {
    expect(() => createInstallerPackage(new Uint8Array([0]), config)).toThrow();
    expect(() => createInstallerPackage(new Uint8Array([77, 90]), { ...config, schemaVersion: 2 } as never)).toThrow();
    expect(() => createInstallerPackage(new Uint8Array([77, 90]), { ...config, deviceDisplayName: 'x'.repeat(129) })).toThrow();
  });
  it('rejects manifests that point outside the approved artifact directory before downloading a token package', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: '1.0.0', path: 'https://untrusted.invalid/program.exe', sha256: '0'.repeat(64), bytes: 10 })));
    await expect(loadInstallerArtifact(fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a mismatching executable hash', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: '1.0.0', path: '/installers/xpoint-setup-1.0.0.exe', sha256: '0'.repeat(64), bytes: 2 })))
      .mockResolvedValueOnce(new Response(new Uint8Array([77, 90])));
    await expect(loadInstallerArtifact(fetcher)).rejects.toThrow();
  });
});
