'use client';

import { useEffect, useState } from 'react';
import {
  History,
  Search,
  Download,
  Clock,
  User,
  Laptop,
  FileText,
  CheckCircle2,
  ChevronRight,
  Copy,
  Check,
  Share2,
  Cpu,
  Globe,
  Folder,
  Sparkles,
  ShieldCheck,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  getRecentConnections,
  getDeviceAuditLogs,
  buildAutomatedTechnicalReport,
  RESOLUTION_STATUS_LABELS,
  type RecentConnectionRecord,
  type DeviceAuditLogRecord,
} from './teamviewer-storage';

export function ConnectionHistoryView({
  onConnectAgain,
}: {
  onConnectAgain?(record: RecentConnectionRecord): void;
}) {
  const [records, setRecords] = useState<RecentConnectionRecord[]>(() => getRecentConnections());
  const [auditLogs, setAuditLogs] = useState<DeviceAuditLogRecord[]>(() => getDeviceAuditLogs());
  const [viewFilter, setViewFilter] = useState<'all' | 'sessions' | 'audit'>('all');
  const [search, setSearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<RecentConnectionRecord | null>(null);
  const [copiedProtocol, setCopiedProtocol] = useState<string | null>(null);

  useEffect(() => {
    const syncAll = () => {
      setRecords(getRecentConnections());
      setAuditLogs(getDeviceAuditLogs());
    };
    window.addEventListener('xpoint:recent-connections-updated', syncAll);
    window.addEventListener('xpoint:device-audit-logs-updated', syncAll);
    return () => {
      window.removeEventListener('xpoint:recent-connections-updated', syncAll);
      window.removeEventListener('xpoint:device-audit-logs-updated', syncAll);
    };
  }, []);

  const filtered = records.filter((r) => {
    const term = search.toLowerCase();
    return (
      r.displayName.toLowerCase().includes(term) ||
      r.hostname.toLowerCase().includes(term) ||
      r.rustdeskId.includes(term) ||
      r.technicianName.toLowerCase().includes(term) ||
      (r.protocolNumber && r.protocolNumber.toLowerCase().includes(term)) ||
      (r.folderName && r.folderName.toLowerCase().includes(term)) ||
      (r.operatingSystem && r.operatingSystem.toLowerCase().includes(term)) ||
      (r.executedActions && r.executedActions.some((a) => a.toLowerCase().includes(term))) ||
      (r.notes && r.notes.toLowerCase().includes(term))
    );
  });

  const filteredAuditLogs = auditLogs.filter((log) => {
    const term = search.toLowerCase();
    return (
      log.newDisplayName.toLowerCase().includes(term) ||
      (log.previousDisplayName && log.previousDisplayName.toLowerCase().includes(term)) ||
      log.hostname.toLowerCase().includes(term) ||
      log.rustdeskId.includes(term) ||
      log.technicianName.toLowerCase().includes(term) ||
      log.protocolNumber.toLowerCase().includes(term) ||
      log.summary.toLowerCase().includes(term) ||
      (log.newFolderName && log.newFolderName.toLowerCase().includes(term))
    );
  });

  const totalSecondsAll = filtered.reduce((acc, r) => acc + (r.durationSeconds || 0), 0);
  const uniqueDevicesCount = new Set(filtered.map((r) => r.deviceId || r.rustdeskId)).size;
  const resolvedCount = filtered.filter(
    (r) => !r.resolutionStatus || r.resolutionStatus === 'resolved'
  ).length;

  function exportHistoryReportTxt() {
    const auditSection =
      filteredAuditLogs.length > 0
        ? `LOGS DE EDIÇÃO E EXCLUSÃO DE CLIENTES (${filteredAuditLogs.length})\n` +
          filteredAuditLogs
            .map(
              (log, idx) =>
                `LOG #${idx + 1} [${log.protocolNumber}] - ${new Date(log.timestamp).toLocaleString('pt-BR')}\n` +
                `• Ação: ${log.action}\n` +
                (log.previousDisplayName && log.previousDisplayName !== log.newDisplayName
                  ? `• Alteração de Nome: "${log.previousDisplayName}" -> "${log.newDisplayName}"\n`
                  : `• Cliente / Máquina: ${log.newDisplayName}\n`) +
                `• Hostname / ID: ${log.hostname} | ID RustDesk: ${log.rustdeskId}\n` +
                `• Responsável: ${log.technicianName}${log.technicianEmail ? ` (${log.technicianEmail})` : ''}\n` +
                `• Resumo: ${log.summary}\n` +
                `----------------------------------------`
            )
            .join('\n') +
          `\n\n========================================\n\n`
        : '';

    const text = filtered
      .map((r, i) => {
        const report = r.autoReportText || buildAutomatedTechnicalReport(r);
        return `ATENDIMENTO #${i + 1}\n${report}\n========================================\n`;
      })
      .join('\n');

    const blob = new Blob(
      [
        `RELATÓRIO DE AUDITORIA E LAUDOS AUTOMATIZADOS - XPOINT REMOTE\nGerado em: ${new Date().toLocaleString(
          'pt-BR'
        )}\nTotal de sessões auditadas: ${filtered.length}\nTotal de logs de edição/exclusão: ${filteredAuditLogs.length}\n\n========================================\n\n${auditSection}${text}`,
      ],
      { type: 'text/plain;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Auditoria-Atendimentos-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportHistoryReportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      totalSessions: filtered.length,
      totalAuditLogs: filteredAuditLogs.length,
      totalSupportDurationSeconds: totalSecondsAll,
      uniqueDevicesCount,
      deviceAuditLogs: filteredAuditLogs,
      sessions: filtered.map((r) => ({
        ...r,
        autoReportText: r.autoReportText || buildAutomatedTechnicalReport(r),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Auditoria-Telemetria-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatDuration(sec?: number) {
    if (!sec) return 'Sessão rápida';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s} seg`;
  }

  function handleCopySingleReport(rec: RecentConnectionRecord) {
    const text = rec.autoReportText || buildAutomatedTechnicalReport(rec);
    void navigator.clipboard.writeText(text).then(() => {
      const key = rec.protocolNumber || rec.connectedAt;
      setCopiedProtocol(key);
      setTimeout(() => setCopiedProtocol(null), 2500);
    });
  }

  function handleShareSingleReport(rec: RecentConnectionRecord) {
    const text = rec.autoReportText || buildAutomatedTechnicalReport(rec);
    if (typeof navigator !== 'undefined' && navigator.share) {
      void navigator
        .share({
          title: `Laudo ${rec.protocolNumber || ''} - ${rec.displayName}`,
          text,
        })
        .catch(() => handleCopySingleReport(rec));
    } else {
      handleCopySingleReport(rec);
    }
  }

  return (
    <div className="history-view-shell animate-in fade-in duration-300">
      <div className="history-header">
        <div>
          <h2>
            <History size={22} className="inline mr-2 text-primary" />
            Central de Laudos & Auditoria de Acessos
          </h2>
          <p className="history-subtitle">
            Documentação automatizada de sessões remotas com protocolo único, telemetria de máquina, rede, tempo e procedimentos.
          </p>
        </div>
        <div className="history-actions">
          <button
            type="button"
            className="command-button"
            onClick={exportHistoryReportJson}
            disabled={filtered.length === 0 && filteredAuditLogs.length === 0}
          >
            <Download size={16} />
            Exportar JSON
          </button>
          <button
            type="button"
            className="command-button"
            onClick={exportHistoryReportTxt}
            disabled={filtered.length === 0 && filteredAuditLogs.length === 0}
          >
            <FileText size={16} />
            Exportar Laudos TXT
          </button>
        </div>
      </div>

      {/* KPIs de Telemetria de Suporte */}
      {(records.length > 0 || auditLogs.length > 0) && (
        <div className="history-kpi-strip">
          <div className="history-kpi-card">
            <span className="history-kpi-label">Sessões Auditadas</span>
            <strong className="history-kpi-value">{filtered.length}</strong>
          </div>
          <div className="history-kpi-card">
            <span className="history-kpi-label">Logs de Edição & Exclusão</span>
            <strong className="history-kpi-value text-amber-400">{filteredAuditLogs.length}</strong>
          </div>
          <div className="history-kpi-card">
            <span className="history-kpi-label">Estações Atendidas</span>
            <strong className="history-kpi-value">{uniqueDevicesCount}</strong>
          </div>
          <div className="history-kpi-card">
            <span className="history-kpi-label">Tempo Total Cronometrado</span>
            <strong className="history-kpi-value">{formatDuration(totalSecondsAll)}</strong>
          </div>
          <div className="history-kpi-card">
            <span className="history-kpi-label">Resolução em 1º Nível</span>
            <strong className="history-kpi-value text-emerald-400">
              {filtered.length > 0 ? Math.round((resolvedCount / filtered.length) * 100) : 100}%
            </strong>
          </div>
        </div>
      )}

      {/* Abas de Filtro: Todos / Logs de Edição & Exclusão / Sessões Remotas */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        <button
          type="button"
          className={`command-button ${viewFilter === 'all' ? 'active' : ''}`}
          style={
            viewFilter === 'all'
              ? { background: 'rgba(16, 185, 129, 0.16)', borderColor: 'rgba(16, 185, 129, 0.45)', color: '#34d399' }
              : undefined
          }
          onClick={() => setViewFilter('all')}
        >
          Todos os Registros ({filtered.length + filteredAuditLogs.length})
        </button>
        <button
          type="button"
          className={`command-button ${viewFilter === 'audit' ? 'active' : ''}`}
          style={
            viewFilter === 'audit'
              ? { background: 'rgba(245, 158, 11, 0.16)', borderColor: 'rgba(245, 158, 11, 0.45)', color: '#fbbf24' }
              : undefined
          }
          onClick={() => setViewFilter('audit')}
        >
          <Pencil size={14} />
          Logs de Edição & Exclusão ({filteredAuditLogs.length})
        </button>
        <button
          type="button"
          className={`command-button ${viewFilter === 'sessions' ? 'active' : ''}`}
          style={
            viewFilter === 'sessions'
              ? { background: 'rgba(59, 130, 246, 0.16)', borderColor: 'rgba(59, 130, 246, 0.45)', color: '#60a5fa' }
              : undefined
          }
          onClick={() => setViewFilter('sessions')}
        >
          <Laptop size={14} />
          Laudos de Conexão ({filtered.length})
        </button>
      </div>

      <div className="history-search-bar">
        <Search size={18} className="search-icon" />
        <input
          type="search"
          placeholder="Buscar por protocolo (XP-... / LOG-...), nome anterior ou novo, hostname, ID, técnico..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="history-count-badge">
          {viewFilter === 'audit'
            ? `${filteredAuditLogs.length} logs`
            : viewFilter === 'sessions'
              ? `${filtered.length} laudos`
              : `${filtered.length + filteredAuditLogs.length} registros`}
        </span>
      </div>

      {/* SEÇÃO: LOGS DE AUDITORIA DE EXCLUSÃO E EDIÇÃO DE NOME DE CLIENTES EXISTENTES */}
      {(viewFilter === 'all' || viewFilter === 'audit') && filteredAuditLogs.length > 0 && (
        <div className="history-list" style={{ marginBottom: '18px' }}>
          {filteredAuditLogs.map((log) => {
            const dateStr = new Intl.DateTimeFormat('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'medium',
            }).format(new Date(log.timestamp));
            const isDelete = log.action === 'DELETE_DEVICE';
            const isRename =
              log.action === 'EDIT_NAME' ||
              Boolean(log.previousDisplayName && log.previousDisplayName !== log.newDisplayName);

            return (
              <div
                key={log.id}
                className="history-card"
                style={{
                  borderColor: isDelete
                    ? 'rgba(244, 63, 94, 0.35)'
                    : isRename
                      ? 'rgba(245, 158, 11, 0.35)'
                      : 'rgba(99, 102, 241, 0.3)',
                }}
              >
                <div className="history-card-main">
                  <div
                    className="history-device-icon"
                    style={{
                      background: isDelete
                        ? 'rgba(244, 63, 94, 0.14)'
                        : isRename
                          ? 'rgba(245, 158, 11, 0.14)'
                          : 'rgba(99, 102, 241, 0.14)',
                      color: isDelete ? '#fb7185' : isRename ? '#fbbf24' : '#818cf8',
                    }}
                  >
                    {isDelete ? <Trash2 size={19} /> : <Pencil size={19} />}
                  </div>
                  <div className="history-details">
                    <div className="history-title-row">
                      <span className="session-protocol-pill">{log.protocolNumber}</span>
                      <span
                        className="history-os-badge"
                        style={{
                          background: isDelete
                            ? 'rgba(244, 63, 94, 0.18)'
                            : isRename
                              ? 'rgba(245, 158, 11, 0.18)'
                              : 'rgba(99, 102, 241, 0.18)',
                          color: isDelete ? '#fda4af' : isRename ? '#fde68a' : '#c7d2fe',
                          fontWeight: 700,
                        }}
                      >
                        {isDelete
                          ? '🗑️ EXCLUSÃO DE CLIENTE'
                          : isRename
                            ? '✏️ EDIÇÃO DE NOME DE CLIENTE'
                            : log.action === 'MOVE_FOLDER'
                              ? '📁 MOVIMENTAÇÃO DE PASTA'
                              : '⚙️ EDIÇÃO CADASTRAL'}
                      </span>
                      {isRename ? (
                        <span className="device-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ textDecoration: 'line-through', opacity: 0.65 }}>
                            {log.previousDisplayName}
                          </span>
                          <span>→</span>
                          <strong style={{ color: '#34d399' }}>{log.newDisplayName}</strong>
                        </span>
                      ) : (
                        <strong className="device-name">{log.newDisplayName}</strong>
                      )}
                      <span className="device-host">({log.hostname})</span>
                      <span className="rustdesk-id-badge">ID: {log.rustdeskId}</span>
                      {log.adminOnlyAccess && (
                        <span
                          className="history-os-badge"
                          style={{ background: 'rgba(244, 63, 94, 0.16)', color: '#fda4af' }}
                        >
                          🛡️ Somente Admin
                        </span>
                      )}
                    </div>

                    <div className="history-meta-row">
                      <span className="meta-item">
                        <Clock size={13} /> {dateStr}
                      </span>
                      <span className="meta-item">
                        <User size={13} /> {log.technicianName}
                        {log.technicianEmail ? ` (${log.technicianEmail})` : ''}
                      </span>
                      {(log.newFolderName || log.previousFolderName) && (
                        <span className="meta-item">
                          <Folder size={13} />{' '}
                          {log.previousFolderName &&
                          log.newFolderName &&
                          log.previousFolderName !== log.newFolderName
                            ? `${log.previousFolderName} → ${log.newFolderName}`
                            : log.newFolderName || log.previousFolderName}
                        </span>
                      )}
                    </div>

                    <p className="history-notes-preview">
                      <FileText size={13} className="inline mr-1" />
                      <strong>Registro de Auditoria:</strong> {log.summary}
                    </p>
                  </div>
                </div>

                <div className="history-card-actions">
                  <button
                    type="button"
                    className="autodoc-mini-btn"
                    onClick={() => {
                      const text = `[${log.protocolNumber}] ${dateStr}\n${log.summary}\nHostname: ${log.hostname} | ID RustDesk: ${log.rustdeskId}\nResponsável: ${log.technicianName}`;
                      void navigator.clipboard.writeText(text).then(() => {
                        setCopiedProtocol(log.protocolNumber);
                        setTimeout(() => setCopiedProtocol(null), 2500);
                      });
                    }}
                    title="Copiar log de auditoria"
                  >
                    {copiedProtocol === log.protocolNumber ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedProtocol === log.protocolNumber ? 'Copiado!' : 'Copiar Log'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewFilter === 'audit' && filteredAuditLogs.length === 0 ? (
        <div className="history-empty-state">
          <History size={48} className="empty-icon" />
          <p className="empty-title">Nenhum log de edição ou exclusão registrado</p>
          <p className="empty-desc">
            Sempre que o nome de um cliente existente for editado ou uma máquina for excluída, o log detalhado com antes/depois e o operador responsável aparecerá aqui automaticamente.
          </p>
        </div>
      ) : viewFilter !== 'audit' && filtered.length === 0 && filteredAuditLogs.length === 0 ? (
        <div className="history-empty-state">
          <History size={48} className="empty-icon" />
          <p className="empty-title">Nenhum registro encontrado</p>
          <p className="empty-desc">
            Ao iniciar qualquer acesso remoto, editar nomes de clientes ou excluir registros, o sistema gera automaticamente a trilha de auditoria.
          </p>
        </div>
      ) : viewFilter !== 'audit' ? (
        <div className="history-list">
          {filtered.map((item) => {
            const dateStr = new Intl.DateTimeFormat('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'medium',
            }).format(new Date(item.connectedAt));
            const statusKey = item.resolutionStatus || 'resolved';
            const copyKey = item.protocolNumber || item.connectedAt;

            return (
              <div
                key={`${item.deviceId}-${item.connectedAt}-${item.protocolNumber || ''}`}
                className="history-card"
                onClick={() => setSelectedRecord(item)}
              >
                <div className="history-card-main">
                  <div className="history-device-icon">
                    <Laptop size={20} />
                  </div>
                  <div className="history-details">
                    <div className="history-title-row">
                      {item.protocolNumber && (
                        <span className="session-protocol-pill">{item.protocolNumber}</span>
                      )}
                      <strong className="device-name">{item.displayName}</strong>
                      <span className="device-host">({item.hostname})</span>
                      <span className="rustdesk-id-badge">ID: {item.rustdeskId}</span>
                      {item.osBadge && <span className="history-os-badge">{item.osBadge}</span>}
                      <span className={`history-resolution-pill status-${statusKey}`}>
                        {RESOLUTION_STATUS_LABELS[statusKey]}
                      </span>
                    </div>

                    <div className="history-meta-row">
                      <span className="meta-item">
                        <Clock size={13} /> {dateStr}
                      </span>
                      <span className="meta-item">
                        <User size={13} /> {item.technicianName}
                      </span>
                      {item.folderName && (
                        <span className="meta-item">
                          <Folder size={13} /> {item.folderName}
                        </span>
                      )}
                      {item.operatingSystem && (
                        <span className="meta-item">
                          <Cpu size={13} /> {item.operatingSystem}
                        </span>
                      )}
                      {item.localIp && (
                        <span className="meta-item font-mono">
                          <Globe size={13} /> {item.localIp}
                        </span>
                      )}
                      <span className="meta-item duration-badge">
                        Duração: {formatDuration(item.durationSeconds)}
                      </span>
                    </div>

                    {item.executedActions && item.executedActions.length > 0 && (
                      <div className="history-actions-chips-row">
                        {item.executedActions.map((act) => (
                          <span key={act} className="history-action-tag">
                            ✓ {act}
                          </span>
                        ))}
                      </div>
                    )}

                    {item.notes && (
                      <p className="history-notes-preview">
                        <FileText size={13} className="inline mr-1" />
                        <strong>Resumo:</strong> {item.notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="history-card-actions">
                  <button
                    type="button"
                    className="autodoc-mini-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopySingleReport(item);
                    }}
                    title="Copiar laudo técnico completo"
                  >
                    {copiedProtocol === copyKey ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedProtocol === copyKey ? 'Copiado!' : 'Laudo'}</span>
                  </button>
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
      ) : null}

      {selectedRecord && (
        <div
          className="tv-modal-backdrop session-modal-overlay"
          onClick={() => setSelectedRecord(null)}
          role="dialog"
          aria-modal="true"
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
                    <h3>Laudo Técnico Auditado</h3>
                    {selectedRecord.protocolNumber && (
                      <span className="session-protocol-badge">
                        {selectedRecord.protocolNumber}
                      </span>
                    )}
                  </div>
                  <p className="session-autodoc-subtitle">
                    Registro completo de telemetria, diagnóstico e ações realizadas na sessão
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="tv-modal-close-btn"
                onClick={() => setSelectedRecord(null)}
              >
                ✕
              </button>
            </div>

            <div className="session-autodoc-body">
              <div className="autodoc-telemetry-grid">
                <div className="autodoc-telemetry-cell">
                  <span className="autodoc-cell-label">Estação / Cliente</span>
                  <strong className="autodoc-cell-value">{selectedRecord.displayName}</strong>
                </div>
                <div className="autodoc-telemetry-cell">
                  <span className="autodoc-cell-label">Hostname & ID RustDesk</span>
                  <strong className="autodoc-cell-value font-mono">
                    {selectedRecord.hostname} · {selectedRecord.rustdeskId}
                  </strong>
                </div>
                <div className="autodoc-telemetry-cell">
                  <span className="autodoc-cell-label">Organização & Pasta</span>
                  <strong className="autodoc-cell-value">
                    {selectedRecord.organizationName} › {selectedRecord.folderName || 'Clientes'}
                  </strong>
                </div>
                <div className="autodoc-telemetry-cell">
                  <span className="autodoc-cell-label">Sistema Operacional</span>
                  <strong className="autodoc-cell-value">
                    {selectedRecord.operatingSystem || 'Windows'}
                    {selectedRecord.osBuild ? ` (${selectedRecord.osBuild})` : ''}
                  </strong>
                </div>
                <div className="autodoc-telemetry-cell">
                  <span className="autodoc-cell-label">Rede / IP Local</span>
                  <strong className="autodoc-cell-value font-mono">
                    {selectedRecord.localIp || 'NAT P2P / HBBR Relay'}
                  </strong>
                </div>
                <div className="autodoc-telemetry-cell">
                  <span className="autodoc-cell-label">Técnico & Origem</span>
                  <strong className="autodoc-cell-value">
                    {selectedRecord.technicianName} ·{' '}
                    {selectedRecord.clientPlatform || 'Painel Web'}
                  </strong>
                </div>
                <div className="autodoc-telemetry-cell">
                  <span className="autodoc-cell-label">Início / Fim</span>
                  <strong className="autodoc-cell-value">
                    {new Intl.DateTimeFormat('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'medium',
                    }).format(new Date(selectedRecord.connectedAt))}
                  </strong>
                </div>
                <div className="autodoc-telemetry-cell">
                  <span className="autodoc-cell-label">Tempo & Status</span>
                  <strong className="autodoc-cell-value text-emerald-400">
                    {formatDuration(selectedRecord.durationSeconds)} ·{' '}
                    {RESOLUTION_STATUS_LABELS[selectedRecord.resolutionStatus || 'resolved']}
                  </strong>
                </div>
              </div>

              <div className="autodoc-preview-box">
                <div className="autodoc-preview-header">
                  <span className="autodoc-section-title">
                    <ShieldCheck size={14} /> Laudo Técnico Completo (Pronto para Envio)
                  </span>
                  <div className="autodoc-preview-actions">
                    <button
                      type="button"
                      className="autodoc-mini-btn"
                      onClick={() => handleCopySingleReport(selectedRecord)}
                    >
                      <Copy size={13} />
                      <span>
                        {copiedProtocol ===
                        (selectedRecord.protocolNumber || selectedRecord.connectedAt)
                          ? 'Copiado!'
                          : 'Copiar Laudo'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="autodoc-mini-btn"
                      onClick={() => handleShareSingleReport(selectedRecord)}
                    >
                      <Share2 size={13} />
                      <span>Compartilhar</span>
                    </button>
                  </div>
                </div>
                <pre className="autodoc-report-pre">
                  {selectedRecord.autoReportText ||
                    buildAutomatedTechnicalReport(selectedRecord)}
                </pre>
              </div>
            </div>

            <div className="session-modal-footer autodoc-modal-footer">
              <button
                type="button"
                className="command-button"
                onClick={() => setSelectedRecord(null)}
              >
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
                  Reconectar a esta Estação
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
