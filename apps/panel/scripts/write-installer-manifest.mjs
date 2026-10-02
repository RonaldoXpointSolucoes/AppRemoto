import { readFileSync, writeFileSync } from 'node:fs';
import { artifactManifest, installerVersion } from './installer-artifacts.mjs';

const directory = new URL('../public/installers/', import.meta.url);
const filename = `xpoint-setup-${installerVersion}.exe`;
const bytes = readFileSync(new URL(filename, directory));
writeFileSync(new URL('manifest.json', directory), JSON.stringify(artifactManifest(bytes, filename)) + '\n');
console.log(`Installer manifest written (${bytes.length} bytes)`);
