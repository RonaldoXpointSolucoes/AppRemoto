'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  CheckCircle2,
  X,
  FileText,
  User,
  Laptop,
  Copy,
  Check,
  Download,
  Zap,
  ShieldCheck,
  Cpu,
  Globe,
  Folder,
  Activity,
  Sparkles,
  Share2,
} from 'lucide-react';
import {
  updateRecentConnectionNotes,
  SMART_ACTION_PRESETS,
  RESOLUTION_STATUS_LABELS,
  generateSessionProtocol,
  detectClientTelemetry,
  buildAutomatedTechnicalReport,
  saveDeviceCustomMetadata,
  getCustomMetadataMap,
  type SessionResolutionStatus,
  type SessionTimelineEvent,
  type RecentConnectionRecord,
} from './teamviewer-storage';

export interface ActiveSession {
  protocolNumber?: string;
  deviceId: string;
  displayName: string;
  hostname: string;
  organizationName?: string;
  organizationId?: string;
  folderName?: string;
  rustdeskId: string;
  operatingSystem?: string;
  osBuild?: string;
  osBadge?: string;
  localIp?: string;
  deviceStatusAtStart?: string;
  lastSeenBeforeConnect?: string;
  isFavorite?: boolean;
  previousDeviceNotes?: string;
  technicianName: string;
  technicianEmail?: string;
  clientPlatform?: string;
  clientNetwork?: string;
  clientViewport?: string;
  mode?: 'automatic' | 'manual';
  startedAt: string;
}

const AUTO_DOC_IDLE_SECONDS = 20;

function formatRustDeskIdDisplay(id: string): string {
  const clean = id.replace(/\s+/g, '');
  return clean.replace(/(\d{3})(?=\d)/g, '$1 ');
}

export function ActiveSessionTracker({
  session,
  onClose,
  onSaved,
}: {
  session: ActiveSession | null;
  onClose(): void;
  onSaved?(): void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [autoCountdown, setAutoCountdown] = useState(AUTO_DOC_IDLE_SECONDS);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [notes, setNotes] = useState('');
  const [resolutionStatus, setResolutionStatus] = useState<SessionResolutionStatus>('resolved');
  const [selectedActions, setSelectedActions] = useState<string[]>([
    'Inspeção Preventiva de Saúde e Desempenho',
  ]);
  const [timelineEvents, setTimelineEvents] = useState<SessionTimelineEvent[]>([]);
  const [syncToDeviceMeta, setSyncToDeviceMeta] = useState(true);
  const [isSaved, setIsSaved] = useState(false);
  const [quickAutoSaved, setQuickAutoSaved] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  const autoTriggeredRef = useRef(false);

  const clientEnv = useMemo(() => detectClientTelemetry(), []);

  function resetIdleCountdown() {
    if (!autoTriggeredRef.current) {
      setAutoCountdown(AUTO_DOC_IDLE_SECONDS);
    }
  }

  useEffect(() => {
    if (!session) {
      setElapsed(0);
      setAutoCountdown(AUTO_DOC_IDLE_SECONDS);
      autoTriggeredRef.current = false;
      setShowDocumentation(false);
      setNotes('');
      setResolutionStatus('resolved');
      setSelectedActions(['Inspeção Preventiva de Saúde e Desempenho']);
      setTimelineEvents([]);
      setIsSaved(false);
      setQuickAutoSaved(false);
      return;
    }

    autoTriggeredRef.current = false;
    setAutoCountdown(AUTO_DOC_IDLE_SECONDS);

    const startMs = new Date(session.startedAt).getTime();
    const startTimeStr = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(
      new Date(session.startedAt)
    );
    setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    setTimelineEvents([
      {
        time: startTimeStr,
        label: `Handshake seguro autenticado para ${session.displayName} (ID ${session.rustdeskId})`,
      },
      {
        time: startTimeStr,
        label: `Sessão iniciada por ${session.technicianName} via ${
          session.clientPlatform || clientEnv.clientPlatform
        }`,
      },
      {
        time: startTimeStr,
        label: `Telemetria da estação capturada: ${session.operatingSystem || 'Windows'}${
          session.localIp ? ` · IP ${session.localIp}` : ''
        }`,
      },
    ]);

    const handleReturnFromRustDesk = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!autoTriggeredRef.current) {
        setAutoCountdown(AUTO_DOC_IDLE_SECONDS);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleReturnFromRustDesk);
      document.addEventListener('visibilitychange', handleReturnFromRustDesk);
    }

    const interval = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        setAutoCountdown(AUTO_DOC_IDLE_SECONDS);
        return;
      }
      if (!autoTriggeredRef.current) {
        setAutoCountdown((prev) => Math.max(0, prev - 1));
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleReturnFromRustDesk);
        document.removeEventListener('visibilitychange', handleReturnFromRustDesk);
      }
    };
  }, [session, clientEnv.clientPlatform]);

  if (!session) return null;

  const protocolNumber = session.protocolNumber || generateSessionProtocol(session.startedAt);

  function formatTime(totalSeconds: number) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  function toggleActionPreset(label: string) {
    const nowTime = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(new Date());
    setSelectedActions((prev) => {
      const exists = prev.includes(label);
      if (exists) {
        return prev.filter((item) => item !== label);
      }
      setTimelineEvents((evPrev) => [
        ...evPrev,
        { time: nowTime, label: `Procedimento marcado: ${label}` },
      ]);
      return [...prev, label];
    });
  }

  const liveRecord: RecentConnectionRecord = {
    protocolNumber,
    deviceId: session.deviceId,
    displayName: session.displayName,
    hostname: session.hostname,
    organizationName: session.organizationName || 'XPoint',
    organizationId: session.organizationId,
    folderName: session.folderName || 'Clientes',
    rustdeskId: session.rustdeskId,
    operatingSystem: session.operatingSystem || 'Windows',
    osBuild: session.osBuild,
    osBadge: session.osBadge,
    localIp: session.localIp,
    deviceStatusAtStart: session.deviceStatusAtStart || 'ONLINE',
    lastSeenBeforeConnect: session.lastSeenBeforeConnect,
    isFavorite: session.isFavorite,
    previousDeviceNotes: session.previousDeviceNotes,
    connectedAt: session.startedAt,
    endedAt: new Date().toISOString(),
    technicianName: session.technicianName,
    technicianEmail: session.technicianEmail,
    clientPlatform: session.clientPlatform || clientEnv.clientPlatform,
    clientNetwork: session.clientNetwork || clientEnv.clientNetwork,
    clientViewport: session.clientViewport || clientEnv.clientViewport,
    mode: session.mode || 'automatic',
    durationSeconds: elapsed,
    resolutionStatus,
    executedActions: selectedActions,
    timelineEvents,
    notes: notes.trim(),
  };

  const autoGeneratedReport = buildAutomatedTechnicalReport(liveRecord);

  function persistDocumentation(closeAfterMs = 900) {
    if (!session) return;
    const endTimeStr = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(new Date());
    const finalTimeline: SessionTimelineEvent[] = [
      ...timelineEvents,
      {
        time: endTimeStr,
        label: `Atendimento finalizado (${RESOLUTION_STATUS_LABELS[resolutionStatus]}) com duração de ${formatTime(elapsed)}`,
      },
    ];

    const summaryNote = [
      `[${protocolNumber}] ${RESOLUTION_STATUS_LABELS[resolutionStatus]}`,
      selectedActions.length > 0 ? `Ações: ${selectedActions.join('; ')}` : '',
      notes.trim() ? `Obs: ${notes.trim()}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    updateRecentConnectionNotes(session.deviceId, session.startedAt, summaryNote, elapsed, {
      ...liveRecord,
      timelineEvents: finalTimeline,
      endedAt: new Date().toISOString(),
    });

    if (syncToDeviceMeta) {
      const existingMeta = getCustomMetadataMap()[session.deviceId];
      const shortDate = new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date());
      const autoStamp = `Último suporte (${shortDate} por ${session.technicianName} · ${formatTime(
        elapsed
      )}): ${selectedActions[0] || 'Verificação remota'}${notes.trim() ? ` - ${notes.trim()}` : ''}`;
      saveDeviceCustomMetadata(session.deviceId, {
        ...existingMeta,
        notes: existingMeta?.notes ? existingMeta.notes : autoStamp,
      });
    }

    onSaved?.();
    if (closeAfterMs > 0) {
      setIsSaved(true);
      setTimeout(() => {
        onClose();
      }, closeAfterMs);
    }
  }

  function handleQuickOneTapAutoDoc() {
    autoTriggeredRef.current = true;
    persistDocumentation(0);
    setQuickAutoSaved(true);
    setTimeout(() => {
      onClose();
    }, 950);
  }

  function handleDismissWithAutoSave() {
    autoTriggeredRef.current = true;
    persistDocumentation(0);
    onClose();
  }

  // Disparo automático do Auto 1-Click após 20 segundos sem cliques nem digitação
  useEffect(() => {
    if (!session) return;
    if (autoCountdown <= 0 && !autoTriggeredRef.current && !isSaved && !quickAutoSaved) {
      handleQuickOneTapAutoDoc();
    }
  });

  function handleCopyFormattedReport() {
    void navigator.clipboard.writeText(autoGeneratedReport).then(() => {
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2500);
    });
  }

  function handleShareReport() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      void navigator
        .share({
          title: `Laudo Técnico ${protocolNumber} - ${liveRecord.displayName}`,
          text: autoGeneratedReport,
        })
        .catch(() => {
          handleCopyFormattedReport();
        });
    } else {
      handleCopyFormattedReport();
    }
  }

  function handleDownloadEvidenceJson() {
    const payload = {
      ...liveRecord,
      autoReportText: autoGeneratedReport,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Laudo-${protocolNumber}-${liveRecord.hostname}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="active-session-widget animate-in fade-in slide-in-from-bottom-4 duration-300"
      onPointerDown={resetIdleCountdown}
      onKeyDown={resetIdleCountdown}
    >
      {/* HUD Flutuante Compacto (Responsivo para PC e Celular sem quebrar palavras na vertical) */}
      <div className="active-session-bar">
        <div className="session-hud-top">
          <div className="session-status-pulse" aria-hidden="true">
            <span className="pulse-dot" />
            <span className="pulse-ring" />
          </div>
          <div className="session-title-wrap">
            <span className="session-title" title={session.displayName}>
              <Laptop size={14} className="session-laptop-icon" />
              <strong>{session.displayName}</strong>
            </span>
            <span className="session-protocol-pill">{protocolNumber}</span>
          </div>
          <button
            type="button"
            className="session-close-btn"
            onClick={handleDismissWithAutoSave}
            title="Encerrar e salvar telemetria automaticamente"
            aria-label="Encerrar e salvar telemetria automaticamente"
          >
            <X size={16} />
          </button>
        </div>

        <div className="session-hud-bottom">
          <div className="session-meta">
            <User size={12} className="inline mr-1" />
            <span className="session-meta-tech">{session.technicianName}</span>
            <span className="session-meta-sep">·</span>
            <span className="session-meta-id">{formatRustDeskIdDisplay(session.rustdeskId)}</span>
            {session.osBadge && <span className="session-meta-os">{session.osBadge}</span>}
          </div>

          <div className="session-hud-actions">
            <div className="session-timer" title="Tempo de sessão ativa">
              <Clock size={13} />
              <span>{formatTime(elapsed)}</span>
            </div>

            <button
              type="button"
              className="session-autodoc-quick-btn"
              onClick={handleQuickOneTapAutoDoc}
              title="Documentar automaticamente com 1 toque (ou aguarde 20s sem clicar nem digitar para conclusão automática)"
            >
              {quickAutoSaved ? <Check size={14} /> : <Zap size={14} />}
              <span>{quickAutoSaved ? 'Salvo Auto!' : `Auto 1-Click (${autoCountdown}s)`}</span>
            </button>

            <button
              type="button"
              className="session-document-btn"
              onClick={() => {
                resetIdleCountdown();
                setShowDocumentation(true);
              }}
              title="Abrir central de documentação automatizada com laudo completo"
            >
              <FileText size={14} />
              <span>Documentar</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal Completo de Documentação Automatizada com Máximo de Dados */}
      {showDocumentation && (
        <div
          className="tv-modal-backdrop session-modal-overlay"
          onClick={() => setShowDocumentation(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="autodoc-modal-title"
        >
          <div
            className="tv-modal-card session-autodoc-modal-card"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={resetIdleCountdown}
            onKeyDown={resetIdleCountdown}
          >
            <div className="tv-sheet-drag-handle" aria-hidden="true" />

            <div className="session-autodoc-header">
              <div className="session-autodoc-header-left">
                <div className="session-autodoc-icon">
                  <Sparkles size={20} />
                </div>
                <div>
                  <div className="session-autodoc-title-row">
                    <h3 id="autodoc-modal-title">Documentação Automatizada de Atendimento</h3>
                    <span className="session-protocol-badge">{protocolNumber}</span>
                  </div>
                  <p className="session-autodoc-subtitle">
                    Telemetria completa da máquina, rede, duração e laudo técnico preenchidos automaticamente
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="tv-modal-close-btn"
                onClick={() => setShowDocumentation(false)}
                aria-label="Fechar janela de documentação"
              >
                <X size={18} />
              </button>
            </div>

            <div className="session-autodoc-body">
              {/* Grade com Máximo de Dados Coletados Automaticamente */}
              <div className="autodoc-telemetry-section">
                <div className="autodoc-section-header">
                  <span className="autodoc-section-title">
                    <Cpu size={14} /> Dados Coletados Automaticamente (12 Indicadores)
                  </span>
                  <span className="autodoc-live-timer-pill">
                    <Clock size={12} /> Duração: {formatTime(elapsed)}
                  </span>
                </div>

                <div className="autodoc-telemetry-grid">
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Computador / Cliente</span>
                    <strong className="autodoc-cell-value">{session.displayName}</strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Hostname & ID RustDesk</span>
                    <strong className="autodoc-cell-value font-mono">
                      {session.hostname} · {formatRustDeskIdDisplay(session.rustdeskId)}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Organização & Pasta</span>
                    <strong className="autodoc-cell-value">
                      <Folder size={12} className="inline mr-1 text-sky-400" />
                      {session.organizationName || 'XPoint'} › {session.folderName || 'Clientes'}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Sistema Operacional & Build</span>
                    <strong className="autodoc-cell-value">
                      {session.operatingSystem || 'Windows'}
                      {session.osBuild ? ` (${session.osBuild})` : ''}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Rede Local / Roteamento</span>
                    <strong className="autodoc-cell-value font-mono">
                      <Globe size={12} className="inline mr-1 text-emerald-400" />
                      {session.localIp || 'NAT P2P / Relay 21117'}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Técnico Responsável</span>
                    <strong className="autodoc-cell-value">
                      {session.technicianName}
                      {session.technicianEmail ? ` (${session.technicianEmail})` : ''}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Dispositivo do Técnico</span>
                    <strong className="autodoc-cell-value">
                      {session.clientPlatform || clientEnv.clientPlatform}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Rede & Resolução de Origem</span>
                    <strong className="autodoc-cell-value">
                      {session.clientNetwork || clientEnv.clientNetwork} ·{' '}
                      {session.clientViewport || clientEnv.clientViewport}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Status Final de Resolução (1 Toque) */}
              <div className="autodoc-block">
                <span className="autodoc-section-title">
                  <ShieldCheck size={14} /> Status de Conclusão do Atendimento
                </span>
                <div className="autodoc-status-pills">
                  {(
                    [
                      { id: 'resolved', label: '✅ Resolvido 100%' },
                      { id: 'monitoring', label: '🛡️ Preventivo / Monitorando' },
                      { id: 'pending_parts', label: '⏳ Aguardando Local' },
                      { id: 'escalated', label: '🚨 Escalonado Nível 2' },
                    ] as const
                  ).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      className={`autodoc-status-pill ${resolutionStatus === st.id ? 'active' : ''}`}
                      onClick={() => setResolutionStatus(st.id)}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Checklist Inteligente de Ações em 1 Toque (Sem precisar digitar!) */}
              <div className="autodoc-block">
                <div className="autodoc-section-header">
                  <span className="autodoc-section-title">
                    <Zap size={14} /> O que foi feito? (Toque Rápido — Preenchimento Automático)
                  </span>
                  <span className="autodoc-counter-badge">
                    {selectedActions.length} selecionada(s)
                  </span>
                </div>
                <div className="autodoc-presets-grid">
                  {SMART_ACTION_PRESETS.map((preset) => {
                    const isChecked = selectedActions.includes(preset.label);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`autodoc-preset-chip ${isChecked ? 'active' : ''}`}
                        onClick={() => toggleActionPreset(preset.label)}
                      >
                        <CheckCircle2
                          size={14}
                          className={isChecked ? 'text-emerald-400' : 'text-slate-500'}
                        />
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Observação Complementar Opcional */}
              <div className="autodoc-block">
                <label htmlFor="session-notes-input" className="autodoc-section-title">
                  <FileText size={14} /> Observação Específica Adicional (Opcional):
                </label>
                <textarea
                  id="session-notes-input"
                  className="session-notes-textarea"
                  placeholder="O laudo já é gerado automaticamente acima. Digite aqui apenas se quiser acrescentar algum detalhe extra..."
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={isSaved}
                />
              </div>

              {/* Laudo Técnico Gerado Automaticamente + Trilha de Auditoria */}
              <div className="autodoc-preview-box">
                <div className="autodoc-preview-header">
                  <span className="autodoc-section-title">
                    <Activity size={14} /> Laudo Técnico Gerado Automaticamente
                  </span>
                  <div className="autodoc-preview-actions">
                    <button
                      type="button"
                      className="autodoc-mini-btn"
                      onClick={handleCopyFormattedReport}
                      title="Copiar laudo completo para WhatsApp ou Chamado"
                    >
                      {copiedReport ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copiedReport ? 'Laudo Copiado!' : 'Copiar Laudo'}</span>
                    </button>
                    <button
                      type="button"
                      className="autodoc-mini-btn"
                      onClick={handleShareReport}
                      title="Compartilhar laudo no WhatsApp"
                    >
                      <Share2 size={13} />
                      <span>Compartilhar</span>
                    </button>
                    <button
                      type="button"
                      className="autodoc-mini-btn"
                      onClick={handleDownloadEvidenceJson}
                      title="Baixar arquivo JSON com todos os dados técnicos"
                    >
                      <Download size={13} />
                      <span>JSON</span>
                    </button>
                  </div>
                </div>
                <pre className="autodoc-report-pre">{autoGeneratedReport}</pre>
              </div>

              <label className="autodoc-sync-checkbox">
                <input
                  type="checkbox"
                  checked={syncToDeviceMeta}
                  onChange={(e) => setSyncToDeviceMeta(e.target.checked)}
                />
                <span>
                  Vincular resumo deste protocolo (<strong>{protocolNumber}</strong>) na ficha da máquina
                </span>
              </label>

              {isSaved && (
                <p className="session-save-success" role="status">
                  <CheckCircle2 size={16} />
                  Laudo técnico e telemetria completa salvos automaticamente no Histórico!
                </p>
              )}
            </div>

            <div className="session-modal-footer autodoc-modal-footer">
              <button
                type="button"
                className="command-button"
                onClick={() => setShowDocumentation(false)}
                disabled={isSaved}
              >
                Continuar na Sessão
              </button>
              <button
                type="button"
                className="primary-button guide-link"
                onClick={() => persistDocumentation(900)}
                disabled={isSaved}
              >
                <CheckCircle2 size={16} />
                {isSaved ? 'Documentado!' : 'Salvar Laudo Automático'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
