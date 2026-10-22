'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { LoginForm } from '../../features/auth/login-form';
import { createLoginService } from '../../features/auth/session';
import { markSessionVerified } from '../../features/auth/session-cache';
import { buildPreservedRoute } from '../../features/embed/chatbot-bridge';

export default function LoginPage() {
  const router = useRouter();
  const service = useMemo(() => createLoginService(), []);

  const handleAuthenticated = () => {
    markSessionVerified();
    const target = buildPreservedRoute('/devices');
    router.replace(target);
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
      window.setTimeout(() => {
        if (!window.location.pathname.startsWith('/devices')) {
          window.location.replace(target);
        }
      }, 900);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <p className="product-name">XPoint Remote</p>
        <h1 id="login-title">Acesso tecnico</h1>
        <p className="login-context">Entre com sua conta de operacao.</p>
        <LoginForm service={service} onAuthenticated={handleAuthenticated} />
      </section>
    </main>
  );
}
