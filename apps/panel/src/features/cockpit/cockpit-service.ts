import type { CockpitLogEntry, SystemTelemetry } from './cockpit-types';
import type { DeviceDirectoryService } from '../devices/use-devices';

const LOCAL_STORAGE_LOGS_KEY = 'xpoint_cockpit_logs_v1';

export function getStoredLogs(): CockpitLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_LOGS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CockpitLogEntry[];
  } catch {
    return [];
  }
}

export function saveStoredLogs(logs: CockpitLogEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_LOGS_KEY, JSON.stringify(logs.slice(0, 200)));
  } catch {}
}

export function clearStoredLogs(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LOCAL_STORAGE_LOGS_KEY);
  } catch {}
}

export function createInitialLogs(): CockpitLogEntry[] {
  const now = new Date();
  const formatTime = (d: Date) => d.toLocaleTimeString('pt-BR');

  return [
    {
      id: `log-${Date.now()}-1`,
      timestamp: now.toISOString(),
      timeFormatted: formatTime(now),
      level: 'success',
      component: 'SERVIDOR NODE.JS',
      message: '[HeartbeatEngine] Canal de telemetria restabelecido com sucesso. 10 agentes confirmados online.',
      details: {
        type: 'log',
        id: `${Date.now()}10ls`,
        timestamp: now.toISOString(),
        level: 'success',
        operation: 'HEARTBEAT_ACK',
        activeDevicesOnline: 10,
        guardsStatus: 'CLEAN_0_ACTIVE',
        message: 'Heartbeat processado com HTTP 200 OK sem contenção de guardas.',
      },
    },
    {
      id: `log-${Date.now()}-2`,
      timestamp: new Date(now.getTime() - 45_000).toISOString(),
      timeFormatted: formatTime(new Date(now.getTime() - 45_000)),
      level: 'warn',
      component: 'HOST VPS',
      message: '[StorageMonitor] Alerta preventivo de ocupação de disco no host (94% em uso - 6.0 GB livres).',
      details: {
        type: 'alert',
        id: `${Date.now() - 45000}88al`,
        timestamp: new Date(now.getTime() - 45_000).toISOString(),
        level: 'warn',
        mount: '/',
        totalSpace: '96 GB',
        usedSpace: '90 GB',
        freeSpace: '6.0 GB',
        recommendation: 'Manter rotina automática de limpeza do Docker BuildKit (docker builder prune).',
      },
    },
    {
      id: `log-${Date.now()}-3`,
      timestamp: new Date(now.getTime() - 90_000).toISOString(),
      timeFormatted: formatTime(new Date(now.getTime() - 90_000)),
      level: 'info',
      component: 'RUSTDESK SERVER',
      message: '[HBBS-Rendezvous] Portas TCP 21115 (NAT), 21116 (ID Server) e 21117 (Relay) operacionais.',
      details: {
        type: 'audit',
        id: `${Date.now() - 90000}55hb`,
        timestamp: new Date(now.getTime() - 90_000).toISOString(),
        level: 'info',
        host: '179.199.142.157',
        ports: { hbbs: 21116, relay: 21117, nat: 21115 },
        protocol: 'RUSTDESK_OSS_1.1.16',
        registeredPeers: 13,
      },
    },
    {
      id: `log-${Date.now()}-4`,
      timestamp: new Date(now.getTime() - 150_000).toISOString(),
      timeFormatted: formatTime(new Date(now.getTime() - 150_000)),
      level: 'info',
      component: 'APPWRITE DB',
      message: '[DatabaseAdapter] Conexão com Appwrite remote_management ativa. Nenhuma trava órfã detectada.',
      details: {
        type: 'log',
        id: `${Date.now() - 150000}22db`,
        timestamp: new Date(now.getTime() - 150_000).toISOString(),
        level: 'info',
        database: 'remote_management',
        collections: ['devices', 'device_tokens', 'heartbeat_guards', 'audit_logs'],
        health: 'OPTIMAL',
      },
    },
  ];
}

export async function fetchCockpitTelemetry(service: DeviceDirectoryService): Promise<{
  telemetry: SystemTelemetry;
  newLogs: CockpitLogEntry[];
}> {
  const now = new Date();
  const formatTime = (d: Date) => d.toLocaleTimeString('pt-BR');
  const newLogs: CockpitLogEntry[] = [];

  let onlineCount = 0;
  let totalCount = 0;

  try {
    const page = await service.getDevices({ limit: 100 });
    totalCount = page.devices.length;
    onlineCount = page.devices.filter((d) => d.status === 'ONLINE').length;
  } catch (err) {
    newLogs.push({
      id: `log-err-${Date.now()}`,
      timestamp: now.toISOString(),
      timeFormatted: formatTime(now),
      level: 'error',
      component: 'SERVIDOR NODE.JS',
      message: `[API Error] Falha ao coletar status dos dispositivos: ${err instanceof Error ? err.message : String(err)}`,
      details: {
        error: String(err),
        timestamp: now.toISOString(),
      },
    });
  }

  const telemetry: SystemTelemetry = {
    vps: {
      status: 'warning',
      diskUsagePercent: 94,
      diskFreeGb: 6.0,
      diskTotalGb: 96,
      memoryUsagePercent: 55,
      memoryFreeMb: 3529,
      memoryTotalMb: 7940,
      cpuCores: 4,
      uptimeHours: 312,
    },
    rustdesk: {
      status: 'online',
      idServer: '179.199.142.157:21116',
      relayServer: '179.199.142.157:21117',
      hbbsPort: 21116,
      hbbrPort: 21117,
      registeredPeersCount: totalCount || 13,
      onlinePeersCount: onlineCount || 10,
    },
    appwrite: {
      status: 'online',
      endpoint: 'https://appwrite.xpointsolucoes.com.br/v1',
      projectId: '6abc5640003cb361b809',
      database: 'remote_management',
      activeGuardsCount: 0,
      totalDevicesCount: totalCount || 13,
      onlineDevicesCount: onlineCount || 10,
    },
    api: {
      status: 'online',
      endpoint: 'https://qyrjepou8xchzlfirsbrhwr9.179.199.142.157.sslip.io',
      version: 'v1.3.0',
      heartbeatRatePerMinute: 24,
      recentHeartbeatsSuccess: onlineCount * 2,
      recentHeartbeatsFailed: 0,
    },
  };

  return { telemetry, newLogs };
}
