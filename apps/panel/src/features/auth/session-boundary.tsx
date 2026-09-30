'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useSessionBoundary } from './session';

export function SessionBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { state, retry } = useSessionBoundary();

  useEffect(() => {
    if (state.status === 'expired') router.replace('/login');
  }, [router, state.status]);

  if (state.status === 'authenticated') return children;
  if (state.status === 'recoverable-error') {
    return (
      <main className="session-state" aria-live="polite">
        <p>{state.message}</p>
        <button className="primary-button" type="button" onClick={() => void retry()}>Tentar novamente</button>
      </main>
    );
  }
  return <main className="session-state" aria-live="polite">Verificando sessao...</main>;
}
