'use client';

import { AppwriteException } from 'appwrite';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createApiClient, ApiClientError } from '../../lib/api';
import { createAppwriteSessionClient, deleteCurrentSessionSafely } from '../../lib/appwrite';
import { getPublicConfig } from '../../lib/config';
import {
  clearVerifiedSessionBootstrap,
  expireSession,
  hasVerifiedSessionBootstrap,
  markSessionVerified,
  sessionEpoch,
} from './session-cache';

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

export const SESSION_CHECK_TIMEOUT_MS = 5_500;

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

async function fetchAuthWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, controller ? { ...init, signal: controller.signal } : init);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

  const preferSameOrigin =
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    cleanBase.includes('.sslip.io') &&
    !window.location.origin.includes('.sslip.io');

  const primaryUrl = preferSameOrigin ? `${window.location.origin}${path}` : `${cleanBase}${path}`;
  const fallbackUrl =
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    cleanBase.includes('.sslip.io')
      ? preferSameOrigin
        ? `${cleanBase}${path}`
        : `${window.location.origin}${path}`
      : null;

  let response: Response;
  try {
    response = await fetchAuthWithTimeout(primaryUrl, reqInit, 6_500);
    if (fallbackUrl && (response.status === 502 || response.status === 503 || response.status === 504)) {
      try {
        response = await fetchAuthWithTimeout(fallbackUrl, reqInit, 5_500);
      } catch {
        // Keep primary gateway response if fallback also fails
      }
    }
  } catch {
    if (fallbackUrl) {
      try {
        response = await fetchAuthWithTimeout(fallbackUrl, reqInit, 5_500);
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
            await deleteCurrentSessionSafely(account, 1_500);
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
      await deleteCurrentSessionSafely(account, 1_500);
      await account.createSession(token.userId, token.secret);
    },
    activateInviteSession: async ({ email, password, displayName, inviteToken }) => {
      const token = await postPublicAuthEndpoint(config.apiBaseUrl, '/v1/auth/activate-invite', {
        email: email.trim().toLowerCase(),
        password,
        ...(displayName ? { displayName } : {}),
        ...(inviteToken ? { inviteToken } : {}),
      });
      await deleteCurrentSessionSafely(account, 1_500);
      await account.createSession(token.userId, token.secret);
    },
    verifyProfile: async () => {
      await api.getMe();
      markSessionVerified();
    },
    removeSession: async () => {
      clearVerifiedSessionBootstrap();
      await deleteCurrentSessionSafely(account, 2_500);
    },
  };
}

export async function checkSession(service: LoginService, expire?: () => Promise<boolean>): Promise<SessionState> {
  try {
    await service.verifyProfile();
    markSessionVerified();
    return { status: 'authenticated' };
  } catch (error) {
    if (!isTerminalSession(error)) {
      return { status: 'recoverable-error', message: 'Nao foi possivel verificar sua sessao.' };
    }
    clearVerifiedSessionBootstrap();
    if (expire) {
      try {
        await Promise.race([
          expire(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 2_500)),
        ]);
      } catch {
        // Never allow session expiration cleanup to block terminal state transition.
      }
    } else {
      try {
        await Promise.race([
          service.removeSession(),
          new Promise<void>((resolve) => setTimeout(resolve, 2_500)),
        ]);
      } catch {
        /* The local session is already unusable. */
      }
    }
    return { status: 'expired' };
  }
}

export function useSessionBoundary(serviceOverride?: LoginService) {
  const queryClient = useQueryClient();
  const service = useMemo(() => serviceOverride ?? createLoginService(), [serviceOverride]);
  const [state, setState] = useState<SessionState>(() =>
    hasVerifiedSessionBootstrap() ? { status: 'authenticated' } : { status: 'checking' }
  );
  const verifyRunId = useRef(0);

  const verify = useCallback(async (backgroundOnly = false) => {
    const currentRun = ++verifyRunId.current;
    const epoch = sessionEpoch(queryClient);
    if (!backgroundOnly) {
      setState({ status: 'checking' });
    }

    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const watchdogPromise = new Promise<SessionState>((resolve) => {
      watchdogTimer = setTimeout(() => {
        resolve({
          status: 'recoverable-error',
          message: 'Nao foi possivel verificar sua sessao.',
        });
      }, SESSION_CHECK_TIMEOUT_MS);
    });

    try {
      const nextState = await Promise.race([
        checkSession(service, () => expireSession(queryClient, epoch, () => service.removeSession())),
        watchdogPromise,
      ]);
      if (verifyRunId.current !== currentRun) return;
      if (backgroundOnly && nextState.status === 'recoverable-error') {
        // Keep optimistic authenticated view when a background check hits a transient network blip
        return;
      }
      setState(nextState);
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer);
    }
  }, [queryClient, service]);

  useEffect(() => {
    const isOptimistic = hasVerifiedSessionBootstrap();
    void verify(isOptimistic);
    return () => {
      verifyRunId.current += 1;
    };
  }, [verify]);

  useEffect(() => {
    if (typeof window === 'undefined' || state.status !== 'recoverable-error') return;
    const handleOnline = () => {
      void verify(false);
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [state.status, verify]);

  const retry = useCallback(() => verify(false), [verify]);

  return { state, retry };
}
