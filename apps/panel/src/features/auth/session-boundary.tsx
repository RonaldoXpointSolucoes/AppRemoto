'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ShieldCheck, RefreshCw, LogIn, AlertTriangle } from 'lucide-react';

import { useSessionBoundary, type LoginService } from './session';
import { clearVerifiedSessionBootstrap } from './session-cache';
import { buildPreservedRoute } from '../embed/chatbot-bridge';

export function SessionBoundary({ children, service }: { children: ReactNode; service?: LoginService }) {
  const router = useRouter();
  const { state, retry } = useSessionBoundary(service);
  const [showQuickEscape, setShowQuickEscape] = useState(false);

  const navigateToLogin = () => {
    clearVerifiedSessionBootstrap();
    const target = buildPreservedRoute('/login');
    router.replace(target);
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
      window.setTimeout(() => {
        if (!window.location.pathname.startsWith('/login')) {
          window.location.replace(target);
        }
      }, 900);
    }
  };

  useEffect(() => {
    if (state.status === 'expired') {
      navigateToLogin();
    }
  }, [router, state.status]);

  useEffect(() => {
    if (state.status !== 'checking') {
      setShowQuickEscape(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowQuickEscape(true);
    }, 1_600);
    return () => window.clearTimeout(timer);
  }, [state.status]);

  if (state.status === 'authenticated') return children;

  if (state.status === 'recoverable-error') {
    return (
      <main className="session-state session-state-modern" aria-live="polite">
        <section className="session-gate-card session-gate-card-error">
          <div className="session-gate-badge session-gate-badge-error">
            <AlertTriangle size={22} aria-hidden="true" />
          </div>
          <span className="session-gate-brand">XPoint Remote</span>
          <h1 className="session-gate-title">Conexão de Sessão Instável</h1>
          <p className="session-gate-message">{state.message}</p>
          <div className="session-gate-actions">
            <button className="primary-button session-gate-btn-primary" type="button" onClick={() => void retry()}>
              <RefreshCw size={16} aria-hidden="true" />
              <span>Tentar novamente</span>
            </button>
            <button
              className="secondary-button session-gate-btn-secondary"
              type="button"
              onClick={navigateToLogin}
            >
              <LogIn size={16} aria-hidden="true" />
              <span>Ir para o login</span>
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="session-state session-state-modern" aria-live="polite">
      <section className="session-gate-card">
        <div className="session-gate-spinner-wrap" aria-hidden="true">
          <div className="session-gate-spinner-ring" />
          <ShieldCheck size={22} className="session-gate-spinner-icon" />
        </div>
        <span className="session-gate-brand">XPoint Remote</span>
        <p className="session-gate-status-text">
          {state.status === 'expired' ? 'Redirecionando para o login...' : 'Verificando sessao...'}
        </p>
        <span className="session-gate-subtext">
          Validando credenciais criptografadas e sincronizando seu ambiente operacional.
        </span>
        <div className="session-gate-progress-track" aria-hidden="true">
          <div className="session-gate-progress-bar" />
        </div>
        {(showQuickEscape || state.status === 'expired') && (
          <div className="session-gate-actions session-gate-actions-subtle">
            <button
              className="secondary-button session-gate-btn-secondary"
              type="button"
              onClick={() => void retry()}
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span>Atualizar agora</span>
            </button>
            <button
              className="primary-button session-gate-btn-primary"
              type="button"
              onClick={navigateToLogin}
            >
              <LogIn size={15} aria-hidden="true" />
              <span>Ir para o login</span>
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
