import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const profiles = {
  'appremoto-production': {
    endpoint: 'https://appwrite.xpointsolucoes.com.br/v1', projectId: '6abc5640003cb361b809',
    databaseId: 'remote_management', bucketId: null,
    secretPath: path.join(root, '.local/appwrite-xpoint/appremoto-production-api-key.dpapi'),
  },
  'chatboot-production': {
    endpoint: 'https://appwrite-inwbueezn2gkpm4tqwvzkswy.179.199.142.157.sslip.io/v1', projectId: 'chatboot-production',
    databaseId: 'chatboot_db', bucketId: 'chatboot_media',
    secretPath: path.join(root, '.local/appwrite-xpoint/chatboot-production-api-key.dpapi'),
  },
};

function response(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function failure(id, error) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } })}\n`); }
function getProfile(name) { const profile = profiles[name]; if (!profile) throw new Error('Unknown Appwrite profile'); return profile; }

function readSecret(profile) {
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'unprotect-secret.ps1');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helper, '-Path', profile.secretPath], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error('Appwrite credential is unavailable for the current Windows user');
  const bytes = Buffer.from(result.stdout.trim(), 'base64');
  const secret = bytes.toString('utf8');
  bytes.fill(0);
  if (!secret) throw new Error('Appwrite credential is empty');
  return secret;
}

function buildUrl(profile, route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || route.includes('://')) {
    throw new Error('Appwrite path must be an absolute API path, not a URL');
  }
  return `${profile.endpoint}${route}`;
}

async function request(profileName, method, route, body) {
  const profile = getProfile(profileName);
  let secret = readSecret(profile);
  try {
    const headers = { 'X-Appwrite-Project': profile.projectId, 'X-Appwrite-Key': secret,
      'X-Appwrite-Response-Format': '1.8.0', Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const result = await fetch(buildUrl(profile, route), { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
    const text = await result.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: 'Non-JSON response withheld' }; }
    if (!result.ok) throw new Error(`Appwrite request failed with HTTP ${result.status}`);
    return { status: result.status, data: payload };
  } finally { secret = ''; }
}

const tools = [
  { name: 'list_appwrite_profiles', description: 'List configured Appwrite profiles and public identifiers. Never returns credentials.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'appwrite_get', description: 'Perform a read-only GET against one configured Appwrite REST API profile.',
    inputSchema: { type: 'object', properties: { profile: { type: 'string', enum: Object.keys(profiles) }, path: { type: 'string' } },
      required: ['profile', 'path'] } },
  { name: 'appwrite_mutate', description: 'Perform an explicitly authorized Appwrite POST, PATCH, PUT, or DELETE. Requires confirmed=true.',
    inputSchema: { type: 'object', properties: { profile: { type: 'string', enum: Object.keys(profiles) },
      method: { type: 'string', enum: ['POST', 'PATCH', 'PUT', 'DELETE'] }, path: { type: 'string' }, body: { type: 'object' },
      confirmed: { const: true } }, required: ['profile', 'method', 'path', 'confirmed'] } },
];

async function callTool(name, args = {}) {
  if (name === 'list_appwrite_profiles') return Object.entries(profiles).map(([id, value]) => ({ id, endpoint: value.endpoint,
    projectId: value.projectId, databaseId: value.databaseId, bucketId: value.bucketId }));
  if (name === 'appwrite_get') return request(args.profile, 'GET', args.path);
  if (name === 'appwrite_mutate') {
    if (args.confirmed !== true) throw new Error('Mutation requires confirmed=true after explicit user authorization');
    return request(args.profile, args.method, args.path, args.body);
  }
  throw new Error('Unknown tool');
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  try {
    if (message.method === 'initialize') response(message.id, { protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'appwrite-xpoint', version: '1.0.0' } });
    else if (message.method === 'tools/list') response(message.id, { tools });
    else if (message.method === 'tools/call') response(message.id, { content: [{ type: 'text',
      text: JSON.stringify(await callTool(message.params?.name, message.params?.arguments)) }], isError: false });
    else failure(message.id, new Error('Method not found'));
  } catch (error) { failure(message.id, error instanceof Error ? error : new Error('Appwrite MCP failure')); }
});
