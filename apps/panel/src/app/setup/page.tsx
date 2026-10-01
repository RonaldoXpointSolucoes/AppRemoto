'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { SessionBoundary } from '../../features/auth/session-boundary';
import { SetupChecklist } from '../../features/setup/setup-checklist';
import { AutomaticSetup } from '../../features/setup/automatic-setup';
import { getPublicConfig } from '../../lib/config';

export default function SetupPage() {
  const { apiBaseUrl } = getPublicConfig();
  return (
    <SessionBoundary>
      <main className="setup-shell">
        <header className="setup-header">
          <p className="product-name">AppRemoto · Instalar no cliente</p>
          <Link className="command-button guide-link" href="/devices">
            <ArrowLeft aria-hidden="true" size={18} />Voltar para dispositivos
          </Link>
        </header>
        <AutomaticSetup />
        <details className="manual-setup"><summary>Guia manual e solução de problemas</summary><SetupChecklist apiBaseUrl={apiBaseUrl} /></details>
        <footer className="setup-footer">
          <Link className="primary-button guide-link" href="/devices">Voltar para dispositivos</Link>
        </footer>
      </main>
    </SessionBoundary>
  );
}
