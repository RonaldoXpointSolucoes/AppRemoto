import { cpSync, existsSync } from 'node:fs';

cpSync(new URL('../.next/static', import.meta.url), new URL('../.next/standalone/apps/panel/.next/static', import.meta.url), { recursive: true });
if (existsSync(new URL('../public', import.meta.url))) cpSync(new URL('../public', import.meta.url), new URL('../.next/standalone/apps/panel/public', import.meta.url), { recursive: true });
process.env.PORT = '3100';
process.env.HOSTNAME = '127.0.0.1';
await import('../.next/standalone/apps/panel/server.js');
