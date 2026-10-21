'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { DeviceView } from '@appremoto/contracts';
import {
  Clock,
  Folder,
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
  ArrowLeftRight,
  Star,
  Share2,
  ArrowUpDown,
  Zap,
  Layers,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Lock,
  ShieldAlert,
  Cpu,
  HardDrive,
  Activity,
  Network,
} from 'lucide-react';
import { ConnectDevice } from './connect-device';
import type { ConnectionLogEvent } from './connection-log';
import type { DeviceDirectoryService } from './use-devices';
import { type DeviceStatusState, formatLastSeen } from './device-record';
import {
  parseSystemInfo,
  resolveDeviceNetworkIps,
  resolveDeviceHardwareTelemetry,
  analyzeDeviceNetworkTopology,
} from './system-info';
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
  getDeviceProtectionState,
  hashDeviceAccessPassword,
  getDeviceFolderName,
  getFavoriteDeviceIds,
  toggleFavoriteDeviceId,
  getUserViewPreferences,
  saveUserViewPreferences,
  type DeviceGroup,
  type DeviceCustomMetadata,
} from './teamviewer-storage';
import {
  resolveCoherentDevicePresentation,
  type CoherentDevicePresentation,
} from './device-presentation';

export { resolveCoherentDevicePresentation, type CoherentDevicePresentation };

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
  activeCategory = '',
  onSelectCategory,
  allDevices = devices,
  currentUserId = null,
  onOpenCnpjGroup,
  searchQuery = '',
  isAdmin,
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
  activeCategory?: string;
  onSelectCategory?(category: string): void;
  allDevices?: DeviceView[];
  currentUserId?: string | null;
  onOpenCnpjGroup?(cnpj: string): void;
  searchQuery?: string;
  isAdmin?(organizationId: string): boolean;
}) {
  const initialTreePrefs = useMemo(() => getUserViewPreferences(currentUserId), [currentUserId]);
  const loadedTreeUserRef = useRef<string | null>(currentUserId);
  const [groups, setGroups] = useState<DeviceGroup[]>(() => getDeviceGroups());
  const [menuOpenForDevice, setMenuOpenForDevice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Estados de Mobilidade & Operação Rápida (PC e Celular - Persistidos por Usuário)
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => getFavoriteDeviceIds(currentUserId));
  const [onlyOnlineQuickFilter, setOnlyOnlineQuickFilter] = useState<boolean>(() => initialTreePrefs.onlyOnlineQuickFilter);
  const [onlyFavoritesQuickFilter, setOnlyFavoritesQuickFilter] = useState<boolean>(() => initialTreePrefs.onlyFavoritesQuickFilter);
  const [sortBy, setSortBy] = useState<'smart' | 'name' | 'recent'>(() => initialTreePrefs.sortBy);
  const [compactMode, setCompactMode] = useState<boolean>(() => initialTreePrefs.compactMode);
  const [actionSheetDevice, setActionSheetDevice] = useState<DeviceView | null>(null);
  const [expandedDeviceIds, setExpandedDeviceIds] = useState<string[]>([]);

  function toggleDeviceDetails(deviceId: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setExpandedDeviceIds((prev) =>
      prev.includes(deviceId) ? prev.filter((id) => id !== deviceId) : [...prev, deviceId]
    );
  }

  // Restaura preferências rápidas e favoritos quando o usuário autenticado muda ou é resolvido
  useEffect(() => {
    if (!currentUserId) return;
    if (loadedTreeUserRef.current !== currentUserId) {
      loadedTreeUserRef.current = currentUserId;
      const prefs = getUserViewPreferences(currentUserId);
      setOnlyOnlineQuickFilter(prefs.onlyOnlineQuickFilter);
      setOnlyFavoritesQuickFilter(prefs.onlyFavoritesQuickFilter);
      setSortBy(prefs.sortBy);
      setCompactMode(prefs.compactMode);
      setFavoriteIds(getFavoriteDeviceIds(currentUserId));
    }
  }, [currentUserId]);

  // Salva filtros rápidos, ordenação e modo compacto no perfil do usuário ativo
  useEffect(() => {
    if (!currentUserId || loadedTreeUserRef.current !== currentUserId) return;
    saveUserViewPreferences(currentUserId, {
      onlyOnlineQuickFilter,
      onlyFavoritesQuickFilter,
      sortBy,
      compactMode,
    });
  }, [currentUserId, onlyOnlineQuickFilter, onlyFavoritesQuickFilter, sortBy, compactMode]);

  // Estados dos Modais
  const [editingDevice, setEditingDevice] = useState<DeviceView | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editFolderId, setEditFolderId] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editAdminOnlyAccess, setEditAdminOnlyAccess] = useState(false);
  const [editAccessPasswordHash, setEditAccessPasswordHash] = useState<string | null>(null);
  const [editNewAccessPassword, setEditNewAccessPassword] = useState('');
  const [editClearAccessPassword, setEditClearAccessPassword] = useState(false);
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

  // Bloqueia a rolagem da tela de fundo enquanto qualquer modal estiver aberto
  useEffect(() => {
    const hasModalOpen = Boolean(
      editingDevice || isNewFolderOpen || folderToRename || folderToDelete || actionSheetDevice
    );
    if (!hasModalOpen || typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [editingDevice, isNewFolderOpen, folderToRename, folderToDelete, actionSheetDevice]);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  }

  function handleToggleFavorite(dev: DeviceView, e?: React.MouseEvent) {
    e?.stopPropagation();
    const updated = toggleFavoriteDeviceId(dev.id, currentUserId);
    setFavoriteIds(updated);
    const isNowFav = updated.includes(dev.id);
    showToast(isNowFav ? `⭐ "${dev.displayName}" fixado no topo` : `Removido dos fixados`);
  }

  async function handleShareDeviceCard(dev: DeviceView, e?: React.MouseEvent) {
    e?.stopPropagation();
    const cleanId = formatRustDeskId(dev.rustdeskId);
    const dd = dev.datadivas;
    const { localIp, publicIp } = resolveDeviceNetworkIps(dev);
    const hw = resolveDeviceHardwareTelemetry(dev);
    const netTopo = analyzeDeviceNetworkTopology(dev, allDevices.length ? allDevices : devices);
    const shareLines = [
      `🖥️ Computador: ${dev.displayName}`,
      `🔑 ID RustDesk: ${cleanId}`,
      `💻 Hostname: ${dev.hostname}`,
      `🏢 Organização: ${dev.organizationName}`,
      `🏠 IP Local: ${localIp || 'N/D'}${dd?.nomeMaq ? ` (${dd.nomeMaq})` : ''}`,
      `🌐 IP Público: ${publicIp || 'N/D'}`,
      `📡 Roteador / Sub-rede: ${netTopo.badgeLabel}`,
    ];
    if (hw.hasAnyHardwareData) {
      shareLines.push(`⚙️ Hardware: ${hw.cpu.compactLabel} · ${hw.ram.compactLabel} · ${hw.disk.compactLabel}`);
    }
    if (dd?.nomeFantasia) shareLines.push(`🏷️ Nome Fantasia: ${dd.nomeFantasia}`);
    if (dd?.razaoSocial) shareLines.push(`🏛️ Razão Social: ${dd.razaoSocial}`);
    if (dd?.cnpj) shareLines.push(`🪪 CNPJ/CPF: ${dd.cnpj}`);
    if (dd?.serial) shareLines.push(`🔐 Serial DataDivas: ${dd.serial}`);
    if (dd?.ie) shareLines.push(`📄 IE: ${dd.ie}`);
    if (dd?.endereco || dd?.cidade || dd?.uf) {
      const loc = [dd.endereco, [dd.cidade, dd.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ');
      shareLines.push(`📍 Endereço: ${loc}`);
    }
    if (dd?.ipDataDivas) shareLines.push(`🗄️ IP DataDivas: ${dd.ipDataDivas}`);
    const shareText = shareLines.join('\n');
    try {
      if (typeof navigator !== 'undefined' && navigator.share && window.innerWidth <= 768) {
        await navigator.share({
          title: `Acesso Remoto - ${dev.displayName}`,
          text: shareText,
        });
        return;
      }
    } catch {
      // Fallback para área de transferência
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(shareText);
      showToast(`Cartão de acesso de "${dev.displayName}" copiado!`);
    }
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
        const currentProtection = getDeviceProtectionState(device, metaMap);
        const encoded = encodeDeviceNotes({
          folderName: targetFolderName,
          adminOnlyAccess: currentProtection.adminOnlyAccess,
          accessPasswordHash: currentProtection.accessPasswordHash,
          customDisplayName: currentMeta.customDisplayName || Boolean(metaMap[device.id]?.customDisplayName),
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
    const protection = getDeviceProtectionState(device, metaMap);
    setEditNotes(parsedNotes.notes || '');
    setEditAdminOnlyAccess(protection.adminOnlyAccess);
    setEditAccessPasswordHash(protection.accessPasswordHash);
    setEditNewAccessPassword('');
    setEditClearAccessPassword(false);

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
          setEditAdminOnlyAccess(freshMeta.adminOnlyAccess);
          setEditAccessPasswordHash(freshMeta.accessPasswordHash);
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

      const nextPasswordHash = editNewAccessPassword.trim()
        ? hashDeviceAccessPassword(editNewAccessPassword.trim())
        : editClearAccessPassword
          ? null
          : editAccessPasswordHash;

      saveDeviceCustomMetadata(editingDevice.id, {
        displayName: trimmedName,
        customDisplayName: true,
        folderId: editFolderId,
        notes: editNotes.trim(),
        adminOnlyAccess: editAdminOnlyAccess,
        accessPasswordHash: nextPasswordHash,
      });

      // 2. Persiste na API / MariaDB
      if (service.updateDevice) {
        const encoded = encodeDeviceNotes({
          folderName: targetFolderName,
          adminOnlyAccess: editAdminOnlyAccess,
          accessPasswordHash: nextPasswordHash,
          customDisplayName: true,
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
          const protection = getDeviceProtectionState(dev, metaMap);
          const encoded = encodeDeviceNotes({
            folderName: trimmed,
            adminOnlyAccess: protection.adminOnlyAccess,
            accessPasswordHash: protection.accessPasswordHash,
            customDisplayName: meta.customDisplayName || Boolean(metaMap[dev.id]?.customDisplayName),
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

  let categoryTitle = 'Todos os computadores';
  if (activeCategory === 'recent') {
    categoryTitle = 'Conexões recentes';
  } else if (activeCategory === 'group_clients') {
    categoryTitle = 'Clientes';
  } else if (activeCategory === 'group_xpoint') {
    categoryTitle = 'X-Point Soluções';
  } else if (activeCategory === 'group_servers') {
    categoryTitle = 'Servidores e infra';
  } else if (activeCategory) {
    const foundGroup = groups.find((g) => g.id === activeCategory);
    if (foundGroup) categoryTitle = foundGroup.name;
    else categoryTitle = activeCategory;
  }

  const isDeviceOnline = (d: DeviceView) => {
    const age = d.lastSeenAt ? Date.now() - new Date(d.lastSeenAt).getTime() : Infinity;
    return d.status === 'ONLINE' || (d.enabled && Number.isFinite(age) && age >= 0 && age <= 95_000);
  };

  const onlineCount = useMemo(() => {
    return devices.filter(isDeviceOnline).length;
  }, [devices]);

  const favoriteCount = useMemo(() => {
    return devices.filter((d) => favoriteIds.includes(d.id)).length;
  }, [devices, favoriteIds]);

  const hasActiveSearch = Boolean(searchQuery && searchQuery.trim().length > 0);

  const getRegistrationTimestamp = (d: DeviceView): number => {
    const rawCreated = d.createdAt || d.datadivas?.ultimaSincronizacao;
    if (rawCreated) {
      const parsed = Date.parse(rawCreated);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (d.lastSeenAt) {
      const seen = Date.parse(d.lastSeenAt);
      if (Number.isFinite(seen)) return seen;
    }
    return 0;
  };

  const processedDevices = useMemo(() => {
    let list = [...devices];
    // Por padrão exibe os online; porém quando há texto na caixa de pesquisa, exibe tanto online quanto offline
    if (onlyOnlineQuickFilter && !hasActiveSearch) {
      list = list.filter(isDeviceOnline);
    }
    if (onlyFavoritesQuickFilter && !hasActiveSearch) {
      list = list.filter((d) => favoriteIds.includes(d.id));
    }

    list.sort((a, b) => {
      const favA = favoriteIds.includes(a.id) ? 1 : 0;
      const favB = favoriteIds.includes(b.id) ? 1 : 0;
      if (favA !== favB) return favB - favA;

      if (sortBy === 'smart') {
        const onA = isDeviceOnline(a) ? 1 : 0;
        const onB = isDeviceOnline(b) ? 1 : 0;
        if (onA !== onB) return onB - onA;

        const regA = getRegistrationTimestamp(a);
        const regB = getRegistrationTimestamp(b);
        if (regA !== regB) return regB - regA;

        const ddA = a.datadivas ? 1 : 0;
        const ddB = b.datadivas ? 1 : 0;
        if (ddA !== ddB) return ddB - ddA;
        return 0;
      }
      if (sortBy === 'name') {
        return resolveCoherentDevicePresentation(a).mainTitle.localeCompare(
          resolveCoherentDevicePresentation(b).mainTitle,
          'pt-BR'
        );
      }
      if (sortBy === 'recent') {
        const regA = getRegistrationTimestamp(a);
        const regB = getRegistrationTimestamp(b);
        if (regA !== regB) return regB - regA;
        const tA = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
        const tB = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
        return tB - tA;
      }
      return 0;
    });

    return list;
  }, [devices, onlyOnlineQuickFilter, onlyFavoritesQuickFilter, favoriteIds, sortBy, hasActiveSearch]);

  const categoryCounts = useMemo(() => {
    let clients = 0;
    let xpoint = 0;
    let servers = 0;
    allDevices.forEach((d) => {
      const fName = getDeviceFolderName(d, groups).toLowerCase();
      if (fName.includes('servidor') || fName.includes('infra')) servers++;
      else if (fName.includes('x-point') || fName.includes('xpoint')) xpoint++;
      else clients++;
    });
    return {
      group_clients: clients,
      group_xpoint: xpoint,
      group_servers: servers,
    };
  }, [allDevices, groups]);

  return (
    <div className={`tv-tree-container ${compactMode ? 'tv-density-compact' : ''}`}>
      {/* Toast de Confirmação */}
      {toastMessage && (
        <div className="tv-floating-toast" role="status">
          <Check size={16} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Barra de Título e Categorias Estilo TeamViewer */}
      <div className="tv-tree-header-bar">
        <div className="tv-tree-header-title">
          <div className="tv-category-icon-box">
            {activeCategory === 'recent' ? (
              <Clock size={18} />
            ) : activeCategory === 'group_servers' ? (
              <Laptop size={18} />
            ) : activeCategory === 'group_xpoint' || activeCategory === 'group_clients' ? (
              <Folder size={18} />
            ) : (
              <Monitor size={18} />
            )}
          </div>
          <div className="tv-category-info">
            <span className="tv-category-title">{categoryTitle}</span>
            <span className="tv-category-stats">
              {onlineCount > 0 && <span className="tv-stats-online-dot" />}
              {onlineCount} online · {processedDevices.length} {processedDevices.length === 1 ? 'computador' : 'computadores'}
            </span>
          </div>
        </div>

        <div className="tv-tree-header-actions">
          {onSelectCategory && (
            <div className="tv-filter-pills" role="tablist" aria-label="Filtrar por organização">
              <button
                type="button"
                className={`tv-filter-pill ${!activeCategory ? 'active' : ''}`}
                onClick={() => onSelectCategory('')}
              >
                Todas
                <span className="tv-pill-count">{allDevices.length}</span>
              </button>
              <button
                type="button"
                className={`tv-filter-pill ${activeCategory === 'recent' ? 'active' : ''}`}
                onClick={() => onSelectCategory('recent')}
              >
                Recentes
                <span className="tv-pill-count">{recents.length}</span>
              </button>
              <button
                type="button"
                className={`tv-filter-pill ${activeCategory === 'group_clients' ? 'active' : ''}`}
                onClick={() => onSelectCategory('group_clients')}
              >
                Clientes
                <span className="tv-pill-count">{categoryCounts.group_clients}</span>
              </button>
              <button
                type="button"
                className={`tv-filter-pill ${activeCategory === 'group_xpoint' ? 'active' : ''}`}
                onClick={() => onSelectCategory('group_xpoint')}
              >
                X-Point Soluções
                <span className="tv-pill-count">{categoryCounts.group_xpoint}</span>
              </button>
              <button
                type="button"
                className={`tv-filter-pill ${activeCategory === 'group_servers' ? 'active' : ''}`}
                onClick={() => onSelectCategory('group_servers')}
              >
                Servidores e infra
                <span className="tv-pill-count">{categoryCounts.group_servers}</span>
              </button>
            </div>
          )}

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
      </div>

      {/* Barra de Operação Rápida em Mobilidade (1-Tap Quick Filters & Ordenação para PC e Celular) */}
      <div className="tv-mobility-strip" aria-label="Atalhos de mobilidade">
        <div className="tv-mobility-chips">
          <button
            type="button"
            className={`tv-mobility-chip online-chip ${onlyOnlineQuickFilter ? 'active' : ''}`}
            onClick={() => setOnlyOnlineQuickFilter((v) => !v)}
            title="Exibir apenas computadores prontos para conectar agora"
          >
            <span className="tv-mobility-dot" />
            <span>Prontos ({onlineCount})</span>
          </button>

          <button
            type="button"
            className={`tv-mobility-chip fav-chip ${onlyFavoritesQuickFilter ? 'active' : ''}`}
            onClick={() => setOnlyFavoritesQuickFilter((v) => !v)}
            title="Filtrar computadores fixados nos favoritos"
          >
            <Star size={13} className={onlyFavoritesQuickFilter || favoriteCount > 0 ? 'fill-amber-400 text-amber-400' : ''} />
            <span>Fixados ({favoriteCount})</span>
          </button>
        </div>

        <div className="tv-mobility-controls">
          <div className="tv-sort-control" title="Ordenação rápida da lista">
            <ArrowUpDown size={13} className="tv-sort-icon" />
            <select
              aria-label="Ordenar computadores"
              className="tv-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'smart' | 'name' | 'recent')}
            >
              <option value="smart">Mais Recentes Cadastrados & Online</option>
              <option value="name">Ordem Alfabética (A-Z)</option>
              <option value="recent">Cadastro / Atividade Mais Recente</option>
            </select>
          </div>

          <button
            type="button"
            className={`tv-density-btn ${compactMode ? 'active' : ''}`}
            onClick={() => setCompactMode((v) => !v)}
            title={compactMode ? 'Mudar para visualização detalhada confortável' : 'Mudar para visualização compacta de alta densidade'}
          >
            <Layers size={13} />
            <span>{compactMode ? 'Compacto' : 'Confortável'}</span>
          </button>
        </div>
      </div>

      {/* Cabeçalho de Colunas TeamViewer */}
      <div className="tv-tree-header">
        <div className="tv-col-name">NOME</div>
        <div className="tv-col-id">ID DO RUSTDESK</div>
        <div className="tv-col-status">STATUS</div>
        <div className="tv-col-actions">ACESSO RÁPIDO</div>
      </div>

      {/* Exibição Contínua de Todos os Dispositivos */}
      <div className="tv-rows-group">
        {processedDevices.length === 0 ? (
          <div className="tv-folder-empty-state">
            <Monitor size={22} className="tv-empty-icon" />
            <span>Nenhum computador encontrado para este filtro.</span>
            {(activeCategory || onlyOnlineQuickFilter || onlyFavoritesQuickFilter) && (
              <button
                type="button"
                className="tv-btn-secondary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  onSelectCategory?.('');
                  setOnlyOnlineQuickFilter(false);
                  setOnlyFavoritesQuickFilter(false);
                }}
              >
                Exibir Todos os Computadores
              </button>
            )}
          </div>
        ) : (
          processedDevices.map((dev) => {
            const seenAgeMs = dev.lastSeenAt ? Date.now() - new Date(dev.lastSeenAt).getTime() : Infinity;
            const isOnline = isDeviceOnline(dev);
            const isFavorite = favoriteIds.includes(dev.id);
            const isExpanded = expandedDeviceIds.includes(dev.id);
            const isMenuOpen = menuOpenForDevice === dev.id;
            const sys = parseSystemInfo(dev.operatingSystem, dev.osVersion);
            const rawNotes = getDeviceNotes(dev, customMetaMap);
            const parsedNotes = parseDeviceNotes(rawNotes);
            const folderName = getDeviceFolderName(dev, groups);
            const rec = recents.find((r) => r.deviceId === dev.id || r.rustdeskId === dev.rustdeskId);
            const localCustomMeta = customMetaMap[dev.id];
            const effectiveDev = localCustomMeta?.displayName
              ? { ...dev, displayName: localCustomMeta.displayName }
              : dev;
            const isCustomEdited = Boolean(
              parsedNotes.customDisplayName || localCustomMeta?.customDisplayName
            );
            const presentation = resolveCoherentDevicePresentation(
              effectiveDev,
              folderName,
              isCustomEdited
            );
            const { localIp, publicIp } = resolveDeviceNetworkIps(dev);
            const hw = resolveDeviceHardwareTelemetry(dev);
            const netTopo = analyzeDeviceNetworkTopology(
              dev,
              allDevices.length ? allDevices : devices
            );
            const protection = getDeviceProtectionState(dev, customMetaMap);
            const userIsAdmin = isAdmin ? isAdmin(dev.organizationId) : canManage(dev.organizationId);
            const adminOnlyBlocked = protection.adminOnlyAccess && !userIsAdmin;

            return (
              <div
                key={dev.id}
                className={`tv-row ${isOnline ? 'is-online' : 'is-offline'} ${isFavorite ? 'is-favorite' : ''} ${isExpanded ? 'is-expanded' : ''}`}
              >
                <div className="tv-col-name">
                  {/* Avatar Circular TeamViewer com Indicador de Status Acoplado */}
                  <div className={`tv-avatar-circle ${isOnline ? 'avatar-online' : ''}`} title={isOnline ? 'Online' : 'Offline'}>
                    <Monitor size={18} className="tv-monitor-icon" />
                    <span className={`tv-status-dot ${isOnline ? 'online' : 'offline'}`} />
                  </div>
                  <div className="tv-name-info">
                    {/* Linha 1 (Maior): Estrela + Nome Principal Coerente Concatenado (ex: PANAMBY - SERVIDOR) */}
                    <div className="tv-name-header">
                      <button
                        type="button"
                        className={`tv-pin-star-btn ${isFavorite ? 'active' : ''}`}
                        title={isFavorite ? 'Desafixar do topo' : 'Fixar computador no topo da lista'}
                        aria-label={isFavorite ? `Desafixar ${presentation.mainTitle}` : `Fixar ${presentation.mainTitle}`}
                        onClick={(e) => handleToggleFavorite(dev, e)}
                      >
                        <Star size={13} className={isFavorite ? 'fill-amber-400 text-amber-400' : ''} />
                      </button>
                      <strong
                        className="tv-display-name clickable"
                        title="Clique para ver ou ocultar os detalhes completos deste computador"
                        onClick={(e) => toggleDeviceDetails(dev.id, e)}
                      >
                        {presentation.mainTitle}
                      </strong>
                      {dev.datadivas?.funcao && !presentation.roleIncludedInTitle && (
                        <span className="tv-compact-role-tag" title={`Função: ${dev.datadivas.funcao}`}>
                          {dev.datadivas.funcao}
                        </span>
                      )}
                      <span className={`tv-badge-os tv-badge-os-desktop ${sys.badge.toLowerCase().replace(/\s+/g, '')}`}>
                        {sys.badge}
                      </span>
                      <button
                        type="button"
                        className="tv-inline-edit-btn"
                        title="Editar nome e dados deste computador"
                        onClick={() => void handleOpenEditDevice(dev)}
                      >
                        <Pencil size={12} />
                      </button>
                      {isFavorite && <span className="tv-badge-pinned">Fixado</span>}
                      {protection.adminOnlyAccess && (
                        <span
                          className="tv-badge-pinned"
                          style={{
                            background: 'rgba(244, 63, 94, 0.16)',
                            color: '#fda4af',
                            borderColor: 'rgba(244, 63, 94, 0.38)',
                          }}
                          title="Esta máquina só pode ser acessada por Administradores"
                        >
                          🛡️ Somente Admin
                        </span>
                      )}
                      {protection.requiresAccessPassword && (
                        <span
                          className="tv-badge-pinned"
                          style={{
                            background: 'rgba(245, 158, 11, 0.16)',
                            color: '#fcd34d',
                            borderColor: 'rgba(245, 158, 11, 0.38)',
                          }}
                          title="Exige Senha de Acesso ao clicar em Conectar"
                        >
                          🔑 Senha
                        </span>
                      )}
                    </div>

                    {/* Linha 2 (Subtítulo Menor Abaixo): Contexto Fantasia/Empresa + Host/Pasta + Opção "Ver detalhes" */}
                    <div className="tv-subtext-primary">
                      <span
                        className="tv-subtitle-company"
                        title={
                          dev.datadivas?.razaoSocial
                            ? `${presentation.subtitlePrimary} · ${dev.datadivas.razaoSocial}`
                            : presentation.subtitlePrimary
                        }
                      >
                        {presentation.subtitlePrimary}
                      </span>
                      {presentation.subtitleSecondary && (
                        <>
                          <span className="tv-subtext-sep">·</span>
                          <span className="tv-subtitle-meta">{presentation.subtitleSecondary}</span>
                        </>
                      )}
                      <span className="tv-subtext-sep">·</span>
                      <button
                        type="button"
                        className={`tv-inline-ip-badge tv-ip-local ${localIp ? '' : 'is-missing'}`}
                        title={
                          localIp
                            ? `IP Local da Máquina na LAN: ${localIp} (clique para copiar)`
                            : 'IP Local na rede interna ainda não reportado pelo agente'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!localIp) return;
                          void navigator.clipboard.writeText(localIp).then(() => {
                            showToast(`IP Local ${localIp} copiado!`);
                          });
                        }}
                      >
                        <Laptop size={11} className="tv-ip-icon" />
                        <span>IP Local: {localIp ?? 'N/D'}</span>
                      </button>
                      <button
                        type="button"
                        className={`tv-inline-ip-badge tv-ip-public ${publicIp ? '' : 'is-missing'}`}
                        title={
                          publicIp
                            ? `IP Público (WAN / Internet): ${publicIp} (clique para copiar)`
                            : 'IP Público ainda não registrado no servidor'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!publicIp) return;
                          void navigator.clipboard.writeText(publicIp).then(() => {
                            showToast(`IP Público ${publicIp} copiado!`);
                          });
                        }}
                      >
                        <Globe size={11} className="tv-ip-icon" />
                        <span>IP Público: {publicIp ?? 'N/D'}</span>
                      </button>
                      <button
                        type="button"
                        className={`tv-inline-net-topology-badge status-${netTopo.status}`}
                        title={`${netTopo.summaryTitle} — ${netTopo.summaryDescription} (clique para abrir o mapa de rede)`}
                        onClick={(e) => toggleDeviceDetails(dev.id, e)}
                      >
                        <Network size={11} className="tv-ip-icon" />
                        <span>{netTopo.badgeLabel}</span>
                      </button>
                      <span className="tv-inline-hw-group" aria-label="Telemetria de Hardware">
                        <span
                          className={`tv-inline-hw-pill tone-${hw.cpu.tone}`}
                          title={`Processador: ${hw.cpu.detailLabel}`}
                        >
                          <Cpu size={10} />
                          <span>{hw.cpu.compactLabel}</span>
                        </span>
                        <span
                          className={`tv-inline-hw-pill tone-${hw.ram.tone}`}
                          title={`Memória RAM: ${hw.ram.detailLabel}`}
                        >
                          <Activity size={10} />
                          <span>{hw.ram.compactLabel}</span>
                        </span>
                        <span
                          className={`tv-inline-hw-pill tone-${hw.disk.tone}`}
                          title={`Disco / Armazenamento (HD/SSD): ${hw.disk.detailLabel}`}
                        >
                          <HardDrive size={10} />
                          <span>{hw.disk.compactLabel}</span>
                        </span>
                      </span>
                      <span className="tv-mobile-id-group">
                        <span className="tv-subtext-sep">·</span>
                        <span
                          className="tv-id-subtext"
                          title="ID do RustDesk (toque para copiar)"
                          onClick={(e) => {
                            e.stopPropagation();
                            void navigator.clipboard.writeText(dev.rustdeskId.replace(/\s+/g, '')).then(() => {
                              setCopiedId(dev.rustdeskId);
                              showToast(`ID ${formatRustDeskId(dev.rustdeskId)} copiado!`);
                              setTimeout(() => setCopiedId(null), 2500);
                            });
                          }}
                        >
                          {formatRustDeskId(dev.rustdeskId)}
                        </span>
                        <button
                          type="button"
                          className="tv-copy-id-btn"
                          title={copiedId === dev.rustdeskId ? 'Copiado!' : 'Copiar ID do RustDesk'}
                          onClick={(e) => {
                            e.stopPropagation();
                            void navigator.clipboard.writeText(dev.rustdeskId.replace(/\s+/g, '')).then(() => {
                              setCopiedId(dev.rustdeskId);
                              showToast(`ID ${formatRustDeskId(dev.rustdeskId)} copiado!`);
                              setTimeout(() => setCopiedId(null), 2500);
                            });
                          }}
                        >
                          {copiedId === dev.rustdeskId ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        </button>
                      </span>
                      <span className={`tv-mobile-inline-status ${isOnline ? 'online' : 'offline'}`}>
                        {isOnline ? '● Online' : `Visto: ${formatLastSeen(dev.lastSeenAt)}`}
                      </span>
                      <button
                        type="button"
                        className={`tv-details-expand-btn ${isExpanded ? 'expanded' : ''}`}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? `Ocultar detalhes de ${presentation.mainTitle}` : `Ver detalhes de ${presentation.mainTitle}`}
                        onClick={(e) => toggleDeviceDetails(dev.id, e)}
                      >
                        <span>{isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}</span>
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>

                    {/* Gaveta Expansível: Exibida APENAS quando o usuário clica em "Detalhes" */}
                    {isExpanded && (
                      <div className="tv-row-expanded-drawer" role="region" aria-label={`Detalhes de ${dev.displayName}`}>
                        {/* Bloco 1: Especificações de Sistema, Rede e Organização */}
                        <div className="tv-subtext-secondary">
                          <span className={`tv-badge-os ${sys.badge.toLowerCase().replace(/\s+/g, '')}`}>
                            {sys.badge}
                          </span>
                          <span className="tv-subtext-host">{dev.hostname}</span>
                          <span className="tv-subtext-sep">·</span>
                          <span className="tv-subtext-os">{sys.osName} {sys.versionLabel}</span>
                          <span className="tv-subtext-sep">·</span>
                          <span className="tv-subtext-ip" title="IP Local na rede interna (LAN)">
                            <Laptop size={11} className="tv-ip-icon" /> IP Local: {localIp ?? 'N/D'}
                          </span>
                          <span className="tv-subtext-sep">·</span>
                          <span className="tv-subtext-ip tv-subtext-ip-public" title="IP Público de saída para internet (WAN)">
                            <Globe size={11} className="tv-ip-icon" /> IP Público: {publicIp ?? 'N/D'}
                          </span>
                          {rec?.technicianName && (
                            <>
                              <span className="tv-subtext-sep">·</span>
                              <span className="tv-subtext-tech">Técnico: {rec.technicianName}</span>
                            </>
                          )}
                          {dev.organizationName && dev.organizationName !== folderName && (
                            <>
                              <span className="tv-subtext-sep">·</span>
                              <span className="tv-subtext-org">{dev.organizationName}</span>
                            </>
                          )}
                          {parsedNotes.notes && (
                            <>
                              <span className="tv-subtext-sep">·</span>
                              <span className="tv-subtext-notes" title={parsedNotes.notes}>
                                <FileText size={11} className="inline mr-1" />
                                {parsedNotes.notes}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Bloco 1.5: Telemetria de Hardware (CPU, Memória RAM, HD) & Topologia de Rede / Roteador */}
                        <div className="tv-drawer-telemetry-grid">
                          <div className="tv-drawer-hw-card">
                            <div className="tv-drawer-section-header">
                              <Cpu size={13} className="text-sky-400" />
                              <span>Recursos da Máquina (Processador, Memória & HD)</span>
                            </div>
                            <div className="tv-drawer-hw-metrics">
                              <div className="tv-drawer-hw-metric-item">
                                <div className="tv-drawer-hw-metric-top">
                                  <span className="tv-drawer-hw-label">Processador (CPU)</span>
                                  <strong className={`tv-drawer-hw-val tone-${hw.cpu.tone}`}>
                                    {hw.cpu.usagePct !== null ? `${hw.cpu.usagePct}% em uso` : 'Sem leitura ativa'}
                                  </strong>
                                </div>
                                <div className="tv-drawer-hw-bar">
                                  <div
                                    className={`tv-drawer-hw-bar-fill tone-${hw.cpu.tone}`}
                                    style={{ width: `${hw.cpu.usagePct ?? 0}%` }}
                                  />
                                </div>
                                <span className="tv-drawer-hw-sub">{hw.cpu.detailLabel}</span>
                              </div>

                              <div className="tv-drawer-hw-metric-item">
                                <div className="tv-drawer-hw-metric-top">
                                  <span className="tv-drawer-hw-label">Memória RAM</span>
                                  <strong className={`tv-drawer-hw-val tone-${hw.ram.tone}`}>
                                    {hw.ram.usedLabel && hw.ram.totalLabel
                                      ? `${hw.ram.usedLabel} / ${hw.ram.totalLabel}`
                                      : hw.ram.usagePct !== null
                                        ? `${hw.ram.usagePct}%`
                                        : 'Sem leitura ativa'}
                                  </strong>
                                </div>
                                <div className="tv-drawer-hw-bar">
                                  <div
                                    className={`tv-drawer-hw-bar-fill tone-${hw.ram.tone}`}
                                    style={{ width: `${hw.ram.usagePct ?? 0}%` }}
                                  />
                                </div>
                                <span className="tv-drawer-hw-sub">{hw.ram.detailLabel}</span>
                              </div>

                              <div className="tv-drawer-hw-metric-item">
                                <div className="tv-drawer-hw-metric-top">
                                  <span className="tv-drawer-hw-label">Armazenamento (HD / SSD)</span>
                                  <strong className={`tv-drawer-hw-val tone-${hw.disk.tone}`}>
                                    {hw.disk.usedLabel && hw.disk.totalLabel
                                      ? `${hw.disk.usedLabel} / ${hw.disk.totalLabel}`
                                      : hw.disk.usagePct !== null
                                        ? `${hw.disk.usagePct}%`
                                        : 'Sem leitura ativa'}
                                  </strong>
                                </div>
                                <div className="tv-drawer-hw-bar">
                                  <div
                                    className={`tv-drawer-hw-bar-fill tone-${hw.disk.tone}`}
                                    style={{ width: `${hw.disk.usagePct ?? 0}%` }}
                                  />
                                </div>
                                <span className="tv-drawer-hw-sub">{hw.disk.detailLabel}</span>
                              </div>
                            </div>
                          </div>

                          <div className={`tv-drawer-net-card status-${netTopo.status}`}>
                            <div className="tv-drawer-section-header">
                              <Network size={13} />
                              <span>Diagnóstico de Rede Local & Roteador (Visibilidade LAN)</span>
                            </div>
                            <p className="tv-drawer-net-title">{netTopo.summaryTitle}</p>
                            <p className="tv-drawer-net-desc">{netTopo.summaryDescription}</p>
                            <div className="tv-drawer-net-chips">
                              <span className="tv-drawer-net-chip">
                                Sub-rede: <strong>{netTopo.subnetCidr ?? 'N/D'}</strong>
                              </span>
                              <span className="tv-drawer-net-chip">
                                Roteador (Gateway): <strong>{netTopo.gatewayIp ?? 'N/D'}</strong>
                              </span>
                              {netTopo.connectionType && (
                                <span className="tv-drawer-net-chip">
                                  Meio: <strong>{netTopo.connectionType}</strong>
                                </span>
                              )}
                              {netTopo.configuredServerIp && (
                                <span className="tv-drawer-net-chip">
                                  IP Servidor BD: <strong>{netTopo.configuredServerIp}</strong>
                                </span>
                              )}
                            </div>
                            {netTopo.peers.length > 0 && (
                              <div className="tv-drawer-net-peers">
                                <span className="tv-drawer-net-peers-label">
                                  Comparativo com outras máquinas deste cliente/local ({netTopo.peers.length}):
                                </span>
                                <div className="tv-drawer-net-peers-list">
                                  {netTopo.peers.map((peer) => (
                                    <div
                                      key={peer.id}
                                      className={`tv-drawer-net-peer-pill rel-${peer.relation}`}
                                    >
                                      <span className="tv-peer-name">{peer.displayName}</span>
                                      <span className="tv-peer-ip">
                                        {peer.localIp ? `LAN ${peer.localIp}` : 'Sem IP Local'}
                                      </span>
                                      <span className="tv-peer-verdict">
                                        {peer.relation === 'same_router'
                                          ? '✅ Mesmo Roteador (Enxerga)'
                                          : peer.relation === 'different_router'
                                            ? `⚠️ Outro Roteador (${peer.subnetPrefix}.x — Não enxerga)`
                                            : '⚪ IP LAN pendente'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Bloco 2: Dados Cadastrais DataDivas (C:\DataDivas\config.ini) */}
                        {dev.datadivas && (
                          <div className="tv-datadivas-strip" aria-label="Dados DataDivas do cliente">
                            {(dev.datadivas.nomeFantasia || dev.datadivas.razaoSocial) && (
                              <span
                                className="tv-dd-pill tv-dd-pill-company"
                                title={`Fantasia: ${dev.datadivas.nomeFantasia || '—'} | Razão Social: ${dev.datadivas.razaoSocial || '—'}`}
                              >
                                🏢 {dev.datadivas.nomeFantasia || dev.datadivas.razaoSocial}
                                {dev.datadivas.razaoSocial &&
                                  dev.datadivas.nomeFantasia &&
                                  dev.datadivas.razaoSocial.toLowerCase() !== dev.datadivas.nomeFantasia.toLowerCase() && (
                                    <span className="tv-dd-pill-sub"> · {dev.datadivas.razaoSocial}</span>
                                  )}
                              </span>
                            )}
                            {dev.datadivas.funcao && (
                              <span
                                className="tv-dd-pill tv-dd-pill-role"
                                title={`Função da máquina no CNPJ: ${dev.datadivas.funcao}`}
                              >
                                🏷️ {dev.datadivas.funcao}
                              </span>
                            )}
                            {dev.datadivas.statusRenomeacao &&
                              dev.datadivas.statusRenomeacao !== 'NOT_REQUESTED' &&
                              dev.datadivas.statusRenomeacao !== 'NAO_SOLICITADO' && (
                                <span
                                  className={`tv-dd-pill tv-dd-pill-rename-${dev.datadivas.statusRenomeacao.toLowerCase()}`}
                                  title={
                                    dev.datadivas.statusRenomeacao === 'PENDING_REBOOT' ||
                                    dev.datadivas.statusRenomeacao === 'APLICADO_AGUARDANDO_REBOOT'
                                      ? `Renomeação Windows pendente de reinicialização para ${dev.datadivas.windowsHostnameDesejado || ''}`
                                      : dev.datadivas.statusRenomeacao === 'COMPLETED' ||
                                          dev.datadivas.statusRenomeacao === 'CONFIRMADO'
                                        ? `Hostname Windows sincronizado (${dev.datadivas.windowsHostnameDesejado || dev.hostname})`
                                        : dev.datadivas.statusRenomeacao === 'BLOCKED_DOMAIN'
                                          ? 'Computador em domínio Active Directory — renomeação Windows bloqueada'
                                          : 'Falha ou divergência ao renomear computador no Windows'
                                  }
                                >
                                  {dev.datadivas.statusRenomeacao === 'PENDING_REBOOT' ||
                                  dev.datadivas.statusRenomeacao === 'APLICADO_AGUARDANDO_REBOOT'
                                    ? `⏳ Reinício Pendente (${dev.datadivas.windowsHostnameDesejado || 'Windows'})`
                                    : dev.datadivas.statusRenomeacao === 'COMPLETED' ||
                                        dev.datadivas.statusRenomeacao === 'CONFIRMADO'
                                      ? '✅ Hostname OK'
                                      : dev.datadivas.statusRenomeacao === 'BLOCKED_DOMAIN'
                                        ? '🔒 Domínio AD'
                                        : '⚠️ Erro Renomeação'}
                                </span>
                              )}
                            {dev.datadivas.cnpj && (
                              <button
                                type="button"
                                className="tv-dd-pill tv-dd-pill-copyable"
                                title="CNPJ / CPF no config.ini (clique para copiar)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void navigator.clipboard.writeText(dev.datadivas!.cnpj!).then(() => {
                                    showToast(`CNPJ/CPF ${dev.datadivas!.cnpj} copiado!`);
                                  });
                                }}
                              >
                                <span>CNPJ: {dev.datadivas.cnpj}</span>
                                <Copy size={10} />
                              </button>
                            )}
                            {dev.datadivas.cnpj && onOpenCnpjGroup && (
                              <button
                                type="button"
                                className="tv-dd-pill tv-dd-pill-copyable"
                                title="Abrir Gestão Inteligente de Computadores deste CNPJ"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenCnpjGroup(dev.datadivas!.cnpj!);
                                }}
                              >
                                <span>⚙️ Gerir CNPJ</span>
                              </button>
                            )}
                            {dev.datadivas.serial && (
                              <button
                                type="button"
                                className="tv-dd-pill tv-dd-pill-serial tv-dd-pill-copyable"
                                title="Serial DataDivas no config.ini (clique para copiar)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void navigator.clipboard.writeText(dev.datadivas!.serial!).then(() => {
                                    showToast(`Serial ${dev.datadivas!.serial} copiado!`);
                                  });
                                }}
                              >
                                <span>Serial: {dev.datadivas.serial}</span>
                                <Copy size={10} />
                              </button>
                            )}
                            {dev.datadivas.ie && (
                              <span className="tv-dd-pill" title="Inscrição Estadual (IE)">
                                IE: {dev.datadivas.ie}
                              </span>
                            )}
                            {dev.datadivas.ipDataDivas && (
                              <button
                                type="button"
                                className="tv-dd-pill tv-dd-pill-copyable"
                                title={`IP DataDivas: ${dev.datadivas.ipDataDivas}${dev.datadivas.banco ? ` (${dev.datadivas.banco})` : ''} — clique para copiar`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void navigator.clipboard.writeText(dev.datadivas!.ipDataDivas!).then(() => {
                                    showToast(`IP DataDivas ${dev.datadivas!.ipDataDivas} copiado!`);
                                  });
                                }}
                              >
                                <span>IP DataDivas: {dev.datadivas.ipDataDivas}</span>
                                <Copy size={10} />
                              </button>
                            )}
                            {(dev.datadivas.endereco || dev.datadivas.cidade || dev.datadivas.uf) && (
                              <span
                                className="tv-dd-pill tv-dd-pill-address"
                                title={[
                                  dev.datadivas.endereco,
                                  [dev.datadivas.cidade, dev.datadivas.uf].filter(Boolean).join('/'),
                                ]
                                  .filter(Boolean)
                                  .join(' — ')}
                              >
                                📍{' '}
                                {[
                                  dev.datadivas.endereco,
                                  [dev.datadivas.cidade, dev.datadivas.uf].filter(Boolean).join('/'),
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Bloco 3: Barra de Ações Rápidas da Gaveta de Detalhes */}
                        <div className="tv-expanded-quick-actions">
                          <button
                            type="button"
                            className="tv-expanded-action-btn primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDetails(dev);
                            }}
                          >
                            <Sliders size={12} />
                            <span>Diagnóstico & Histórico</span>
                          </button>
                          <button
                            type="button"
                            className="tv-expanded-action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleOpenEditDevice(dev);
                            }}
                          >
                            <Pencil size={12} />
                            <span>Editar Nome / Pasta</span>
                          </button>
                          <button
                            type="button"
                            className="tv-expanded-action-btn"
                            onClick={(e) => void handleShareDeviceCard(dev, e)}
                          >
                            <Share2 size={12} />
                            <span>Compartilhar Ficha</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Coluna ID para Desktop */}
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
                        showToast(`ID ${formatRustDeskId(dev.rustdeskId)} copiado!`);
                        setTimeout(() => setCopiedId(null), 2500);
                      });
                    }}
                  >
                    {copiedId === dev.rustdeskId ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  </button>
                </div>

                {/* Coluna Status para Desktop */}
                <div className="tv-col-status">
                  <span
                    className={`tv-pill-status ${isOnline ? 'status-online' : 'status-offline'}`}
                    title={
                      isOnline
                        ? `Computador Online · Sinal ativo recebido há ${Math.max(0, Math.round(seenAgeMs / 1000))}s`
                        : `Computador Offline · Visto pela última vez: ${formatLastSeen(dev.lastSeenAt)}`
                    }
                  >
                    <span className="tv-pill-dot" />
                    <span>{isOnline ? 'Online' : 'Offline'}</span>
                  </span>
                </div>

                {/* Coluna de Ações: Botão TeamViewer com setas e ferramentas de mobilidade */}
                <div className="tv-col-actions">
                  <div className="tv-action-buttons">
                    {service.connectDevice && canConnect(dev.organizationId) && (
                      <ConnectDevice
                        deviceId={dev.id}
                        peerAlias={presentation.mainTitle}
                        deviceDisplayName={presentation.mainTitle}
                        requiresAccessPassword={protection.requiresAccessPassword}
                        accessPasswordHash={protection.accessPasswordHash}
                        adminOnlyBlocked={adminOnlyBlocked}
                        enabled={dev.enabled && isOnline && statusState === 'current'}
                        service={{
                          connectDevice: service.connectDevice,
                          recordConnectionEvent: service.recordConnectionEvent,
                        }}
                        onEvent={(event) => onEvent(dev.id, event)}
                        onHelp={() => onDetails(dev)}
                        onSessionExpired={onSessionExpired}
                        onConnectStarted={() => onSessionStarted?.(dev)}
                        trigger={({ connect, pending, enabled }) => (
                          <button
                            type="button"
                            className={`tv-btn-connect-tv ${isOnline ? 'online' : 'offline'}`}
                            disabled={!enabled || pending}
                            onClick={connect}
                            title={
                              adminOnlyBlocked
                                ? 'Acesso restrito somente a Administradores'
                                : !enabled
                                  ? 'Aguarde o dispositivo ficar online'
                                  : protection.requiresAccessPassword
                                    ? `Conectar a ${dev.displayName} (exige Senha de Acesso)`
                                    : `Conectar a ${dev.displayName}`
                            }
                            aria-label={`Conectar a ${dev.displayName}`}
                          >
                            {pending ? (
                              <Loader2 size={18} className="animate-spin text-primary" />
                            ) : adminOnlyBlocked ? (
                              <ShieldAlert size={16} className="text-rose-400" />
                            ) : protection.requiresAccessPassword ? (
                              <KeyRound size={16} className="text-amber-400" />
                            ) : (
                              <ArrowLeftRight size={18} className="tv-connect-arrows" />
                            )}
                            <span className="tv-connect-label">
                              {adminOnlyBlocked ? 'Só Admin' : 'Conectar'}
                            </span>
                          </button>
                        )}
                      />
                    )}
                    <div className="tv-action-toolbar">
                      <button
                        type="button"
                        className="tv-icon-action-btn"
                        title="Compartilhar ou copiar cartão de acesso rápido"
                        onClick={(e) => void handleShareDeviceCard(dev, e)}
                      >
                        <Share2 size={14} />
                      </button>
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
                        title="Diagnóstico técnico e histórico completo"
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
                      {/* Botão de Ações Rápidas (abre Bottom Sheet no celular ou Menu Rápido no PC) */}
                      <div className="tv-menu-container">
                        <button
                          type="button"
                          className="tv-icon-action-btn tv-more-actions-trigger"
                          title="Ações rápidas e mover para pasta"
                          aria-label={`Opções rápidas de ${dev.displayName}`}
                          onClick={() => {
                            if (typeof window !== 'undefined' && window.innerWidth <= 768) {
                              setActionSheetDevice(dev);
                            } else {
                              setMenuOpenForDevice(isMenuOpen ? null : dev.id);
                            }
                          }}
                        >
                          <MoreVertical size={15} />
                        </button>
                        {isMenuOpen && (
                          <div className="tv-dropdown-menu">
                            <p className="tv-dropdown-title">Ações rápidas:</p>
                            <button
                              type="button"
                              className="tv-dropdown-item"
                              onClick={(e) => {
                                setMenuOpenForDevice(null);
                                toggleDeviceDetails(dev.id, e);
                              }}
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              <span>{isExpanded ? 'Ocultar Detalhes' : 'Expandir Detalhes'}</span>
                            </button>
                            <button
                              type="button"
                              className="tv-dropdown-item"
                              onClick={() => {
                                setMenuOpenForDevice(null);
                                onDetails(dev);
                              }}
                            >
                              <Sliders size={14} />
                              <span>Diagnóstico & Histórico</span>
                            </button>
                            <button
                              type="button"
                              className="tv-dropdown-item"
                              onClick={() => {
                                setMenuOpenForDevice(null);
                                void handleShareDeviceCard(dev);
                              }}
                            >
                              <Share2 size={14} />
                              <span>Copiar Cartão de Acesso</span>
                            </button>
                            <button
                              type="button"
                              className="tv-dropdown-item"
                              onClick={() => {
                                setMenuOpenForDevice(null);
                                handleToggleFavorite(dev);
                              }}
                            >
                              <Star size={14} />
                              <span>{isFavorite ? 'Desafixar do Topo' : 'Fixar no Topo'}</span>
                            </button>
                            <div className="tv-dropdown-divider" />
                            <p className="tv-dropdown-title">Mover para pasta:</p>
                            {groups.map((tg) => (
                              <button
                                key={tg.id}
                                type="button"
                                className={`tv-dropdown-item ${tg.name === folderName ? 'active' : ''}`}
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

      {/* BOTTOM SHEET MOBILE / GAVETA TÁTIL DE AÇÕES RÁPIDAS EM MOBILIDADE */}
      {actionSheetDevice && (
        <div className="tv-modal-backdrop" onClick={() => setActionSheetDevice(null)}>
          <div
            className="tv-modal-card tv-action-sheet-card"
            role="dialog"
            aria-modal="true"
            aria-label={`Ações rápidas para ${actionSheetDevice.displayName}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tv-sheet-drag-handle" aria-hidden="true" />
            <div className="tv-modal-header">
              <div className="tv-modal-title-wrap">
                <Monitor size={18} className="text-primary" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>{actionSheetDevice.displayName}</h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    ID: {formatRustDeskId(actionSheetDevice.rustdeskId)} · {actionSheetDevice.hostname}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="tv-modal-close-btn"
                onClick={() => setActionSheetDevice(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="tv-action-sheet-body">
              <div className="tv-sheet-grid">
                <button
                  type="button"
                  className="tv-sheet-action-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(actionSheetDevice.rustdeskId.replace(/\s+/g, ''));
                    showToast(`ID ${formatRustDeskId(actionSheetDevice.rustdeskId)} copiado!`);
                    setActionSheetDevice(null);
                  }}
                >
                  <Copy size={18} className="text-sky-400" />
                  <span>Copiar ID</span>
                </button>

                <button
                  type="button"
                  className="tv-sheet-action-btn"
                  onClick={() => {
                    const target = actionSheetDevice;
                    setActionSheetDevice(null);
                    void handleShareDeviceCard(target);
                  }}
                >
                  <Share2 size={18} className="text-emerald-400" />
                  <span>Compartilhar</span>
                </button>

                <button
                  type="button"
                  className="tv-sheet-action-btn"
                  onClick={() => {
                    const target = actionSheetDevice;
                    setActionSheetDevice(null);
                    handleToggleFavorite(target);
                  }}
                >
                  <Star size={18} className="text-amber-400" />
                  <span>{favoriteIds.includes(actionSheetDevice.id) ? 'Desafixar' : 'Fixar no Topo'}</span>
                </button>

                <button
                  type="button"
                  className="tv-sheet-action-btn"
                  onClick={() => {
                    const target = actionSheetDevice;
                    setActionSheetDevice(null);
                    void handleOpenEditDevice(target);
                  }}
                >
                  <Pencil size={18} className="text-indigo-400" />
                  <span>Editar Dados</span>
                </button>

                <button
                  type="button"
                  className="tv-sheet-action-btn"
                  onClick={() => {
                    const target = actionSheetDevice;
                    setActionSheetDevice(null);
                    onDetails(target);
                  }}
                >
                  <Sliders size={18} className="text-purple-400" />
                  <span>Diagnóstico</span>
                </button>

                {canManage(actionSheetDevice.organizationId) && (
                  <button
                    type="button"
                    className="tv-sheet-action-btn danger"
                    onClick={() => {
                      const target = actionSheetDevice;
                      setActionSheetDevice(null);
                      onDeletePrompt(target);
                    }}
                  >
                    <Trash2 size={18} className="text-rose-400" />
                    <span>Excluir</span>
                  </button>
                )}
              </div>

              <div className="tv-sheet-folders-section">
                <span className="tv-sheet-section-label">Mover rapidamente para pasta:</span>
                <div className="tv-sheet-folder-pills">
                  {groups.map((tg) => {
                    const currentFolder = getDeviceFolderName(actionSheetDevice, groups);
                    return (
                      <button
                        key={tg.id}
                        type="button"
                        className={`tv-sheet-folder-pill ${tg.name === currentFolder ? 'active' : ''}`}
                        onClick={() => {
                          const target = actionSheetDevice;
                          setActionSheetDevice(null);
                          void handleAssignGroup(target, tg.id);
                        }}
                      >
                        <Folder size={13} />
                        <span>{tg.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: EDITAR DADOS DO COMPUTADOR */}
      {editingDevice && (() => {
        const editingIps = resolveDeviceNetworkIps(editingDevice);
        return (
        <div className="tv-modal-backdrop tv-edit-modal-backdrop">
          <div
            className="tv-modal-card tv-edit-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-device-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tv-sheet-drag-handle" aria-hidden="true" />
            <div className="tv-modal-header tv-edit-modal-header">
              <div className="tv-modal-title-wrap">
                <span className="tv-edit-modal-icon-badge" aria-hidden="true">
                  <Pencil size={16} />
                </span>
                <div className="tv-edit-modal-title-text">
                  <h3 id="edit-device-title">Editar Computador</h3>
                  <span className="tv-edit-modal-subtitle">
                    {editingDevice.hostname} • {formatRustDeskId(editingDevice.rustdeskId)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="tv-modal-close-btn tv-edit-close-btn"
                disabled={isSavingDevice}
                onClick={() => setEditingDevice(null)}
                aria-label="Fechar"
                title="Fechar janela de edição"
              >
                <X size={16} />
                <span>Fechar</span>
              </button>
            </div>

            <form onSubmit={handleSaveDevice} className="tv-edit-modal-form">
              <div className="tv-modal-body tv-edit-modal-scroll-area">
                <div className="tv-modal-meta-box tv-edit-meta-box">
                  <div className="tv-edit-meta-primary-grid">
                    <div className="tv-edit-meta-chip">
                      <span className="tv-meta-label">RustDesk ID</span>
                      <span className="tv-meta-val mono">{formatRustDeskId(editingDevice.rustdeskId)}</span>
                    </div>
                    <div className="tv-edit-meta-chip">
                      <span className="tv-meta-label">Hostname</span>
                      <span className="tv-meta-val" title={editingDevice.hostname}>{editingDevice.hostname}</span>
                    </div>
                    <div className="tv-edit-meta-chip">
                      <span className="tv-meta-label">Organização</span>
                      <span className="tv-meta-val" title={editingDevice.organizationName}>{editingDevice.organizationName}</span>
                    </div>
                    <div className="tv-edit-meta-chip">
                      <span className="tv-meta-label">IP Local (LAN)</span>
                      <span className="tv-meta-val mono">{editingIps.localIp ?? 'N/D'}</span>
                    </div>
                    <div className="tv-edit-meta-chip">
                      <span className="tv-meta-label">IP Público (WAN)</span>
                      <span className="tv-meta-val mono">{editingIps.publicIp ?? 'N/D'}</span>
                    </div>
                  </div>

                  {(editingDevice.datadivas?.nomeFantasia ||
                    editingDevice.datadivas?.razaoSocial ||
                    editingDevice.datadivas?.cnpj ||
                    editingDevice.datadivas?.serial ||
                    editingDevice.datadivas?.ie ||
                    editingDevice.datadivas?.ipMaq ||
                    editingDevice.datadivas?.ipDataDivas) && (
                    <div className="tv-edit-meta-secondary-grid">
                      {editingDevice.datadivas?.nomeFantasia && (
                        <div className="tv-modal-meta-item">
                          <span className="tv-meta-label">Nome Fantasia:</span>
                          <span className="tv-meta-val">{editingDevice.datadivas.nomeFantasia}</span>
                        </div>
                      )}
                      {editingDevice.datadivas?.razaoSocial && (
                        <div className="tv-modal-meta-item">
                          <span className="tv-meta-label">Razão Social:</span>
                          <span className="tv-meta-val">{editingDevice.datadivas.razaoSocial}</span>
                        </div>
                      )}
                      {editingDevice.datadivas?.cnpj && (
                        <div className="tv-modal-meta-item">
                          <span className="tv-meta-label">CNPJ / CPF:</span>
                          <span className="tv-meta-val mono">{editingDevice.datadivas.cnpj}</span>
                        </div>
                      )}
                      {editingDevice.datadivas?.serial && (
                        <div className="tv-modal-meta-item">
                          <span className="tv-meta-label">Serial:</span>
                          <span className="tv-meta-val mono">{editingDevice.datadivas.serial}</span>
                        </div>
                      )}
                      {editingDevice.datadivas?.ie && (
                        <div className="tv-modal-meta-item">
                          <span className="tv-meta-label">IE:</span>
                          <span className="tv-meta-val mono">{editingDevice.datadivas.ie}</span>
                        </div>
                      )}
                      {editingDevice.datadivas?.ipMaq && (
                        <div className="tv-modal-meta-item">
                          <span className="tv-meta-label">IP Máquina:</span>
                          <span className="tv-meta-val mono">{editingDevice.datadivas.ipMaq}</span>
                        </div>
                      )}
                      {editingDevice.datadivas?.ipDataDivas && (
                        <div className="tv-modal-meta-item">
                          <span className="tv-meta-label">IP DataDivas:</span>
                          <span className="tv-meta-val mono">{editingDevice.datadivas.ipDataDivas}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {deviceSaveError && (
                  <div className="tv-modal-error" role="alert">
                    {deviceSaveError}
                  </div>
                )}

                <div className="tv-edit-form-row">
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
                      Nome principal na listagem e na busca do painel.
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
                      Pasta onde esta máquina ficará agrupada.
                    </span>
                  </div>
                </div>

                <div className="tv-form-field">
                  <label htmlFor="edit-notes-input" className="tv-field-label">
                    Observações e Anotações Técnicas:
                  </label>
                  <textarea
                    id="edit-notes-input"
                    className="tv-textarea-input"
                    rows={2}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Ex: Máquina do gerente, atendimento prioritário, suporte autorizado..."
                  />
                  <span className="tv-field-hint">
                    Informações visíveis aos técnicos sobre esta estação de trabalho.
                  </span>
                </div>

                <div className="tv-edit-security-card">
                  <div className="tv-edit-security-header">
                    <span className="tv-edit-security-title">
                      <Lock size={14} />
                      Controle de Acesso & Senha da Máquina
                    </span>
                    {editAccessPasswordHash && !editClearAccessPassword && (
                      <span className="tv-edit-security-badge">
                        🔑 Senha Ativa
                      </span>
                    )}
                  </div>

                  <div className="tv-form-field" style={{ margin: 0 }}>
                    <label htmlFor="edit-access-password-input" className="tv-field-label">
                      Senha de Acesso (exigida ao clicar em Conectar):
                    </label>
                    <div className="tv-edit-password-input-row">
                      <input
                        id="edit-access-password-input"
                        type="password"
                        className="tv-text-input"
                        value={editNewAccessPassword}
                        onChange={(e) => {
                          setEditNewAccessPassword(e.target.value);
                          if (e.target.value.trim()) setEditClearAccessPassword(false);
                        }}
                        placeholder={
                          editAccessPasswordHash && !editClearAccessPassword
                            ? 'Digite nova senha para alterar (ou deixe em branco para manter)...'
                            : 'Ex: definir senha de acesso para esta máquina (opcional)...'
                        }
                        autoComplete="new-password"
                      />
                      {editAccessPasswordHash && !editClearAccessPassword && (
                        <button
                          type="button"
                          className="tv-btn-secondary tv-edit-remove-pwd-btn"
                          onClick={() => {
                            setEditClearAccessPassword(true);
                            setEditNewAccessPassword('');
                          }}
                          title="Remover exigência de senha de acesso desta máquina"
                        >
                          Remover Senha
                        </button>
                      )}
                    </div>
                    <span className="tv-field-hint">
                      {editClearAccessPassword
                        ? '⚠️ A senha de acesso será removida ao salvar (voltará para conexão direta em 1 clique).'
                        : 'Se definida, o sistema exigirá esta senha antes de abrir a conexão remota (a senha interna automática do RustDesk permanece intacta).'}
                    </span>
                  </div>

                  <label className={`tv-edit-admin-toggle ${editAdminOnlyAccess ? 'is-active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={editAdminOnlyAccess}
                      onChange={(e) => setEditAdminOnlyAccess(e.target.checked)}
                    />
                    <div className="tv-edit-admin-toggle-content">
                      <span className="tv-edit-admin-toggle-title">
                        🛡️ Acesso restrito somente a Administrador
                      </span>
                      <span className="tv-edit-admin-toggle-desc">
                        Quando marcado, apenas usuários com perfil de Administrador podem iniciar conexão remota nesta máquina.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="tv-modal-actions tv-edit-modal-footer">
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
        );
      })()}

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
            <div className="tv-sheet-drag-handle" aria-hidden="true" />
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
