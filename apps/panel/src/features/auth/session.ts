'use client';

import { AppwriteException } from 'appwrite';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createApiClient, ApiClientError } from '../../lib/api';
import { createAppwriteSessionClient } from '../../lib/appwrite';
import { getPublicConfig } from '../../lib/config';
import { expireSession, sessionEpoch } from './session-cache';

export interface LoginService {
  createSession(email: string, password: string): Promise<void>;
  verifyProfile(): Promise<void>;
  removeSession(): Promise<void>;
}

export type SessionState =
  | { status: 'checking' }
  | { status: 'authenticated' }
  | { status: 'expired' }
  | { status: 'recoverable-error'; message: string };

export function isExpiredSession(error: unknown): boolean {
  return (error instanceof AppwriteException && error.code === 401)
    || (error instanceof ApiClientError && error.status === 401);
}

function isTerminalSession(error: unknown): boolean {
  return isExpiredSession(error) || isDisabledProfile(error);
}

export function isInvalidCredentials(error: unknown): boolean {
  return error instanceof AppwriteException && error.code === 401;
}

export function isDisabledProfile(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 403 && error.code === 'TECHNICIAN_DISABLED';
}

export function createLoginService(): LoginService {
  const config = getPublicConfig();
  const { account } = createAppwriteSessionClient(config);
  const api = createApiClient({
    baseUrl: config.apiBaseUrl,
    getJwt: async () => (await account.createJWT()).jwt,
  });

  return {
    createSession: async (email, password) => { await account.createEmailPasswordSession(email, password); },
    verifyProfile: async () => { await api.getMe(); },
    removeSession: async () => { await account.deleteSession('current'); },
  };
}

export async function checkSession(service: LoginService, expire?: () => Promise<boolean>): Promise<SessionState> {
  try {
    await service.verifyProfile();
    return { status: 'authenticated' };
  } catch (error) {
    if (!isTerminalSession(error)) {
      return { status: 'recoverable-error', message: 'Nao foi possivel verificar sua sessao.' };
    }
    if (expire) {
      if (!await expire()) return { status: 'checking' };
    } else {
      try { await service.removeSession(); } catch { /* The local session is already unusable. */ }
    }
    return { status: 'expired' };
  }
}

export function useSessionBoundary(serviceOverride?: LoginService) {
  const queryClient = useQueryClient();
  const service = useMemo(() => serviceOverride ?? createLoginService(), [serviceOverride]);
  const [state, setState] = useState<SessionState>({ status: 'checking' });
  const started = useRef(false);

  const verify = useCallback(async () => {
    const epoch = sessionEpoch(queryClient);
    setState({ status: 'checking' });
    setState(await checkSession(service, () => expireSession(queryClient, epoch, () => service.removeSession())));
  }, [queryClient, service]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void verify();
  }, [verify]);

  return { state, retry: verify };
}
