'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { LoginForm } from '../../features/auth/login-form';
import { createLoginService } from '../../features/auth/session';

export default function LoginPage() {
  const router = useRouter();
  const service = useMemo(() => createLoginService(), []);

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <p className="product-name">XPoint Remote</p>
        <h1 id="login-title">Acesso tecnico</h1>
        <p className="login-context">Entre com sua conta de operacao.</p>
        <LoginForm service={service} onAuthenticated={() => router.replace('/devices')} />
      </section>
    </main>
  );
}
