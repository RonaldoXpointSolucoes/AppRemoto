'use client';

import { useEffect, useState } from 'react';
import { Clock, CheckCircle2, X, FileText, User, Laptop } from 'lucide-react';
import { updateRecentConnectionNotes } from './teamviewer-storage';

export interface ActiveSession {
  deviceId: string;
  displayName: string;
  hostname: string;
  rustdeskId: string;
  technicianName: string;
  startedAt: string;
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
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [notes, setNotes] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (!session) {
      setElapsed(0);
      setShowDocumentation(false);
      setNotes('');
      setIsSaved(false);
      return;
    }
    const start = new Date(session.startedAt).getTime();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  if (!session) return null;

  function formatTime(totalSeconds: number) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  function handleSaveDocumentation() {
    if (!session) return;
    updateRecentConnectionNotes(session.deviceId, session.startedAt, notes.trim(), elapsed);
    setIsSaved(true);
    onSaved?.();
    setTimeout(() => {
      onClose();
    }, 1200);
  }

  return (
    <div className="active-session-widget animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="active-session-bar">
        <div className="session-status-pulse">
          <span className="pulse-dot" />
          <span className="pulse-ring" />
        </div>
        <div className="session-info">
          <span className="session-title">
            <Laptop size={14} className="inline mr-1" />
            Sessão com <strong>{session.displayName}</strong>
          </span>
          <span className="session-meta">
            <User size={12} className="inline mr-1" />
            {session.technicianName} · ID: {session.rustdeskId}
          </span>
        </div>
        <div className="session-timer">
          <Clock size={15} />
          <span>{formatTime(elapsed)}</span>
        </div>
        <button
          type="button"
          className="session-document-btn"
          onClick={() => setShowDocumentation(true)}
          title="Documentar e finalizar atendimento"
        >
          <FileText size={15} />
          Documentar
        </button>
        <button
          type="button"
          className="session-close-btn"
          onClick={onClose}
          title="Ocultar cronômetro"
        >
          <X size={16} />
        </button>
      </div>

      {showDocumentation && (
        <div className="session-modal-overlay" onClick={() => setShowDocumentation(false)}>
          <div className="session-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="session-modal-header">
              <h3>
                <FileText size={18} />
                Documentar Atendimento
              </h3>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowDocumentation(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="session-modal-body">
              <div className="session-summary-grid">
                <div>
                  <span className="summary-label">Computador:</span>
                  <span className="summary-value">{session.displayName} ({session.hostname})</span>
                </div>
                <div>
                  <span className="summary-label">Técnico:</span>
                  <span className="summary-value">{session.technicianName}</span>
                </div>
                <div>
                  <span className="summary-label">Tempo decorrido:</span>
                  <span className="summary-value highlight-timer">{formatTime(elapsed)}</span>
                </div>
                <div>
                  <span className="summary-label">Iniciado às:</span>
                  <span className="summary-value">
                    {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(session.startedAt))}
                  </span>
                </div>
              </div>

              <div className="field" style={{ marginTop: '16px' }}>
                <label htmlFor="session-notes-input">
                  Ações executadas / Notas técnicas do suporte:
                </label>
                <textarea
                  id="session-notes-input"
                  className="session-notes-textarea"
                  placeholder="Ex: Atualização do sistema, configuração de impressora fiscal, limpeza de arquivos temporários..."
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={isSaved}
                />
              </div>

              {isSaved && (
                <p className="session-save-success" role="status">
                  <CheckCircle2 size={16} />
                  Atendimento documentado com sucesso no histórico de conexões!
                </p>
              )}
            </div>
            <div className="session-modal-footer">
              <button
                type="button"
                className="command-button"
                onClick={() => setShowDocumentation(false)}
                disabled={isSaved}
              >
                Continuar Conectado
              </button>
              <button
                type="button"
                className="primary-button guide-link"
                onClick={handleSaveDocumentation}
                disabled={isSaved}
              >
                <CheckCircle2 size={16} />
                {isSaved ? 'Salvo!' : 'Salvar no Histórico'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
