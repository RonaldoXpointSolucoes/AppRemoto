'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { ShieldCheck, RefreshCw, Wrench, AlertTriangle } from 'lucide-react';
import { appendClientDiagnosticLog } from '../features/cockpit/cockpit-service';

const CHUNK_RELOAD_GUARD_KEY = 'xpoint_chunk_reload_guard_v1';

export function isStaleChunkError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('chunkloaderror') ||
    lower.includes('loading chunk') ||
    lower.includes('failed to fetch dynamically imported module') ||
    lower.includes('importing a module script failed')
  );
}

export function compactLocalStorageOnQuotaPressure(): number {
  if (typeof window === 'undefined') return 0;
  let freedKeys = 0;
  try {
    const logsRaw = window.localStorage.getItem('xpoint_cockpit_logs_v1');
    if (logsRaw && logsRaw.length > 25_000) {
      const parsed = JSON.parse(logsRaw);
      if (Array.isArray(parsed)) {
        window.localStorage.setItem('xpoint_cockpit_logs_v1', JSON.stringify(parsed.slice(0, 40)));
        freedKeys += 1;
      }
    }
  } catch {
    try {
      window.localStorage.removeItem('xpoint_cockpit_logs_v1');
      freedKeys += 1;
    } catch {}
  }
  return freedKeys;
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  rootCause: string;
  autoRetryCount: number;
}

export class SelfHealingRuntimeBoundary extends Component<Props, State> {
  private cleanupListeners: (() => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      rootCause: '',
      autoRetryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const msg = error?.message || 'Erro inesperado de renderização';
    const rootCause = isStaleChunkError(msg)
      ? 'Atualização de versão detectada (bundle JS substituído em novo deploy).'
      : 'Exceção de estado isolada em componente visual.';
    return {
      hasError: true,
      errorMessage: msg,
      rootCause,
    };
  }

  override componentDidMount(): void {
    if (typeof window === 'undefined') return;

    const onWindowError = (event: ErrorEvent) => {
      const msg = event.message || String(event.error ?? '');
      if (!msg) return;

      if (isStaleChunkError(msg)) {
        appendClientDiagnosticLog({
          level: 'warn',
          component: 'SERVIDOR NODE.JS',
          message: `[SelfHealingRuntime] Bundle atualizado detectado (${msg.slice(0, 80)}). Sincronizando nova versão automaticamente.`,
          rootCause: 'Nova versão implantada no servidor invalidou chunk antigo em cache.',
          autoRemediation: 'Recarregamento seguro de assets executado automaticamente.',
          details: { operation: 'CHUNK_LOAD_AUTO_RECOVERY' },
        });
        this.trySafeChunkReload();
        return;
      }

      if (msg.toLowerCase().includes('quotaexceeded')) {
        const compacted = compactLocalStorageOnQuotaPressure();
        appendClientDiagnosticLog({
          level: 'warn',
          component: 'SERVIDOR NODE.JS',
          message: `[SelfHealingRuntime] Pressão de armazenamento local detectada. Compactação automática liberou ${compacted} buffer(s).`,
          rootCause: 'Limite de quota do localStorage do navegador atingido.',
          autoRemediation: 'Logs antigos compactados automaticamente preservando favoritos e pastas.',
          details: { operation: 'STORAGE_QUOTA_COMPACTED', compacted },
        });
      }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === 'string'
            ? event.reason
            : '';
      if (!reason) return;
      if (isStaleChunkError(reason)) {
        appendClientDiagnosticLog({
          level: 'warn',
          component: 'SERVIDOR NODE.JS',
          message: `[SelfHealingRuntime] Promessa de módulo dinâmico desatualizada detectada. Aplicando auto-cura.`,
          rootCause: 'Chunk dinâmico substituído após deploy.',
          autoRemediation: 'Sincronização automática da versão mais recente.',
          details: { operation: 'DYNAMIC_IMPORT_AUTO_RECOVERY' },
        });
        this.trySafeChunkReload();
      }
    };

    const onCustomDiagnostic = (event: Event) => {
      const custom = event as CustomEvent<{
        level?: 'info' | 'warn' | 'error' | 'success';
        component?:
          | 'SERVIDOR NODE.JS'
          | 'RUSTDESK SERVER'
          | 'APPWRITE DB'
          | 'HOST VPS'
          | 'AGENTE WINDOWS'
          | 'TRAEFIK PROXY';
        operation?: string;
        message?: string;
        rootCause?: string;
        autoRemediation?: string;
      }>;
      const detail = custom.detail;
      if (!detail?.message) return;
      appendClientDiagnosticLog({
        level: detail.level ?? 'info',
        component: detail.component ?? 'SERVIDOR NODE.JS',
        message: detail.message,
        rootCause: detail.rootCause,
        autoRemediation: detail.autoRemediation,
        details: { operation: detail.operation ?? 'CLIENT_AUTO_HEAL' },
      });
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('xpoint:client-diagnostic', onCustomDiagnostic);

    this.cleanupListeners = () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('xpoint:client-diagnostic', onCustomDiagnostic);
    };
  }

  override componentWillUnmount(): void {
    this.cleanupListeners?.();
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const msg = error?.message || 'Erro de renderização';
    appendClientDiagnosticLog({
      level: 'warn',
      component: 'SERVIDOR NODE.JS',
      message: `[SelfHealingBoundary] Exceção de interface interceptada e isolada (${msg.slice(0, 90)}).`,
      rootCause: this.state.rootCause || 'Falha transitória de árvore React.',
      autoRemediation:
        this.state.autoRetryCount === 0
          ? 'Reconciliação automática imediata da árvore de componentes executada.'
          : 'Isolamento seguro ativado com opção de restauração em 1 clique.',
      details: {
        operation: 'REACT_BOUNDARY_INTERCEPTED',
        componentStack: errorInfo?.componentStack?.slice(0, 240) ?? '',
      },
    });

    if (isStaleChunkError(msg)) {
      this.trySafeChunkReload();
      return;
    }

    // Auto-cura silenciosa na primeira ocorrência
    if (this.state.autoRetryCount < 1) {
      this.setState((prev) => ({
        hasError: false,
        errorMessage: '',
        autoRetryCount: prev.autoRetryCount + 1,
      }));
    }
  }

  private trySafeChunkReload(): void {
    if (typeof window === 'undefined') return;
    try {
      const lastReload = Number(window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) || '0');
      if (Date.now() - lastReload > 30_000) {
        window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(Date.now()));
        window.location.reload();
      }
    } catch {}
  }

  private handleManualHeal = (): void => {
    compactLocalStorageOnQuotaPressure();
    this.setState({
      hasError: false,
      errorMessage: '',
      rootCause: '',
      autoRetryCount: 0,
    });
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="session-state session-state-modern" aria-live="polite">
        <section className="session-gate-card session-gate-card-error">
          <div className="session-gate-badge session-gate-badge-error">
            <Wrench size={22} aria-hidden="true" />
          </div>
          <span className="session-gate-brand">XPoint Remote · Auto-Cura Ativa</span>
          <h1 className="session-gate-title">Interface Reconciliada com Segurança</h1>
          <p className="session-gate-message">
            O motor de proteção interceptou uma falha visual isolada sem desconectar sua sessão.
          </p>
          {this.state.rootCause && (
            <div className="mt-2 mb-3 rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0 text-amber-400" />
              <span>
                <strong>Diagnóstico:</strong> {this.state.rootCause}
              </span>
            </div>
          )}
          <div className="session-gate-actions">
            <button
              className="primary-button session-gate-btn-primary"
              type="button"
              onClick={this.handleManualHeal}
            >
              <RefreshCw size={16} aria-hidden="true" />
              <span>Auto-Recuperar Interface</span>
            </button>
            <button
              className="secondary-button session-gate-btn-secondary"
              type="button"
              onClick={() => typeof window !== 'undefined' && window.location.reload()}
            >
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Recarregar Painel Completo</span>
            </button>
          </div>
        </section>
      </main>
    );
  }
}
