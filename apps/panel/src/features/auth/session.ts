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
  createGoogleSession?(email?: string, inviteToken?: string): Promise<void>;
  activateInviteSession?(input: {
    email: string;
    password: string;
    displayName?: string;
    inviteToken?: string;
  }): Promise<void>;
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
  return (error instanceof AppwriteException && error.code === 401)
    || (error instanceof ApiClientError && error.status === 401 && error.code === 'INVALID_CREDENTIALS');
}

export function isDisabledProfile(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 403 && (
    error.code === 'TECHNICIAN_DISABLED' || error.code === 'TECHNICIAN_NOT_AUTHORIZED'
  );
}

async function postPublicAuthEndpoint(
  baseUrl: string,
  path: string,
  payload: Record<string, unknown>
): Promise<{ userId: string; secret: string }> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const reqInit: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  };
  let response: Response;
  try {
    response = await fetch(`${cleanBase}${path}`, reqInit);
  } catch {
    if (
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:' &&
      cleanBase.includes('.sslip.io')
    ) {
      try {
        response = await fetch(`${window.location.origin}${path}`, reqInit);
      } catch {
        throw new ApiClientError({
          code: 'NETWORK_ERROR',
          message: 'Não foi possível conectar ao servidor de autenticação.',
          status: 0,
        });
      }
    } else {
      throw new ApiClientError({
        code: 'NETWORK_ERROR',
        message: 'Não foi possível conectar ao servidor de autenticação.',
        status: 0,
      });
    }
  }

  const data = (await response.json().catch(() => null)) as
    | { userId?: string; secret?: string; error?: { code?: string; message?: string } }
    | null;

  if (!response.ok || !data?.userId || !data?.secret) {
    throw new ApiClientError({
      code: data?.error?.code || 'AUTH_FAILED',
      message: data?.error?.message || 'Não foi possível autenticar este acesso.',
      status: response.status || 500,
    });
  }

  return { userId: data.userId, secret: data.secret };
}

export function createLoginService(): LoginService {
  const config = getPublicConfig();
  const { account, getJwt } = createAppwriteSessionClient(config);
  const api = createApiClient({
    baseUrl: config.apiBaseUrl,
    getJwt,
  });

  return {
    createSession: async (email, password) => {
      try {
        await account.createEmailPasswordSession(email, password);
      } catch (err) {
        if (err instanceof AppwriteException && err.code === 401 && password.length >= 8) {
          try {
            const token = await postPublicAuthEndpoint(config.apiBaseUrl, '/v1/auth/activate-invite', {
              email,
              password,
              requireUnconfiguredOrToken: true,
            });
            try {
              await account.deleteSession('current');
            } catch {
              // Ignore if no previous session exists
            }
            await account.createSession(token.userId, token.secret);
            return;
          } catch {
            throw err;
          }
        }
        throw err;
      }
    },
    createGoogleSession: async (email, inviteToken) => {
      const normalized = (email || '').trim().toLowerCase();
      if (!normalized) {
        throw new ApiClientError({
          code: 'INVALID_EMAIL',
          message: 'Informe seu e-mail liberado na lista de Técnicos para continuar com o Google.',
          status: 400,
        });
      }
      const token = await postPublicAuthEndpoint(config.apiBaseUrl, '/v1/auth/google-session', {
        email: normalized,
        ...(inviteToken ? { inviteToken } : {}),
      });
      try {
        await account.deleteSession('current');
      } catch {
        // Ignore if no previous session exists
      }
      await account.createSession(token.userId, token.secret);
    },
    activateInviteSession: async ({ email, password, displayName, inviteToken }) => {
      const token = await postPublicAuthEndpoint(config.apiBaseUrl, '/v1/auth/activate-invite', {
        email: email.trim().toLowerCase(),
        password,
        ...(displayName ? { displayName } : {}),
        ...(inviteToken ? { inviteToken } : {}),
      });
      try {
        await account.deleteSession('current');
      } catch {
        // Ignore if no previous session exists
      }
      await account.createSession(token.userId, token.secret);
    },
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
