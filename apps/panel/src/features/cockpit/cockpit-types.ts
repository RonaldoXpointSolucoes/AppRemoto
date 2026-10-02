export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export type LogComponent =
  | 'SERVIDOR NODE.JS'
  | 'RUSTDESK SERVER'
  | 'APPWRITE DB'
  | 'HOST VPS'
  | 'AGENTE WINDOWS'
  | 'TRAEFIK PROXY';

export interface CockpitLogEntry {
  id: string;
  timestamp: string;
  timeFormatted: string;
  level: LogLevel;
  component: LogComponent;
  message: string;
  details: Record<string, unknown>;
}

export interface ServiceHealthStatus {
  name: string;
  status: 'online' | 'degraded' | 'offline';
  latencyMs: number;
  details: string;
  metrics?: Record<string, string | number>;
}

export interface SystemTelemetry {
  vps: {
    status: 'online' | 'warning' | 'critical';
    diskUsagePercent: number;
    diskFreeGb: number;
    diskTotalGb: number;
    memoryUsagePercent: number;
    memoryFreeMb: number;
    memoryTotalMb: number;
    cpuCores: number;
    uptimeHours: number;
  };
  rustdesk: {
    status: 'online' | 'degraded' | 'offline';
    idServer: string;
    relayServer: string;
    hbbsPort: number;
    hbbrPort: number;
    registeredPeersCount: number;
    onlinePeersCount: number;
  };
  appwrite: {
    status: 'online' | 'degraded' | 'offline';
    endpoint: string;
    projectId: string;
    database: string;
    activeGuardsCount: number;
    totalDevicesCount: number;
    onlineDevicesCount: number;
  };
  api: {
    status: 'online' | 'degraded' | 'offline';
    endpoint: string;
    version: string;
    heartbeatRatePerMinute: number;
    recentHeartbeatsSuccess: number;
    recentHeartbeatsFailed: number;
  };
}
