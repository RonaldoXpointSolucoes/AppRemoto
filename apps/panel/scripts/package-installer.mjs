import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactManifest, assembleInstaller, installerVersion, rustDesk, rustDeskX86, verifyRustDesk } from './installer-artifacts.mjs';

const directory = new URL('../public/installers/', import.meta.url);
mkdirSync(directory, { recursive: true });

async function downloadPayload(spec) {
  let url = new URL(spec.url);
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
      if (length > spec.bytes) throw new Error('RustDesk release exceeds pinned size');
      chunks.push(Buffer.from(chunk));
    }
    const payload = Buffer.concat(chunks);
    verifyRustDesk(payload, spec);
    return payload;
  }
  throw new Error('Too many RustDesk release redirects');
}

async function resolvePayload(spec, cacheFilename, envOverride) {
  const cached = envOverride || fileURLToPath(new URL(`../../../.local/installer-cache/${cacheFilename}`, import.meta.url));
  if (existsSync(cached)) {
    const payload = readFileSync(cached);
    verifyRustDesk(payload, spec);
    return payload;
  }
  if (envOverride) throw new Error('Configured RustDesk installer file is missing');
  const payload = await downloadPayload(spec);
  if (process.env.NO_INSTALLER_CACHE !== '1') {
    try {
      mkdirSync(dirname(cached), { recursive: true });
      writeFileSync(cached, payload, { flag: 'wx' });
    } catch {
      // Ignore cache write errors in constrained environments
    }
  }
  return payload;
}

const payload64 = await resolvePayload(rustDesk, `rustdesk-${rustDesk.version}-x86_64.exe`, process.env.RUSTDESK_INSTALLER_FILE);
const baseName64 = `xpoint-setup-${installerVersion}.exe`;
const completeName64 = `xpoint-complete-${installerVersion}.exe`;
const complete64 = assembleInstaller(readFileSync(new URL(baseName64, directory)), payload64, rustDesk);
writeFileSync(new URL(completeName64, directory), complete64);
writeFileSync(new URL('complete-manifest.json', directory), JSON.stringify(artifactManifest(complete64, completeName64)) + '\n');

const baseUrlX86 = new URL(`xpoint-setup-${installerVersion}-x86.exe`, directory);
if (existsSync(baseUrlX86)) {
  const payload32 = await resolvePayload(rustDeskX86, `rustdesk-${rustDeskX86.version}-x86-sciter.exe`, process.env.RUSTDESK_INSTALLER_X86_FILE);
  const completeName32 = `xpoint-complete-${installerVersion}-x86.exe`;
  const complete32 = assembleInstaller(readFileSync(baseUrlX86), payload32, rustDeskX86);
  writeFileSync(new URL(completeName32, directory), complete32);
  writeFileSync(new URL('complete-manifest-x86.json', directory), JSON.stringify(artifactManifest(complete32, completeName32)) + '\n');
  console.log(`Complete Windows 32-bit installer verified (${complete32.length} bytes; RustDesk ${rustDeskX86.version})`);
}

const baseUrlWin7 = new URL(`xpoint-setup-${installerVersion}-win7.exe`, directory);
if (existsSync(baseUrlWin7)) {
  const payloadWin7 = await resolvePayload(rustDeskX86, `rustdesk-${rustDeskX86.version}-x86-sciter.exe`, process.env.RUSTDESK_INSTALLER_X86_FILE);
  const completeNameWin7 = `xpoint-complete-${installerVersion}-win7.exe`;
  const completeWin7 = assembleInstaller(readFileSync(baseUrlWin7), payloadWin7, rustDeskX86);
  writeFileSync(new URL(completeNameWin7, directory), completeWin7);
  writeFileSync(new URL('complete-manifest-win7.json', directory), JSON.stringify(artifactManifest(completeWin7, completeNameWin7)) + '\n');
  console.log(`Complete Windows 7 installer verified (${completeWin7.length} bytes; RustDesk ${rustDeskX86.version})`);
}

await import('./write-installer-manifest.mjs');
console.log(`Complete Windows 64-bit installer verified (${complete64.length} bytes; RustDesk ${rustDesk.version})`);
