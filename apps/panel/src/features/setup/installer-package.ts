import { z } from 'zod';

const PackageConfigSchema = z.object({
  schemaVersion: z.literal(1),
  enrollmentId: z.string().min(1).max(36),
  enrollmentToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  expiresAt: z.iso.datetime({ offset: true }),
  organizationId: z.string().min(1).max(36),
  deviceDisplayName: z.string().trim().min(1).max(128),
}).strict();

export type InstallerPackageConfig = z.infer<typeof PackageConfigSchema>;

const ManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  path: z.string().regex(/^\/installers\/xpoint-setup-\d+\.\d+\.\d+\.exe$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(2).max(64 * 1024 * 1024),
}).strict();

export async function loadInstallerArtifact(fetcher: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  const metadata = await fetcher('/installers/manifest.json', { cache: 'no-store', credentials: 'omit' });
  if (!metadata.ok) throw new Error('Installer unavailable');
  const manifest = ManifestSchema.parse(await metadata.json());
  const response = await fetcher(manifest.path, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('Installer unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== manifest.bytes || bytes[0] !== 77 || bytes[1] !== 90) throw new Error('Installer integrity failed');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.sha256) throw new Error('Installer integrity failed');
  return bytes;
}

export function createInstallerPackage(base: Uint8Array<ArrayBuffer>, input: InstallerPackageConfig): Blob {
  if (base[0] !== 77 || base[1] !== 90) throw new Error('Invalid installer');
  const config = PackageConfigSchema.parse(input);
  const json = new TextEncoder().encode(JSON.stringify(config));
  if (json.length > 16 * 1024) throw new Error('Invalid installation package');
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, json.length, true);
  const magic = new TextEncoder().encode('XPOINT_SETUP_V1');
  return new Blob([base, json, length, magic], { type: 'application/octet-stream' });
}

export function downloadInstaller(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'XPoint-Instalar-Cliente.exe';
  anchor.click();
  // Allow the browser to take ownership of the download before releasing memory.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
