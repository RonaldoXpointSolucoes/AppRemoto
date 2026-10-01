import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const version = '1.0.2';
const directory = new URL('../public/installers/', import.meta.url);
const filename = `xpoint-setup-${version}.exe`;
const bytes = readFileSync(new URL(filename, directory));
if (bytes.length < 2 || bytes.length > 64 * 1024 * 1024 || bytes[0] !== 77 || bytes[1] !== 90) throw new Error('Invalid Windows installer artifact');
writeFileSync(new URL('manifest.json', directory), JSON.stringify({
  version, path: `/installers/${filename}`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
}) + '\n');
console.log(`Installer manifest written (${bytes.length} bytes)`);
