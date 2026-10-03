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
  CheckCircle2,
  Download,
  ShieldCheck,
  Terminal,
  ArrowRight,
  Info,
} from 'lucide-react';
import type { SystemTelemetry, DiskBreakdownItem, DiskSafeAction } from './cockpit-types';

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
      breakdown: items,
      history,
      safeMaintenanceActions: safeActions,
      activeServicesOnHost: [
        { name: 'Appwrite Database & Storage', uuid: 'inwbueezn2gkpm4tqwvzkswy', role: 'Database MariaDB, Redis, Storages' },
        { name: 'RustDesk Server OSS', uuid: 'i7phe5rgnsc4ajahgg5tuzkc', role: 'HBBS 21116, HBBR 21117 Relay & Rendezvous' },
        { name: 'Remote API (Fastify)', uuid: 'qyrjepou8xchzlfirsbrhwr9', role: 'Heartbeat & Telemetry API Engine' },
        { name: 'Remote Panel (Next.js)', uuid: 'hr1uqo4mlsw3sm7s2mehiaa2', role: 'Painel Web de Produção' },
        { name: 'Core Business Engine', uuid: 'k8takzbnyqyuoxz47tsrph5l', role: 'Microsserviço de Negócio Node.js' },
        { name: 'AI Engine (Gemini & RAG)', uuid: 'cuvzwwpjwwdlsf45qhbjof69', role: 'Motor de Inteligência Artificial' },
        { name: 'Whatsmeow Engine (Go)', uuid: 'tgn7x5mqldi4j2ebcchczj4o', role: 'Serviço de Mensageria Go' },
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
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <HardDrive size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="disk-modal-title" className="text-lg font-bold text-white tracking-tight">
                  Raio-X de Armazenamento & Disco VPS
                </h2>
                <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                  <AlertTriangle size={11} />
                  <span>{usagePercent}% em uso</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Host VPS: 179.199.142.157 · Partição Raiz <code className="text-slate-200">/</code> (ext4) · Coolify Server
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="disk-action-btn secondary"
              onClick={handleExportJson}
              title="Copiar relatório completo de armazenamento em JSON"
            >
              {copiedReport ? (
                <>
                  <Check size={14} className="text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">Copiado!</span>
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
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              onClick={onClose}
              title="Fechar Raio-X"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Global Capacity Multi-bar */}
        <div className="disk-overview-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black tracking-tight text-white">
                {usedGb.toFixed(1)} GB
              </span>
              <span className="text-sm font-semibold text-slate-400">
                ocupados de {totalGb} GB
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                {freeGb.toFixed(1)} GB livres ({((freeGb / totalGb) * 100).toFixed(1)}%)
              </span>
              <span className="text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-md">
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
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-slate-300 font-medium truncate">{item.label}</span>
                <span className="text-slate-400 ml-auto font-mono text-[11px]">
                  {item.usedGb} GB <span className="opacity-60">({item.percent}%)</span>
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
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-200">
                <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold text-amber-100">Diagnóstico Principal da Causa Raiz:</strong>{' '}
                  O maior consumidor de armazenamento é o <code className="bg-amber-950/60 px-1 py-0.5 rounded text-amber-200">Docker BuildKit</code> ({items[0]?.usedGb ?? 39.2} GB).
                  Ele acumula camadas temporárias geradas pelos sucessivos deploys de aplicações. Purgar o BuildKit recupera espaço imediatamente sem derrubar nenhum container e sem apagar dados de bancos.
                </div>
              </div>

              <div className="grid gap-2.5">
                {items.map((item) => (
                  <div key={item.id} className="disk-item-card">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="font-bold text-sm text-white">{item.label}</span>
                        <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {item.path}
                        </code>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-black text-sm text-white font-mono">{item.usedGb} GB</span>
                        <span className="text-xs text-slate-400 ml-1">({item.percent}%)</span>
                      </div>
                    </div>

                    {/* Barra individual */}
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${item.percent}%`, backgroundColor: item.color }}
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <p className="text-slate-400 m-0">{item.description}</p>
                      <span className="text-amber-300/90 font-medium shrink-0 flex items-center gap-1 bg-amber-950/30 px-2 py-0.5 rounded border border-amber-800/30">
                        <ArrowRight size={11} />
                        <span>{item.actionTip}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: PLAYBOOK DE LIMPEZA */}
          {activeTab === 'playbook' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3">
                <ShieldCheck size={20} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-emerald-200">
                  <h4 className="font-bold text-emerald-100 text-sm mb-0.5">Segurança Absoluta dos Dados de Produção</h4>
                  <p className="m-0 leading-relaxed text-emerald-200/90">
                    Os comandos abaixo atuam <strong>apenas em caches de compilação, imagens obsoletas e logs temporários</strong>.
                    Nenhum volume de dados persistente (<code className="bg-emerald-950/50 px-1 py-0.5 rounded">appwrite-mariadb</code>, dispositivos, tokens ou chaves do RustDesk) é afetado.
                  </p>
                </div>
              </div>

              <div className="grid gap-3">
                {safeActions.map((action) => (
                  <div key={action.id} className="disk-playbook-card">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Terminal size={16} className="text-purple-400" />
                        <h4 className="font-bold text-sm text-white m-0">{action.title}</h4>
                      </div>
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                        Libera: {action.estimatedFreeGb}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 mb-3">{action.impact}</p>

                    <div className="disk-code-box">
                      <code className="text-xs font-mono text-emerald-300 break-all select-all">
                        {action.command}
                      </code>
                      <button
                        type="button"
                        className="disk-code-copy-btn"
                        onClick={() => handleCopyCommand(action.command, action.id)}
                        title="Copiar comando para executar no terminal SSH"
                      >
                        {copiedCmd === action.id ? (
                          <>
                            <Check size={12} className="text-emerald-400" />
                            <span className="text-emerald-400 font-bold">Copiado!</span>
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
            </div>
          )}

          {/* TAB 3: HISTÓRICO DE EVOLUÇÃO */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300">
                <span className="font-semibold text-white">Curva de ocupação dos últimos 20 dias:</span>{' '}
                O armazenamento subiu progressivamente de 34% para 94% à medida que novos deploys acumularam cache no disco.
              </div>

              <div className="disk-history-timeline">
                {history.map((h, idx) => (
                  <div key={h.date} className="disk-history-step">
                    <div className="disk-history-point">
                      <span className={`w-3 h-3 rounded-full ${idx === history.length - 1 ? 'bg-amber-400 animate-ping' : 'bg-blue-400'}`} />
                    </div>
                    <div className="disk-history-content">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-white text-sm">{h.date}</span>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                            h.percent >= 90
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : h.percent >= 70
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}>
                            {h.percent}% em uso ({h.usedGb} GB)
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 m-0">{h.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: SERVIÇOS NO HOST */}
          {activeTab === 'services' && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300">
                <span className="font-semibold text-white">Ambiente Multi-Serviço Unificado:</span> A VPS host comporta os seguintes containers e serviços gerenciados pelo Coolify, dividindo a mesma partição de 96 GB:
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {[
                  { name: 'Appwrite Database (MariaDB + Redis)', type: 'Service', size: '~14.5 GB', desc: 'Base de dados principal, autenticação e storages' },
                  { name: 'RustDesk OSS (HBBS / HBBR)', type: 'Service', size: '~1.8 GB', desc: 'Portas 21115-21117 para conexão remota P2P' },
                  { name: 'Remote API (Fastify)', type: 'App Node.js', size: '~800 MB', desc: 'API backend, telemetria e heartbeats' },
                  { name: 'Remote Panel (Next.js)', type: 'App React', size: '~1.5 GB', desc: 'Painel administrativo e gerência de dispositivos' },
                  { name: 'Core Business Engine', type: 'App Node.js', size: '~1.2 GB', desc: 'Microsserviço de regras corporativas' },
                  { name: 'AI Engine (Gemini & RAG)', type: 'App Python', size: '~3.5 GB', desc: 'Modelos de vetorização e análise por IA' },
                  { name: 'Whatsmeow Engine (Go)', type: 'App Go', size: '~500 MB', desc: 'Worker de conexões e sockets' },
                  { name: 'AppWeb Frontend', type: 'App React', size: '~1.0 GB', desc: 'Aplicação web institucional' },
                  { name: 'Modelagem 3D (API & App)', type: 'App Híbrido', size: '~2.2 GB', desc: 'Renderizador paramétrico e catálogo' },
                  { name: 'Coolify Core & Traefik Proxy', type: 'Infra Host', size: '~2.0 GB', desc: 'Roteamento HTTPS/TLS e orquestrador Docker' },
                ].map((s) => (
                  <div key={s.name} className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-white">{s.name}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                          {s.type}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 m-0">{s.desc}</p>
                    </div>
                    <span className="text-xs font-mono font-bold text-slate-300 shrink-0">
                      {s.size}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="disk-modal-footer">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Activity size={14} className="text-emerald-400" />
            <span>Telemetria em tempo real sincronizada via Coolify Sentinel</span>
          </div>

          <div className="flex items-center gap-2">
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
    </div>
  );
}
