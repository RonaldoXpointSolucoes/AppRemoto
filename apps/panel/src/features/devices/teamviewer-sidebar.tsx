'use client';

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
} from 'lucide-react';
import Link from 'next/link';
import { ThemeToggle } from '../../components/theme-toggle';

export type TeamViewerTab = 'devices' | 'history' | 'cockpit';

export function TeamViewerSidebar({
  activeTab,
  onTabChange,
  onOpenQuickConnect,
  onLogout,
  logoutPending,
  collapsed,
  onToggleCollapse,
}: {
  activeTab: TeamViewerTab;
  onTabChange(tab: TeamViewerTab): void;
  onOpenQuickConnect(): void;
  onLogout(): void;
  logoutPending: boolean;
  collapsed: boolean;
  onToggleCollapse(): void;
}) {
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
              <span className="tv-brand-badge">v1.3.0</span>
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
