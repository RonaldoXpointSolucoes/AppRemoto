'use client';

import 'client-only';
import { Account, AppwriteException, Client } from 'appwrite';

import { getPublicConfig, type PublicConfig } from './config';
import {
  clearPanelSessionJwt,
  createSessionJwtGetter,
  readPanelSessionJwt,
  type SessionJwtGetter,
} from './session-jwt';

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

export function clearAppwriteCookieFallback(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem('cookieFallback');
  } catch {
    // Ignore storage errors
  }
}

export async function deleteCurrentSessionSafely(
  account: Pick<Account, 'deleteSession'>,
  timeoutMs = 1_800
): Promise<void> {
  clearPanelSessionJwt();
  try {
    await withPromiseTimeout(account.deleteSession('current'), timeoutMs, 'Session deletion timed out');
  } catch {
    // Local or remote session is already unusable or unreachable; never block navigation.
  } finally {
    clearAppwriteCookieFallback();
  }
}

export function createAppwriteSessionClient(
  config: PublicConfig = getPublicConfig()
): AppwriteSessionClient {
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId);

  const account = new Account(client);
  const getJwt = createSessionJwtGetter(
    JSON.stringify([config.appwriteEndpoint, config.appwriteProjectId]),
    async () => {
      const panelJwt = readPanelSessionJwt();
      if (panelJwt) {
        return { jwt: panelJwt };
      }
      if (typeof window !== 'undefined') {
        try {
          const fallback = window.localStorage.getItem('cookieFallback');
          const hasCookieFallback =
            Boolean(fallback) && fallback !== '{}' && fallback !== '[]' && fallback !== 'null';
          const hasSessionCookie =
            typeof document !== 'undefined' && document.cookie.includes('a_session_');
          if (!hasCookieFallback && !hasSessionCookie) {
            throw new AppwriteException('No active session', 401, 'user_unauthorized');
          }
        } catch (err) {
          if (err instanceof AppwriteException) throw err;
        }
      }
      try {
        return await withPromiseTimeout(account.createJWT(), 2_800, 'JWT creation timed out');
      } catch (firstError) {
        if (firstError instanceof AppwriteException) {
          throw firstError;
        }
        throw new AppwriteException('Session expired or unreachable', 401, 'user_unauthorized');
      }
    }
  );
  return { client, account, getJwt };
}
