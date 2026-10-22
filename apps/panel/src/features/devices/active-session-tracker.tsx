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
  Layers,
  ChevronLeft,
  ChevronRight,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import type { DataDivasInfo } from '@appremoto/contracts';
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
  datadivas?: DataDivasInfo;
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
  draftNotes?: string;
  draftResolutionStatus?: SessionResolutionStatus;
  draftSelectedActions?: string[];
  draftTimelineEvents?: SessionTimelineEvent[];
  draftSyncToDeviceMeta?: boolean;
}

const DEFAULT_SELECTED_ACTIONS = ['Inspeção Preventiva de Saúde e Desempenho'];

function formatRustDeskIdDisplay(id: string): string {
  const clean = id.replace(/\s+/g, '');
  return clean.replace(/(\d{3})(?=\d)/g, '$1 ');
}

export function formatSessionElapsedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

function buildInitialTimelineForSession(
  target: ActiveSession,
  fallbackPlatform: string
): SessionTimelineEvent[] {
  if (target.draftTimelineEvents && target.draftTimelineEvents.length > 0) {
    return target.draftTimelineEvents;
  }
  const startTimeStr = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(
    new Date(target.startedAt)
  );
  return [
    {
      time: startTimeStr,
      label: `Handshake seguro autenticado para ${target.displayName} (ID ${target.rustdeskId})`,
    },
    {
      time: startTimeStr,
      label: `Sessão iniciada por ${target.technicianName} via ${
        target.clientPlatform || fallbackPlatform
      }`,
    },
    {
      time: startTimeStr,
      label: `Telemetria da estação capturada: ${target.operatingSystem || 'Windows'}${
        target.localIp ? ` · IP ${target.localIp}` : ''
      }`,
    },
  ];
}

export function ActiveSessionTracker({
  session,
  sessions,
  activeSessionId,
  onSelectSession,
  onUpdateSessionDraft,
  onCloseSession,
  onCloseAllSessions,
  onClose,
  onSaved,
}: {
  session?: ActiveSession | null;
  sessions?: ActiveSession[];
  activeSessionId?: string | null;
  onSelectSession?(deviceId: string): void;
  onUpdateSessionDraft?(deviceId: string, draft: Partial<ActiveSession>): void;
  onCloseSession?(deviceId: string): void;
  onCloseAllSessions?(): void;
  onClose(): void;
  onSaved?(): void;
}) {
  const sessionList = useMemo<ActiveSession[]>(() => {
    if (sessions && sessions.length > 0) return sessions;
    if (session) return [session];
    return [];
  }, [sessions, session]);

  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    () => activeSessionId ?? session?.deviceId ?? null
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isMinimized, setIsMinimized] = useState(false);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [quickAutoSaved, setQuickAutoSaved] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mapa local de rascunhos por deviceId para garantir preservação mesmo sem callback externo
  const [localDrafts, setLocalDrafts] = useState<
    Record<
      string,
      {
        notes: string;
        resolutionStatus: SessionResolutionStatus;
        selectedActions: string[];
        timelineEvents: SessionTimelineEvent[];
        syncToDeviceMeta: boolean;
      }
    >
  >({});

  const clientEnv = useMemo(() => detectClientTelemetry(), []);

  const effectiveSelectedId = activeSessionId ?? internalSelectedId;
  const currentSession = useMemo<ActiveSession | null>(() => {
    if (sessionList.length === 0) return null;
    if (effectiveSelectedId) {
      const found = sessionList.find((item) => item.deviceId === effectiveSelectedId);
      if (found) return found;
    }
    return sessionList[sessionList.length - 1] ?? sessionList[0] ?? null;
  }, [sessionList, effectiveSelectedId]);

  const currentIndex = useMemo(() => {
    if (!currentSession) return -1;
    return sessionList.findIndex((item) => item.deviceId === currentSession.deviceId);
  }, [sessionList, currentSession]);

  function selectSessionById(deviceId: string) {
    setInternalSelectedId(deviceId);
    setIsSaved(false);
    setQuickAutoSaved(false);
    onSelectSession?.(deviceId);
  }

  // Relógio global de 1 segundo para atualizar simultaneamente todos os cronômetros ativos
  useEffect(() => {
    if (sessionList.length === 0) {
      setShowDocumentation(false);
      setIsMinimized(false);
      setIsSaved(false);
      setQuickAutoSaved(false);
      return;
    }
    setNowMs(Date.now());
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [sessionList.length]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  if (!currentSession || sessionList.length === 0) return null;

  const currentDraft = localDrafts[currentSession.deviceId] ?? {
    notes: currentSession.draftNotes ?? '',
    resolutionStatus: currentSession.draftResolutionStatus ?? 'resolved',
    selectedActions: currentSession.draftSelectedActions ?? DEFAULT_SELECTED_ACTIONS,
    timelineEvents: buildInitialTimelineForSession(currentSession, clientEnv.clientPlatform),
    syncToDeviceMeta: currentSession.draftSyncToDeviceMeta ?? true,
  };

  const { notes, resolutionStatus, selectedActions, timelineEvents, syncToDeviceMeta } =
    currentDraft;

  function updateCurrentDraft(
    patch: Partial<{
      notes: string;
      resolutionStatus: SessionResolutionStatus;
      selectedActions: string[];
      timelineEvents: SessionTimelineEvent[];
      syncToDeviceMeta: boolean;
    }>
  ) {
    if (!currentSession) return;
    const merged = {
      notes: patch.notes ?? currentDraft.notes,
      resolutionStatus: patch.resolutionStatus ?? currentDraft.resolutionStatus,
      selectedActions: patch.selectedActions ?? currentDraft.selectedActions,
      timelineEvents: patch.timelineEvents ?? currentDraft.timelineEvents,
      syncToDeviceMeta: patch.syncToDeviceMeta ?? currentDraft.syncToDeviceMeta,
    };
    setLocalDrafts((prev) => ({
      ...prev,
      [currentSession.deviceId]: merged,
    }));
    onUpdateSessionDraft?.(currentSession.deviceId, {
      draftNotes: merged.notes,
      draftResolutionStatus: merged.resolutionStatus,
      draftSelectedActions: merged.selectedActions,
      draftTimelineEvents: merged.timelineEvents,
      draftSyncToDeviceMeta: merged.syncToDeviceMeta,
    });
  }

  function getElapsedSecondsFor(target: ActiveSession): number {
    const startMs = new Date(target.startedAt).getTime();
    if (Number.isNaN(startMs)) return 0;
    return Math.max(0, Math.floor((nowMs - startMs) / 1000));
  }

  const elapsed = getElapsedSecondsFor(currentSession);
  const protocolNumber =
    currentSession.protocolNumber || generateSessionProtocol(currentSession.startedAt);

  function toggleActionPreset(label: string) {
    const nowTime = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(new Date());
    const exists = selectedActions.includes(label);
    const nextActions = exists
      ? selectedActions.filter((item) => item !== label)
      : [...selectedActions, label];
    const nextTimeline = exists
      ? timelineEvents
      : [...timelineEvents, { time: nowTime, label: `Procedimento marcado: ${label}` }];
    updateCurrentDraft({
      selectedActions: nextActions,
      timelineEvents: nextTimeline,
    });
  }

  function buildRecordForSession(target: ActiveSession): {
    record: RecentConnectionRecord;
    reportText: string;
    syncMeta: boolean;
  } {
    const draft = localDrafts[target.deviceId] ?? {
      notes: target.draftNotes ?? '',
      resolutionStatus: target.draftResolutionStatus ?? 'resolved',
      selectedActions: target.draftSelectedActions ?? DEFAULT_SELECTED_ACTIONS,
      timelineEvents: buildInitialTimelineForSession(target, clientEnv.clientPlatform),
      syncToDeviceMeta: target.draftSyncToDeviceMeta ?? true,
    };
    const targetProtocol = target.protocolNumber || generateSessionProtocol(target.startedAt);
    const targetElapsed = getElapsedSecondsFor(target);
    const record: RecentConnectionRecord = {
      protocolNumber: targetProtocol,
      deviceId: target.deviceId,
      displayName: target.displayName,
      hostname: target.hostname,
      organizationName: target.organizationName || 'XPoint',
      organizationId: target.organizationId,
      folderName: target.folderName || 'Clientes',
      rustdeskId: target.rustdeskId,
      operatingSystem: target.operatingSystem || 'Windows',
      osBuild: target.osBuild,
      osBadge: target.osBadge,
      localIp: target.localIp,
      datadivas: target.datadivas,
      deviceStatusAtStart: target.deviceStatusAtStart || 'ONLINE',
      lastSeenBeforeConnect: target.lastSeenBeforeConnect,
      isFavorite: target.isFavorite,
      previousDeviceNotes: target.previousDeviceNotes,
      connectedAt: target.startedAt,
      endedAt: new Date().toISOString(),
      technicianName: target.technicianName,
      technicianEmail: target.technicianEmail,
      clientPlatform: target.clientPlatform || clientEnv.clientPlatform,
      clientNetwork: target.clientNetwork || clientEnv.clientNetwork,
      clientViewport: target.clientViewport || clientEnv.clientViewport,
      mode: target.mode || 'automatic',
      durationSeconds: targetElapsed,
      resolutionStatus: draft.resolutionStatus,
      executedActions: draft.selectedActions,
      timelineEvents: draft.timelineEvents,
      notes: draft.notes.trim(),
    };
    return {
      record,
      reportText: buildAutomatedTechnicalReport(record),
      syncMeta: draft.syncToDeviceMeta,
    };
  }

  const { record: liveRecord, reportText: autoGeneratedReport } =
    buildRecordForSession(currentSession);

  function saveSingleSessionToStorage(target: ActiveSession) {
    const { record, syncMeta } = buildRecordForSession(target);
    const targetProtocol = record.protocolNumber || generateSessionProtocol(target.startedAt);
    const targetElapsed = record.durationSeconds ?? 0;
    const targetStatus = record.resolutionStatus ?? 'resolved';
    const targetActions = record.executedActions ?? DEFAULT_SELECTED_ACTIONS;
    const targetNotes = record.notes ?? '';
    const endTimeStr = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(new Date());

    const finalTimeline: SessionTimelineEvent[] = [
      ...(record.timelineEvents ?? []),
      {
        time: endTimeStr,
        label: `Atendimento finalizado (${RESOLUTION_STATUS_LABELS[targetStatus]}) com duração de ${formatSessionElapsedTime(
          targetElapsed
        )}`,
      },
    ];

    const summaryNote = [
      `[${targetProtocol}] ${RESOLUTION_STATUS_LABELS[targetStatus]}`,
      targetActions.length > 0 ? `Ações: ${targetActions.join('; ')}` : '',
      targetNotes ? `Obs: ${targetNotes}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    updateRecentConnectionNotes(target.deviceId, target.startedAt, summaryNote, targetElapsed, {
      ...record,
      timelineEvents: finalTimeline,
      endedAt: new Date().toISOString(),
    });

    if (syncMeta) {
      const existingMeta = getCustomMetadataMap()[target.deviceId];
      const shortDate = new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date());
      const autoStamp = `Último suporte (${shortDate} por ${target.technicianName} · ${formatSessionElapsedTime(
        targetElapsed
      )}): ${targetActions[0] || 'Verificação remota'}${targetNotes ? ` - ${targetNotes}` : ''}`;
      saveDeviceCustomMetadata(target.deviceId, {
        ...existingMeta,
        notes: existingMeta?.notes ? existingMeta.notes : autoStamp,
      });
    }
  }

  function closeTargetSession(deviceId: string) {
    setLocalDrafts((prev) => {
      const copy = { ...prev };
      delete copy[deviceId];
      return copy;
    });
    if (onCloseSession) {
      onCloseSession(deviceId);
    } else {
      onClose();
    }
  }

  function persistDocumentation(closeAfterMs = 900, stayInModalForNext = false) {
    if (!currentSession) return;
    const targetId = currentSession.deviceId;
    saveSingleSessionToStorage(currentSession);
    onSaved?.();

    const remainingSessions = sessionList.filter((s) => s.deviceId !== targetId);
    if (stayInModalForNext && remainingSessions.length > 0) {
      const nextTarget = remainingSessions[remainingSessions.length - 1] ?? remainingSessions[0];
      closeTargetSession(targetId);
      if (nextTarget) {
        selectSessionById(nextTarget.deviceId);
      }
      return;
    }

    if (closeAfterMs > 0) {
      setIsSaved(true);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        setIsSaved(false);
        if (remainingSessions.length === 0) {
          setShowDocumentation(false);
        }
        closeTargetSession(targetId);
      }, closeAfterMs);
    } else {
      closeTargetSession(targetId);
    }
  }

  function handleQuickOneTapAutoDoc() {
    if (!currentSession) return;
    const targetId = currentSession.deviceId;
    saveSingleSessionToStorage(currentSession);
    onSaved?.();
    setQuickAutoSaved(true);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setQuickAutoSaved(false);
      closeTargetSession(targetId);
    }, 550);
  }

  function handleDismissWithAutoSave() {
    if (!currentSession) return;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    saveSingleSessionToStorage(currentSession);
    onSaved?.();
    closeTargetSession(currentSession.deviceId);
  }

  function handleSaveAndCloseAllSessions() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    for (const item of sessionList) {
      saveSingleSessionToStorage(item);
    }
    setLocalDrafts({});
    setShowDocumentation(false);
    onSaved?.();
    if (onCloseAllSessions) {
      onCloseAllSessions();
    } else {
      onClose();
    }
  }

  function handleCycleSession(delta: number) {
    if (sessionList.length <= 1) return;
    const nextIdx = (currentIndex + delta + sessionList.length) % sessionList.length;
    const target = sessionList[nextIdx];
    if (target) {
      selectSessionById(target.deviceId);
    }
  }

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

  const hasMultipleSessions = sessionList.length > 1;
  const remainingCount = Math.max(0, sessionList.length - 1);

  return (
    <div className="active-session-widget animate-in fade-in slide-in-from-bottom-4 duration-300">
      {isMinimized ? (
        <div className="active-session-minimized-pill">
          <button
            type="button"
            className="session-minimized-expand-btn"
            onClick={() => setIsMinimized(false)}
            title="Expandir painel de sessões ativas para documentar"
            aria-label="Expandir sessões ativas"
          >
            <div className="session-status-pulse" aria-hidden="true">
              <span className="pulse-dot" />
              <span className="pulse-ring" />
            </div>
            <span className="session-minimized-label">
              {hasMultipleSessions
                ? `${sessionList.length} máquinas conectadas`
                : currentSession.displayName}
            </span>
            <span className="session-timer">
              <Clock size={12} />
              <span>{formatSessionElapsedTime(elapsed)}</span>
            </span>
            <Maximize2 size={14} className="text-sky-400" />
          </button>
        </div>
      ) : (
        /* HUD Flutuante Multi-Sessão (Responsivo para PC, Tablet e Celular) */
        <div className="active-session-bar">
          {hasMultipleSessions && (
            <div className="session-multi-switcher">
              <div className="session-multi-header">
                <div className="session-multi-badge" title="Múltiplas máquinas conectadas simultaneamente">
                  <Layers size={13} className="text-sky-400" />
                  <span>{sessionList.length} máquinas ativas</span>
                  <span className="session-multi-counter">
                    ({currentIndex + 1}/{sessionList.length})
                  </span>
                </div>

                <div className="session-multi-controls">
                  <button
                    type="button"
                    className="session-multi-nav-btn"
                    onClick={() => handleCycleSession(-1)}
                    title="Máquina anterior"
                    aria-label="Máquina anterior"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="session-multi-nav-btn"
                    onClick={() => handleCycleSession(1)}
                    title="Próxima máquina"
                    aria-label="Próxima máquina"
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type="button"
                    className="session-multi-save-all-btn"
                    onClick={handleSaveAndCloseAllSessions}
                    title="Salvar laudo automático de todas as máquinas conectadas e encerrar"
                  >
                    <CheckCircle2 size={12} />
                    <span>Salvar todas ({sessionList.length})</span>
                  </button>
                  <button
                    type="button"
                    className="session-multi-nav-btn"
                    onClick={() => setIsMinimized(true)}
                    title="Minimizar card flutuante"
                    aria-label="Minimizar card flutuante"
                  >
                    <Minimize2 size={13} />
                  </button>
                </div>
              </div>

              <div
                className="session-multi-tabs"
                role="tablist"
                aria-label="Alternar entre máquinas conectadas"
              >
                {sessionList.map((item, idx) => {
                  const isActive = item.deviceId === currentSession.deviceId;
                  const itemElapsed = getElapsedSecondsFor(item);
                  const itemDraft = localDrafts[item.deviceId];
                  const hasCustomDoc = Boolean(
                    (itemDraft?.notes && itemDraft.notes.trim().length > 0) ||
                      (item.draftNotes && item.draftNotes.trim().length > 0) ||
                      (itemDraft?.selectedActions && itemDraft.selectedActions.length > 1) ||
                      (item.draftSelectedActions && item.draftSelectedActions.length > 1)
                  );
                  return (
                    <button
                      key={item.deviceId}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`session-multi-tab ${isActive ? 'active' : ''}`}
                      onClick={() => selectSessionById(item.deviceId)}
                      title={`Alternar para ${item.displayName} (${formatRustDeskIdDisplay(
                        item.rustdeskId
                      )})`}
                    >
                      <span className="session-tab-dot" />
                      <span className="session-tab-name">
                        {idx + 1}. {item.displayName}
                      </span>
                      <span className="session-tab-timer">
                        {formatSessionElapsedTime(itemElapsed)}
                      </span>
                      {hasCustomDoc && (
                        <CheckCircle2
                          size={11}
                          className="text-emerald-400 shrink-0"
                          aria-label="Rascunho preenchido"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="session-hud-top">
            <div className="session-status-pulse" aria-hidden="true">
              <span className="pulse-dot" />
              <span className="pulse-ring" />
            </div>
            <div className="session-title-wrap">
              <span className="session-title" title={currentSession.displayName}>
                <Laptop size={14} className="session-laptop-icon" />
                <strong>{currentSession.displayName}</strong>
              </span>
              <span className="session-protocol-pill">{protocolNumber}</span>
            </div>
            {!hasMultipleSessions && (
              <button
                type="button"
                className="session-close-btn"
                onClick={() => setIsMinimized(true)}
                title="Minimizar card de sessão"
                aria-label="Minimizar card de sessão"
              >
                <Minimize2 size={14} />
              </button>
            )}
            <button
              type="button"
              className="session-close-btn"
              onClick={handleDismissWithAutoSave}
              title={
                hasMultipleSessions
                  ? `Encerrar e salvar telemetria de ${currentSession.displayName}`
                  : 'Encerrar e salvar telemetria automaticamente'
              }
              aria-label="Encerrar e salvar telemetria automaticamente"
            >
              <X size={16} />
            </button>
          </div>

          <div className="session-hud-bottom">
            <div className="session-meta">
              <User size={12} className="inline mr-1" />
              <span className="session-meta-tech">{currentSession.technicianName}</span>
              <span className="session-meta-sep">·</span>
              <span className="session-meta-id">
                {formatRustDeskIdDisplay(currentSession.rustdeskId)}
              </span>
              {currentSession.osBadge && (
                <span className="session-meta-os">{currentSession.osBadge}</span>
              )}
            </div>

            <div className="session-hud-actions">
              <div className="session-timer" title="Tempo de sessão ativa nesta máquina">
                <Clock size={13} />
                <span>{formatSessionElapsedTime(elapsed)}</span>
              </div>

              <button
                type="button"
                className="session-autodoc-quick-btn"
                onClick={handleQuickOneTapAutoDoc}
                title={`Encerrar e documentar ${currentSession.displayName} com 1 clique`}
              >
                {quickAutoSaved ? <Check size={14} /> : <Zap size={14} />}
                <span>{quickAutoSaved ? 'Salvo Auto!' : 'Auto 1-Click'}</span>
              </button>

              <button
                type="button"
                className="session-document-btn"
                onClick={() => setShowDocumentation(true)}
                title="Abrir central de documentação automatizada com laudo por máquina"
              >
                <FileText size={14} />
                <span>Documentar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Completo de Documentação Automatizada com Suporte Multi-Máquinas */}
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
                    {hasMultipleSessions && (
                      <span className="session-protocol-badge">
                        Máquina {currentIndex + 1} de {sessionList.length}
                      </span>
                    )}
                  </div>
                  <p className="session-autodoc-subtitle">
                    {hasMultipleSessions
                      ? 'Selecione cada máquina conectada abaixo para registrar individualmente o que foi feito'
                      : 'Telemetria completa da máquina, rede, duração e laudo técnico preenchidos automaticamente'}
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
              {/* Seletor Multi-Máquinas dentro do Modal de Documentação */}
              {hasMultipleSessions && (
                <div className="autodoc-multi-bar">
                  <div className="autodoc-section-header">
                    <span className="autodoc-section-title">
                      <Layers size={14} /> Máquinas Conectadas Neste Atendimento ({sessionList.length})
                    </span>
                    <span className="autodoc-counter-badge">
                      Alternância rápida sem perder o rascunho de cada máquina
                    </span>
                  </div>
                  <div
                    className="autodoc-multi-grid"
                    role="tablist"
                    aria-label="Selecionar máquina para documentar"
                  >
                    {sessionList.map((item, idx) => {
                      const isActive = item.deviceId === currentSession.deviceId;
                      const itemElapsed = getElapsedSecondsFor(item);
                      const itemDraft = localDrafts[item.deviceId];
                      const itemNotes = itemDraft?.notes ?? item.draftNotes ?? '';
                      const itemActions =
                        itemDraft?.selectedActions ??
                        item.draftSelectedActions ??
                        DEFAULT_SELECTED_ACTIONS;
                      return (
                        <button
                          key={item.deviceId}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          className={`autodoc-machine-card ${isActive ? 'active' : ''}`}
                          onClick={() => selectSessionById(item.deviceId)}
                        >
                          <div className="autodoc-machine-card-top">
                            <span className="autodoc-machine-name">
                              <Laptop size={13} className="inline mr-1 text-sky-400" />
                              {idx + 1}. {item.displayName}
                            </span>
                            <span className="autodoc-machine-timer">
                              <Clock size={11} />
                              {formatSessionElapsedTime(itemElapsed)}
                            </span>
                          </div>
                          <div className="autodoc-machine-card-meta">
                            <span className="font-mono">
                              {formatRustDeskIdDisplay(item.rustdeskId)}
                            </span>
                            <span>·</span>
                            <span>
                              {itemActions.length} ação(ões)
                              {itemNotes.trim() ? ' · C/ obs' : ''}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Grade com Máximo de Dados Coletados Automaticamente */}
              <div className="autodoc-telemetry-section">
                <div className="autodoc-section-header">
                  <span className="autodoc-section-title">
                    <Cpu size={14} /> Dados Coletados Automaticamente (12 Indicadores)
                  </span>
                  <span className="autodoc-live-timer-pill">
                    <Clock size={12} /> Duração: {formatSessionElapsedTime(elapsed)}
                  </span>
                </div>

                <div className="autodoc-telemetry-grid">
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Computador / Cliente</span>
                    <strong className="autodoc-cell-value">{currentSession.displayName}</strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Hostname & ID RustDesk</span>
                    <strong className="autodoc-cell-value font-mono">
                      {currentSession.hostname} ·{' '}
                      {formatRustDeskIdDisplay(currentSession.rustdeskId)}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Organização & Pasta</span>
                    <strong className="autodoc-cell-value">
                      <Folder size={12} className="inline mr-1 text-sky-400" />
                      {currentSession.organizationName || 'XPoint'} ›{' '}
                      {currentSession.folderName || 'Clientes'}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Sistema Operacional & Build</span>
                    <strong className="autodoc-cell-value">
                      {currentSession.operatingSystem || 'Windows'}
                      {currentSession.osBuild ? ` (${currentSession.osBuild})` : ''}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Rede Local / Roteamento</span>
                    <strong className="autodoc-cell-value font-mono">
                      <Globe size={12} className="inline mr-1 text-emerald-400" />
                      {currentSession.localIp || 'NAT P2P / Relay 21117'}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Técnico Responsável</span>
                    <strong className="autodoc-cell-value">
                      {currentSession.technicianName}
                      {currentSession.technicianEmail
                        ? ` (${currentSession.technicianEmail})`
                        : ''}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Dispositivo do Técnico</span>
                    <strong className="autodoc-cell-value">
                      {currentSession.clientPlatform || clientEnv.clientPlatform}
                    </strong>
                  </div>
                  <div className="autodoc-telemetry-cell">
                    <span className="autodoc-cell-label">Rede & Resolução de Origem</span>
                    <strong className="autodoc-cell-value">
                      {currentSession.clientNetwork || clientEnv.clientNetwork} ·{' '}
                      {currentSession.clientViewport || clientEnv.clientViewport}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Status Final de Resolução (1 Toque) */}
              <div className="autodoc-block">
                <span className="autodoc-section-title">
                  <ShieldCheck size={14} /> Status de Conclusão ({currentSession.displayName})
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
                      onClick={() => updateCurrentDraft({ resolutionStatus: st.id })}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Checklist Inteligente de Ações em 1 Toque */}
              <div className="autodoc-block">
                <div className="autodoc-section-header">
                  <span className="autodoc-section-title">
                    <Zap size={14} /> O que foi feito em {currentSession.displayName}? (Toque Rápido)
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
                  <FileText size={14} /> Observação Específica para {currentSession.displayName}{' '}
                  (Opcional):
                </label>
                <textarea
                  id="session-notes-input"
                  className="session-notes-textarea"
                  placeholder={`Digite aqui detalhes extras realizados especificamente em ${currentSession.displayName}...`}
                  rows={2}
                  value={notes}
                  onChange={(e) => updateCurrentDraft({ notes: e.target.value })}
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
                  onChange={(e) => updateCurrentDraft({ syncToDeviceMeta: e.target.checked })}
                />
                <span>
                  Vincular resumo deste protocolo (<strong>{protocolNumber}</strong>) na ficha da
                  máquina
                </span>
              </label>

              {isSaved && (
                <p className="session-save-success" role="status">
                  <CheckCircle2 size={16} />
                  Laudo técnico de {currentSession.displayName} salvo no Histórico!
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
              {hasMultipleSessions && (
                <button
                  type="button"
                  className="command-button"
                  onClick={() => persistDocumentation(0, true)}
                  disabled={isSaved}
                  title="Salva o laudo desta máquina e alterna imediatamente para a próxima máquina conectada"
                >
                  <CheckCircle2 size={16} />
                  Salvar e Ir p/ Próxima ({remainingCount})
                </button>
              )}
              <button
                type="button"
                className="primary-button guide-link"
                onClick={() => persistDocumentation(900, false)}
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
