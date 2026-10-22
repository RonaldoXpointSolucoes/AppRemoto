'use client';

import 'client-only';
import { Account, Client } from 'appwrite';

import { getPublicConfig, type PublicConfig } from './config';
import { createSessionJwtGetter, type SessionJwtGetter } from './session-jwt';

export interface AppwriteSessionClient {
  client: Client;
  account: Account;
  getJwt: SessionJwtGetter;
}

function withPromiseTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function deleteCurrentSessionSafely(account: Pick<Account, 'deleteSession'>, timeoutMs = 2_500): Promise<void> {
  try {
    await withPromiseTimeout(account.deleteSession('current'), timeoutMs, 'Session deletion timed out');
  } catch {
    // Local or remote session is already unusable or unreachable; never block navigation.
  }
}

export function createAppwriteSessionClient(config: PublicConfig = getPublicConfig()): AppwriteSessionClient {
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId);

  const account = new Account(client);
  const getJwt = createSessionJwtGetter(
    JSON.stringify([config.appwriteEndpoint, config.appwriteProjectId]),
    async () => {
      try {
        return await withPromiseTimeout(account.createJWT(), 5_500, 'JWT creation timed out');
      } catch (firstError) {
        if (firstError instanceof Error && firstError.message === 'JWT creation timed out') {
          return await withPromiseTimeout(account.createJWT(), 3_500, 'JWT creation timed out');
        }
        throw firstError;
      }
    }
  );
  return { client, account, getJwt };
}
