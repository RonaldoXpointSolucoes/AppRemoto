import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactManifest, assembleInstaller, installerVersion, rustDesk, verifyRustDesk } from './installer-artifacts.mjs';

const directory = new URL('../public/installers/', import.meta.url);
mkdirSync(directory, { recursive: true });
const cached = process.env.RUSTDESK_INSTALLER_FILE || fileURLToPath(new URL(`../../../.local/installer-cache/rustdesk-${rustDesk.version}-x86_64.exe`, import.meta.url));

async function downloadPayload() {
  let url = new URL(rustDesk.url);
  const allowed = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
  const signal = AbortSignal.timeout(120_000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (url.protocol !== 'https:' || !allowed.has(url.hostname) || url.username || url.password) throw new Error('Invalid RustDesk release destination');
    const response = await fetch(url, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Invalid RustDesk release redirect');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`RustDesk release download failed (${response.status})`);
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > rustDesk.bytes) throw new Error('RustDesk release exceeds pinned size');
      chunks.push(Buffer.from(chunk));
    }
    const payload = Buffer.concat(chunks);
    verifyRustDesk(payload);
    return payload;
  }
  throw new Error('Too many RustDesk release redirects');
}

let payload;
if (existsSync(cached)) {
  payload = readFileSync(cached);
  verifyRustDesk(payload);
} else {
  if (process.env.RUSTDESK_INSTALLER_FILE) throw new Error('Configured RustDesk installer file is missing');
  payload = await downloadPayload();
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, payload, { flag: 'wx' });
}
const baseName = `xpoint-setup-${installerVersion}.exe`;
const completeName = `xpoint-complete-${installerVersion}.exe`;
const complete = assembleInstaller(readFileSync(new URL(baseName, directory)), payload);
writeFileSync(new URL(completeName, directory), complete);
writeFileSync(new URL('complete-manifest.json', directory), JSON.stringify(artifactManifest(complete, completeName)) + '\n');
await import('./write-installer-manifest.mjs');
console.log(`Complete Windows installer verified (${complete.length} bytes; RustDesk ${rustDesk.version})`);
