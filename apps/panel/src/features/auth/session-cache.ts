import type { QueryClient } from '@tanstack/react-query';

interface SessionScope {
  epoch: number;
  removing?: Promise<void>;
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
  // clear destroys and cancels queries synchronously, before another identity can mount.
  client.clear();
  return next;
}

export async function beginSession(client: QueryClient): Promise<number> {
  await scope(client).removing;
  return clearSession(client);
}

export async function expireSession(
  client: QueryClient, expectedEpoch: number, remove: () => Promise<void>,
): Promise<boolean> {
  const current = scope(client);
  if (current.epoch !== expectedEpoch) return false;
  const expiredEpoch = clearSession(client);
  const removing = Promise.resolve().then(remove).catch(() => undefined);
  current.removing = removing;
  await removing;
  if (current.removing === removing) current.removing = undefined;
  return current.epoch === expiredEpoch;
}
