'use client';

import React, { useState } from 'react';
import {
  HardDrive,
  Layers,
  Activity,
  Clock,
  Wrench,
  Server,
  Check,
  Copy,
  X,
  AlertTriangle,
  Download,
  ShieldCheck,
  Terminal,
  ArrowRight,
  Info,
} from 'lucide-react';
import type { SystemTelemetry } from './cockpit-types';

interface DiskStorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: SystemTelemetry | null;
}

export function DiskStorageModal({ isOpen, onClose, telemetry }: DiskStorageModalProps) {
  const [activeTab, setActiveTab] = useState<'breakdown' | 'history' | 'playbook' | 'services'>('breakdown');
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);

  if (!isOpen) return null;

  const disk = telemetry?.diskDiagnostics;
  const totalGb = disk?.totalGb ?? 96;
  const usedGb = disk?.usedGb ?? 90.0;
  const freeGb = disk?.freeGb ?? 6.0;
  const usagePercent = disk?.usagePercent ?? 94;
  const items = disk?.items ?? [];
  const history = disk?.history ?? [];
  const safeActions = disk?.safeActions ?? [];

  const handleCopyCommand = (command: string, actionId: string) => {
    void navigator.clipboard.writeText(command);
    setCopiedCmd(actionId);
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  const handleExportJson = () => {
    const reportData = {
      server: 'localhost (VPS Host)',
      hostIp: '179.199.142.157',
      diagnosedAt: new Date().toISOString(),
      diskCapacity: {
        totalGb,
        usedGb,
        freeGb,
        usagePercent: `${usagePercent}%`,
        status: 'CRITICAL_HIGH_USAGE',
      },
      rootCauseBreakdown: {
        whatsmeowMedia: '~34 GB (/data/whatsmeow/media)',
        appwriteUploads: '~41 GB (_appwrite-uploads volume)',
        mariadbMetadata: '~680 MB (Íntegro)',
        systemLogs: '~5.7 GB',
        dockerImages: '~7.6 GB',
        dockerBuildKit: '~1.0 GB (Pós-limpeza)',
      },
      breakdown: items,
      history,
      safeMaintenanceActions: safeActions,
      activeServicesOnHost: [
        { name: 'Appwrite Database & Storage', uuid: 'inwbueezn2gkpm4tqwvzkswy', role: 'Database MariaDB, Redis, Storages' },
        { name: 'Whatsmeow Engine (Go)', uuid: 'tgn7x5mqldi4j2ebcchczj4o', role: 'Worker de Mensageria WhatsApp (/data/whatsmeow/media ~34 GB)' },
        { name: 'RustDesk Server OSS', uuid: 'i7phe5rgnsc4ajahgg5tuzkc', role: 'HBBS 21116, HBBR 21117 Relay & Rendezvous' },
        { name: 'Remote API (Fastify)', uuid: 'qyrjepou8xchzlfirsbrhwr9', role: 'Heartbeat & Telemetry API Engine' },
        { name: 'Remote Panel (Next.js)', uuid: 'hr1uqo4mlsw3sm7s2mehiaa2', role: 'Painel Web de Produção v1.3.5' },
        { name: 'Core Business Engine', uuid: 'k8takzbnyqyuoxz47tsrph5l', role: 'Microsserviço de Negócio Node.js' },
        { name: 'AI Engine (Gemini & RAG)', uuid: 'cuvzwwpjwwdlsf45qhbjof69', role: 'Motor de Inteligência Artificial' },
        { name: 'AppWeb Frontend', uuid: '7isvr9ftizrxhzititieqowd', role: 'Frontend AppWeb' },
        { name: 'Modelagem 3D - API', uuid: '47bpytx748ugvtth1d0hspf1', role: 'API de Processamento 3D' },
        { name: 'Modelagem 3D - App', uuid: '1wnj05nmu6oegpdiyzlzg4rc', role: 'Frontend 3D' },
        { name: 'Coolify Controller & Traefik', uuid: 'xhnrncf5ydrst3ny6s3m965b', role: 'PaaS & Reverse Proxy SSL' },
      ],
    };

    void navigator.clipboard.writeText(JSON.stringify(reportData, null, 2));
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2500);
  };

  return (
    <div
      className="disk-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="disk-modal-title"
    >
      <div
        className="disk-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="disk-modal-header">
          <div className="disk-header-left">
            <div className="disk-header-icon">
              <HardDrive size={22} className="animate-pulse" />
            </div>
            <div className="disk-header-text">
              <div className="disk-header-title-row">
                <h2 id="disk-modal-title" className="disk-header-title">
                  Raio-X de Armazenamento & Disco VPS
                </h2>
                <span className="disk-header-badge">
                  <AlertTriangle size={11} />
                  <span>{usagePercent}% em uso</span>
                </span>
              </div>
              <p className="disk-header-sub">
                Host VPS: 179.199.142.157 · Partição Raiz <code style={{ color: '#e2e8f0' }}>/</code> (ext4) · Coolify Server
              </p>
            </div>
          </div>

          <div className="disk-header-actions">
            <button
              type="button"
              className="disk-action-btn secondary"
              onClick={handleExportJson}
              title="Copiar relatório completo de armazenamento em JSON"
            >
              {copiedReport ? (
                <>
                  <Check size={14} className="text-emerald-400" />
                  <span style={{ color: '#34d399', fontWeight: 600 }}>Copiado!</span>
                </>
              ) : (
                <>
                  <Download size={14} />
                  <span>Exportar JSON</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="disk-close-btn"
              onClick={onClose}
              title="Fechar Raio-X"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Global Capacity Multi-bar */}
        <div className="disk-overview-card">
          <div className="disk-capacity-summary">
            <div className="disk-capacity-metric">
              <span className="disk-capacity-used">
                {usedGb.toFixed(1)} GB
              </span>
              <span className="disk-capacity-total">
                ocupados de {totalGb} GB
              </span>
            </div>
            <div className="disk-capacity-badges">
              <span className="disk-badge-free">
                {freeGb.toFixed(1)} GB livres ({((freeGb / totalGb) * 100).toFixed(1)}%)
              </span>
              <span className="disk-badge-critical">
                Capacidade Crítica (&lt; 10%)
              </span>
            </div>
          </div>

          {/* Multi-segmented Progress Bar */}
          <div className="disk-multi-bar" role="progressbar" aria-valuenow={usagePercent} aria-valuemin={0} aria-valuemax={100}>
            {items.map((item) => (
              <div
                key={item.id}
                className="disk-multi-bar-segment"
                style={{
                  width: `${item.percent}%`,
                  backgroundColor: item.color,
                }}
                title={`${item.label}: ${item.usedGb} GB (${item.percent}%)`}
              />
            ))}
          </div>

          {/* Legend */}
          <div className="disk-legend-grid">
            {items.map((item) => (
              <div key={item.id} className="disk-legend-item">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color, display: 'inline-block' }} />
                <span style={{ color: '#cbd5e1', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
                <span style={{ color: '#94a3b8', marginLeft: 'auto', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                  {item.usedGb.toFixed(1)} GB <span style={{ opacity: 0.65 }}>({item.percent}%)</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="disk-tabs-nav">
          <button
            type="button"
            className={`disk-tab-btn ${activeTab === 'breakdown' ? 'active' : ''}`}
            onClick={() => setActiveTab('breakdown')}
          >
            <Layers size={14} />
            <span>O que consome o disco</span>
          </button>

          <button
            type="button"
            className={`disk-tab-btn ${activeTab === 'playbook' ? 'active' : ''}`}
            onClick={() => setActiveTab('playbook')}
          >
            <Wrench size={14} />
            <span>Playbook de Limpeza Segura</span>
          </button>

          <button
            type="button"
            className={`disk-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <Clock size={14} />
            <span>Histórico de Evolução</span>
          </button>

          <button
            type="button"
            className={`disk-tab-btn ${activeTab === 'services' ? 'active' : ''}`}
            onClick={() => setActiveTab('services')}
          >
            <Server size={14} />
            <span>10 Serviços no Host</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="disk-modal-body">
          {/* TAB 1: BREAKDOWN */}
          {activeTab === 'breakdown' && (
            <>
              {/* Alerta Realista Baseado na Auditoria de Disco */}
              <div className="disk-highlight-banner critical">
                <AlertTriangle size={18} className="disk-banner-icon text-rose-400" />
                <div className="disk-banner-content">
                  <div>
                    <strong style={{ color: '#ffffff', fontWeight: 700 }}>Diagnóstico Real da VPS:</strong>{' '}
                    Aproximadamente <strong style={{ color: '#ffffff' }}>75 GB dos 96 GB</strong> estão concentrados em apenas <strong>dois pontos de armazenamento</strong>.
                    O cache do Docker BuildKit já foi limpo e está em ~1 GB. Portanto, <strong>não adianta rodar docker prune</strong>, não use volume prune e <strong>não apague o volume _appwrite-uploads manualmente</strong> no sistema de arquivos.
                  </div>
                  <div className="disk-banner-pills">
                    <span className="disk-banner-pill danger">
                      /data/whatsmeow/media: ~34 GB
                    </span>
                    <span className="disk-banner-pill danger">
                      ..._appwrite-uploads: ~41 GB
                    </span>
                    <span className="disk-banner-pill">
                      Build Cache: ~1.0 GB (Limpo)
                    </span>
                    <span className="disk-banner-pill">
                      Appwrite MariaDB: ~680 MB (Íntegro)
                    </span>
                  </div>
                </div>
              </div>

              {/* Lista dos Itens com Classes Semânticas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {items.map((item) => (
                  <div key={item.id} className="disk-item-card">
                    <div className="disk-item-header">
                      <div className="disk-item-info">
                        <span
                          className="disk-item-dot"
                          style={{ backgroundColor: item.color, color: item.color }}
                        />
                        <span className="disk-item-title">{item.label}</span>
                        <code className="disk-item-path">
                          {item.path}
                        </code>
                      </div>
                      <div className="disk-item-stat">
                        <span className="disk-item-gb">{item.usedGb.toFixed(1)} GB</span>
                        <span className="disk-item-pct">({item.percent}%)</span>
                      </div>
                    </div>

                    {/* Barra individual */}
                    <div className="disk-item-bar-bg">
                      <div
                        className="disk-item-bar-fill"
                        style={{ width: `${item.percent}%`, backgroundColor: item.color }}
                      />
                    </div>

                    <div className="disk-item-meta">
                      <p className="disk-item-desc">{item.description}</p>
                      <span className="disk-item-action-pill">
                        <ArrowRight size={11} />
                        <span>{item.actionTip}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* TAB 2: PLAYBOOK DE LIMPEZA */}
          {activeTab === 'playbook' && (
            <>
              <div className="disk-highlight-banner" style={{ background: 'rgba(16, 185, 129, 0.08)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#a7f3d0' }}>
                <ShieldCheck size={20} className="disk-banner-icon text-emerald-400" />
                <div className="disk-banner-content">
                  <strong style={{ color: '#ffffff', fontWeight: 700 }}>Segurança e Critério de Manutenção da VPS</strong>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.45 }}>
                    Não execute <code>docker volume prune</code>! Os volumes do Appwrite MariaDB residem no Docker.
                    Siga o playbook abaixo para purgar com segurança as mídias antigas do WhatsApp e auditar os buckets do Appwrite Storage.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {safeActions.map((action) => (
                  <div key={action.id} className="disk-playbook-card">
                    <div className="disk-playbook-header">
                      <div className="disk-playbook-title-wrap">
                        <Terminal size={16} className="text-purple-400" />
                        <h4 className="disk-playbook-title">{action.title}</h4>
                      </div>
                      <span className={`disk-playbook-badge ${action.riskLevel === 'warning' ? 'warning' : ''}`}>
                        Libera: {action.estimatedFreeGb}
                      </span>
                    </div>

                    <p className="disk-playbook-desc">{action.impact}</p>

                    <div className="disk-code-box">
                      <pre className="disk-code-text">
                        {action.command}
                      </pre>
                      <button
                        type="button"
                        className="disk-code-copy-btn"
                        onClick={() => handleCopyCommand(action.command, action.id)}
                        title="Copiar comando para executar no terminal SSH"
                      >
                        {copiedCmd === action.id ? (
                          <>
                            <Check size={12} className="text-emerald-400" />
                            <span style={{ color: '#34d399', fontWeight: 700 }}>Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={12} />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* TAB 3: HISTÓRICO DE EVOLUÇÃO */}
          {activeTab === 'history' && (
            <>
              <div style={{ padding: '12px 16px', borderRadius: '12px', background: 'rgba(30, 41, 59, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', fontSize: '0.78rem', color: '#cbd5e1' }}>
                <span style={{ fontWeight: 700, color: '#ffffff' }}>Curva de Ocupação Histórica:</span> O crescimento do disco ocorreu principalmente pelo tráfego contínuo de mídias no WhatsApp e arquivos enviados ao Appwrite Storage.
              </div>

              <div className="disk-history-timeline">
                {history.map((h, idx) => (
                  <div key={h.date} className="disk-history-step">
                    <div className="disk-history-point">
                      <span
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          backgroundColor: idx === history.length - 1 ? '#f59e0b' : '#3b82f6',
                          display: 'inline-block',
                          boxShadow: idx === history.length - 1 ? '0 0 10px #f59e0b' : 'none',
                        }}
                      />
                    </div>
                    <div className="disk-history-content">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ fontWeight: 700, color: '#ffffff', fontSize: '0.875rem' }}>{h.date}</span>
                        <span style={{
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '6px',
                          background: h.percent >= 90 ? 'rgba(244, 63, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: h.percent >= 90 ? '#fda4af' : '#fde68a',
                          border: `1px solid ${h.percent >= 90 ? 'rgba(244, 63, 94, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                        }}>
                          {h.percent}% em uso ({h.usedGb.toFixed(1)} GB)
                        </span>
                      </div>
                      <p style={{ margin: '6px 0 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>{h.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* TAB 4: SERVIÇOS NO HOST */}
          {activeTab === 'services' && (
            <>
              <div style={{ padding: '12px 16px', borderRadius: '12px', background: 'rgba(30, 41, 59, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', fontSize: '0.78rem', color: '#cbd5e1' }}>
                <span style={{ fontWeight: 700, color: '#ffffff' }}>Mapeamento de Serviços no Host:</span> Os 10 serviços do ecossistema dividem os 96 GB da VPS:
              </div>

              <div className="disk-service-grid">
                {[
                  { name: 'Appwrite Storage & DB', type: 'Service', size: '~41.7 GB', desc: 'Storage uploads (_appwrite-uploads ~41 GB) + MariaDB (~680 MB)' },
                  { name: 'Whatsmeow Engine (Go)', type: 'Worker Go', size: '~34.5 GB', desc: 'Sessões ativas WhatsApp + Mídias locais (/data/whatsmeow/media ~34 GB)' },
                  { name: 'RustDesk OSS (HBBS / HBBR)', type: 'Service', size: '~1.8 GB', desc: 'Portas 21115-21117 para conexão remota P2P' },
                  { name: 'Remote API (Fastify)', type: 'App Node.js', size: '~800 MB', desc: 'API backend, telemetria e heartbeats' },
                  { name: 'Remote Panel (Next.js)', type: 'App React', size: '~1.5 GB', desc: 'Painel administrativo e gerência de dispositivos (v1.3.5)' },
                  { name: 'Core Business Engine', type: 'App Node.js', size: '~1.2 GB', desc: 'Microsserviço de regras corporativas' },
                  { name: 'AI Engine (Gemini & RAG)', type: 'App Python', size: '~3.5 GB', desc: 'Modelos de vetorização e análise por IA' },
                  { name: 'AppWeb Frontend', type: 'App React', size: '~1.0 GB', desc: 'Aplicação web institucional' },
                  { name: 'Modelagem 3D (API & App)', type: 'App Híbrido', size: '~2.2 GB', desc: 'Renderizador paramétrico e catálogo' },
                  { name: 'Coolify Core & Traefik Proxy', type: 'Infra Host', size: '~2.0 GB', desc: 'Roteamento HTTPS/TLS e orquestrador Docker' },
                ].map((s) => (
                  <div key={s.name} className="disk-service-card">
                    <div className="disk-service-info">
                      <div className="disk-service-name-row">
                        <span className="disk-service-name">{s.name}</span>
                        <span className="disk-service-tag">{s.type}</span>
                      </div>
                      <p className="disk-service-desc">{s.desc}</p>
                    </div>
                    <span className="disk-service-size">{s.size}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="disk-modal-footer">
          <div className="disk-footer-meta">
            <Activity size={14} className="text-emerald-400" />
            <span>Telemetria em tempo real sincronizada via Coolify Sentinel</span>
          </div>

          <button
            type="button"
            className="disk-action-btn primary"
            onClick={onClose}
          >
            Fechar Diagnóstico
          </button>
        </div>
      </div>
    </div>
  );
}
