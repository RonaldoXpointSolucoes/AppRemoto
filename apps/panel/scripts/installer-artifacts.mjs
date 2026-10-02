import { createHash } from 'node:crypto';

export const installerVersion = '1.2.7';
export const rustDesk = Object.freeze({
  version: '1.4.9',
  bytes: 24472432,
  sha256: 'eaedeb0088e687bf46f7c46a9c6ea5493ce51f3134dfd6acbedb47b5b9136274',
  url: 'https://github.com/rustdesk/rustdesk/releases/download/1.4.9/rustdesk-1.4.9-x86_64.exe',
  source: 'https://github.com/rustdesk/rustdesk/tree/1.4.9',
});
export const bundleMarker = Buffer.from('XPOINT_BUNDLE_V1', 'ascii');

export function validateWindowsExecutable(bytes) {
  if (bytes.length < 2 || bytes.length > 64 * 1024 * 1024 || bytes[0] !== 77 || bytes[1] !== 90) {
    throw new Error('Invalid Windows installer artifact');
  }
}

export function verifyRustDesk(bytes) {
  validateWindowsExecutable(bytes);
  if (bytes.length !== rustDesk.bytes || createHash('sha256').update(bytes).digest('hex') !== rustDesk.sha256) {
    throw new Error('RustDesk installer integrity verification failed');
  }
}

export function assembleInstaller(base, payload) {
  validateWindowsExecutable(base);
  verifyRustDesk(payload);
  const footer = Buffer.alloc(16 + bundleMarker.length);
  footer.writeBigUInt64LE(BigInt(base.length), 0);
  footer.writeBigUInt64LE(BigInt(payload.length), 8);
  bundleMarker.copy(footer, 16);
  const result = Buffer.concat([base, payload, footer]);
  validateWindowsExecutable(result);
  return result;
}

export function artifactManifest(bytes, filename) {
  validateWindowsExecutable(bytes);
  return {
    version: installerVersion,
    path: `/installers/${filename}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  };
}
