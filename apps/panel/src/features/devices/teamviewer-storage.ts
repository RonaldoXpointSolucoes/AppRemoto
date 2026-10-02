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
}

const RECENT_KEY = 'xpoint_recent_connections';
const GROUPS_KEY = 'xpoint_device_groups';

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
    // Mantém no topo e sem duplicar o mesmo device id recente
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

export function getDeviceGroups(): DeviceGroup[] {
  if (typeof window === 'undefined') return defaultGroups();
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) {
      const def = defaultGroups();
      localStorage.setItem(GROUPS_KEY, JSON.stringify(def));
      return def;
    }
    return JSON.parse(raw);
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
  };
  const updated = [...current, newGroup];
  saveDeviceGroups(updated);
  return updated;
}

export function deleteDeviceGroup(groupId: string): DeviceGroup[] {
  const current = getDeviceGroups();
  const updated = current.filter((g) => g.id !== groupId);
  saveDeviceGroups(updated);
  return updated;
}

export function assignDeviceToGroup(deviceId: string, targetGroupId: string): DeviceGroup[] {
  const current = getDeviceGroups();
  const updated = current.map((g) => {
    // Remove de outros grupos se necessário ou permite pertencer ao grupo selecionado
    if (g.id === targetGroupId) {
      return { ...g, deviceIds: Array.from(new Set([...g.deviceIds, deviceId])) };
    }
    return { ...g, deviceIds: g.deviceIds.filter((id) => id !== deviceId) };
  });
  saveDeviceGroups(updated);
  return updated;
}

function defaultGroups(): DeviceGroup[] {
  return [
    { id: 'group_clients', name: 'Clientes', deviceIds: [] },
    { id: 'group_xpoint', name: 'X-Point Soluções', deviceIds: [] },
    { id: 'group_servers', name: 'Servidores & Infra', deviceIds: [] },
  ];
}
