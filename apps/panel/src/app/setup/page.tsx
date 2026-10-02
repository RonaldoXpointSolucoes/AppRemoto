'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { ThemeToggle } from '../../components/theme-toggle';
import { SessionBoundary } from '../../features/auth/session-boundary';
import { SetupChecklist } from '../../features/setup/setup-checklist';
import { GenericSetup } from '../../features/setup/generic-setup';
import { AutomaticSetup } from '../../features/setup/automatic-setup';
import { getPublicConfig } from '../../lib/config';

export default function SetupPage() {
  const [legacyOpen, setLegacyOpen] = useState(false);
  const { apiBaseUrl } = getPublicConfig();
  return (
    <SessionBoundary>
      <main className="setup-shell">
        <header className="setup-header">
          <div className="product-title-row">
            <p className="product-name">AppRemoto · Instalar no cliente</p>
            <span className="version-badge" title="Versão da Plataforma">v1.2.4</span>
          </div>
          <div className="devices-header-actions">
            <ThemeToggle />
            <Link className="command-button guide-link" href="/devices">
              <ArrowLeft aria-hidden="true" size={18} />Voltar para dispositivos
            </Link>
          </div>
        </header>
        <GenericSetup />
        <details className="manual-setup" open={legacyOpen} onToggle={(event) => setLegacyOpen(event.currentTarget.open)}><summary>Configuração avançada: RustDesk já instalado</summary>{legacyOpen && <AutomaticSetup />}</details>
        <details className="manual-setup"><summary>Guia manual e solução de problemas</summary><SetupChecklist apiBaseUrl={apiBaseUrl} /></details>
        <footer className="setup-footer">
          <Link className="primary-button guide-link" href="/devices">Voltar para dispositivos</Link>
        </footer>
      </main>
    </SessionBoundary>
  );
}
