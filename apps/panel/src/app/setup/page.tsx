'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { MarkdownRenderer } from '../../components/markdown-renderer';
import { SessionBoundary } from '../../features/auth/session-boundary';
import { setupGuideMarkdown } from '../../features/setup/setup-guide';
import { getPublicConfig } from '../../lib/config';

export default function SetupPage() {
  const content = setupGuideMarkdown(getPublicConfig().apiBaseUrl);
  return (
    <SessionBoundary>
      <main className="setup-shell">
        <header className="setup-header">
          <p className="product-name">AppRemoto · Como Configurar?</p>
          <Link className="command-button guide-link" href="/devices">
            <ArrowLeft aria-hidden="true" size={18} />Voltar para dispositivos
          </Link>
        </header>
        <article className="setup-article"><MarkdownRenderer content={content} /></article>
        <footer className="setup-footer">
          <Link className="primary-button guide-link" href="/devices">Voltar para dispositivos</Link>
        </footer>
      </main>
    </SessionBoundary>
  );
}
