'use client';

import { useState, useEffect, useMemo } from 'react';
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
  Pencil,
  X,
  Check,
  Loader2,
  FileText,
  Copy,
} from 'lucide-react';
import { ConnectDevice } from './connect-device';
import type { ConnectionLogEvent } from './connection-log';
import type { DeviceDirectoryService } from './use-devices';
import { type DeviceStatusState } from './device-record';
import { parseSystemInfo } from './system-info';
import {
  getRecentConnections,
  getDeviceGroups,
  saveDeviceGroups,
  createDeviceGroup,
  renameDeviceGroup,
  deleteDeviceGroup,
  assignDeviceToGroup,
  getDeviceFolderMap,
  parseDeviceNotes,
  encodeDeviceNotes,
  saveDeviceCustomMetadata,
  getCustomMetadataMap,
  type DeviceGroup,
  type DeviceCustomMetadata,
} from './teamviewer-storage';

function getDeviceNotes(dev: DeviceView, metaMap: Record<string, DeviceCustomMetadata>): string {
  const fromDev = (dev as { notes?: string }).notes;
  if (fromDev) return fromDev;
  if (metaMap && metaMap[dev.id]?.notes) {
    return metaMap[dev.id].notes || '';
  }
  return '';
}

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
  onSaved,
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
  onSaved?(): void;
}) {
  const [recentOpen, setRecentOpen] = useState(true);
  const [managedOpen, setManagedOpen] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    group_clients: true,
    group_xpoint: true,
    group_servers: true,
  });
  const [groups, setGroups] = useState<DeviceGroup[]>(() => getDeviceGroups());
  const [menuOpenForDevice, setMenuOpenForDevice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Estados dos Modais
  const [editingDevice, setEditingDevice] = useState<DeviceView | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editFolderId, setEditFolderId] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingDevice, setIsSavingDevice] = useState(false);
  const [deviceSaveError, setDeviceSaveError] = useState('');

  // Estados de Gerenciamento de Pastas
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderToRename, setFolderToRename] = useState<DeviceGroup | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [folderToDelete, setFolderToDelete] = useState<DeviceGroup | null>(null);

  // Toast / Feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  }

  // Sincroniza grupos com pastas existentes nos metadados dos dispositivos
  useEffect(() => {
    const current = getDeviceGroups();
    const metaMap = getCustomMetadataMap();
    let hasNewFolder = false;
    const merged = [...current];

    devices.forEach((dev) => {
      const rawNotes = getDeviceNotes(dev, metaMap);
      const meta = parseDeviceNotes(rawNotes);
      if (meta.folderName) {
        const found = merged.some(
          (g) => g.name.toLowerCase() === meta.folderName!.toLowerCase()
        );
        if (!found) {
          const newG: DeviceGroup = {
            id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: meta.folderName,
            deviceIds: [dev.id],
            isDefault: false,
          };
          merged.push(newG);
          hasNewFolder = true;
        }
      }
    });

    if (hasNewFolder) {
      saveDeviceGroups(merged);
    }
    setGroups(merged);
  }, [devices]);

  const recents = getRecentConnections();

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: prev[id] === false }));
  }

  // Mapeamento dos dispositivos nas pastas
  const groupedMap = useMemo(() => {
    const map = new Map<string, DeviceView[]>();
    for (const g of groups) {
      map.set(g.id, []);
    }

    const folderMap = typeof window !== 'undefined' ? getDeviceFolderMap() : {};
    const metaMap = typeof window !== 'undefined' ? getCustomMetadataMap() : {};

    devices.forEach((dev) => {
      let placed = false;

      // 1. Prioridade: Pasta salva nas observações [pasta:Nome]
      const rawNotes = getDeviceNotes(dev, metaMap);
      const parsedNotes = parseDeviceNotes(rawNotes);
      if (parsedNotes.folderName) {
        const match = groups.find(
          (g) => g.name.toLowerCase() === parsedNotes.folderName!.toLowerCase()
        );
        if (match && map.has(match.id)) {
          map.get(match.id)?.push(dev);
          placed = true;
        }
      }

      // 2. Prioridade: Mapeamento direto salvo no localStorage por ID, RustDesk ID ou Hostname
      if (!placed) {
        const targetGroupId =
          folderMap[dev.id] ||
          folderMap[dev.rustdeskId] ||
          (dev.hostname ? folderMap[dev.hostname.toLowerCase()] : undefined);

        if (targetGroupId && map.has(targetGroupId)) {
          map.get(targetGroupId)?.push(dev);
          placed = true;
        }
      }

      // 3. Prioridade: deviceIds dentro da estrutura do grupo
      if (!placed) {
        for (const g of groups) {
          if (g.deviceIds && (g.deviceIds.includes(dev.id) || g.deviceIds.includes(dev.rustdeskId))) {
            map.get(g.id)?.push(dev);
            placed = true;
            break;
          }
        }
      }

      // 4. Fallback inteligente apenas se o dispositivo nunca tiver sido organizado
      if (!placed) {
        const raw = (dev.displayName + ' ' + dev.hostname + ' ' + dev.organizationName).toLowerCase();
        const isServer = raw.includes('server') || /server/i.test(dev.operatingSystem);
        const isStaff =
          raw.includes('xpoint') ||
          raw.includes('x-point') ||
          raw.includes('arthur') ||
          raw.includes('ronaldo');

        if (isServer && map.has('group_servers')) {
          map.get('group_servers')?.push(dev);
        } else if (isStaff && map.has('group_xpoint')) {
          map.get('group_xpoint')?.push(dev);
        } else if (map.has('group_clients')) {
          map.get('group_clients')?.push(dev);
        } else if (groups.length > 0) {
          map.get(groups[0].id)?.push(dev);
        }
      }
    });

    return map;
  }, [devices, groups]);

  // Atribuição rápida de pasta pelo menu ⋮ (salva no localStorage E no banco de dados)
  async function handleAssignGroup(device: DeviceView, targetGroupId: string) {
    const targetGroup = groups.find((g) => g.id === targetGroupId);
    const targetFolderName = targetGroup ? targetGroup.name : 'Clientes';

    // 1. Atualização instantânea na UI e storage
    const updated = assignDeviceToGroup(device.id, targetGroupId, {
      rustdeskId: device.rustdeskId,
      hostname: device.hostname,
    });
    setGroups(updated);
    setMenuOpenForDevice(null);
    showToast(`Computador movido para "${targetFolderName}"`);

    // 2. Persistência permanente no banco de dados via API
    if (service.updateDevice) {
      try {
        const metaMap = getCustomMetadataMap();
        const currentRaw = getDeviceNotes(device, metaMap);
        const currentMeta = parseDeviceNotes(currentRaw);
        const encoded = encodeDeviceNotes({
          folderName: targetFolderName,
          notes: currentMeta.notes,
        });
        await service.updateDevice(device.id, {
          displayName: device.displayName,
          notes: encoded,
        });
        onSaved?.();
      } catch (err) {
        console.warn('Persistência no backend falhou, mas mantido localmente:', err);
      }
    }
  }

  // Abrir modal de edição do computador
  async function handleOpenEditDevice(device: DeviceView) {
    setEditingDevice(device);
    setEditDisplayName(device.displayName || '');
    setDeviceSaveError('');

    // Identifica pasta e notas atuais do cache local
    const metaMap = getCustomMetadataMap();
    const rawNotes = getDeviceNotes(device, metaMap);
    const parsedNotes = parseDeviceNotes(rawNotes);
    setEditNotes(parsedNotes.notes || '');

    if (parsedNotes.folderName) {
      const match = groups.find(
        (g) => g.name.toLowerCase() === parsedNotes.folderName!.toLowerCase()
      );
      if (match) {
        setEditFolderId(match.id);
      } else {
        setEditFolderId('group_clients');
      }
    } else {
      const folderMap = getDeviceFolderMap();
      const mapped =
        folderMap[device.id] ||
        folderMap[device.rustdeskId] ||
        (device.hostname ? folderMap[device.hostname.toLowerCase()] : undefined);

      if (mapped && groups.some((g) => g.id === mapped)) {
        setEditFolderId(mapped);
      } else {
        setEditFolderId('group_clients');
      }
    }

    // Se a API permitir detalhes, busca as notas mais recentes do banco em segundo plano
    if (service.getDeviceDetails) {
      try {
        const details = await service.getDeviceDetails(device.id);
        if (details?.notes) {
          const freshMeta = parseDeviceNotes(details.notes);
          setEditNotes(freshMeta.notes || '');
          if (freshMeta.folderName) {
            const match = groups.find(
              (g) => g.name.toLowerCase() === freshMeta.folderName!.toLowerCase()
            );
            if (match) setEditFolderId(match.id);
          }
        }
      } catch {
        // Mantém as notas do cache local
      }
    }
  }

  // Salvar alterações do computador (Nome, Pasta e Observações)
  async function handleSaveDevice(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDevice) return;

    const trimmedName = editDisplayName.trim();
    if (!trimmedName) {
      setDeviceSaveError('O nome do computador não pode estar vazio.');
      return;
    }

    setIsSavingDevice(true);
    setDeviceSaveError('');

    try {
      const targetGroup = groups.find((g) => g.id === editFolderId);
      const targetFolderName = targetGroup ? targetGroup.name : 'Clientes';

      // 1. Atualiza localStorage e grupos locais
      assignDeviceToGroup(editingDevice.id, editFolderId, {
        rustdeskId: editingDevice.rustdeskId,
        hostname: editingDevice.hostname,
      });

      saveDeviceCustomMetadata(editingDevice.id, {
        displayName: trimmedName,
        folderId: editFolderId,
        notes: editNotes.trim(),
      });

      // 2. Persiste na API / MariaDB
      if (service.updateDevice) {
        const encoded = encodeDeviceNotes({
          folderName: targetFolderName,
          notes: editNotes.trim(),
        });

        await service.updateDevice(editingDevice.id, {
          displayName: trimmedName,
          notes: encoded,
        });
      }

      setGroups(getDeviceGroups());
      setEditingDevice(null);
      showToast(`Dados de "${trimmedName}" salvos com sucesso!`);
      onSaved?.();
    } catch (err: any) {
      setDeviceSaveError(
        err?.message || 'Falha ao salvar alterações. Verifique sua conexão e tente novamente.'
      );
    } finally {
      setIsSavingDevice(false);
    }
  }

  // Criar Nova Pasta
  function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;

    const updated = createDeviceGroup(trimmed);
    setGroups(updated);

    // Encontra o ID da nova pasta e já deixa ela expandida
    const created = updated.find((g) => g.name.toLowerCase() === trimmed.toLowerCase());
    if (created) {
      setOpenGroups((prev) => ({ ...prev, [created.id]: true }));
    }

    setNewFolderName('');
    setIsNewFolderOpen(false);
    showToast(`Pasta "${trimmed}" criada!`);
  }

  // Renomear Pasta
  async function handleRenameFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!folderToRename) return;
    const trimmed = renameFolderName.trim();
    if (!trimmed) return;

    const oldName = folderToRename.name;
    const updated = renameDeviceGroup(folderToRename.id, trimmed);
    setGroups(updated);

    // Atualiza os dispositivos pertencentes a essa pasta na API
    const devsInFolder = groupedMap.get(folderToRename.id) || [];
    if (service.updateDevice && devsInFolder.length > 0) {
      const metaMap = getCustomMetadataMap();
      for (const dev of devsInFolder) {
        try {
          const raw = getDeviceNotes(dev, metaMap);
          const meta = parseDeviceNotes(raw);
          const encoded = encodeDeviceNotes({
            folderName: trimmed,
            notes: meta.notes,
          });
          await service.updateDevice(dev.id, {
            displayName: dev.displayName,
            notes: encoded,
          });
        } catch {
          // segue em segundo plano
        }
      }
      onSaved?.();
    }

    setFolderToRename(null);
    setRenameFolderName('');
    showToast(`Pasta "${oldName}" renomeada para "${trimmed}"`);
  }

  // Excluir Pasta
  function handleDeleteFolder(group: DeviceGroup) {
    const updated = deleteDeviceGroup(group.id);
    setGroups(updated);
    setFolderToDelete(null);
    showToast(`Pasta "${group.name}" excluída. Dispositivos movidos para "Clientes".`);
    onSaved?.();
  }

  function formatRustDeskId(id: string) {
    const clean = id.replace(/\s+/g, '');
    if (clean.length === 9) {
      return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6, 9)}`;
    }
    return clean;
  }

  const customMetaMap = typeof window !== 'undefined' ? getCustomMetadataMap() : {};

  return (
    <div className="tv-tree-container">
      {/* Toast de Confirmação */}
      {toastMessage && (
        <div className="tv-floating-toast" role="status">
          <Check size={16} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

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
              <div className="tv-empty-row">
                Nenhuma conexão recente registrada ainda. Conecte-se a um computador para vê-lo aqui.
              </div>
            ) : (
              recents.map((rec) => {
                const liveDevice = devices.find(
                  (d) => d.id === rec.deviceId || d.rustdeskId === rec.rustdeskId
                );
                const isOnline = liveDevice ? liveDevice.status === 'ONLINE' : false;
                const sys = liveDevice
                  ? parseSystemInfo(liveDevice.operatingSystem, liveDevice.osVersion)
                  : null;

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
                          {liveDevice && (
                            <button
                              type="button"
                              className="tv-inline-edit-btn"
                              title="Editar nome e dados deste computador"
                              onClick={() => void handleOpenEditDevice(liveDevice)}
                            >
                              <Pencil size={12} />
                            </button>
                          )}
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
                      <button
                        type="button"
                        className="tv-copy-id-btn"
                        title={copiedId === rec.rustdeskId ? 'Copiado!' : 'Copiar ID do RustDesk'}
                        onClick={(e) => {
                          e.stopPropagation();
                          void navigator.clipboard.writeText(rec.rustdeskId.replace(/\s+/g, '')).then(() => {
                            setCopiedId(rec.rustdeskId);
                            setTimeout(() => setCopiedId(null), 2500);
                          });
                        }}
                      >
                        {copiedId === rec.rustdeskId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      </button>
                    </div>
                    <div className="tv-col-status">
                      <span className={`tv-pill-status ${isOnline ? 'status-online' : 'status-offline'}`}>
                        <span className="tv-pill-dot" />
                        <span>{isOnline ? 'Online' : 'Offline'}</span>
                      </span>
                    </div>
                    <div className="tv-col-actions">
                      <div className="tv-action-buttons">
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
                        ) : null}
                        {liveDevice && (
                          <div className="tv-action-toolbar">
                            <button
                              type="button"
                              className="tv-icon-action-btn"
                              title="Editar dados do computador"
                              onClick={() => void handleOpenEditDevice(liveDevice)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="tv-icon-action-btn"
                              title="Detalhes técnicos"
                              onClick={() => onDetails(liveDevice)}
                            >
                              <Sliders size={14} />
                            </button>
                          </div>
                        )}
                      </div>
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
        <div className="tv-section-header-bar">
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

          {/* Botão para Criar Nova Pasta */}
          <button
            type="button"
            className="tv-btn-new-folder"
            title="Criar nova pasta para organizar computadores"
            onClick={() => {
              setNewFolderName('');
              setIsNewFolderOpen(true);
            }}
          >
            <FolderPlus size={15} />
            <span>Nova Pasta</span>
          </button>
        </div>

        {managedOpen && (
          <div className="tv-folders-container">
            {groups.map((group) => {
              const groupDevs = groupedMap.get(group.id) || [];
              const isOpen = openGroups[group.id] !== false;
              const onlineCount = groupDevs.filter((d) => d.status === 'ONLINE').length;

              return (
                <div key={group.id} className="tv-folder-block">
                  <div className="tv-folder-row-header">
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
                        {onlineCount > 0 && <span className="tv-stats-online-dot" />}
                        {onlineCount} online / {groupDevs.length} total
                      </span>
                    </button>

                    {/* Ações de Edição e Exclusão da Pasta */}
                    <div className="tv-folder-actions">
                      <button
                        type="button"
                        className="tv-folder-action-btn"
                        title={`Renomear pasta "${group.name}"`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFolderToRename(group);
                          setRenameFolderName(group.name);
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      {!group.isDefault && (
                        <button
                          type="button"
                          className="tv-folder-action-btn danger"
                          title={`Excluir pasta "${group.name}" (os computadores serão movidos para "Clientes")`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFolderToDelete(group);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="tv-rows-group">
                      {groupDevs.length === 0 ? (
                        <div className="tv-folder-empty-state">
                          <Folder size={16} className="tv-empty-icon" />
                          <span>Nenhum computador atribuído a esta pasta.</span>
                          <span className="tv-empty-hint">
                            Use o botão de editar ou o menu ⋮ em um computador para movê-lo para cá.
                          </span>
                        </div>
                      ) : (
                        groupDevs.map((dev) => {
                          const isOnline = dev.status === 'ONLINE';
                          const isMenuOpen = menuOpenForDevice === dev.id;
                          const sys = parseSystemInfo(dev.operatingSystem, dev.osVersion);
                          const rawNotes = getDeviceNotes(dev, customMetaMap);
                          const parsedNotes = parseDeviceNotes(rawNotes);

                          return (
                            <div key={dev.id} className="tv-row">
                              <div className="tv-col-name">
                                <div className="tv-device-icon-wrap">
                                  <Monitor size={17} className="tv-monitor-icon" />
                                  <span className={`tv-status-dot ${isOnline ? 'online' : 'offline'}`} />
                                </div>
                                <div className="tv-name-info">
                                  <div className="tv-name-header">
                                    <strong
                                      className="tv-display-name clickable"
                                      title="Clique para editar o nome e dados deste computador"
                                      onClick={() => void handleOpenEditDevice(dev)}
                                    >
                                      {dev.displayName}
                                    </strong>
                                    <button
                                      type="button"
                                      className="tv-inline-edit-btn"
                                      title="Editar nome e dados deste computador"
                                      onClick={() => void handleOpenEditDevice(dev)}
                                    >
                                      <Pencil size={12} />
                                    </button>
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
                                    {parsedNotes.notes && (
                                      <>
                                        <span className="tv-subtext-sep">·</span>
                                        <span className="tv-subtext-notes" title={parsedNotes.notes}>
                                          <FileText size={11} className="inline mr-1" />
                                          {parsedNotes.notes.slice(0, 30)}
                                          {parsedNotes.notes.length > 30 ? '...' : ''}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                </div>
                              </div>
                              <div className="tv-col-id">
                                <span className="tv-id-text">{formatRustDeskId(dev.rustdeskId)}</span>
                                <button
                                  type="button"
                                  className="tv-copy-id-btn"
                                  title={copiedId === dev.rustdeskId ? 'Copiado!' : 'Copiar ID do RustDesk'}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void navigator.clipboard.writeText(dev.rustdeskId.replace(/\s+/g, '')).then(() => {
                                      setCopiedId(dev.rustdeskId);
                                      setTimeout(() => setCopiedId(null), 2500);
                                    });
                                  }}
                                >
                                  {copiedId === dev.rustdeskId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                </button>
                              </div>
                              <div className="tv-col-status">
                                <span className={`tv-pill-status ${isOnline ? 'status-online' : 'status-offline'}`}>
                                  <span className="tv-pill-dot" />
                                  <span>{isOnline ? 'Online' : 'Offline'}</span>
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
                                  <div className="tv-action-toolbar">
                                    <button
                                      type="button"
                                      className="tv-icon-action-btn"
                                      title="Editar nome, pasta e observações"
                                      onClick={() => void handleOpenEditDevice(dev)}
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      className="tv-icon-action-btn"
                                      title="Detalhes técnicos e histórico"
                                      onClick={() => onDetails(dev)}
                                    >
                                      <Sliders size={14} />
                                    </button>
                                    {canManage(dev.organizationId) && (
                                      <button
                                        type="button"
                                        className="tv-icon-action-btn danger"
                                        title="Excluir dispositivo"
                                        onClick={() => onDeletePrompt(dev)}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                    {/* Menu de pasta rápida */}
                                    <div className="tv-menu-container">
                                      <button
                                        type="button"
                                        className="tv-icon-action-btn"
                                        title="Mover rapidamente para outra pasta"
                                        onClick={() => setMenuOpenForDevice(isMenuOpen ? null : dev.id)}
                                      >
                                        <MoreVertical size={14} />
                                      </button>
                                      {isMenuOpen && (
                                        <div className="tv-dropdown-menu">
                                          <p className="tv-dropdown-title">Mover para pasta:</p>
                                          {groups.map((tg) => (
                                            <button
                                              key={tg.id}
                                              type="button"
                                              className={`tv-dropdown-item ${tg.id === group.id ? 'active' : ''}`}
                                              onClick={() => void handleAssignGroup(dev, tg.id)}
                                            >
                                              <Folder size={14} />
                                              <span>{tg.name}</span>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
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

      {/* MODAL 1: EDITAR DADOS DO COMPUTADOR */}
      {editingDevice && (
        <div className="tv-modal-backdrop" onClick={() => !isSavingDevice && setEditingDevice(null)}>
          <div
            className="tv-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-device-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tv-modal-header">
              <div className="tv-modal-title-wrap">
                <Pencil size={18} className="text-primary" />
                <h3 id="edit-device-title">Editar Computador</h3>
              </div>
              <button
                type="button"
                className="tv-modal-close-btn"
                disabled={isSavingDevice}
                onClick={() => setEditingDevice(null)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveDevice} className="tv-modal-body">
              <div className="tv-modal-meta-box">
                <div className="tv-modal-meta-item">
                  <span className="tv-meta-label">RustDesk ID:</span>
                  <span className="tv-meta-val mono">{formatRustDeskId(editingDevice.rustdeskId)}</span>
                </div>
                <div className="tv-modal-meta-item">
                  <span className="tv-meta-label">Hostname:</span>
                  <span className="tv-meta-val">{editingDevice.hostname}</span>
                </div>
                <div className="tv-modal-meta-item">
                  <span className="tv-meta-label">Organização:</span>
                  <span className="tv-meta-val">{editingDevice.organizationName}</span>
                </div>
              </div>

              {deviceSaveError && (
                <div className="tv-modal-error" role="alert">
                  {deviceSaveError}
                </div>
              )}

              <div className="tv-form-field">
                <label htmlFor="edit-name-input" className="tv-field-label">
                  Nome de Exibição:
                </label>
                <input
                  id="edit-name-input"
                  type="text"
                  className="tv-text-input"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder="Ex: Balcão Caixa 01, Servidor Dell..."
                  required
                  autoFocus
                />
                <span className="tv-field-hint">
                  Este é o nome principal que aparecerá na listagem e na busca do painel.
                </span>
              </div>

              <div className="tv-form-field">
                <label htmlFor="edit-folder-select" className="tv-field-label">
                  Pasta / Grupo:
                </label>
                <select
                  id="edit-folder-select"
                  className="tv-select-input"
                  value={editFolderId}
                  onChange={(e) => setEditFolderId(e.target.value)}
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      📁 {g.name}
                    </option>
                  ))}
                </select>
                <span className="tv-field-hint">
                  Selecione a pasta onde esta máquina deve ficar agrupada. As alterações são salvas permanentemente.
                </span>
              </div>

              <div className="tv-form-field">
                <label htmlFor="edit-notes-input" className="tv-field-label">
                  Observações e Anotações Técnicas:
                </label>
                <textarea
                  id="edit-notes-input"
                  className="tv-textarea-input"
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Ex: Máquina do gerente, IP estático 192.168.1.150, suporte autorizado..."
                />
                <span className="tv-field-hint">
                  Informações visíveis aos técnicos sobre esta estação de trabalho.
                </span>
              </div>

              <div className="tv-modal-actions">
                <button
                  type="button"
                  className="tv-btn-secondary"
                  disabled={isSavingDevice}
                  onClick={() => setEditingDevice(null)}
                >
                  Cancelar
                </button>
                <button type="submit" className="tv-btn-primary" disabled={isSavingDevice}>
                  {isSavingDevice ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      <span>Salvar Alterações</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CRIAR NOVA PASTA */}
      {isNewFolderOpen && (
        <div className="tv-modal-backdrop" onClick={() => setIsNewFolderOpen(false)}>
          <div
            className="tv-modal-card sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-folder-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tv-modal-header">
              <div className="tv-modal-title-wrap">
                <FolderPlus size={18} className="text-primary" />
                <h3 id="new-folder-title">Nova Pasta</h3>
              </div>
              <button
                type="button"
                className="tv-modal-close-btn"
                onClick={() => setIsNewFolderOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateFolder} className="tv-modal-body">
              <div className="tv-form-field">
                <label htmlFor="new-folder-name" className="tv-field-label">
                  Nome da Pasta:
                </label>
                <input
                  id="new-folder-name"
                  type="text"
                  className="tv-text-input"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Ex: Totens de Autoatendimento, Filial Centro..."
                  required
                  autoFocus
                />
              </div>

              <div className="tv-modal-actions">
                <button
                  type="button"
                  className="tv-btn-secondary"
                  onClick={() => setIsNewFolderOpen(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="tv-btn-primary" disabled={!newFolderName.trim()}>
                  <Check size={16} />
                  <span>Criar Pasta</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: RENOMEAR PASTA */}
      {folderToRename && (
        <div className="tv-modal-backdrop" onClick={() => setFolderToRename(null)}>
          <div
            className="tv-modal-card sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-folder-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tv-modal-header">
              <div className="tv-modal-title-wrap">
                <Pencil size={18} className="text-primary" />
                <h3 id="rename-folder-title">Renomear Pasta</h3>
              </div>
              <button
                type="button"
                className="tv-modal-close-btn"
                onClick={() => setFolderToRename(null)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRenameFolder} className="tv-modal-body">
              <div className="tv-form-field">
                <label htmlFor="rename-folder-name" className="tv-field-label">
                  Nome da Pasta:
                </label>
                <input
                  id="rename-folder-name"
                  type="text"
                  className="tv-text-input"
                  value={renameFolderName}
                  onChange={(e) => setRenameFolderName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="tv-modal-actions">
                <button
                  type="button"
                  className="tv-btn-secondary"
                  onClick={() => setFolderToRename(null)}
                >
                  Cancelar
                </button>
                <button type="submit" className="tv-btn-primary" disabled={!renameFolderName.trim()}>
                  <Check size={16} />
                  <span>Salvar Nome</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: CONFIRMAR EXCLUSÃO DE PASTA */}
      {folderToDelete && (
        <div className="tv-modal-backdrop" onClick={() => setFolderToDelete(null)}>
          <div
            className="tv-modal-card sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-folder-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tv-modal-header">
              <div className="tv-modal-title-wrap">
                <Trash2 size={18} className="text-red-400" />
                <h3 id="delete-folder-title">Excluir Pasta</h3>
              </div>
              <button
                type="button"
                className="tv-modal-close-btn"
                onClick={() => setFolderToDelete(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="tv-modal-body">
              <p className="tv-delete-confirm-text">
                Tem certeza de que deseja excluir a pasta <strong>{folderToDelete.name}</strong>?
              </p>
              <p className="tv-delete-confirm-sub">
                Os computadores contidos nesta pasta não serão excluídos: eles serão movidos automaticamente para a pasta principal <strong>Clientes</strong>.
              </p>

              <div className="tv-modal-actions">
                <button
                  type="button"
                  className="tv-btn-secondary"
                  onClick={() => setFolderToDelete(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="tv-btn-danger"
                  onClick={() => handleDeleteFolder(folderToDelete)}
                >
                  <Trash2 size={16} />
                  <span>Excluir Pasta</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
