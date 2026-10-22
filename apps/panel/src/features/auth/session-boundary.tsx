'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useSessionBoundary, type LoginService } from './session';
import { buildPreservedRoute } from '../embed/chatbot-bridge';

export function SessionBoundary({ children, service }: { children: ReactNode; service?: LoginService }) {
  const router = useRouter();
  const { state, retry } = useSessionBoundary(service);

  useEffect(() => {
    if (state.status === 'expired') router.replace(buildPreservedRoute('/login'));
  }, [router, state.status]);

  if (state.status === 'authenticated') return children;
  if (state.status === 'recoverable-error') {
    return (
      <main className="session-state" aria-live="polite">
        <p>{state.message}</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="primary-button" type="button" onClick={() => void retry()}>Tentar novamente</button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => router.replace(buildPreservedRoute('/login'))}
          >
            Ir para o login
          </button>
        </div>
      </main>
    );
  }
  return <main className="session-state" aria-live="polite">Verificando sessao...</main>;
}
