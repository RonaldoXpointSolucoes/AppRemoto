import net from 'node:net';
import os from 'node:os';

export type DiagnosticLogLevel = 'info' | 'warn' | 'error' | 'success';

export type DiagnosticComponent =
  | 'SERVIDOR NODE.JS'
  | 'RUSTDESK SERVER'
  | 'APPWRITE DB'
  | 'HOST VPS'
  | 'AGENTE WINDOWS'
  | 'TRAEFIK PROXY';

export interface DiagnosticEventEntry {
  id: string;
  timestamp: string;
  level: DiagnosticLogLevel;
  component: DiagnosticComponent;
  operation: string;
  message: string;
  rootCause?: string;
  autoRemediation?: string;
  details: Record<string, unknown>;
}

export interface PortProbeResult {
  port: number;
  name: string;
  reachable: boolean;
  latencyMs: number;
}

export interface DiagnosticsTelemetryResponse {
  timestamp: string;
  version: string;
  selfHealing: {
    status: 'active' | 'degraded';
    autoHealedEventsCount: number;
    orphanGuardsPurged: number;
    cacheEvictionsCount: number;
    dbFallbackActivations: number;
    devicesHealedCount: number;
    lastSelfHealAt: string | null;
  };
  api: {
    status: 'online' | 'degraded' | 'offline';
    uptimeSeconds: number;
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    heartbeatRatePerMinute: number;
    recentHeartbeatsSuccess: number;
    recentHeartbeatsFailed: number;
    avgHeartbeatLatencyMs: number;
    cacheStats: {
      deviceSnapshots: number;
      tokenSnapshots: number;
      jwtEntries: number;
      hbbsPeers: number;
      activeGuards: number;
    };
  };
  rustdesk: {
    status: 'online' | 'degraded' | 'offline';
    host: string;
    hbbsPort: number;
    hbbrPort: number;
    natPort: number;
    latencyMs: number;
    ports: PortProbeResult[];
    registeredPeersCount: number;
    onlinePeersCount: number;
  };
  appwrite: {
    status: 'online' | 'degraded' | 'offline';
    latencyMs: number;
    database: string;
    activeGuardsCount: number;
    totalDevicesCount: number;
    onlineDevicesCount: number;
  };
  host: {
    cpuCores: number;
    loadAvg1m: number;
    memoryTotalMb: number;
    memoryFreeMb: number;
    memoryUsagePercent: number;
    uptimeHours: number;
  };
  events: DiagnosticEventEntry[];
}

export interface SelfHealActionResult {
  action: string;
  component: DiagnosticComponent;
  status: 'healed' | 'verified' | 'warning';
  summary: string;
  metrics?: Record<string, number | string | boolean>;
}

export interface SelfHealExecutionResponse {
  executedAt: string;
  durationMs: number;
  overallStatus: 'healthy' | 'remediated' | 'attention';
  actions: SelfHealActionResult[];
  telemetry: DiagnosticsTelemetryResponse;
}

export interface SystemDiagnosticsHooks {
  hbbsHost: string;
  hbbsOnlinePort: number;
  probeAppwriteLatency: () => Promise<{ ok: boolean; latencyMs: number }>;
  getCacheSnapshot: () => {
    deviceSnapshots: number;
    tokenSnapshots: number;
    jwtEntries: number;
    hbbsPeers: number;
    activeGuards: number;
    totalDevicesCount: number;
    onlineDevicesCount: number;
  };
  executeInternalSelfHeal: () => Promise<{
    orphanGuardsPurged: number;
    cachesEvicted: number;
    devicesReconciled: number;
    hbbsOnlineSynced: number;
  }>;
}

export interface SystemDiagnosticsService {
  recordEvent(input: {
    level: DiagnosticLogLevel;
    component: DiagnosticComponent;
    operation: string;
    message: string;
    rootCause?: string;
    autoRemediation?: string;
    details?: Record<string, unknown>;
  }): void;
  recordHeartbeatMetric(outcome: 'success' | 'failure', durationMs: number): void;
  recordAutoHealCounter(
    kind: 'orphanGuard' | 'cacheEviction' | 'dbFallback' | 'deviceHealed',
    count?: number,
  ): void;
  getTelemetry(): Promise<DiagnosticsTelemetryResponse>;
  runSelfHeal(): Promise<SelfHealExecutionResponse>;
}

const MAX_EVENTS = 120;
const HEARTBEAT_WINDOW_MS = 60_000;

function probeTcpPort(host: string, port: number, name: string, timeoutMs = 1500): Promise<PortProbeResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({
        port,
        name,
        reachable,
        latencyMs: Math.max(1, Math.round(performance.now() - start)),
      });
    };
    const socket = net.createConnection({ host, port }, () => finish(true));
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on('error', () => finish(false));
  });
}

export function createSystemDiagnosticsService(hooks: SystemDiagnosticsHooks): SystemDiagnosticsService {
  const events: DiagnosticEventEntry[] = [];
  const heartbeatTimestamps: Array<{ ts: number; ok: boolean; durationMs: number }> = [];
  let totalHeartbeatsSuccess = 0;
  let totalHeartbeatsFailed = 0;
  let orphanGuardsPurged = 0;
  let cacheEvictionsCount = 0;
  let dbFallbackActivations = 0;
  let devicesHealedCount = 0;
  let autoHealedEventsCount = 0;
  let lastSelfHealAt: string | null = null;
  let cachedPortProbe: { at: number; results: PortProbeResult[] } | null = null;
  let cachedAppwriteProbe: { at: number; ok: boolean; latencyMs: number } | null = null;

  function recordEvent(input: {
    level: DiagnosticLogLevel;
    component: DiagnosticComponent;
    operation: string;
    message: string;
    rootCause?: string;
    autoRemediation?: string;
    details?: Record<string, unknown>;
  }): void {
    const now = new Date();
    if (input.autoRemediation) {
      autoHealedEventsCount += 1;
    }
    const entry: DiagnosticEventEntry = {
      id: `diag-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now.toISOString(),
      level: input.level,
      component: input.component,
      operation: input.operation,
      message: input.message,
      ...(input.rootCause ? { rootCause: input.rootCause } : {}),
      ...(input.autoRemediation ? { autoRemediation: input.autoRemediation } : {}),
      details: {
        operation: input.operation,
        ...(input.rootCause ? { rootCause: input.rootCause } : {}),
        ...(input.autoRemediation ? { autoRemediation: input.autoRemediation } : {}),
        ...(input.details ?? {}),
      },
    };
    events.unshift(entry);
    if (events.length > MAX_EVENTS) {
      events.length = MAX_EVENTS;
    }
  }

  // Evento inicial de boot do motor de auto-cura
  recordEvent({
    level: 'success',
    component: 'SERVIDOR NODE.JS',
    operation: 'SELF_HEALING_ENGINE_READY',
    message:
      '[SelfHealingEngine] Motor de inteligência de erros, telemetria em tempo real e auto-recuperação iniciado.',
    autoRemediation:
      'Monitoramento contínuo de guardas de heartbeat, caches em memória, fallback de leitura Appwrite e sondagem TCP RustDesk ativo.',
    details: {
      version: 'v1.8.7',
      features: [
        'ORPHAN_GUARD_REAPER',
        'BOUNDED_TTL_CACHE_GC',
        'APPWRITE_SNAPSHOT_FALLBACK',
        'HBBS_PRESENCE_RECONCILER',
      ],
    },
  });

  function pruneHeartbeatWindow(now: number) {
    while (heartbeatTimestamps.length > 0 && now - heartbeatTimestamps[0].ts > HEARTBEAT_WINDOW_MS) {
      heartbeatTimestamps.shift();
    }
  }

  function recordHeartbeatMetric(outcome: 'success' | 'failure', durationMs: number): void {
    const now = Date.now();
    pruneHeartbeatWindow(now);
    heartbeatTimestamps.push({ ts: now, ok: outcome === 'success', durationMs });
    if (outcome === 'success') {
      totalHeartbeatsSuccess += 1;
    } else {
      totalHeartbeatsFailed += 1;
    }
  }

  function recordAutoHealCounter(
    kind: 'orphanGuard' | 'cacheEviction' | 'dbFallback' | 'deviceHealed',
    count = 1,
  ): void {
    if (count <= 0) return;
    autoHealedEventsCount += 1;
    if (kind === 'orphanGuard') orphanGuardsPurged += count;
    if (kind === 'cacheEviction') cacheEvictionsCount += count;
    if (kind === 'dbFallback') dbFallbackActivations += count;
    if (kind === 'deviceHealed') devicesHealedCount += count;
  }

  async function probeRustDeskPorts(force = false): Promise<PortProbeResult[]> {
    const now = Date.now();
    if (!force && cachedPortProbe && now - cachedPortProbe.at < 12_000) {
      return cachedPortProbe.results;
    }
    const results = await Promise.all([
      probeTcpPort(hooks.hbbsHost, 21115, 'NAT Test (21115)'),
      probeTcpPort(hooks.hbbsHost, 21116, 'ID/Rendezvous HBBS (21116)'),
      probeTcpPort(hooks.hbbsHost, 21117, 'Relay HBBR (21117)'),
    ]);
    cachedPortProbe = { at: now, results };
    const failedPorts = results.filter((r) => !r.reachable);
    if (failedPorts.length > 0) {
      recordEvent({
        level: 'warn',
        component: 'RUSTDESK SERVER',
        operation: 'RUSTDESK_PORT_DEGRADED',
        message: `[RustDeskProbe] Oscilação detectada nas portas TCP: ${failedPorts.map((p) => p.port).join(', ')}.`,
        rootCause: 'Timeout na conexão socket TCP com o container RustDesk (hbbs/hbbr).',
        autoRemediation: 'Presença mantida via janela de graça de 5 min do agente Windows até normalização do socket.',
        details: { ports: results },
      });
    }
    return results;
  }

  async function probeAppwrite(force = false): Promise<{ ok: boolean; latencyMs: number }> {
    const now = Date.now();
    if (!force && cachedAppwriteProbe && now - cachedAppwriteProbe.at < 12_000) {
      return { ok: cachedAppwriteProbe.ok, latencyMs: cachedAppwriteProbe.latencyMs };
    }
    const res = await hooks.probeAppwriteLatency();
    cachedAppwriteProbe = { at: now, ...res };
    return res;
  }

  async function getTelemetry(): Promise<DiagnosticsTelemetryResponse> {
    const now = Date.now();
    pruneHeartbeatWindow(now);

    const [ports, appwriteProbe] = await Promise.all([
      probeRustDeskPorts(false),
      probeAppwrite(false),
    ]);

    const snap = hooks.getCacheSnapshot();
    const mem = process.memoryUsage();
    const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
    const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
    const usedMemPct = totalMemMb > 0 ? Math.round(((totalMemMb - freeMemMb) / totalMemMb) * 100) : 50;

    const recentWindowCount = heartbeatTimestamps.length;
    const avgLatency =
      recentWindowCount > 0
        ? Math.round(
            heartbeatTimestamps.reduce((acc, item) => acc + item.durationMs, 0) / recentWindowCount,
          )
        : 12;

    const allPortsReachable = ports.every((p) => p.reachable);
    const anyPortReachable = ports.some((p) => p.reachable);
    const avgRustDeskLatency =
      ports.length > 0
        ? Math.round(ports.reduce((acc, p) => acc + p.latencyMs, 0) / ports.length)
        : 5;

    return {
      timestamp: new Date(now).toISOString(),
      version: 'v1.8.7',
      selfHealing: {
        status: appwriteProbe.ok && anyPortReachable ? 'active' : 'degraded',
        autoHealedEventsCount,
        orphanGuardsPurged,
        cacheEvictionsCount,
        dbFallbackActivations,
        devicesHealedCount,
        lastSelfHealAt,
      },
      api: {
        status: 'online',
        uptimeSeconds: Math.round(process.uptime()),
        heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
        heapTotalMb: Math.round((mem.heapTotal / (1024 * 1024)) * 10) / 10,
        rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
        heartbeatRatePerMinute: recentWindowCount,
        recentHeartbeatsSuccess: totalHeartbeatsSuccess,
        recentHeartbeatsFailed: totalHeartbeatsFailed,
        avgHeartbeatLatencyMs: avgLatency,
        cacheStats: {
          deviceSnapshots: snap.deviceSnapshots,
          tokenSnapshots: snap.tokenSnapshots,
          jwtEntries: snap.jwtEntries,
          hbbsPeers: snap.hbbsPeers,
          activeGuards: snap.activeGuards,
        },
      },
      rustdesk: {
        status: allPortsReachable ? 'online' : anyPortReachable ? 'degraded' : 'offline',
        host: hooks.hbbsHost,
        hbbsPort: 21116,
        hbbrPort: 21117,
        natPort: 21115,
        latencyMs: avgRustDeskLatency,
        ports,
        registeredPeersCount: snap.totalDevicesCount,
        onlinePeersCount: snap.onlineDevicesCount,
      },
      appwrite: {
        status: appwriteProbe.ok
          ? appwriteProbe.latencyMs > 1200
            ? 'degraded'
            : 'online'
          : 'degraded',
        latencyMs: appwriteProbe.latencyMs,
        database: 'remote_management',
        activeGuardsCount: snap.activeGuards,
        totalDevicesCount: snap.totalDevicesCount,
        onlineDevicesCount: snap.onlineDevicesCount,
      },
      host: {
        cpuCores: os.cpus().length || 4,
        loadAvg1m: Math.round((os.loadavg()[0] ?? 0.2) * 100) / 100,
        memoryTotalMb: totalMemMb,
        memoryFreeMb: freeMemMb,
        memoryUsagePercent: usedMemPct,
        uptimeHours: Math.max(1, Math.round(os.uptime() / 3600)),
      },
      events: events.slice(0, 60),
    };
  }

  async function runSelfHeal(): Promise<SelfHealExecutionResponse> {
    const started = performance.now();
    const executedAt = new Date().toISOString();
    lastSelfHealAt = executedAt;

    const internalResult = await hooks.executeInternalSelfHeal();
    const [ports, appwriteProbe] = await Promise.all([
      probeRustDeskPorts(true),
      probeAppwrite(true),
    ]);

    const actions: SelfHealActionResult[] = [
      {
        action: 'ORPHAN_GUARD_RECONCILIATION',
        component: 'SERVIDOR NODE.JS',
        status: internalResult.orphanGuardsPurged > 0 ? 'healed' : 'verified',
        summary:
          internalResult.orphanGuardsPurged > 0
            ? `${internalResult.orphanGuardsPurged} trava(s) órfã(s) de heartbeat removida(s) com sucesso.`
            : 'Nenhuma trava órfã pendente na fila de concorrência de heartbeat.',
        metrics: { orphanGuardsPurged: internalResult.orphanGuardsPurged },
      },
      {
        action: 'MEMORY_CACHE_SANITATION',
        component: 'SERVIDOR NODE.JS',
        status: internalResult.cachesEvicted > 0 ? 'healed' : 'verified',
        summary:
          internalResult.cachesEvicted > 0
            ? `${internalResult.cachesEvicted} entrada(s) expirada(s) expurgada(s) dos caches de sessão, tokens e peers.`
            : 'Caches de sessão JWT, snapshots e tokens dentro dos limites ótimos de TTL.',
        metrics: { cachesEvicted: internalResult.cachesEvicted },
      },
      {
        action: 'DEVICE_STATE_AND_HBBS_SYNC',
        component: 'RUSTDESK SERVER',
        status: ports.every((p) => p.reachable) ? 'healed' : 'warning',
        summary: `Presença tempo real ressincronizada via HBBS (${internalResult.hbbsOnlineSynced} peers online; ${internalResult.devicesReconciled} cadastros reconciliados).`,
        metrics: {
          hbbsOnlineSynced: internalResult.hbbsOnlineSynced,
          devicesReconciled: internalResult.devicesReconciled,
        },
      },
      {
        action: 'APPWRITE_CONNECTION_VERIFICATION',
        component: 'APPWRITE DB',
        status: appwriteProbe.ok ? 'verified' : 'warning',
        summary: appwriteProbe.ok
          ? `Conexão com banco remote_management validada (${appwriteProbe.latencyMs} ms).`
          : `Oscilação detectada no Appwrite (${appwriteProbe.latencyMs} ms) — fallback em memória ativo.`,
        metrics: { ok: appwriteProbe.ok, latencyMs: appwriteProbe.latencyMs },
      },
    ];

    const durationMs = Math.max(1, Math.round(performance.now() - started));
    recordEvent({
      level: 'success',
      component: 'SERVIDOR NODE.JS',
      operation: 'SELF_HEAL_CYCLE_COMPLETED',
      message: `[SelfHealingEngine] Ciclo completo de auto-cura e reconciliação concluído em ${durationMs} ms (${internalResult.orphanGuardsPurged} guardas limpas, ${internalResult.cachesEvicted} caches expurgados, ${internalResult.hbbsOnlineSynced} peers HBBS sincronizados).`,
      autoRemediation:
        'Caches sanitizados, presença RustDesk atualizada em tempo real e integridade de dispositivos reconciliada.',
      details: {
        durationMs,
        ...internalResult,
      },
    });

    const telemetry = await getTelemetry();
    const overallStatus =
      internalResult.orphanGuardsPurged > 0 ||
      internalResult.cachesEvicted > 0 ||
      internalResult.devicesReconciled > 0
        ? 'remediated'
        : appwriteProbe.ok && ports.every((p) => p.reachable)
          ? 'healthy'
          : 'attention';

    return {
      executedAt,
      durationMs,
      overallStatus,
      actions,
      telemetry,
    };
  }

  return {
    recordEvent,
    recordHeartbeatMetric,
    recordAutoHealCounter,
    getTelemetry,
    runSelfHeal,
  };
}
