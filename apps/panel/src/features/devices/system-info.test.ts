import { describe, expect, it } from 'vitest';
import {
  parseSystemInfo,
  resolveDeviceNetworkIps,
  resolveDeviceHardwareTelemetry,
  analyzeDeviceNetworkTopology,
} from './system-info';

describe('parseSystemInfo', () => {
  it('correctly maps raw Windows 10.0.22631 to Windows 11 (23H2)', () => {
    const res = parseSystemInfo('Windows', '10.0.22631');
    expect(res.osName).toBe('Windows 11 (23H2)');
    expect(res.badge).toBe('Win 11');
    expect(res.versionLabel).toBe('Build 22631');
    expect(res.summary).toContain('Windows 11 (23H2)');
  });

  it('correctly maps Windows 10.0.19045 to Windows 10 (22H2)', () => {
    const res = parseSystemInfo('Windows', '10.0.19045');
    expect(res.osName).toBe('Windows 10 (22H2)');
    expect(res.badge).toBe('Win 10');
    expect(res.versionLabel).toBe('Build 19045');
  });

  it('correctly maps Windows 10.0.26200 to Windows 11 (24H2)', () => {
    const res = parseSystemInfo('Windows', '10.0.26200');
    expect(res.osName).toBe('Windows 11 (24H2)');
    expect(res.badge).toBe('Win 11');
  });

  it('extracts local IP address and handles detailed OS string', () => {
    const res = parseSystemInfo('Windows 11 Home Single Language', '25H2 (Build 26200.9457) · IP 192.168.15.12');
    expect(res.osName).toBe('Windows 11 Home Single Language');
    expect(res.badge).toBe('Win 11');
    expect(res.ip).toBe('192.168.15.12');
    expect(res.versionLabel).toBe('25H2 (Build 26200.9457)');
    expect(res.summary).toBe('Windows 11 Home Single Language · 25H2 (Build 26200.9457) · IP: 192.168.15.12');
  });

  it('fixes legacy Microsoft registry where Windows 11 has ProductName "Windows 10 Pro"', () => {
    const res = parseSystemInfo('Windows 10 Pro', '23H2 (Build 22631) · IP 10.0.0.5');
    expect(res.osName).toBe('Windows 11 Pro');
    expect(res.badge).toBe('Win 11');
    expect(res.ip).toBe('10.0.0.5');
  });

  it('identifies Windows Server', () => {
    const res = parseSystemInfo('Windows Server 2022 Standard', '10.0.20348');
    expect(res.badge).toBe('Server');
    expect(res.osName).toBe('Windows Server 2022 Standard');
  });

  it('resolves both local LAN IP and public WAN IP and classifies public ipMaq accurately', () => {
    const both = resolveDeviceNetworkIps({
      operatingSystem: 'Windows 11 Pro',
      osVersion: '24H2 (Build 26100) · IP 192.168.0.240',
      publicIp: '179.199.142.157',
    });
    expect(both).toEqual({
      localIp: '192.168.0.240',
      publicIp: '179.199.142.157',
    });

    const edilza = resolveDeviceNetworkIps({
      operatingSystem: 'Windows 10 Pro',
      osVersion: '22H2 (Build 19045) · IP 192.168.1.45',
      datadivas: { ipMaq: '54.232.189.113:3050' },
    });
    expect(edilza).toEqual({
      localIp: '192.168.1.45',
      publicIp: '54.232.189.113',
    });
  });

  it('formats CPU, RAM and Disk telemetry and detects when machines are on different routers', () => {
    const hw = resolveDeviceHardwareTelemetry({
      datadivas: {
        cpuModelo: 'Intel Core i5-10400 (12 núcleos)',
        cpuUsoPct: '24%',
        ramTotalGb: '16.0 GB',
        ramUsadaGb: '9.2 GB',
        ramUsoPct: '58%',
        discoTotalGb: '476 GB',
        discoUsadoGb: '214 GB',
        discoLivreGb: '262 GB',
        discoUsoPct: '45%',
      },
    });
    expect(hw.hasAnyHardwareData).toBe(true);
    expect(hw.cpu.compactLabel).toBe('CPU: 24%');
    expect(hw.ram.compactLabel).toBe('RAM: 9.2/16.0 GB (58%)');
    expect(hw.disk.compactLabel).toBe('HD: 214/476 GB (45%)');

    const servidor = {
      id: 'srv-1',
      displayName: 'KAY E YO (TBK) - SERVIDOR TEATRO',
      hostname: 'SERVIDOR',
      operatingSystem: 'Windows 11 Pro',
      osVersion: '23H2 · IP 192.168.0.100',
      publicIp: '187.45.100.20',
      datadivas: { cnpj: '12.345.678/0001-90' },
    };
    const estacaoMesmoRoteador = {
      id: 'est-1',
      displayName: 'KAY E YO (TBK) - CAIXA 01',
      hostname: 'CAIXA-01',
      operatingSystem: 'Windows 10 Pro',
      osVersion: '22H2 · IP 192.168.0.105',
      publicIp: '187.45.100.20',
      datadivas: { cnpj: '12.345.678/0001-90' },
    };
    const estacaoOutroRoteador = {
      id: 'est-2',
      displayName: 'KAY E YO (TBK) - ESTAÇÃO TEATRO',
      hostname: 'TERMINAL',
      operatingSystem: 'Windows 10 Pro',
      osVersion: '22H2 · IP 192.168.1.55',
      publicIp: '187.45.100.20',
      datadivas: { cnpj: '12.345.678/0001-90', ipDataDivas: '192.168.0.100' },
    };

    const sameAnalysis = analyzeDeviceNetworkTopology(servidor, [servidor, estacaoMesmoRoteador]);
    expect(sameAnalysis.status).toBe('same_router');
    expect(sameAnalysis.badgeLabel).toContain('Mesma Rede (192.168.0.x · 2 PCs)');

    const isolatedAnalysis = analyzeDeviceNetworkTopology(estacaoOutroRoteador, [
      servidor,
      estacaoMesmoRoteador,
      estacaoOutroRoteador,
    ]);
    expect(isolatedAnalysis.status).toBe('isolated_router');
    expect(isolatedAnalysis.badgeLabel).toContain('Outro Roteador (192.168.1.x ≠ 192.168.0.x)');
  });
});
