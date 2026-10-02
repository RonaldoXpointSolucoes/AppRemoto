'use client';

import { useState } from 'react';
import { History, Search, Download, Clock, User, Laptop, FileText, CheckCircle2, ChevronRight } from 'lucide-react';
import { getRecentConnections, type RecentConnectionRecord } from './teamviewer-storage';

export function ConnectionHistoryView({
  onConnectAgain,
}: {
  onConnectAgain?(record: RecentConnectionRecord): void;
}) {
  const [records, setRecords] = useState<RecentConnectionRecord[]>(() => getRecentConnections());
  const [search, setSearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<RecentConnectionRecord | null>(null);

  const filtered = records.filter((r) => {
    const term = search.toLowerCase();
    return (
      r.displayName.toLowerCase().includes(term) ||
      r.hostname.toLowerCase().includes(term) ||
      r.rustdeskId.includes(term) ||
      r.technicianName.toLowerCase().includes(term) ||
      (r.notes && r.notes.toLowerCase().includes(term))
    );
  });

  function exportHistoryReport() {
    const text = filtered.map((r, i) => {
      const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(r.connectedAt));
      const dur = r.durationSeconds ? `${Math.floor(r.durationSeconds / 60)}m ${r.durationSeconds % 60}s` : 'N/A';
      return `[${i + 1}] DATA: ${date}\nDISPOSITIVO: ${r.displayName} (${r.hostname})\nID RUSTDESK: ${r.rustdeskId}\nTÉCNICO: ${r.technicianName}\nMODO: ${r.mode}\nDURAÇÃO: ${dur}\nAÇÕES / NOTAS: ${r.notes || 'Sem observações'}\n----------------------------------------\n`;
    }).join('\n');

    const blob = new Blob([`RELATÓRIO DE ATENDIMENTOS E ACESSOS REMOTOS - XPOINT REMOTE\nGerado em: ${new Date().toLocaleString('pt-BR')}\nTotal de atendimentos: ${filtered.length}\n\n========================================\n\n${text}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Relatorio-Acessos-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatDuration(sec?: number) {
    if (!sec) return 'Não cronometrado';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m > 0) return `${m} min ${s} seg`;
    return `${s} segundos`;
  }

  return (
    <div className="history-view-shell animate-in fade-in duration-300">
      <div className="history-header">
        <div>
          <h2>
            <History size={22} className="inline mr-2 text-primary" />
            Histórico de Conexões e Atendimentos
          </h2>
          <p className="history-subtitle">
            Auditoria completa de todos os acessos remotos realizados, técnicos responsáveis, tempo de chamada e documentação técnica.
          </p>
        </div>
        <div className="history-actions">
          <button
            type="button"
            className="command-button"
            onClick={exportHistoryReport}
            disabled={filtered.length === 0}
          >
            <Download size={16} />
            Exportar Relatório TXT
          </button>
        </div>
      </div>

      <div className="history-search-bar">
        <Search size={18} className="search-icon" />
        <input
          type="search"
          placeholder="Buscar por computador, ID, técnico ou ações executadas..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="history-count-badge">
          {filtered.length} {filtered.length === 1 ? 'registro' : 'registros'}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="history-empty-state">
          <History size={48} className="empty-icon" />
          <p className="empty-title">Nenhum histórico encontrado</p>
          <p className="empty-desc">
            As conexões e atendimentos realizados através do painel aparecerão aqui automaticamente com data, hora e técnico.
          </p>
        </div>
      ) : (
        <div className="history-list">
          {filtered.map((item) => {
            const dateStr = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.connectedAt));
            return (
              <div
                key={`${item.deviceId}-${item.connectedAt}`}
                className="history-card"
                onClick={() => setSelectedRecord(item)}
              >
                <div className="history-card-main">
                  <div className="history-device-icon">
                    <Laptop size={20} />
                  </div>
                  <div className="history-details">
                    <div className="history-title-row">
                      <strong className="device-name">{item.displayName}</strong>
                      <span className="device-host">({item.hostname})</span>
                      <span className="rustdesk-id-badge">ID: {item.rustdeskId}</span>
                    </div>
                    <div className="history-meta-row">
                      <span className="meta-item">
                        <Clock size={13} /> {dateStr}
                      </span>
                      <span className="meta-item">
                        <User size={13} /> {item.technicianName}
                      </span>
                      <span className="meta-item duration-badge">
                        Duração: {formatDuration(item.durationSeconds)}
                      </span>
                    </div>
                    {item.notes && (
                      <p className="history-notes-preview">
                        <FileText size={13} className="inline mr-1" />
                        <strong>Ações:</strong> {item.notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="history-card-actions">
                  {onConnectAgain && (
                    <button
                      type="button"
                      className="primary-button-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConnectAgain(item);
                      }}
                      title="Conectar novamente com 1 clique"
                    >
                      Reconectar
                    </button>
                  )}
                  <ChevronRight size={18} className="arrow-icon" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedRecord && (
        <div className="session-modal-overlay" onClick={() => setSelectedRecord(null)}>
          <div className="session-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="session-modal-header">
              <h3>
                <FileText size={18} />
                Detalhes do Atendimento
              </h3>
              <button type="button" className="icon-button" onClick={() => setSelectedRecord(null)}>
                ✕
              </button>
            </div>
            <div className="session-modal-body">
              <div className="session-summary-grid">
                <div>
                  <span className="summary-label">Dispositivo:</span>
                  <span className="summary-value">{selectedRecord.displayName}</span>
                </div>
                <div>
                  <span className="summary-label">Hostname:</span>
                  <span className="summary-value">{selectedRecord.hostname}</span>
                </div>
                <div>
                  <span className="summary-label">ID RustDesk:</span>
                  <span className="summary-value font-mono">{selectedRecord.rustdeskId}</span>
                </div>
                <div>
                  <span className="summary-label">Técnico Responsável:</span>
                  <span className="summary-value">{selectedRecord.technicianName}</span>
                </div>
                <div>
                  <span className="summary-label">Data e Hora:</span>
                  <span className="summary-value">
                    {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'medium' }).format(new Date(selectedRecord.connectedAt))}
                  </span>
                </div>
                <div>
                  <span className="summary-label">Tempo de Sessão:</span>
                  <span className="summary-value highlight-timer">{formatDuration(selectedRecord.durationSeconds)}</span>
                </div>
              </div>

              <div style={{ marginTop: '16px' }}>
                <span className="summary-label">Documentação das Ações Executadas:</span>
                <div className="history-notes-box">
                  {selectedRecord.notes ? selectedRecord.notes : 'Nenhuma observação técnica registrada para este atendimento.'}
                </div>
              </div>
            </div>
            <div className="session-modal-footer">
              <button type="button" className="command-button" onClick={() => setSelectedRecord(null)}>
                Fechar
              </button>
              {onConnectAgain && (
                <button
                  type="button"
                  className="primary-button guide-link"
                  onClick={() => {
                    const rec = selectedRecord;
                    setSelectedRecord(null);
                    onConnectAgain(rec);
                  }}
                >
                  <CheckCircle2 size={16} />
                  Conectar a este Computador
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
