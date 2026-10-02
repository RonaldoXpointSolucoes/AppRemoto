'use client';

export interface RecentConnectionRecord {
  deviceId: string;
  displayName: string;
  hostname: string;
  organizationName: string;
  rustdeskId: string;
  connectedAt: string;
  technicianName: string;
  mode: 'automatic' | 'manual';
  durationSeconds?: number;
  notes?: string;
}

export interface DeviceGroup {
  id: string;
  name: string;
  icon?: string;
  deviceIds: string[];
  isDefault?: boolean;
}

export interface DeviceCustomMetadata {
  displayName?: string;
  notes?: string;
  folderId?: string;
}

const RECENT_KEY = 'xpoint_recent_connections';
const GROUPS_KEY = 'xpoint_device_groups_v2';
const LEGACY_GROUPS_KEY = 'xpoint_device_groups';
const FOLDER_MAP_KEY = 'xpoint_device_folder_map_v2';
const CUSTOM_META_KEY = 'xpoint_device_custom_meta_v1';

export function getRecentConnections(): RecentConnectionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveRecentConnection(record: Omit<RecentConnectionRecord, 'connectedAt'> & { connectedAt?: string }): RecentConnectionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const existing = getRecentConnections();
    const newRecord: RecentConnectionRecord = {
      ...record,
      connectedAt: record.connectedAt || new Date().toISOString(),
    };
    const filtered = existing.filter((item) => item.deviceId !== record.deviceId);
    const updated = [newRecord, ...filtered].slice(0, 15);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function updateRecentConnectionNotes(deviceId: string, connectedAt: string, notes: string, durationSeconds?: number): RecentConnectionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const existing = getRecentConnections();
    const updated = existing.map((item) => {
      if (item.deviceId === deviceId && item.connectedAt === connectedAt) {
        return { ...item, notes, durationSeconds: durationSeconds ?? item.durationSeconds };
      }
      return item;
    });
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function defaultGroups(): DeviceGroup[] {
  return [
    { id: 'group_clients', name: 'Clientes', deviceIds: [], isDefault: true },
    { id: 'group_xpoint', name: 'X-Point Soluções', deviceIds: [], isDefault: true },
    { id: 'group_servers', name: 'Servidores & Infra', deviceIds: [], isDefault: true },
  ];
}

export function getDeviceFolderMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(FOLDER_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveDeviceFolderMap(map: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FOLDER_MAP_KEY, JSON.stringify(map));
  } catch {}
}

export function getDeviceGroups(): DeviceGroup[] {
  if (typeof window === 'undefined') return defaultGroups();
  try {
    let groups: DeviceGroup[];
    const raw = localStorage.getItem(GROUPS_KEY);
    if (raw) {
      groups = JSON.parse(raw);
    } else {
      // Tenta migrar da chave legada se existir
      const legacyRaw = localStorage.getItem(LEGACY_GROUPS_KEY);
      if (legacyRaw) {
        groups = JSON.parse(legacyRaw);
      } else {
        groups = defaultGroups();
      }
      localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
    }

    // Mescla com o mapeamento direto de pastas persistido
    const folderMap = getDeviceFolderMap();
    if (Object.keys(folderMap).length > 0) {
      groups = groups.map((g) => {
        const matchingDeviceIds = Object.entries(folderMap)
          .filter(([, targetGroup]) => targetGroup === g.id)
          .map(([id]) => id);
        return {
          ...g,
          deviceIds: Array.from(new Set([...g.deviceIds, ...matchingDeviceIds])),
        };
      });
    }

    return groups;
  } catch {
    return defaultGroups();
  }
}

export function saveDeviceGroups(groups: DeviceGroup[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch {}
}

export function createDeviceGroup(name: string): DeviceGroup[] {
  const current = getDeviceGroups();
  const trimmed = name.trim();
  if (!trimmed || current.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) {
    return current;
  }
  const newGroup: DeviceGroup = {
    id: `group_${Date.now()}`,
    name: trimmed,
    deviceIds: [],
    isDefault: false,
  };
  const updated = [...current, newGroup];
  saveDeviceGroups(updated);
  return updated;
}

export function renameDeviceGroup(groupId: string, newName: string): DeviceGroup[] {
  const current = getDeviceGroups();
  const trimmed = newName.trim();
  if (!trimmed) return current;
  const updated = current.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g));
  saveDeviceGroups(updated);
  return updated;
}

export function deleteDeviceGroup(groupId: string): DeviceGroup[] {
  const current = getDeviceGroups();
  const target = current.find((g) => g.id === groupId);
  if (!target) return current;

  // Move dispositivos da pasta excluída para a pasta padrão Clientes
  const orphanedIds = target.deviceIds || [];
  const folderMap = getDeviceFolderMap();
  for (const id of orphanedIds) {
    folderMap[id] = 'group_clients';
  }
  saveDeviceFolderMap(folderMap);

  const updated = current
    .filter((g) => g.id !== groupId)
    .map((g) => {
      if (g.id === 'group_clients') {
        return { ...g, deviceIds: Array.from(new Set([...g.deviceIds, ...orphanedIds])) };
      }
      return g;
    });

  saveDeviceGroups(updated);
  return updated;
}

export function assignDeviceToGroup(
  deviceIdentifier: string,
  targetGroupId: string,
  extraKeys?: { deviceUuid?: string; rustdeskId?: string; hostname?: string }
): DeviceGroup[] {
  // Salva no mapa direto de pastas
  const folderMap = getDeviceFolderMap();
  folderMap[deviceIdentifier] = targetGroupId;
  if (extraKeys?.deviceUuid) folderMap[extraKeys.deviceUuid] = targetGroupId;
  if (extraKeys?.rustdeskId) folderMap[extraKeys.rustdeskId] = targetGroupId;
  if (extraKeys?.hostname) folderMap[extraKeys.hostname.toLowerCase()] = targetGroupId;
  saveDeviceFolderMap(folderMap);

  // Atualiza os grupos
  const current = getDeviceGroups();
  const updated = current.map((g) => {
    if (g.id === targetGroupId) {
      return { ...g, deviceIds: Array.from(new Set([...g.deviceIds, deviceIdentifier])) };
    }
    return { ...g, deviceIds: g.deviceIds.filter((id) => id !== deviceIdentifier) };
  });
  saveDeviceGroups(updated);
  return updated;
}

export function getCustomMetadataMap(): Record<string, DeviceCustomMetadata> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CUSTOM_META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveDeviceCustomMetadata(deviceId: string, metadata: DeviceCustomMetadata): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getCustomMetadataMap();
    current[deviceId] = { ...current[deviceId], ...metadata };
    localStorage.setItem(CUSTOM_META_KEY, JSON.stringify(current));
  } catch {}
}

export function parseDeviceNotes(rawNotes?: string | null): { folderName?: string; notes: string } {
  if (!rawNotes) return { notes: '' };
  const match = rawNotes.match(/^\[pasta:([^\]]+)\]\s*([\s\S]*)$/i);
  if (match) {
    return { folderName: match[1]?.trim(), notes: match[2]?.trim() || '' };
  }
  return { notes: rawNotes };
}

export function encodeDeviceNotes(input: { folderName?: string; notes?: string }): string {
  const cleanNotes = (input.notes || '').trim();
  if (input.folderName && input.folderName.trim()) {
    return `[pasta:${input.folderName.trim()}]${cleanNotes ? '\n' + cleanNotes : ''}`;
  }
  return cleanNotes;
}
