'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DeviceView } from '@appremoto/contracts';
import {
  Monitor,
  History,
  Zap,
  Download,
  LogOut,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Terminal,
  Users,
  Clock,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { ThemeToggle } from '../../components/theme-toggle';
import {
  getRecentConnections,
  getDeviceFolderName,
  type RecentConnectionRecord,
} from './teamviewer-storage';
import { resolveCoherentDevicePresentation } from './device-presentation';
import { getPublicConfig } from '../../lib/config';
import { createAppwriteSessionClient } from '../../lib/appwrite';

export type TeamViewerTab = 'devices' | 'history' | 'cockpit' | 'technicians';

interface SidebarAccessEntry {
  id: string;
  deviceId: string;
  displayName: string;
  technicianName: string;
  connectedAt: string;
}

function formatSidebarAccessDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} às ${hh}:${min}`;
  } catch {
    return iso;
  }
}

export function TeamViewerSidebar({
  activeTab,
  onTabChange,
  onOpenQuickConnect,
  onOpenChangelog,
  onLogout,
  logoutPending,
  collapsed,
  onToggleCollapse,
  devices = [],
}: {
  activeTab: TeamViewerTab;
  onTabChange(tab: TeamViewerTab): void;
  onOpenQuickConnect(): void;
  onOpenChangelog?(): void;
  onLogout(): void;
  logoutPending: boolean;
  collapsed: boolean;
  onToggleCollapse(): void;
  devices?: DeviceView[];
}) {
  const [localRecents, setLocalRecents] = useState<RecentConnectionRecord[]>(() =>
    getRecentConnections()
  );
  const [remoteRecents, setRemoteRecents] = useState<SidebarAccessEntry[]>([]);

  useEffect(() => {
    function refreshLocal() {
      setLocalRecents(getRecentConnections());
    }
    window.addEventListener('xpoint:recent-connections-updated', refreshLocal);
    window.addEventListener('storage', refreshLocal);
    return () => {
      window.removeEventListener('xpoint:recent-connections-updated', refreshLocal);
      window.removeEventListener('storage', refreshLocal);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchServerRecents() {
      try {
        if (
          typeof window === 'undefined' ||
          !process.env.NEXT_PUBLIC_API_BASE_URL ||
          !process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT
        ) {
          return;
        }
        const config = getPublicConfig();
        const { getJwt } = createAppwriteSessionClient(config);
        const jwt = await getJwt();
        const res = await fetch(`${config.apiBaseUrl}/v1/recent-accesses`, {
          headers: {
            authorization: `Bearer ${jwt}`,
            accept: 'application/json',
          },
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { accesses?: SidebarAccessEntry[] };
        if (!cancelled && Array.isArray(body.accesses)) {
          setRemoteRecents(body.accesses);
        }
      } catch {
        // Mantém histórico local caso offline ou ambiente de teste
      }
    }
    void fetchServerRecents();
    const timer = setInterval(() => void fetchServerRecents(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [localRecents.length]);

  const recentEntries = useMemo<SidebarAccessEntry[]>(() => {
    const combined: SidebarAccessEntry[] = [];

    for (const loc of localRecents) {
      combined.push({
        id: loc.protocolNumber || `${loc.deviceId}_${loc.connectedAt}`,
        deviceId: loc.deviceId,
        displayName: loc.displayName,
        technicianName: loc.technicianName || 'Técnico',
        connectedAt: loc.connectedAt,
      });
    }

    for (const rem of remoteRecents) {
      const remTs = Date.parse(rem.connectedAt);
      const duplicate = combined.some((existing) => {
        if (existing.deviceId !== rem.deviceId) return false;
        const exTs = Date.parse(existing.connectedAt);
        return Number.isFinite(remTs) && Number.isFinite(exTs) && Math.abs(exTs - remTs) <= 25_000;
      });
      if (!duplicate) {
        combined.push(rem);
      }
    }

    combined.sort((a, b) => {
      const tA = Date.parse(a.connectedAt) || 0;
      const tB = Date.parse(b.connectedAt) || 0;
      return tB - tA;
    });

    return combined.slice(0, 8).map((entry) => {
      const matchedDev = devices.find((d) => d.id === entry.deviceId);
      if (matchedDev) {
        const coherent = resolveCoherentDevicePresentation(
          matchedDev,
          getDeviceFolderName(matchedDev)
        ).mainTitle;
        return { ...entry, displayName: coherent };
      }
      return entry;
    });
  }, [localRecents, remoteRecents, devices]);

  return (
    <aside className={`tv-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="tv-sidebar-brand">
        <div className="tv-logo-wrap">
          <div className="tv-logo-symbol">
            <Monitor size={22} className="text-white" />
          </div>
          {!collapsed && (
            <div className="tv-brand-text">
              <span className="tv-brand-title">XPoint Remote</span>
              <button
                type="button"
                className="tv-brand-badge version-badge-btn"
                onClick={onOpenChangelog}
                title="Clique para ver todas as novidades da versão v1.7.2"
                aria-label="Ver novidades da versão v1.7.2"
              >
                v1.7.2
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="tv-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
          aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="tv-sidebar-nav" aria-label="Navegação principal">
        <button
          type="button"
          className={`tv-nav-item ${activeTab === 'devices' ? 'active' : ''}`}
          onClick={() => onTabChange('devices')}
          title="Dispositivos e Computadores"
        >
          <Monitor size={20} className="tv-nav-icon" />
          {!collapsed && <span className="tv-nav-label">Dispositivos</span>}
          {activeTab === 'devices' && <span className="tv-active-pill" />}
        </button>

        <button
          type="button"
          className={`tv-nav-item ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => onTabChange('history')}
          title="Histórico de Conexões e Atendimentos"
        >
          <History size={20} className="tv-nav-icon" />
          {!collapsed && <span className="tv-nav-label">Histórico de Acessos</span>}
          {activeTab === 'history' && <span className="tv-active-pill" />}
        </button>

        <button
          type="button"
          className={`tv-nav-item ${activeTab === 'cockpit' ? 'active' : ''}`}
          onClick={() => onTabChange('cockpit')}
          title="Antigravity Cockpit & Dev Logger"
        >
          <Terminal size={20} className="tv-nav-icon text-emerald-400" />
          {!collapsed && <span className="tv-nav-label">Cockpit Dev Logger</span>}
          {activeTab === 'cockpit' && <span className="tv-active-pill" />}
        </button>

        <button
          type="button"
          className={`tv-nav-item ${activeTab === 'technicians' ? 'active' : ''}`}
          onClick={() => onTabChange('technicians')}
          title="Gestão de Técnicos e Convites"
        >
          <Users size={20} className="tv-nav-icon text-indigo-400" />
          {!collapsed && <span className="tv-nav-label">Técnicos & Convites</span>}
          {activeTab === 'technicians' && <span className="tv-active-pill" />}
        </button>

        <button
          type="button"
          className="tv-nav-item"
          onClick={onOpenQuickConnect}
          title="Conectar Imediatamente por ID"
        >
          <Zap size={20} className="tv-nav-icon text-amber-400" />
          {!collapsed && <span className="tv-nav-label">Conexão Rápida</span>}
        </button>

        <Link
          href="/setup"
          className="tv-nav-item"
          title="Baixar Instalador no Cliente"
        >
          <Download size={20} className="tv-nav-icon" />
          {!collapsed && <span className="tv-nav-label">Instalar no Cliente</span>}
        </Link>
      </nav>

      {/* Histórico Rápido dos Últimos Acessos na Barra Lateral Esquerda */}
      {!collapsed && (
        <div className="tv-sidebar-recent-section" aria-label="Últimos acessos realizados">
          <div className="tv-sidebar-recent-header">
            <span className="tv-sidebar-recent-title">
              <Clock size={12} className="text-sky-400" />
              Últimos Acessos
            </span>
            <button
              type="button"
              className="tv-sidebar-recent-more"
              onClick={() => onTabChange('history')}
              title="Ver histórico completo de acessos"
            >
              Ver todos
            </button>
          </div>

          {recentEntries.length === 0 ? (
            <div className="tv-sidebar-recent-empty">
              Nenhum acesso recente registrado.
            </div>
          ) : (
            <div className="tv-sidebar-recent-list">
              {recentEntries.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="tv-sidebar-recent-card"
                  onClick={() => onTabChange('history')}
                  title={`Acessado por ${item.technicianName} em ${formatSidebarAccessDateTime(item.connectedAt)}`}
                >
                  <div className="tv-sidebar-recent-pc">
                    <span className="tv-sidebar-recent-dot" />
                    <span className="tv-sidebar-recent-pc-name">{item.displayName}</span>
                  </div>
                  <div className="tv-sidebar-recent-meta">
                    <span className="tv-sidebar-recent-time">
                      {formatSidebarAccessDateTime(item.connectedAt)}
                    </span>
                    <span className="tv-sidebar-recent-user">
                      <User size={10} />
                      {item.technicianName}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="tv-sidebar-footer">
        {!collapsed && (
          <div
            className="tv-server-status-card cursor-pointer hover:border-emerald-500/50 transition-colors"
            onClick={() => onTabChange('cockpit')}
            title="Clique para abrir o Cockpit Dev Logger do Servidor"
          >
            <ShieldCheck size={16} className="text-emerald-400" />
            <div className="tv-server-info">
              <span className="server-label">Servidor XPoint</span>
              <span className="server-state">Online · 21116</span>
            </div>
          </div>
        )}

        <div className="tv-footer-controls">
          <ThemeToggle />
          <button
            type="button"
            className="icon-button"
            title="Sair da conta"
            aria-label="Sair da conta"
            aria-busy={logoutPending}
            disabled={logoutPending}
            onClick={onLogout}
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
