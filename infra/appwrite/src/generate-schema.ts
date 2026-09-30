import { readFileSync, writeFileSync } from 'node:fs';
import { REMOTE_MANAGEMENT_SCHEMA, renderSchemaMarkdown } from './schema.ts';

const target = new URL('../schema.md', import.meta.url);
const expected = renderSchemaMarkdown(REMOTE_MANAGEMENT_SCHEMA);

if (process.argv[2] === '--write') {
  writeFileSync(target, expected, 'utf8');
} else if (process.argv[2] === '--check') {
  if (readFileSync(target, 'utf8') !== expected) {
    throw new Error('schema.md is stale; run pnpm --filter @appremoto/appwrite schema:write');
  }
} else {
  throw new Error('Expected --write or --check');
}
