import type { QueryClient } from '@tanstack/react-query';
import { clearSetupProgress } from '../../lib/setup-progress';
import { clearSessionJwts } from '../../lib/session-jwt';

interface SessionScope {
  epoch: number;
  listeners?: Set<() => void>;
  removing?: Promise<void>;
  loggingOut?: Promise<boolean>;
}

const scopes = new WeakMap<QueryClient, SessionScope>();
const VERIFIED_SESSION_STORAGE_KEY = 'xpoint_verified_session_ts';
let lastVerifiedAtMemory = 0;

export function markSessionVerified(): void {
  const now = Date.now();
  lastVerifiedAtMemory = now;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(VERIFIED_SESSION_STORAGE_KEY, String(now));
    } catch {
      // Ignore storage quota/privacy errors
    }
  }
}

export function clearVerifiedSessionBootstrap(): void {
  lastVerifiedAtMemory = 0;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(VERIFIED_SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}

export function hasVerifiedSessionBootstrap(maxAgeMs = 180_000): boolean {
  const now = Date.now();
  if (lastVerifiedAtMemory > 0 && now - lastVerifiedAtMemory < maxAgeMs) {
    return true;
  }
  if (typeof window !== 'undefined') {
    try {
      const raw = window.sessionStorage.getItem(VERIFIED_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0 && now - parsed < maxAgeMs) {
          lastVerifiedAtMemory = parsed;
          return true;
        }
      }
    } catch {
      // Ignore storage errors
    }
  }
  return false;
}

function scope(client: QueryClient): SessionScope {
  let current = scopes.get(client);
  if (!current) {
    current = { epoch: 0 };
    scopes.set(client, current);
  }
  return current;
}

export function sessionEpoch(client: QueryClient): number {
  return scope(client).epoch;
}

// Ephemeral handoff data lives outside the query cache and must be erased too.
export function onSessionClear(client: QueryClient, listener: () => void): () => void {
  const listeners = scope(client).listeners ??= new Set();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function clearSession(client: QueryClient): number {
  const next = ++scope(client).epoch;
  clearVerifiedSessionBootstrap();
  for (const listener of scope(client).listeners ?? []) {
    // A failed UI cleanup must not prevent cache and credential invalidation.
    try { listener(); } catch { /* Continue invalidating the remaining session state. */ }
  }
  clearSessionJwts();
  // clear destroys and cancels queries synchronously, before another identity can mount.
  client.clear();
  clearSetupProgress();
  return next;
}

export async function beginSession(client: QueryClient): Promise<number> {
  await scope(client).removing;
  await scope(client).loggingOut;
  return clearSession(client);
}

export function logoutSession(
  client: QueryClient, expectedEpoch: number, remove: () => Promise<void>,
): Promise<boolean> {
  const current = scope(client);
  if (current.epoch !== expectedEpoch) return Promise.resolve(false);
  if (current.loggingOut) return current.loggingOut;

  let deletion: Promise<void>;
  try {
    deletion = remove();
  } catch (error) {
    deletion = Promise.reject(error);
  }
  const loggingOut = deletion.then(() => {
    if (current.epoch !== expectedEpoch) return false;
    clearSession(client);
    return true;
  }, () => false).finally(() => {
    if (current.loggingOut === loggingOut) current.loggingOut = undefined;
  });
  current.loggingOut = loggingOut;
  return loggingOut;
}

export async function expireSession(
  client: QueryClient, expectedEpoch: number, remove: () => Promise<void>,
): Promise<boolean> {
  const current = scope(client);
  if (current.epoch !== expectedEpoch) return false;
  if (current.loggingOut) return current.loggingOut;
  const expiredEpoch = clearSession(client);
  const removing = Promise.resolve().then(remove).catch(() => undefined);
  current.removing = removing;
  await removing;
  if (current.removing === removing) current.removing = undefined;
  return current.epoch === expiredEpoch;
}
