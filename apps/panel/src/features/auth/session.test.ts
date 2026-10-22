// @vitest-environment jsdom

import { createElement } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../lib/api';
import { checkSession, SESSION_CHECK_TIMEOUT_MS, type LoginService } from './session';
import { SessionBoundary } from './session-boundary';
import {
  clearVerifiedSessionBootstrap,
  hasVerifiedSessionBootstrap,
  markSessionVerified,
} from './session-cache';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

afterEach(() => {
  clearVerifiedSessionBootstrap();
  vi.useRealTimers();
});

function service(overrides: Partial<LoginService> = {}): LoginService {
  return {
    createSession: vi.fn().mockResolvedValue(undefined),
    verifyProfile: vi.fn().mockResolvedValue(undefined),
    removeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('checkSession & SessionBoundary resilience', () => {
  it('removes a disabled technician session once and returns a stable terminal state', async () => {
    const auth = service({
      verifyProfile: vi.fn().mockRejectedValue(new ApiClientError({
        code: 'TECHNICIAN_DISABLED', message: 'private profile detail', status: 403,
      })),
    });

    const state = await checkSession(auth);

    expect(state).toEqual({ status: 'expired' });
    expect(auth.removeSession).toHaveBeenCalledTimes(1);
    expect(hasVerifiedSessionBootstrap()).toBe(false);
  });

  it('never remains stuck in checking when expire callback returns false', async () => {
    const auth = service({
      verifyProfile: vi.fn().mockRejectedValue(new ApiClientError({
        code: 'UNAUTHENTICATED', message: 'expired', status: 401,
      })),
    });

    const state = await checkSession(auth, async () => false);
    expect(state).toEqual({ status: 'expired' });
  });

  it('renders authenticated children immediately with zero white-screen delay after login verification', async () => {
    markSessionVerified();
    expect(hasVerifiedSessionBootstrap()).toBe(true);

    let resolveVerify!: () => void;
    const auth = service({
      verifyProfile: vi.fn(() => new Promise<void>((resolve) => {
        resolveVerify = resolve;
      })),
    });

    const client = new QueryClient();
    render(
      createElement(QueryClientProvider, {
        client,
        children: createElement(SessionBoundary, {
          service: auth,
          children: createElement('div', null, 'Painel Carregado Instantaneamente'),
        }),
      })
    );

    expect(screen.getByText('Painel Carregado Instantaneamente')).toBeInTheDocument();
    expect(screen.queryByText('Verificando sessao...')).not.toBeInTheDocument();

    resolveVerify();
    await waitFor(() => expect(auth.verifyProfile).toHaveBeenCalledTimes(1));
  });

  it('automatically exits checking state via watchdog timeout if network hangs indefinitely', async () => {
    vi.useFakeTimers();
    const auth = service({
      verifyProfile: vi.fn(() => new Promise<void>(() => {
        // Simulates a dead mobile/DNS socket that never resolves
      })),
    });

    const client = new QueryClient();
    render(
      createElement(QueryClientProvider, {
        client,
        children: createElement(SessionBoundary, {
          service: auth,
          children: createElement('div', null, 'Painel Protegido'),
        }),
      })
    );

    expect(screen.getByText('Verificando sessao...')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CHECK_TIMEOUT_MS + 100);
    });

    expect(screen.getByText('Nao foi possivel verificar sua sessao.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ir para o login/i })).toBeInTheDocument();
  });
});
