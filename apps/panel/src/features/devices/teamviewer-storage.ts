'use client';

import {
  extractDeviceAccessPolicy,
  encodeDeviceAccessNotes,
  hashDeviceAccessPassword,
  verifyDeviceAccessPassword,
  type DataDivasInfo,
} from '@appremoto/contracts';

export { hashDeviceAccessPassword, verifyDeviceAccessPassword };

export type SessionResolutionStatus = 'resolved' | 'monitoring' | 'pending_parts' | 'escalated';

export interface SessionTimelineEvent {
  time: string;
  label: string;
}

export interface RecentConnectionRecord {
  protocolNumber?: string;
  deviceId: string;
  displayName: string;
  hostname: string;
  organizationName: string;
  organizationId?: string;
  folderName?: string;
  rustdeskId: string;
  operatingSystem?: string;
  osBuild?: string;
  osBadge?: string;
  localIp?: string;
  datadivas?: DataDivasInfo;
  deviceStatusAtStart?: string;
  lastSeenBeforeConnect?: string;
  isFavorite?: boolean;
  previousDeviceNotes?: string;
  connectedAt: string;
  endedAt?: string;
  technicianName: string;
  technicianEmail?: string;
  clientPlatform?: string;
  clientNetwork?: string;
  clientViewport?: string;
  mode: 'automatic' | 'manual';
  durationSeconds?: number;
  resolutionStatus?: SessionResolutionStatus;
  executedActions?: string[];
  timelineEvents?: SessionTimelineEvent[];
  notes?: string;
  autoReportText?: string;
}

export interface SmartActionPreset {
  id: string;
  label: string;
  category: 'PDV & Totem' | 'Sistema & Rede' | 'Manutenção';
}

export const SMART_ACTION_PRESETS: SmartActionPreset[] = [
  { id: 'totem_restart', label: 'Reinício / Destravamento de Totem ou PDV', category: 'PDV & Totem' },
  { id: 'printer_config', label: 'Configuração de Impressora Térmica / Spooler', category: 'PDV & Totem' },
  { id: 'pinpad_tef', label: 'Ajuste de Pinpad / TEF / Pagamento', category: 'PDV & Totem' },
  { id: 'app_update', label: 'Atualização de Sistema / App X-Point', category: 'PDV & Totem' },
  { id: 'db_sync', label: 'Sincronização de Cardápio / Banco de Dados', category: 'PDV & Totem' },
  { id: 'disk_cleanup', label: 'Limpeza de Cache / Arquivos Temporários', category: 'Sistema & Rede' },
  { id: 'network_dns', label: 'Verificação de Rede / DNS / IP Local', category: 'Sistema & Rede' },
  { id: 'windows_fix', label: 'Correção de Permissão / Serviço do Windows', category: 'Sistema & Rede' },
  { id: 'preventive_check', label: 'Inspeção Preventiva de Saúde e Desempenho', category: 'Manutenção' },
  { id: 'operator_training', label: 'Orientação e Suporte ao Operador no Local', category: 'Manutenção' },
];

export const RESOLUTION_STATUS_LABELS: Record<SessionResolutionStatus, string> = {
  resolved: 'Resolvido 100% (Operacional)',
  monitoring: 'Em Monitoramento Preventivo',
  pending_parts: 'Aguardando Ação Local / Terceiros',
  escalated: 'Escalonado para Nível 2 / Infra',
};

export function generateSessionProtocol(isoDate?: string): string {
  const d = isoDate ? new Date(isoDate) : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const suffix = String(Math.floor(1000 + (d.getTime() % 9000))).padStart(4, '0');
  return `XP-${yyyy}${mm}${dd}-${suffix}`;
}

export function detectClientTelemetry(): {
  clientPlatform: string;
  clientNetwork: string;
  clientViewport: string;
} {
  if (typeof window === 'undefined') {
    return {
      clientPlatform: 'Painel Web XPoint',
      clientNetwork: 'Conexão Criptografada HTTPS',
      clientViewport: 'Padrão',
    };
  }
  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const os = /Android/i.test(ua)
    ? 'Android Mobile'
    : /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS Mobile'
    : /Windows/i.test(ua)
    ? 'Desktop Windows'
    : /Mac/i.test(ua)
    ? 'Desktop macOS'
    : /Linux/i.test(ua)
    ? 'Desktop Linux'
    : isMobile
    ? 'Smartphone Mobile'
    : 'Estação Desktop';

  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Chrome\//i.test(ua)
    ? 'Chrome'
    : /Firefox\//i.test(ua)
    ? 'Firefox'
    : /Safari\//i.test(ua)
    ? 'Safari'
    : 'Web Browser';

  const navConn = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number } }).connection;
  const netType = navConn?.effectiveType ? navConn.effectiveType.toUpperCase() : isMobile ? 'Rede Móvel / Wi-Fi' : 'Fibra / LAN';
  const netSpeed = navConn?.downlink ? ` (~${navConn.downlink} Mbps)` : '';

  return {
    clientPlatform: `${os} · ${browser}`,
    clientNetwork: `${netType}${netSpeed}`,
    clientViewport: `${window.innerWidth}×${window.innerHeight}px (${isMobile ? 'Mobilidade' : 'Desktop'})`,
  };
}

export function formatDurationDetailed(totalSeconds?: number): string {
  if (totalSeconds === undefined || totalSeconds === null) return 'Sessão rápida (< 1 min)';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s (${totalSeconds}s)`;
  if (m > 0) return `${m}m ${s}s (${totalSeconds}s)`;
  return `${s} segundos`;
}

export function buildAutomatedTechnicalReport(record: RecentConnectionRecord): string {
  const protocol = record.protocolNumber || generateSessionProtocol(record.connectedAt);
  const startFmt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(record.connectedAt));
  const endFmt = record.endedAt
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(record.endedAt))
    : 'Em andamento / Finalizado automaticamente';
  const statusLabel = RESOLUTION_STATUS_LABELS[record.resolutionStatus || 'resolved'];
  const actions =
    record.executedActions && record.executedActions.length > 0
      ? record.executedActions.map((a) => `  • ${a}`).join('\n')
      : '  • Conexão remota estabelecida, verificação de integridade da estação e validação de disponibilidade operacional.';
  const timeline =
    record.timelineEvents && record.timelineEvents.length > 0
      ? record.timelineEvents.map((ev) => `  [${ev.time}] ${ev.label}`).join('\n')
      : `  [${startFmt.split(' ')[1] || startFmt}] Handshake P2P RustDesk autenticado com sucesso`;

  const lines = [
    `📋 LAUDO TÉCNICO AUTOMATIZADO — XPOINT REMOTE`,
    `Protocolo: ${protocol} | Status: ${statusLabel}`,
    `──────────────────────────────────────────────`,
    `🖥️ DADOS DA ESTAÇÃO REMOTA:`,
    `• Computador: ${record.displayName} (${record.hostname})`,
    `• ID RustDesk: ${record.rustdeskId}`,
    `• Organização / Pasta: ${record.organizationName || 'XPoint'}${record.folderName ? ` › ${record.folderName}` : ''}`,
    `• Sistema Operacional: ${record.operatingSystem || 'Windows'}${record.osBuild ? ` (${record.osBuild})` : ''}`,
    `• Rede / IP Local: ${record.localIp || record.datadivas?.ipMaq || 'Roteamento P2P / HBBR Relay (21116/21117)'}`,
    `• Estado no Handshake: ${record.deviceStatusAtStart || 'ONLINE'}${record.isFavorite ? ' · ⭐ Fixado/Prioritário' : ''}`,
  ];

  if (record.datadivas && Object.keys(record.datadivas).length > 0) {
    const dd = record.datadivas;
    lines.push(`──────────────────────────────────────────────`);
    lines.push(`🏢 CADASTRO DO CLIENTE (DATADIVAS / CONFIG.INI):`);
    if (dd.nomeFantasia) lines.push(`• Nome Fantasia: ${dd.nomeFantasia}`);
    if (dd.razaoSocial) lines.push(`• Razão Social: ${dd.razaoSocial}`);
    if (dd.cnpj) lines.push(`• CNPJ / CPF: ${dd.cnpj}`);
    if (dd.serial) lines.push(`• Serial DataDivas: ${dd.serial}`);
    if (dd.ie) lines.push(`• Inscrição Estadual (IE): ${dd.ie}`);
    if (dd.endereco || dd.cidade || dd.uf) {
      const loc = [dd.endereco, [dd.cidade, dd.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ');
      lines.push(`• Endereço: ${loc}`);
    }
    if (dd.ipMaq || dd.nomeMaq) {
      lines.push(`• IP Máquina (config.ini): ${dd.ipMaq || '—'}${dd.nomeMaq ? ` (${dd.nomeMaq})` : ''}`);
    }
    if (dd.ipDataDivas || dd.banco) {
      lines.push(`• IP Servidor DataDivas: ${dd.ipDataDivas || '—'}${dd.banco ? ` | Banco: ${dd.banco}` : ''}`);
    }
  }

  lines.push(
    `──────────────────────────────────────────────`,
    `⏱️ TELEMETRIA DA SESSÃO & ORIGEM:`,
    `• Técnico Responsável: ${record.technicianName}${record.technicianEmail ? ` (${record.technicianEmail})` : ''}`,
    `• Modo de Autenticação: ${record.mode === 'automatic' ? 'Automático 1-Clique (Cofre Efêmero)' : 'Conexão Manual por ID'}`,
    `• Origem do Acesso: ${record.clientPlatform || 'Painel Web'} · ${record.clientViewport || ''}`,
    `• Conectividade do Técnico: ${record.clientNetwork || 'HTTPS Seguro'}`,
    `• Início da Sessão: ${startFmt}`,
    `• Encerramento / Registro: ${endFmt}`,
    `• Duração Cronometrada: ${formatDurationDetailed(record.durationSeconds)}`,
    `──────────────────────────────────────────────`,
    `🛠️ PROCEDIMENTOS & AÇÕES REALIZADAS:`,
    actions,
  );

  if (record.notes && record.notes.trim()) {
    lines.push(`──────────────────────────────────────────────`);
    lines.push(`📝 OBSERVAÇÕES TÉCNICAS COMPLEMENTARES:`);
    lines.push(`  ${record.notes.trim()}`);
  }

  lines.push(`──────────────────────────────────────────────`);
  lines.push(`📡 TRILHA DE AUDITORIA AUTOMÁTICA:`);
  lines.push(timeline);

  return lines.join('\n');
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
  customDisplayName?: boolean;
  notes?: string;
  folderId?: string;
  adminOnlyAccess?: boolean;
  accessPasswordHash?: string | null;
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
    const connectedAt = record.connectedAt || new Date().toISOString();
    const protocolNumber = record.protocolNumber || generateSessionProtocol(connectedAt);
    const clientTelemetry = detectClientTelemetry();
    const timeLabel = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(new Date(connectedAt));

    const newRecord: RecentConnectionRecord = {
      ...clientTelemetry,
      ...record,
      connectedAt,
      protocolNumber,
      resolutionStatus: record.resolutionStatus || 'resolved',
      executedActions: record.executedActions || [],
      timelineEvents: record.timelineEvents || [
        { time: timeLabel, label: `Handshake seguro iniciado para ${record.displayName} (${record.rustdeskId})` },
        { time: timeLabel, label: `Sessão remota disparada por ${record.technicianName} via ${clientTelemetry.clientPlatform}` },
      ],
    };
    newRecord.autoReportText = buildAutomatedTechnicalReport(newRecord);

    const filtered = existing.filter(
      (item) =>
        item.protocolNumber !== newRecord.protocolNumber &&
        !(item.deviceId === newRecord.deviceId && item.connectedAt === newRecord.connectedAt)
    );
    const updated = [newRecord, ...filtered].slice(0, 50);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    try {
      window.dispatchEvent(new CustomEvent('xpoint:recent-connections-updated'));
    } catch {}
    return updated;
  } catch {
    return [];
  }
}

export function updateRecentConnectionNotes(
  deviceId: string,
  connectedAt: string,
  notes: string,
  durationSeconds?: number,
  extra?: Partial<RecentConnectionRecord>
): RecentConnectionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const existing = getRecentConnections();
    let matched = false;
    const updated = existing.map((item) => {
      if (
        (item.deviceId === deviceId && item.connectedAt === connectedAt) ||
        (extra?.protocolNumber && item.protocolNumber === extra.protocolNumber)
      ) {
        matched = true;
        const merged: RecentConnectionRecord = {
          ...item,
          ...extra,
          notes,
          durationSeconds: durationSeconds ?? extra?.durationSeconds ?? item.durationSeconds,
          endedAt: extra?.endedAt || new Date().toISOString(),
        };
        merged.autoReportText = buildAutomatedTechnicalReport(merged);
        return merged;
      }
      return item;
    });

    // Caso o registro tenha sido iniciado em memória, garante que seja persistido
    if (!matched && extra && extra.displayName && extra.rustdeskId) {
      const fallbackRecord: RecentConnectionRecord = {
        deviceId,
        displayName: extra.displayName,
        hostname: extra.hostname || deviceId,
        organizationName: extra.organizationName || 'XPoint',
        rustdeskId: extra.rustdeskId,
        connectedAt,
        technicianName: extra.technicianName || 'Técnico',
        mode: extra.mode || 'automatic',
        ...extra,
        notes,
        durationSeconds,
        endedAt: extra.endedAt || new Date().toISOString(),
      };
      fallbackRecord.autoReportText = buildAutomatedTechnicalReport(fallbackRecord);
      const withFallback = [fallbackRecord, ...updated].slice(0, 50);
      localStorage.setItem(RECENT_KEY, JSON.stringify(withFallback));
      return withFallback;
    }

    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    try {
      window.dispatchEvent(new CustomEvent('xpoint:recent-connections-updated'));
    } catch {}
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

const FAVORITES_KEY = 'xpoint_favorite_devices_v1';

export function getFavoriteDeviceIds(userId?: string | null): string[] {
  if (typeof window === 'undefined') return [];
  try {
    if (userId) {
      const userRaw = localStorage.getItem(`${FAVORITES_KEY}_${userId}`);
      return userRaw ? JSON.parse(userRaw) : [];
    }
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function toggleFavoriteDeviceId(deviceId: string, userId?: string | null): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const current = getFavoriteDeviceIds(userId);
    const exists = current.includes(deviceId);
    const updated = exists ? current.filter((id) => id !== deviceId) : [deviceId, ...current];
    if (userId) {
      localStorage.setItem(`${FAVORITES_KEY}_${userId}`, JSON.stringify(updated));
    } else {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
    }
    return updated;
  } catch {
    return [];
  }
}

export function parseDeviceNotes(rawNotes?: string | null): {
  folderName?: string;
  adminOnlyAccess: boolean;
  requiresAccessPassword: boolean;
  accessPasswordHash: string | null;
  customDisplayName?: boolean;
  notes: string;
} {
  const policy = extractDeviceAccessPolicy(rawNotes);
  return {
    ...(policy.folderName ? { folderName: policy.folderName } : {}),
    adminOnlyAccess: policy.adminOnlyAccess,
    requiresAccessPassword: policy.requiresAccessPassword,
    accessPasswordHash: policy.accessPasswordHash,
    ...(policy.customDisplayName ? { customDisplayName: true } : {}),
    notes: policy.cleanNotes,
  };
}

export function encodeDeviceNotes(input: {
  folderName?: string;
  adminOnlyAccess?: boolean;
  accessPasswordHash?: string | null;
  customDisplayName?: boolean;
  notes?: string;
}): string {
  return encodeDeviceAccessNotes(input);
}

export function getDeviceProtectionState(
  dev: { id: string; notes?: string; requiresAccessPassword?: boolean; adminOnlyAccess?: boolean },
  metaMap: Record<string, DeviceCustomMetadata> = getCustomMetadataMap()
): {
  adminOnlyAccess: boolean;
  requiresAccessPassword: boolean;
  accessPasswordHash: string | null;
} {
  const rawNotes = dev.notes || metaMap[dev.id]?.notes || '';
  const parsed = parseDeviceNotes(rawNotes);
  const meta = metaMap[dev.id];
  const accessPasswordHash =
    parsed.accessPasswordHash ??
    (meta?.accessPasswordHash !== undefined ? meta.accessPasswordHash : null);
  const adminOnlyAccess = Boolean(
    dev.adminOnlyAccess || parsed.adminOnlyAccess || meta?.adminOnlyAccess
  );
  const requiresAccessPassword = Boolean(
    dev.requiresAccessPassword || parsed.requiresAccessPassword || accessPasswordHash
  );
  return {
    adminOnlyAccess,
    requiresAccessPassword,
    accessPasswordHash,
  };
}

export function getDeviceFolderName(
  dev: { id: string; displayName?: string; hostname?: string; organizationName?: string; rustdeskId?: string; operatingSystem?: string; notes?: string },
  groups: DeviceGroup[] = getDeviceGroups()
): string {
  const metaMap = getCustomMetadataMap();
  const rawNotes = dev.notes || metaMap[dev.id]?.notes || '';
  const parsed = parseDeviceNotes(rawNotes);
  if (parsed.folderName) return parsed.folderName;

  const folderMap = getDeviceFolderMap();
  const targetId = folderMap[dev.id] || (dev.rustdeskId ? folderMap[dev.rustdeskId] : undefined) || (dev.hostname ? folderMap[dev.hostname.toLowerCase()] : undefined);
  if (targetId) {
    const found = groups.find((g) => g.id === targetId);
    if (found) return found.name;
  }

  for (const g of groups) {
    if (g.deviceIds && (g.deviceIds.includes(dev.id) || (dev.rustdeskId && g.deviceIds.includes(dev.rustdeskId)))) {
      return g.name;
    }
  }

  const raw = ((dev.displayName || '') + ' ' + (dev.hostname || '') + ' ' + (dev.organizationName || '')).toLowerCase();
  const isServer = raw.includes('server') || (dev.operatingSystem ? /server/i.test(dev.operatingSystem) : false);
  const isStaff = raw.includes('xpoint') || raw.includes('x-point') || raw.includes('arthur') || raw.includes('ronaldo');

  if (isServer) return 'Servidores e infra';
  if (isStaff) return 'X-Point Soluções';
  return 'Clientes';
}

export function filterDevicesByCategory<T extends { id: string; displayName?: string; hostname?: string; organizationName?: string; rustdeskId: string; operatingSystem?: string; notes?: string }>(
  devices: T[],
  category: string,
  groups: DeviceGroup[] = getDeviceGroups()
): T[] {
  if (!category || category === '') return devices;

  if (category === 'recent') {
    const recents = getRecentConnections();
    const recentIndexMap = new Map<string, number>();
    recents.forEach((r, idx) => {
      if (!recentIndexMap.has(r.deviceId)) recentIndexMap.set(r.deviceId, idx);
      if (!recentIndexMap.has(r.rustdeskId)) recentIndexMap.set(r.rustdeskId, idx);
    });
    const matched = devices.filter((d) => recentIndexMap.has(d.id) || recentIndexMap.has(d.rustdeskId));
    return matched.sort((a, b) => {
      const idxA = Math.min(recentIndexMap.get(a.id) ?? 999, recentIndexMap.get(a.rustdeskId) ?? 999);
      const idxB = Math.min(recentIndexMap.get(b.id) ?? 999, recentIndexMap.get(b.rustdeskId) ?? 999);
      return idxA - idxB;
    });
  }

  return devices.filter((dev) => {
    const folderName = getDeviceFolderName(dev, groups);
    const norm = folderName.toLowerCase();
    if (category === 'group_servers') {
      return norm.includes('servidor') || norm.includes('infra');
    }
    if (category === 'group_xpoint') {
      return norm.includes('x-point') || norm.includes('xpoint');
    }
    if (category === 'group_clients') {
      return (
        norm.includes('cliente') ||
        (!norm.includes('servidor') &&
          !norm.includes('infra') &&
          !norm.includes('x-point') &&
          !norm.includes('xpoint'))
      );
    }
    const matchedGroup = groups.find((g) => g.id === category);
    if (matchedGroup) {
      return norm === matchedGroup.name.toLowerCase();
    }
    return false;
  });
}

export interface UserViewPreferences {
  organizationId: string;
  status: '' | 'ONLINE' | 'OFFLINE';
  search: string;
  viewMode: 'teamviewer' | 'table';
  sidebarCollapsed: boolean;
  onlyOnlineQuickFilter: boolean;
  onlyFavoritesQuickFilter: boolean;
  sortBy: 'smart' | 'name' | 'recent';
  compactMode: boolean;
  updatedAt?: string;
}

export const DEFAULT_USER_VIEW_PREFERENCES: UserViewPreferences = {
  organizationId: '',
  status: '',
  search: '',
  viewMode: 'teamviewer',
  sidebarCollapsed: false,
  onlyOnlineQuickFilter: false,
  onlyFavoritesQuickFilter: false,
  sortBy: 'smart',
  compactMode: false,
};

const USER_PREFS_PREFIX = 'xpoint_user_view_prefs_v3_';
const LAST_ACTIVE_USER_KEY = 'xpoint_last_active_user_id_v1';

export function getLastActiveUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(LAST_ACTIVE_USER_KEY);
  } catch {
    return null;
  }
}

export function setLastActiveUserId(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    localStorage.setItem(LAST_ACTIVE_USER_KEY, userId);
  } catch {}
}

export function getUserViewPreferences(userId?: string | null): UserViewPreferences {
  if (typeof window === 'undefined' || !userId) {
    return { ...DEFAULT_USER_VIEW_PREFERENCES };
  }
  try {
    const raw = localStorage.getItem(`${USER_PREFS_PREFIX}${userId}`);
    if (!raw) return { ...DEFAULT_USER_VIEW_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<UserViewPreferences>;
    return {
      organizationId: typeof parsed.organizationId === 'string' ? parsed.organizationId : '',
      status:
        parsed.status === 'ONLINE' || parsed.status === 'OFFLINE' || parsed.status === ''
          ? parsed.status
          : '',
      search: typeof parsed.search === 'string' ? parsed.search : '',
      viewMode: parsed.viewMode === 'table' ? 'table' : 'teamviewer',
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      onlyOnlineQuickFilter:
        typeof parsed.onlyOnlineQuickFilter === 'boolean' ? parsed.onlyOnlineQuickFilter : false,
      onlyFavoritesQuickFilter: Boolean(parsed.onlyFavoritesQuickFilter),
      sortBy:
        parsed.sortBy === 'name' || parsed.sortBy === 'recent' || parsed.sortBy === 'smart'
          ? parsed.sortBy
          : 'smart',
      compactMode: Boolean(parsed.compactMode),
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return { ...DEFAULT_USER_VIEW_PREFERENCES };
  }
}

export function saveUserViewPreferences(
  userId: string | null | undefined,
  partial: Partial<UserViewPreferences>
): UserViewPreferences {
  if (typeof window === 'undefined' || !userId) {
    return { ...DEFAULT_USER_VIEW_PREFERENCES, ...partial };
  }
  try {
    const current = getUserViewPreferences(userId);
    const updated: UserViewPreferences = {
      ...current,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(`${USER_PREFS_PREFIX}${userId}`, JSON.stringify(updated));
    setLastActiveUserId(userId);
    return updated;
  } catch {
    return { ...DEFAULT_USER_VIEW_PREFERENCES, ...partial };
  }
}

export interface ActiveSessionDraft {
  protocolNumber?: string;
  deviceId: string;
  displayName: string;
  hostname: string;
  organizationName?: string;
  organizationId?: string;
  folderName?: string;
  rustdeskId: string;
  operatingSystem?: string;
  osBuild?: string;
  osBadge?: string;
  localIp?: string;
  datadivas?: DataDivasInfo;
  deviceStatusAtStart?: string;
  lastSeenBeforeConnect?: string;
  isFavorite?: boolean;
  previousDeviceNotes?: string;
  technicianName: string;
  technicianEmail?: string;
  clientPlatform?: string;
  clientNetwork?: string;
  clientViewport?: string;
  mode?: 'automatic' | 'manual';
  startedAt: string;
}

const ACTIVE_SESSION_DRAFT_KEY = 'xpoint_tv_active_session_v1';
const ACTIVE_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 horas

export function saveActiveSessionDraft(session: ActiveSessionDraft | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!session) {
      localStorage.removeItem(ACTIVE_SESSION_DRAFT_KEY);
      return;
    }
    localStorage.setItem(ACTIVE_SESSION_DRAFT_KEY, JSON.stringify(session));
  } catch {}
}

export function getActiveSessionDraft(): ActiveSessionDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveSessionDraft;
    if (!parsed || !parsed.deviceId || !parsed.startedAt) return null;
    const ageMs = Date.now() - new Date(parsed.startedAt).getTime();
    if (Number.isNaN(ageMs) || ageMs > ACTIVE_SESSION_MAX_AGE_MS) {
      localStorage.removeItem(ACTIVE_SESSION_DRAFT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}



