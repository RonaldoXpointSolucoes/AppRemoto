'use client';

import { useState } from 'react';
import type { DeviceView } from '@appremoto/contracts';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  Laptop,
  Monitor,
  MoreVertical,
  Trash2,
  Sliders,
  FolderPlus,
  Globe,
} from 'lucide-react';
import { ConnectDevice } from './connect-device';
import type { ConnectionLogEvent } from './connection-log';
import type { DeviceDirectoryService } from './use-devices';
import { formatLastSeen, type DeviceStatusState } from './device-record';
import { parseSystemInfo } from './system-info';
import {
  getRecentConnections,
  getDeviceGroups,
  assignDeviceToGroup,
  type RecentConnectionRecord,
  type DeviceGroup,
} from './teamviewer-storage';

export function TeamViewerDeviceTree({
  devices,
  statusState,
  service,
  canConnect,
  canManage,
  onDetails,
  onDeletePrompt,
  onEvent,
  onSessionExpired,
  onSessionStarted,
}: {
  devices: DeviceView[];
  statusState: DeviceStatusState;
  service: DeviceDirectoryService;
  canConnect(organizationId: string): boolean;
  canManage(organizationId: string): boolean;
  onDetails(device: DeviceView): void;
  onDeletePrompt(device: DeviceView): void;
  onEvent(deviceId: string, event: ConnectionLogEvent): void;
  onSessionExpired(): void;
  onSessionStarted?(device: DeviceView): void;
}) {
  const [recentOpen, setRecentOpen] = useState(true);
  const [managedOpen, setManagedOpen] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    group_clients: true,
    group_xpoint: true,
    group_servers: true,
    group_ungrouped: true,
  });
  const [groups, setGroups] = useState<DeviceGroup[]>(() => getDeviceGroups());
  const [menuOpenForDevice, setMenuOpenForDevice] = useState<string | null>(null);

  const recents = getRecentConnections();

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleAssignGroup(deviceId: string, groupId: string) {
    const updated = assignDeviceToGroup(deviceId, groupId);
    setGroups(updated);
    setMenuOpenForDevice(null);
  }

  // Mapeia dispositivos agrupados
  const groupedMap = new Map<string, DeviceView[]>();
  for (const g of groups) {
    groupedMap.set(g.id, []);
  }

  devices.forEach((dev) => {
    let placed = false;
    for (const g of groups) {
      if (g.deviceIds.includes(dev.id)) {
        groupedMap.get(g.id)?.push(dev);
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Agrupamento inteligente inicial
      const raw = (dev.displayName + ' ' + dev.hostname + ' ' + dev.organizationName).toLowerCase();
      const isServer = raw.includes('server') || /server/i.test(dev.operatingSystem);
      const isStaff = raw.includes('xpoint') || raw.includes('x-point') || raw.includes('arthur') || raw.includes('ronaldo');

      if (isServer) {
        groupedMap.get('group_servers')?.push(dev);
      } else if (isStaff) {
        groupedMap.get('group_xpoint')?.push(dev);
      } else {
        groupedMap.get('group_clients')?.push(dev);
      }
    }
  });

  function formatRustDeskId(id: string) {
    const clean = id.replace(/\s+/g, '');
    if (clean.length === 9) {
      return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6, 9)}`;
    }
    return clean;
  }

  return (
    <div className="tv-tree-container">
      {/* Cabeçalho da Tabela em Estilo TeamViewer */}
      <div className="tv-tree-header">
        <div className="tv-col-name">NOME</div>
        <div className="tv-col-id">ID DO RUSTDESK</div>
        <div className="tv-col-status">STATUS</div>
        <div className="tv-col-actions">ACESSO RÁPIDO</div>
      </div>

      {/* 1. SEÇÃO DE CONEXÕES RECENTES */}
      <div className="tv-section">
        <button
          type="button"
          className="tv-section-toggle"
          onClick={() => setRecentOpen(!recentOpen)}
        >
          {recentOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Clock size={16} className="tv-section-icon text-primary" />
          <span className="tv-section-title">Conexões recentes</span>
          <span className="tv-badge-count">{recents.length}</span>
        </button>

        {recentOpen && (
          <div className="tv-rows-group">
            {recents.length === 0 ? (
              <div className="tv-empty-row">Nenhuma conexão recente registrada ainda. Conecte-se a um computador para vê-lo aqui.</div>
            ) : (
              recents.map((rec) => {
                const liveDevice = devices.find((d) => d.id === rec.deviceId || d.rustdeskId === rec.rustdeskId);
                const isOnline = liveDevice ? liveDevice.status === 'ONLINE' : false;
                const sys = liveDevice ? parseSystemInfo(liveDevice.operatingSystem, liveDevice.osVersion) : null;
                return (
                  <div key={`${rec.deviceId}-${rec.connectedAt}`} className="tv-row tv-row-recent">
                    <div className="tv-col-name">
                      <div className="tv-device-icon-wrap">
                        <Monitor size={17} className="tv-monitor-icon" />
                        <span className={`tv-status-dot ${isOnline ? 'online' : 'offline'}`} />
                      </div>
                      <div className="tv-name-info">
                        <div className="tv-name-header">
                          <strong className="tv-display-name">{rec.displayName}</strong>
                          {sys && (
                            <span className={`tv-badge-os ${sys.badge.toLowerCase().replace(/\s+/g, '')}`}>
                              {sys.badge}
                            </span>
                          )}
                        </div>
                        <span className="tv-subtext">
                          <span className="tv-subtext-host">{rec.hostname}</span>
                          {sys?.ip && (
                            <>
                              <span className="tv-subtext-sep">·</span>
                              <span className="tv-subtext-ip" title="IP Local">
                                <Globe size={11} className="tv-ip-icon" /> {sys.ip}
                              </span>
                            </>
                          )}
                          <span className="tv-subtext-sep">·</span>
                          <span className="tv-subtext-tech">Técnico: {rec.technicianName}</span>
                        </span>
                      </div>
                    </div>
                    <div className="tv-col-id">
                      <span className="tv-id-text">{formatRustDeskId(rec.rustdeskId)}</span>
                    </div>
                    <div className="tv-col-status">
                      <span className={`tv-pill-status ${isOnline ? 'status-online' : 'status-offline'}`}>
                        {isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <div className="tv-col-actions">
                      {liveDevice && service.connectDevice && canConnect(liveDevice.organizationId) ? (
                        <div onClick={() => onSessionStarted?.(liveDevice)}>
                          <ConnectDevice
                            deviceId={liveDevice.id}
                            enabled={liveDevice.enabled && isOnline && statusState === 'current'}
                            service={{
                              connectDevice: service.connectDevice,
                              recordConnectionEvent: service.recordConnectionEvent,
                            }}
                            onEvent={(event) => onEvent(liveDevice.id, event)}
                            onHelp={() => onDetails(liveDevice)}
                            onSessionExpired={onSessionExpired}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => liveDevice && onDetails(liveDevice)}
                        >
                          Ver detalhes
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 2. SEÇÃO DE TODOS OS DISPOSITIVOS GERENCIADOS */}
      <div className="tv-section">
        <button
          type="button"
          className="tv-section-toggle"
          onClick={() => setManagedOpen(!managedOpen)}
        >
          {managedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Laptop size={16} className="tv-section-icon text-primary" />
          <span className="tv-section-title">Todos os dispositivos gerenciados</span>
          <span className="tv-badge-count">{devices.length}</span>
        </button>

        {managedOpen && (
          <div className="tv-folders-container">
            {groups.map((group) => {
              const groupDevs = groupedMap.get(group.id) || [];
              const isOpen = openGroups[group.id] !== false;
              const onlineCount = groupDevs.filter((d) => d.status === 'ONLINE').length;
              return (
                <div key={group.id} className="tv-folder-block">
                  <button
                    type="button"
                    className="tv-folder-toggle"
                    onClick={() => toggleGroup(group.id)}
                  >
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    {isOpen ? (
                      <FolderOpen size={16} className="tv-folder-icon" />
                    ) : (
                      <Folder size={16} className="tv-folder-icon" />
                    )}
                    <span className="tv-folder-name">{group.name}</span>
                    <span className="tv-folder-stats">
                      ({onlineCount} online / {groupDevs.length} total)
                    </span>
                  </button>

                  {isOpen && (
                    <div className="tv-rows-group">
                      {groupDevs.length === 0 ? (
                        <div className="tv-folder-empty-state">
                          <Folder size={16} className="tv-empty-icon" />
                          <span>Nenhum computador atribuído a esta pasta.</span>
                          <span className="tv-empty-hint">Use o menu ⋮ ao lado de um computador para organizá-lo aqui.</span>
                        </div>
                      ) : (
                        groupDevs.map((dev) => {
                          const isOnline = dev.status === 'ONLINE';
                          const isMenuOpen = menuOpenForDevice === dev.id;
                          const sys = parseSystemInfo(dev.operatingSystem, dev.osVersion);
                          return (
                            <div key={dev.id} className="tv-row">
                              <div className="tv-col-name">
                                <div className="tv-device-icon-wrap">
                                  <Monitor size={17} className="tv-monitor-icon" />
                                  <span className={`tv-status-dot ${isOnline ? 'online' : 'offline'}`} />
                                </div>
                                <div className="tv-name-info">
                                  <div className="tv-name-header">
                                    <strong className="tv-display-name">{dev.displayName}</strong>
                                    <span className={`tv-badge-os ${sys.badge.toLowerCase().replace(/\s+/g, '')}`}>
                                      {sys.badge}
                                    </span>
                                  </div>
                                  <span className="tv-subtext">
                                    <span className="tv-subtext-host">{dev.hostname}</span>
                                    <span className="tv-subtext-sep">·</span>
                                    <span className="tv-subtext-os">{sys.osName} {sys.versionLabel}</span>
                                    {sys.ip && (
                                      <>
                                        <span className="tv-subtext-sep">·</span>
                                        <span className="tv-subtext-ip" title="IP Local na rede">
                                          <Globe size={11} className="tv-ip-icon" /> {sys.ip}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                </div>
                              </div>
                              <div className="tv-col-id">
                                <span className="tv-id-text">{formatRustDeskId(dev.rustdeskId)}</span>
                              </div>
                              <div className="tv-col-status">
                                <span className={`tv-pill-status ${isOnline ? 'status-online' : 'status-offline'}`}>
                                  {isOnline ? 'Online' : 'Offline'}
                                </span>
                              </div>
                              <div className="tv-col-actions">
                                <div className="tv-action-buttons">
                                  {service.connectDevice && canConnect(dev.organizationId) && (
                                    <div onClick={() => onSessionStarted?.(dev)}>
                                      <ConnectDevice
                                        deviceId={dev.id}
                                        enabled={dev.enabled && isOnline && statusState === 'current'}
                                        service={{
                                          connectDevice: service.connectDevice,
                                          recordConnectionEvent: service.recordConnectionEvent,
                                        }}
                                        onEvent={(event) => onEvent(dev.id, event)}
                                        onHelp={() => onDetails(dev)}
                                        onSessionExpired={onSessionExpired}
                                      />
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    className="tv-icon-action-btn"
                                    title="Detalhes e opções"
                                    onClick={() => onDetails(dev)}
                                  >
                                    <Sliders size={16} />
                                  </button>
                                  {canManage(dev.organizationId) && (
                                    <button
                                      type="button"
                                      className="tv-icon-action-btn danger"
                                      title="Excluir dispositivo"
                                      onClick={() => onDeletePrompt(dev)}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  )}
                                  {/* Menu de pasta rápida */}
                                  <div className="tv-menu-container">
                                    <button
                                      type="button"
                                      className="tv-icon-action-btn"
                                      title="Mover para outra pasta"
                                      onClick={() => setMenuOpenForDevice(isMenuOpen ? null : dev.id)}
                                    >
                                      <MoreVertical size={16} />
                                    </button>
                                    {isMenuOpen && (
                                      <div className="tv-dropdown-menu">
                                        <p className="tv-dropdown-title">Mover para pasta:</p>
                                        {groups.map((tg) => (
                                          <button
                                            key={tg.id}
                                            type="button"
                                            className="tv-dropdown-item"
                                            onClick={() => handleAssignGroup(dev.id, tg.id)}
                                          >
                                            <Folder size={14} />
                                            {tg.name}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* BARRA DE RODAPÉ INFERIOR ESTILO TEAMVIEWER */}
      <footer className="tv-status-bar">
        <div className="tv-status-indicator">
          <span className="tv-status-live-dot" />
          <span className="tv-status-live-text">
            Pronto para a conexão (conexão segura via servidor XPoint 179.199.142.157)
          </span>
        </div>
        <div className="tv-status-security-note">
          <span>🔒 Criptografia ponta a ponta ativa</span>
        </div>
      </footer>
    </div>
  );
}
