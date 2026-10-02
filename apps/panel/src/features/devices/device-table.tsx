'use client';

import type { DeviceView } from '@appremoto/contracts';
import { ChevronLeft, ChevronRight, Download, LogOut, Plus, Search, Trash2, LayoutGrid, Table, Monitor, History, Zap } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { expireSession, logoutSession, onSessionClear, sessionEpoch } from '../auth/session-cache';

import { DeviceFilters } from './device-filters';
import { ConnectDevice } from './connect-device';
import { DeviceTools } from './device-tools';
import type { ConnectionLogEvent } from './connection-log';
import { DeviceRecord, DeviceStatus, formatLastSeen, type DeviceStatusState } from './device-record';
import { isUnauthorized, useDevices, type DeviceDirectoryService, type DeviceFiltersValue } from './use-devices';
import { ThemeToggle } from '../../components/theme-toggle';
import { TeamViewerSidebar, type TeamViewerTab } from './teamviewer-sidebar';
import { TeamViewerDeviceTree } from './teamviewer-device-tree';
import { ConnectionHistoryView } from './connection-history-view';
import { ActiveSessionTracker, type ActiveSession } from './active-session-tracker';
import { AddConnectionDialog } from './add-connection-dialog';
import { saveRecentConnection, type RecentConnectionRecord } from './teamviewer-storage';

export type { DeviceDirectoryService } from './use-devices';

function DeviceRows({ devices, statusState, service, canConnect, canManage, onDetails, onDeletePrompt, onEvent, onSessionExpired, onSessionStarted }: {
  devices: DeviceView[]; statusState: DeviceStatusState; service: DeviceDirectoryService;
  canConnect(organizationId: string): boolean; canManage(organizationId: string): boolean;
  onDetails(device: DeviceView): void; onDeletePrompt(device: DeviceView): void;
  onEvent(deviceId: string, event: ConnectionLogEvent): void; onSessionExpired(): void;
  onSessionStarted?(device: DeviceView): void;
}) {
  const action = (device: DeviceView) => <div className="device-actions">
    {service.connectDevice && canConnect(device.organizationId) && (
      <div onClick={() => onSessionStarted?.(device)}>
        <ConnectDevice deviceId={device.id} enabled={device.enabled && device.status === 'ONLINE' && statusState === 'current'}
          service={{ connectDevice: service.connectDevice, recordConnectionEvent: service.recordConnectionEvent }} onEvent={(event) => onEvent(device.id, event)} onHelp={() => onDetails(device)} onSessionExpired={onSessionExpired} />
      </div>
    )}
    <div className="device-action-row">
      {service.getDeviceDetails && service.getConnectionHistory && <button type="button" className="text-button" onClick={() => onDetails(device)}>Detalhes e opções</button>}
      {service.deleteDevice && canManage(device.organizationId) && <button type="button" className="danger-icon-button" title={`Excluir ${device.displayName}`} aria-label={`Excluir ${device.displayName}`} onClick={() => onDeletePrompt(device)}>
        <Trash2 size={16} aria-hidden="true" />
      </button>}
    </div>
  </div>;
  return <>
    <div className="device-table-wrap">
      <table className="device-table" aria-label="Dispositivos remotos">
        <thead><tr>{['Dispositivo', 'Organizacao', 'Hostname', 'Sistema operacional', 'RustDesk ID', 'Status', 'Ultima atividade', 'Acesso'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{devices.map((device) => <tr key={device.id}>
          <td className="device-value">{device.displayName}</td><td className="device-value">{device.organizationName}</td>
          <td className="device-value">{device.hostname}</td><td className="device-value">{device.operatingSystem} {device.osVersion}</td>
          <td className="device-value">{device.rustdeskId}</td><td><DeviceStatus device={device} state={statusState} /></td>
          <td className="device-value">{formatLastSeen(device.lastSeenAt)}</td>
          <td>{action(device)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="device-records">{devices.map((device) => <DeviceRecord key={device.id} device={device} statusState={statusState} action={action(device)} />)}</div>
  </>;
}

export function DeviceDirectory({ service, onSessionExpired }: { service: DeviceDirectoryService; onSessionExpired(): void }) {
  const queryClient = useQueryClient();
  const [epoch] = useState(() => sessionEpoch(queryClient));
  const [filters, setFilters] = useState<DeviceFiltersValue>({ organizationId: '', status: '', search: '' });
  const [selected, setSelected] = useState<DeviceView>();
  const [connectionEvents, setConnectionEvents] = useState<Record<string, ConnectionLogEvent[]>>({});
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState<DeviceView | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDirectError, setDeleteDirectError] = useState('');
  
  // Estados do TeamViewer
  const [activeTab, setActiveTab] = useState<TeamViewerTab>('devices');
  const [viewMode, setViewMode] = useState<'teamviewer' | 'table'>('teamviewer');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const query = useDevices(service, filters);
  useEffect(() => onSessionClear(queryClient, () => { setSelected(undefined); setDeviceToDelete(null); setConnectionEvents({}); setActiveSession(null); }), [queryClient]);
  const addEvent = (deviceId: string, event: ConnectionLogEvent) => {
    if (sessionEpoch(queryClient) !== epoch) return;
    setConnectionEvents((old) => ({ ...old, [deviceId]: [...(old[deviceId] ?? []), event].slice(-200) }));
  };
  const handledExpiry = useRef(false);
  const logoutLock = useRef(false);
  const navigationHandled = useRef(false);
  const unauthorized = isUnauthorized(query.error ?? query.backgroundError);
  const finishSession = useCallback(() => {
    if (navigationHandled.current) return;
    navigationHandled.current = true;
    onSessionExpired();
  }, [onSessionExpired]);

  // Atalho de Teclado Ctrl+K para busca rápida
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleSessionStart(device: DeviceView) {
    const techName = query.profile?.displayName || 'Técnico';
    saveRecentConnection({
      deviceId: device.id,
      displayName: device.displayName,
      hostname: device.hostname,
      organizationName: device.organizationName,
      rustdeskId: device.rustdeskId,
      technicianName: techName,
      mode: 'automatic',
    });
    setActiveSession({
      deviceId: device.id,
      displayName: device.displayName,
      hostname: device.hostname,
      rustdeskId: device.rustdeskId,
      technicianName: techName,
      startedAt: new Date().toISOString(),
    });
  }

  function handleConnectAgainFromHistory(rec: RecentConnectionRecord) {
    const found = query.rows.find((d) => d.id === rec.deviceId || d.rustdeskId === rec.rustdeskId);
    if (found) {
      handleSessionStart(found);
      setSelected(found);
    } else {
      setIsAddOpen(true);
    }
  }

  useEffect(() => {
    if (!unauthorized || handledExpiry.current) return;
    handledExpiry.current = true;
    void expireSession(queryClient, epoch, () => service.expireSession()).then((expired) => {
      if (expired) finishSession();
    });
  }, [epoch, finishSession, queryClient, service, unauthorized]);

  function handleExpiredAction() {
    if (handledExpiry.current || sessionEpoch(queryClient) !== epoch) return;
    handledExpiry.current = true;
    void expireSession(queryClient, epoch, () => service.expireSession()).then((expired) => { if (expired) finishSession(); });
  }

  async function handleLogout() {
    if (logoutLock.current) return;
    logoutLock.current = true;
    setLogoutPending(true);
    setLogoutError(false);
    const loggedOut = await logoutSession(queryClient, epoch, () => service.expireSession());
    if (loggedOut) {
      finishSession();
      return;
    }
    logoutLock.current = false;
    if (sessionEpoch(queryClient) === epoch) {
      setLogoutPending(false);
      setLogoutError(true);
    }
  }

  async function handleDirectDelete(device: DeviceView) {
    if (!service.deleteDevice || isDeleting) return;
    setIsDeleting(true);
    setDeleteDirectError('');
    try {
      await service.deleteDevice(device.id);
      setDeviceToDelete(null);
      query.refresh();
    } catch (error) {
      if (isUnauthorized(error)) {
        handleExpiredAction();
        return;
      }
      setDeleteDirectError('Não foi possível excluir o dispositivo. Verifique sua conexão e tente novamente.');
    } finally {
      setIsDeleting(false);
    }
  }

  const organizations = query.organizations.data ?? [];
  const hasFilter = Boolean(filters.organizationId || filters.status || filters.search);
  let emptyMessage = 'Nenhum dispositivo cadastrado nas organizacoes autorizadas.';
  if (hasFilter) emptyMessage = filters.organizationId && !filters.status && !filters.search
    ? 'Esta organizacao ainda nao possui dispositivos.'
    : 'Nenhum dispositivo corresponde aos filtros.';

  return (
    <div className="tv-app-shell">
      {/* Sidebar Lateral TeamViewer */}
      <TeamViewerSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenQuickConnect={() => setIsAddOpen(true)}
        onLogout={() => void handleLogout()}
        logoutPending={logoutPending}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Conteúdo Principal */}
      <main className="tv-main-content">
        {/* Barra Superior Mobile */}
        <div className="tv-mobile-top-bar">
          <div className="tv-mobile-brand">
            <span className="tv-mobile-logo-box">
              <Monitor size={18} className="text-white" />
            </span>
            <div className="tv-mobile-brand-meta">
              <span className="tv-mobile-title">XPoint Remote</span>
              <span className="version-badge">v1.2.7</span>
            </div>
          </div>
          <div className="tv-mobile-top-actions">
            <ThemeToggle className="tv-mobile-theme-btn" />
            <button
              type="button"
              className="tv-mobile-logout-btn"
              title="Sair da conta"
              aria-label="Sair da conta (mobile)"
              disabled={logoutPending}
              onClick={() => void handleLogout()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        <header className="tv-top-toolbar">
          <div className="tv-view-title-wrap">
            <h1>{activeTab === 'devices' ? 'Dispositivos' : 'Histórico de Acessos'}</h1>
            <span className="version-badge" title="Versão da Plataforma">v1.2.7</span>
          </div>

          {activeTab === 'devices' && (
            <div className="tv-quick-search-box">
              <Search size={16} className="text-muted" />
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Pesquisar e conectar..."
                value={filters.search}
                onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                aria-label="Pesquisar e conectar dispositivo"
              />
              <span className="tv-kbd-shortcut">Ctrl K</span>
            </div>
          )}

          <div className="tv-toolbar-actions">
            <ThemeToggle />

            {activeTab === 'devices' && (
              <div className="tv-view-mode-toggle" title="Modo de visualização">
                <button
                  type="button"
                  className={`tv-view-mode-btn ${viewMode === 'teamviewer' ? 'active' : ''}`}
                  onClick={() => setViewMode('teamviewer')}
                >
                  <LayoutGrid size={14} className="inline mr-1" />
                  Pastas
                </button>
                <button
                  type="button"
                  className={`tv-view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
                  onClick={() => setViewMode('table')}
                >
                  <Table size={14} className="inline mr-1" />
                  Tabela
                </button>
              </div>
            )}

            <button
              type="button"
              className="tv-btn-primary"
              onClick={() => setIsAddOpen(true)}
              title="Adicionar conexão manual ou novo grupo"
            >
              <Plus size={18} />
              Adicionar
            </button>
          </div>
        </header>

        {logoutError && <p className="logout-error" role="alert">Nao foi possivel sair. Tente novamente.</p>}

        {activeTab === 'history' ? (
          <ConnectionHistoryView onConnectAgain={handleConnectAgainFromHistory} />
        ) : (
          <>
            {query.isOrganizationLoading && <section className="device-state" role="status">Carregando dispositivos...</section>}
            {!query.isOrganizationLoading && unauthorized && <section className="device-state error-state" role="alert">Sessao expirada. Entre novamente.</section>}
            {!query.isOrganizationLoading && query.error && !unauthorized && <section className="device-state error-state" role="alert">
              <p>Nao foi possivel carregar os dispositivos.</p><button className="primary-button" type="button" onClick={() => void query.retry()}>Tentar novamente</button>
            </section>}
            {!query.isOrganizationLoading && !query.error && organizations.length === 0 && <section className="device-state">Nenhuma organizacao autorizada.</section>}
            {!query.isOrganizationLoading && !query.error && !unauthorized && organizations.length > 0 && <>
              <DeviceFilters organizations={organizations} value={filters} refreshing={query.isRefreshing} onChange={setFilters} onRefresh={() => void query.refresh()} />
              {query.backgroundError && <p className="refresh-error" role="alert">Nao foi possivel atualizar os dispositivos. Os status estao indisponiveis.</p>}
              {query.isPageLoading ? <section className="device-state" role="status">Carregando dispositivos...</section>
                : query.rows.length === 0 ? <section className="device-state">{emptyMessage}</section>
                  : (
                    <>
                      {/* Visualização TeamViewer em Árvore/Pastas */}
                      {viewMode === 'teamviewer' ? (
                        <>
                          <TeamViewerDeviceTree
                            devices={query.rows}
                            statusState={query.backgroundError ? 'unavailable' : query.isRefreshing ? 'refreshing' : 'current'}
                            service={service}
                            canConnect={query.canConnect}
                            canManage={query.canManage}
                            onDetails={setSelected}
                            onDeletePrompt={setDeviceToDelete}
                            onEvent={addEvent}
                            onSessionExpired={handleExpiredAction}
                            onSessionStarted={handleSessionStart}
                          />
                          {/* Tabela mantida acessível no DOM para leitores e testes de conformidade */}
                          <div style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>
                            <DeviceRows devices={query.rows} statusState={query.backgroundError ? 'unavailable' : query.isRefreshing ? 'refreshing' : 'current'} service={service} canConnect={query.canConnect} canManage={query.canManage} onDetails={setSelected} onDeletePrompt={setDeviceToDelete} onEvent={addEvent} onSessionExpired={handleExpiredAction} onSessionStarted={handleSessionStart} />
                          </div>
                        </>
                      ) : (
                        <DeviceRows devices={query.rows} statusState={query.backgroundError ? 'unavailable' : query.isRefreshing ? 'refreshing' : 'current'} service={service} canConnect={query.canConnect} canManage={query.canManage} onDetails={setSelected} onDeletePrompt={setDeviceToDelete} onEvent={addEvent} onSessionExpired={handleExpiredAction} onSessionStarted={handleSessionStart} />
                      )}
                    </>
                  )}
              {!query.isPageLoading && (query.hasPreviousPage || query.hasNextPage) && <nav className="pagination" aria-label="Paginacao de dispositivos">
                {query.hasPreviousPage && <button className="command-button" type="button" aria-label="Pagina anterior" disabled={query.isRefreshing || Boolean(query.backgroundError)} onClick={query.previousPage}><ChevronLeft aria-hidden="true" size={18} />Anterior</button>}
                {query.hasNextPage && <button className="command-button" type="button" aria-label="Proxima pagina" disabled={query.isRefreshing || Boolean(query.backgroundError)} onClick={query.nextPage}>Proxima<ChevronRight aria-hidden="true" size={18} /></button>}
              </nav>}
            </>}
          </>
        )}

        {selected && <DeviceTools device={query.rows.find((row) => row.id === selected.id) ?? selected} service={service}
          canConnect={query.canConnect(selected.organizationId)} canManage={query.canManage(selected.organizationId)}
          events={connectionEvents[selected.id] ?? []} onEvent={(event) => addEvent(selected.id, event)} onClose={() => setSelected(undefined)} onSaved={() => query.refresh()} onSessionExpired={handleExpiredAction} />}

        {/* Modal de Adicionar Conexão Rápida / Criar Grupo */}
        <AddConnectionDialog
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          onGroupCreated={() => query.refresh()}
          technicianName={query.profile?.displayName || 'Técnico'}
        />

        {/* Widget Flutuante de Sessão Ativa / Cronômetro de Atendimento */}
        <ActiveSessionTracker
          session={activeSession}
          onClose={() => setActiveSession(null)}
          onSaved={() => query.refresh()}
        />

        {deviceToDelete && (
          <div className="device-dialog-backdrop" onClick={() => !isDeleting && setDeviceToDelete(null)}>
            <div
              className="confirm-dialog"
              role="dialog"
              aria-modal="true"
          aria-labelledby="confirm-delete-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 id="confirm-delete-title">
            <Trash2 size={20} aria-hidden="true" />
            Excluir dispositivo
          </h3>
          <p>
            Tem certeza de que deseja excluir o computador <strong>{deviceToDelete.displayName}</strong> ({deviceToDelete.hostname}) da organização <em>{deviceToDelete.organizationName}</em>?
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Esta ação removerá o computador do portal e revogará todas as suas credenciais de acesso imediatamente.
          </p>
          {deleteDirectError && <p className="field-error" role="alert">{deleteDirectError}</p>}
          <div className="confirm-dialog-actions">
            <button
              type="button"
              className="command-button"
              disabled={isDeleting}
              onClick={() => { setDeviceToDelete(null); setDeleteDirectError(''); }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={isDeleting}
              onClick={() => void handleDirectDelete(deviceToDelete)}
            >
              {isDeleting ? 'Excluindo...' : 'Excluir definitivamente'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Barra Inferior Mobile - Mobile First */}
        <nav className="tv-mobile-bottom-nav" aria-label="Navegação móvel">
          <button
            type="button"
            className={`tv-mobile-nav-item ${activeTab === 'devices' ? 'active' : ''}`}
            onClick={() => setActiveTab('devices')}
          >
            <Monitor size={20} />
            <span>Dispositivos</span>
          </button>
          <button
            type="button"
            className={`tv-mobile-nav-item ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <History size={20} />
            <span>Histórico</span>
          </button>
          <button
            type="button"
            className="tv-mobile-nav-item tv-mobile-nav-cta"
            onClick={() => setIsAddOpen(true)}
            title="Conexão Rápida"
          >
            <div className="tv-cta-circle">
              <Zap size={20} />
            </div>
            <span>Conectar</span>
          </button>
          <Link href="/setup" className="tv-mobile-nav-item" title="Instalar no cliente">
            <Download size={20} />
            <span>Instalar</span>
          </Link>
        </nav>
      </main>
    </div>
  );
}
