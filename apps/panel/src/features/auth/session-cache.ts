import type { QueryClient } from '@tanstack/react-query';
import { clearSetupProgress } from '../../lib/setup-progress';
import { clearSessionJwts } from '../../lib/session-jwt';

interface SessionScope {
  epoch: number;
  removing?: Promise<void>;
  loggingOut?: Promise<boolean>;
}

const scopes = new WeakMap<QueryClient, SessionScope>();

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

function clearSession(client: QueryClient): number {
  const next = ++scope(client).epoch;
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
