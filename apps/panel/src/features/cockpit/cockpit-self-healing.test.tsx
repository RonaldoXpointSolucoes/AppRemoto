// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  SelfHealingRuntimeBoundary,
  isStaleChunkError,
  compactLocalStorageOnQuotaPressure,
} from '../../components/self-healing-boundary';
import { AntigravityCockpit } from './antigravity-cockpit';
import type { DeviceDirectoryService } from '../devices/use-devices';

describe('Self-Healing Runtime & Cockpit Diagnostics (v1.8.7)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('identifies stale deployment chunk errors and compacts localStorage under quota pressure', () => {
    expect(isStaleChunkError('ChunkLoadError: Loading chunk 492 failed.')).toBe(true);
    expect(isStaleChunkError('Failed to fetch dynamically imported module')).toBe(true);
    expect(isStaleChunkError('Normal validation error')).toBe(false);

    const largeLogs = Array.from({ length: 120 }, (_, idx) => ({
      id: `log-${idx}`,
      timestamp: new Date().toISOString(),
      timeFormatted: '12:00:00',
      level: 'info',
      component: 'SERVIDOR NODE.JS',
      message: 'x'.repeat(300),
      details: {},
    }));
    window.localStorage.setItem('xpoint_cockpit_logs_v1', JSON.stringify(largeLogs));
    expect(compactLocalStorageOnQuotaPressure()).toBe(1);
    const compacted = JSON.parse(window.localStorage.getItem('xpoint_cockpit_logs_v1') || '[]');
    expect(compacted.length).toBeLessThanOrEqual(40);
  });

  it('isolates persistent React render crashes and recovers on clicking Auto-Recuperar Interface', async () => {
    let shouldCrash = true;
    function UnstableWidget() {
      if (shouldCrash) {
        throw new Error('Falha transitória simulada no widget');
      }
      return <div>Widget Operacional</div>;
    }

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <SelfHealingRuntimeBoundary>
          <UnstableWidget />
        </SelfHealingRuntimeBoundary>,
      );

      expect(await screen.findByText('Interface Reconciliada com Segurança')).toBeInTheDocument();

      shouldCrash = false;
      await userEvent.click(screen.getByRole('button', { name: /Auto-Recuperar Interface/i }));
      expect(await screen.findByText('Widget Operacional')).toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('connects AntigravityCockpit to live backend diagnostics and executes full self-healing cycle', async () => {
    const getDiagnosticsTelemetry = vi.fn().mockResolvedValue({
      timestamp: '2026-11-10T23:00:00.000Z',
      version: 'v1.8.7',
      selfHealing: {
        status: 'active',
        autoHealedEventsCount: 4,
        orphanGuardsPurged: 2,
        cacheEvictionsCount: 7,
        dbFallbackActivations: 1,
        devicesHealedCount: 1,
        lastSelfHealAt: null,
      },
      api: {
        status: 'online',
        uptimeSeconds: 7200,
        heapUsedMb: 38.4,
        heapTotalMb: 64.0,
        rssMb: 92.1,
        heartbeatRatePerMinute: 28,
        recentHeartbeatsSuccess: 420,
        recentHeartbeatsFailed: 0,
        avgHeartbeatLatencyMs: 9,
        cacheStats: {
          deviceSnapshots: 15,
          tokenSnapshots: 15,
          jwtEntries: 2,
          hbbsPeers: 15,
          activeGuards: 0,
        },
      },
      rustdesk: {
        status: 'online',
        host: '179.199.142.157',
        hbbsPort: 21116,
        hbbrPort: 21117,
        natPort: 21115,
        latencyMs: 3,
        ports: [
          { port: 21115, name: 'NAT', reachable: true, latencyMs: 3 },
          { port: 21116, name: 'HBBS', reachable: true, latencyMs: 3 },
          { port: 21117, name: 'HBBR', reachable: true, latencyMs: 4 },
        ],
        registeredPeersCount: 15,
        onlinePeersCount: 12,
      },
      appwrite: {
        status: 'online',
        latencyMs: 11,
        database: 'remote_management',
        activeGuardsCount: 0,
        totalDevicesCount: 15,
        onlinePeersCount: 12,
        onlineDevicesCount: 12,
      },
      host: {
        cpuCores: 4,
        loadAvg1m: 0.18,
        memoryTotalMb: 7940,
        memoryFreeMb: 3600,
        memoryUsagePercent: 54,
        uptimeHours: 320,
      },
      events: [
        {
          id: 'diag-evt-1',
          timestamp: '2026-11-10T23:00:00.000Z',
          level: 'warn',
          component: 'SERVIDOR NODE.JS',
          operation: 'ORPHAN_GUARD_AUTO_PURGED',
          message: '[SelfHealingEngine] Trava órfã de heartbeat purgada automaticamente.',
          rootCause: 'Operação anterior expirou (>180s).',
          autoRemediation: 'Guarda removida e fila liberada.',
          details: { deviceId: 'dev-1' },
        },
      ],
    });

    const executeDiagnosticsSelfHeal = vi.fn().mockResolvedValue({
      executedAt: '2026-11-10T23:01:00.000Z',
      durationMs: 22,
      overallStatus: 'remediated',
      actions: [
        {
          action: 'ORPHAN_GUARD_RECONCILIATION',
          component: 'SERVIDOR NODE.JS',
          status: 'healed',
          summary: '2 travas órfãs de heartbeat removidas com sucesso.',
        },
        {
          action: 'MEMORY_CACHE_SANITATION',
          component: 'SERVIDOR NODE.JS',
          status: 'healed',
          summary: '7 entradas expiradas expurgadas dos caches em memória.',
        },
      ],
      telemetry: await getDiagnosticsTelemetry(),
    });

    const mockService: DeviceDirectoryService = {
      getOrganizations: vi.fn().mockResolvedValue([]),
      getDevices: vi.fn().mockResolvedValue({ devices: [], nextCursor: null }),
      expireSession: vi.fn().mockResolvedValue(undefined),
      getDiagnosticsTelemetry,
      executeDiagnosticsSelfHeal,
    };

    render(<AntigravityCockpit service={mockService} />);

    await waitFor(() => expect(getDiagnosticsTelemetry).toHaveBeenCalled());
    expect(await screen.findByText(/Trava órfã de heartbeat purgada automaticamente/i)).toBeInTheDocument();
    expect(screen.getByText(/Operação anterior expirou/i)).toBeInTheDocument();

    // Executa Auto-Cura Agora
    const healBtn = screen.getByRole('button', { name: /Auto-Cura Agora/i });
    await userEvent.click(healBtn);

    await waitFor(() => expect(executeDiagnosticsSelfHeal).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/Relatório de Execução do Motor de Auto-Cura/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/2 travas órfãs de heartbeat removidas com sucesso/i).length,
    ).toBeGreaterThan(0);
  });
});
