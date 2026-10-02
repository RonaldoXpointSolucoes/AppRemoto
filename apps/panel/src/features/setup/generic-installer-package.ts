import { GenericInstallerPackageSchema, type GenericInstallerPackage } from '@appremoto/contracts';
import { z } from 'zod';

const CompleteManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  path: z.string().regex(/^\/installers\/xpoint-complete-\d+\.\d+\.\d+\.exe$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(2).max(64 * 1024 * 1024),
}).strict().refine((value) => value.path === `/installers/xpoint-complete-${value.version}.exe`);

export async function loadCompleteInstallerArtifact(fetcher: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  const metadata = await fetcher('/installers/complete-manifest.json', { cache: 'no-store', credentials: 'omit' });
  if (!metadata.ok) throw new Error('Installer unavailable');
  const manifest = CompleteManifestSchema.parse(await metadata.json());
  const response = await fetcher(manifest.path, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('Installer unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== manifest.bytes || bytes[0] !== 77 || bytes[1] !== 90) throw new Error('Installer integrity failed');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.sha256) throw new Error('Installer integrity failed');
  return bytes;
}

export function createGenericInstallerPackage(base: Uint8Array<ArrayBuffer>, input: GenericInstallerPackage): Blob {
  if (base[0] !== 77 || base[1] !== 90) throw new Error('Invalid installer');
  const config = GenericInstallerPackageSchema.parse(input);
  const json = new TextEncoder().encode(JSON.stringify(config));
  try {
    if (json.length > 16 * 1024) throw new Error('Invalid installation package');
    const size = new Uint8Array(4);
    new DataView(size.buffer).setUint32(0, json.length, true);
    return new Blob([base, json, size, new TextEncoder().encode('XPOINT_GENERIC_V1')], { type: 'application/octet-stream' });
  } finally { json.fill(0); config.installerToken = ''; }
}

export function downloadGenericInstaller(blob: Blob): () => void {
  const url = URL.createObjectURL(blob);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => { clearTimeout(timer); URL.revokeObjectURL(url); };
  try {
    const link = document.createElement('a');
    link.href = url; link.download = 'XPoint-Instalar-Completo.exe'; link.click();
    timer = setTimeout(release, 1000);
    return release;
  } catch (error) { release(); throw error; }
}
