/**
 * Utilitário de parsing e formatação inteligente de informações de sistema operacional e rede
 * Transforma versões brutas do Windows (ex: "10.0.22631") em nomes humanos claros (ex: "Windows 11 (23H2)")
 * e extrai endereço IP local quando fornecido pelo agente.
 */

export interface ParsedSystemInfo {
  osName: string;
  versionLabel: string;
  badge: 'Win 11' | 'Win 10' | 'Server' | 'Windows';
  ip?: string;
  summary: string;
}

export function parseSystemInfo(operatingSystem: string, rawVersion: string): ParsedSystemInfo {
  let osName = operatingSystem.trim() || 'Windows';
  let version = rawVersion.trim() || '';
  let ip: string | undefined;

  // Extrai IP local se presente na string (ex: "23H2 (Build 22631) · IP 192.168.15.12")
  const ipMatch = version.match(/·\s*IP\s+([0-9a-fA-F:.]+)/i) || version.match(/\bIP\s+([0-9a-fA-F:.]+)/i);
  if (ipMatch) {
    ip = ipMatch[1];
    version = version.replace(/·\s*IP\s+[0-9a-fA-F:.]+/i, '').replace(/\bIP\s+[0-9a-fA-F:.]+/i, '').trim();
  }

  // Se o operatingSystem for genérico "Windows", analisa o build number na versão
  let buildNumber = 0;
  const buildMatch = version.match(/(?:10\.0\.|Build\s+|build\s+)(\d{5,})/i) || version.match(/^10\.0\.(\d+)/);
  if (buildMatch) {
    buildNumber = parseInt(buildMatch[1], 10);
  }

  // Detecta se é Windows Server
  const isServer = /server/i.test(osName) || /server/i.test(version);

  // Mapeamento preciso de Builds do Windows 10 vs Windows 11
  let friendlyEdition = '';
  if (!isServer) {
    if (buildNumber >= 26100) {
      friendlyEdition = 'Windows 11 (24H2)';
    } else if (buildNumber >= 22631) {
      friendlyEdition = 'Windows 11 (23H2)';
    } else if (buildNumber >= 22621) {
      friendlyEdition = 'Windows 11 (22H2)';
    } else if (buildNumber >= 22000) {
      friendlyEdition = 'Windows 11 (21H2)';
    } else if (buildNumber === 19045) {
      friendlyEdition = 'Windows 10 (22H2)';
    } else if (buildNumber === 19044) {
      friendlyEdition = 'Windows 10 (21H2)';
    } else if (buildNumber === 19043) {
      friendlyEdition = 'Windows 10 (21H1)';
    } else if (buildNumber === 19042) {
      friendlyEdition = 'Windows 10 (20H2)';
    } else if (buildNumber >= 10240 && buildNumber < 22000) {
      friendlyEdition = 'Windows 10';
    }
  }

  // Se o operatingSystem já for específico (ex: "Windows 11 Home Single Language" ou "Windows 10 Pro"), preserva-o
  if (osName === 'Windows' && friendlyEdition) {
    osName = friendlyEdition;
  } else if (buildNumber >= 22000 && osName.startsWith('Windows 10')) {
    // Corrige ProductName legado da Microsoft no Windows 11
    osName = osName.replace('Windows 10', 'Windows 11');
  }

  // Determina o badge curto
  let badge: ParsedSystemInfo['badge'] = 'Windows';
  if (isServer) {
    badge = 'Server';
  } else if (osName.includes('11') || buildNumber >= 22000) {
    badge = 'Win 11';
  } else if (osName.includes('10') || (buildNumber > 0 && buildNumber < 22000)) {
    badge = 'Win 10';
  }

  // Limpa o rótulo de versão para exibição amigável
  let cleanVersion = version;
  if (/^10\.0\.\d+/.test(cleanVersion)) {
    cleanVersion = `Build ${buildNumber || cleanVersion.replace('10.0.', '')}`;
  }

  const summaryParts: string[] = [osName];
  if (cleanVersion && !osName.includes(cleanVersion)) {
    summaryParts.push(cleanVersion);
  }
  if (ip) {
    summaryParts.push(`IP: ${ip}`);
  }

  return {
    osName,
    versionLabel: cleanVersion,
    badge,
    ip,
    summary: summaryParts.join(' · '),
  };
}

export interface DeviceNetworkIps {
  localIp: string | null;
  publicIp: string | null;
}

export function normalizeIpAddress(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^::ffff:/i, '');
  if (!trimmed) return null;
  const ipv4WithPort = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (ipv4WithPort && ipv4WithPort[1]) {
    return ipv4WithPort[1];
  }
  return trimmed;
}

export function isPrivateIpv4(ip: string): boolean {
  const clean = normalizeIpAddress(ip);
  if (!clean) return false;
  const parts = clean.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127 || a === 169 || a === 0) return true;
  return false;
}

export function resolveDeviceNetworkIps(input: {
  operatingSystem: string;
  osVersion: string;
  publicIp?: string | null;
  datadivas?: {
    ipMaq?: string;
    ipDataDivas?: string;
  } | null;
}): DeviceNetworkIps {
  const sys = parseSystemInfo(input.operatingSystem, input.osVersion);
  const sysIp = normalizeIpAddress(sys.ip);
  const maqIp = normalizeIpAddress(input.datadivas?.ipMaq);
  const ddServerIp = normalizeIpAddress(input.datadivas?.ipDataDivas);
  const apiPublicIp = normalizeIpAddress(input.publicIp);

  let localIp: string | null = null;
  let publicIp: string | null = null;

  for (const candidate of [sysIp, maqIp, ddServerIp]) {
    if (candidate && isPrivateIpv4(candidate)) {
      localIp = candidate;
      break;
    }
  }

  for (const candidate of [apiPublicIp, sysIp, maqIp, ddServerIp]) {
    if (
      candidate &&
      !isPrivateIpv4(candidate) &&
      candidate !== '::1' &&
      candidate.toLowerCase() !== 'localhost'
    ) {
      publicIp = candidate;
      break;
    }
  }

  return { localIp, publicIp };
}

export type TelemetryHealthTone = 'ok' | 'warn' | 'critical' | 'neutral';

export interface HardwareMetricView {
  hasData: boolean;
  usagePct: number | null;
  usedLabel: string | null;
  totalLabel: string | null;
  freeLabel: string | null;
  modelLabel: string | null;
  compactLabel: string;
  detailLabel: string;
  tone: TelemetryHealthTone;
}

export interface DeviceHardwareTelemetry {
  hasAnyHardwareData: boolean;
  cpu: HardwareMetricView;
  ram: HardwareMetricView;
  disk: HardwareMetricView;
}

function parsePctNumber(raw?: string | null): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  if (!m || !m[1]) return null;
  const val = Math.round(Number(m[1]));
  if (!Number.isFinite(val)) return null;
  return Math.max(0, Math.min(100, val));
}

function classifyMetricTone(pct: number | null): TelemetryHealthTone {
  if (pct === null) return 'neutral';
  if (pct >= 90) return 'critical';
  if (pct >= 75) return 'warn';
  return 'ok';
}

export function resolveDeviceHardwareTelemetry(input: {
  datadivas?: {
    cpuModelo?: string;
    cpuUsoPct?: string;
    ramTotalGb?: string;
    ramUsadaGb?: string;
    ramUsoPct?: string;
    discoTotalGb?: string;
    discoUsadoGb?: string;
    discoLivreGb?: string;
    discoUsoPct?: string;
  } | null;
}): DeviceHardwareTelemetry {
  const dd = input.datadivas;

  const cpuPct = parsePctNumber(dd?.cpuUsoPct);
  const cpuModel = dd?.cpuModelo?.trim() || null;
  const hasCpu = cpuPct !== null || Boolean(cpuModel);
  const cpu: HardwareMetricView = {
    hasData: hasCpu,
    usagePct: cpuPct,
    usedLabel: cpuPct !== null ? `${cpuPct}%` : null,
    totalLabel: cpuModel,
    freeLabel: null,
    modelLabel: cpuModel,
    compactLabel:
      cpuPct !== null
        ? `CPU: ${cpuPct}%`
        : cpuModel
          ? `CPU: ${cpuModel.slice(0, 18)}`
          : 'CPU: s/ leitura',
    detailLabel: hasCpu
      ? `${cpuModel || 'Processador'}${cpuPct !== null ? ` · ${cpuPct}% em uso` : ''}`
      : 'Aguardando leitura do agente Windows (v1.6.1+)',
    tone: classifyMetricTone(cpuPct),
  };

  const ramPct = parsePctNumber(dd?.ramUsoPct);
  const ramUsed = dd?.ramUsadaGb?.trim() || null;
  const ramTotal = dd?.ramTotalGb?.trim() || null;
  const hasRam = Boolean(ramUsed || ramTotal || ramPct !== null);
  const ramShortUsed = ramUsed ? ramUsed.replace(/\s*GB$/i, '') : null;
  const ramShortTotal = ramTotal ? ramTotal.replace(/\s*GB$/i, ' GB') : null;
  const ram: HardwareMetricView = {
    hasData: hasRam,
    usagePct: ramPct,
    usedLabel: ramUsed,
    totalLabel: ramTotal,
    freeLabel: null,
    modelLabel: null,
    compactLabel:
      ramShortUsed && ramShortTotal
        ? `RAM: ${ramShortUsed}/${ramShortTotal}${ramPct !== null ? ` (${ramPct}%)` : ''}`
        : ramPct !== null
          ? `RAM: ${ramPct}%`
          : 'RAM: s/ leitura',
    detailLabel:
      ramUsed && ramTotal
        ? `${ramUsed} em uso de ${ramTotal}${ramPct !== null ? ` (${ramPct}%)` : ''}`
        : hasRam
          ? `Uso de memória: ${ramPct ?? 0}%`
          : 'Aguardando leitura do agente Windows (v1.6.1+)',
    tone: classifyMetricTone(ramPct),
  };

  const diskPct = parsePctNumber(dd?.discoUsoPct);
  const diskUsed = dd?.discoUsadoGb?.trim() || null;
  const diskTotal = dd?.discoTotalGb?.trim() || null;
  const diskFree = dd?.discoLivreGb?.trim() || null;
  const hasDisk = Boolean(diskUsed || diskTotal || diskPct !== null);
  const diskShortUsed = diskUsed ? diskUsed.replace(/\s*GB$/i, '') : null;
  const diskShortTotal = diskTotal ? diskTotal.replace(/\s*GB$/i, ' GB') : null;
  const disk: HardwareMetricView = {
    hasData: hasDisk,
    usagePct: diskPct,
    usedLabel: diskUsed,
    totalLabel: diskTotal,
    freeLabel: diskFree,
    modelLabel: null,
    compactLabel:
      diskShortUsed && diskShortTotal
        ? `HD: ${diskShortUsed}/${diskShortTotal}${diskPct !== null ? ` (${diskPct}%)` : ''}`
        : diskPct !== null
          ? `HD: ${diskPct}%`
          : 'HD: s/ leitura',
    detailLabel:
      diskUsed && diskTotal
        ? `${diskUsed} em uso de ${diskTotal}${diskFree ? ` (${diskFree} livres)` : ''}${diskPct !== null ? ` · ${diskPct}%` : ''}`
        : hasDisk
          ? `Uso de disco: ${diskPct ?? 0}%`
          : 'Aguardando leitura do agente Windows (v1.6.1+)',
    tone: classifyMetricTone(diskPct),
  };

  return {
    hasAnyHardwareData: hasCpu || hasRam || hasDisk,
    cpu,
    ram,
    disk,
  };
}

export function extractIpv4SubnetPrefix(ip?: string | null): string | null {
  const clean = normalizeIpAddress(ip);
  if (!clean || !isPrivateIpv4(clean)) return null;
  const parts = clean.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

export interface NetworkPeerSummary {
  id: string;
  displayName: string;
  hostname: string;
  localIp: string | null;
  publicIp: string | null;
  subnetPrefix: string | null;
  gatewayIp: string | null;
  relation: 'same_router' | 'different_router' | 'unknown_lan';
}

export interface DeviceNetworkTopologyAnalysis {
  status: 'same_router' | 'isolated_router' | 'single_router' | 'no_lan_ip';
  localIp: string | null;
  publicIp: string | null;
  subnetPrefix: string | null;
  subnetRangeLabel: string | null;
  subnetCidr: string | null;
  gatewayIp: string | null;
  connectionType: string | null;
  configuredServerIp: string | null;
  serverSubnetMismatch: boolean;
  badgeLabel: string;
  summaryTitle: string;
  summaryDescription: string;
  peers: NetworkPeerSummary[];
  sameRouterCount: number;
  differentRouterCount: number;
}

function extractClientGroupKey(dev: {
  displayName: string;
  datadivas?: {
    cnpj?: string;
    nomeFantasia?: string;
    razaoSocial?: string;
  } | null;
}): { cnpjKey: string | null; clientNameKey: string | null } {
  const rawCnpj = dev.datadivas?.cnpj?.replace(/\D+/g, '') || '';
  const cnpjKey = rawCnpj.length >= 11 ? rawCnpj : null;

  const fantasia = dev.datadivas?.nomeFantasia?.trim().toUpperCase();
  if (fantasia && fantasia.length >= 3) {
    return { cnpjKey, clientNameKey: fantasia };
  }

  const sepIdx = dev.displayName.indexOf(' - ');
  if (sepIdx >= 3) {
    const prefix = dev.displayName.slice(0, sepIdx).trim().toUpperCase();
    if (prefix.length >= 3) {
      return { cnpjKey, clientNameKey: prefix };
    }
  }
  return { cnpjKey, clientNameKey: null };
}

export function analyzeDeviceNetworkTopology<
  T extends {
    id: string;
    displayName: string;
    hostname: string;
    operatingSystem: string;
    osVersion: string;
    publicIp?: string | null;
    datadivas?: {
      cnpj?: string;
      nomeFantasia?: string;
      razaoSocial?: string;
      ipMaq?: string;
      ipDataDivas?: string;
      redeSubrede?: string;
      redeGateway?: string;
      redeTipo?: string;
    } | null;
  },
>(target: T, allDevices: readonly T[]): DeviceNetworkTopologyAnalysis {
  const { localIp, publicIp } = resolveDeviceNetworkIps(target);
  const subnetPrefix = extractIpv4SubnetPrefix(localIp);
  const subnetRangeLabel = subnetPrefix ? `${subnetPrefix}.x` : null;
  const subnetCidr =
    target.datadivas?.redeSubrede?.trim() || (subnetPrefix ? `${subnetPrefix}.0/24` : null);
  const gatewayIp =
    normalizeIpAddress(target.datadivas?.redeGateway) ||
    (subnetPrefix ? `${subnetPrefix}.1` : null);
  const connectionType = target.datadivas?.redeTipo?.trim() || null;

  const configuredServerIp = normalizeIpAddress(target.datadivas?.ipDataDivas);
  const configuredServerSubnet = extractIpv4SubnetPrefix(configuredServerIp);
  const serverSubnetMismatch = Boolean(
    subnetPrefix && configuredServerSubnet && subnetPrefix !== configuredServerSubnet
  );

  const targetKeys = extractClientGroupKey(target);

  const matchedPeers = allDevices.filter((other) => {
    if (other.id === target.id) return false;
    const otherKeys = extractClientGroupKey(other);
    const otherIps = resolveDeviceNetworkIps(other);

    if (targetKeys.cnpjKey && otherKeys.cnpjKey && targetKeys.cnpjKey === otherKeys.cnpjKey) {
      return true;
    }
    if (
      targetKeys.clientNameKey &&
      otherKeys.clientNameKey &&
      targetKeys.clientNameKey === otherKeys.clientNameKey
    ) {
      return true;
    }
    if (publicIp && otherIps.publicIp && publicIp === otherIps.publicIp) {
      return true;
    }
    return false;
  });

  const peers: NetworkPeerSummary[] = matchedPeers.map((peer) => {
    const peerIps = resolveDeviceNetworkIps(peer);
    const peerSubnet = extractIpv4SubnetPrefix(peerIps.localIp);
    const peerGw =
      normalizeIpAddress(peer.datadivas?.redeGateway) ||
      (peerSubnet ? `${peerSubnet}.1` : null);

    let relation: NetworkPeerSummary['relation'] = 'unknown_lan';
    if (subnetPrefix && peerSubnet) {
      relation = subnetPrefix === peerSubnet ? 'same_router' : 'different_router';
    }
    return {
      id: peer.id,
      displayName: peer.displayName,
      hostname: peer.hostname,
      localIp: peerIps.localIp,
      publicIp: peerIps.publicIp,
      subnetPrefix: peerSubnet,
      gatewayIp: peerGw,
      relation,
    };
  });

  const sameRouterPeers = peers.filter((p) => p.relation === 'same_router');
  const differentRouterPeers = peers.filter((p) => p.relation === 'different_router');

  if (!localIp || !subnetPrefix) {
    return {
      status: 'no_lan_ip',
      localIp: null,
      publicIp,
      subnetPrefix: null,
      subnetRangeLabel: null,
      subnetCidr: null,
      gatewayIp: null,
      connectionType,
      configuredServerIp,
      serverSubnetMismatch: false,
      badgeLabel:
        peers.length > 0
          ? `📡 Rede: s/ IP Local (${peers.length + 1} PCs no grupo)`
          : '📡 Rede: s/ IP Local',
      summaryTitle: 'IP Local ainda não detectado para diagnóstico de roteador',
      summaryDescription:
        peers.length > 0
          ? `Esta máquina pertence a um grupo com mais ${peers.length} computador(es), mas ainda não reportou seu IP de rede local (LAN).`
          : 'O endereço IP da rede interna ainda não foi reportado pelo agente desta máquina.',
      peers,
      sameRouterCount: 0,
      differentRouterCount: 0,
    };
  }

  if (serverSubnetMismatch || differentRouterPeers.length > 0) {
    const conflictTarget = serverSubnetMismatch
      ? `${configuredServerSubnet}.x (Servidor DataDivas ${configuredServerIp})`
      : `${differentRouterPeers[0]!.subnetPrefix}.x (${differentRouterPeers[0]!.displayName})`;
    const conflictSubnetShort = serverSubnetMismatch
      ? `${configuredServerSubnet}.x`
      : `${differentRouterPeers[0]!.subnetPrefix}.x`;

    return {
      status: 'isolated_router',
      localIp,
      publicIp,
      subnetPrefix,
      subnetRangeLabel,
      subnetCidr,
      gatewayIp,
      connectionType,
      configuredServerIp,
      serverSubnetMismatch,
      badgeLabel: `⚠️ Outro Roteador (${subnetPrefix}.x ≠ ${conflictSubnetShort})`,
      summaryTitle: 'Alerta de Isolamento de Rede (Roteadores / Sub-redes Diferentes)',
      summaryDescription: `Esta máquina está na faixa ${subnetPrefix}.x (Roteador ${gatewayIp}), enquanto ${conflictTarget} está em outra faixa de rede. Máquinas em roteadores/sub-redes diferentes não se enxergam na rede local.`,
      peers,
      sameRouterCount: sameRouterPeers.length + 1,
      differentRouterCount: differentRouterPeers.length,
    };
  }

  if (sameRouterPeers.length > 0) {
    const totalSame = sameRouterPeers.length + 1;
    return {
      status: 'same_router',
      localIp,
      publicIp,
      subnetPrefix,
      subnetRangeLabel,
      subnetCidr,
      gatewayIp,
      connectionType,
      configuredServerIp,
      serverSubnetMismatch: false,
      badgeLabel: `🔗 Mesma Rede (${subnetPrefix}.x · ${totalSame} PCs)`,
      summaryTitle: `Todas as ${totalSame} máquinas na Mesma Rede Local (${subnetPrefix}.x)`,
      summaryDescription: `Este computador e mais ${sameRouterPeers.length} máquina(s) deste local estão conectados na mesma faixa de roteador (${subnetCidr} · Gateway ${gatewayIp}) e se enxergam normalmente na LAN.`,
      peers,
      sameRouterCount: totalSame,
      differentRouterCount: 0,
    };
  }

  return {
    status: 'single_router',
    localIp,
    publicIp,
    subnetPrefix,
    subnetRangeLabel,
    subnetCidr,
    gatewayIp,
    connectionType,
    configuredServerIp,
    serverSubnetMismatch: false,
    badgeLabel: `📡 Roteador: ${subnetPrefix}.x (GW ${gatewayIp})`,
    summaryTitle: `Sub-rede Local ${subnetCidr} (Roteador ${gatewayIp})`,
    summaryDescription: `Máquina operando na faixa local ${subnetPrefix}.x com gateway padrão ${gatewayIp}${connectionType ? ` via ${connectionType}` : ''}.`,
    peers,
    sameRouterCount: 1,
    differentRouterCount: 0,
  };
}

export function analyzeAllDevicesNetworkTopology<
  T extends {
    id: string;
    displayName: string;
    hostname: string;
    operatingSystem: string;
    osVersion: string;
    publicIp?: string | null;
    datadivas?: {
      cnpj?: string;
      nomeFantasia?: string;
      razaoSocial?: string;
      ipMaq?: string;
      ipDataDivas?: string;
      redeSubrede?: string;
      redeGateway?: string;
      redeTipo?: string;
    } | null;
  },
>(allDevices: readonly T[]): Map<string, DeviceNetworkTopologyAnalysis> {
  const result = new Map<string, DeviceNetworkTopologyAnalysis>();
  if (allDevices.length === 0) return result;

  interface PrecomputedNode {
    dev: T;
    localIp: string | null;
    publicIp: string | null;
    subnetPrefix: string | null;
    gatewayIp: string | null;
    cnpjKey: string | null;
    clientNameKey: string | null;
  }

  const nodes: PrecomputedNode[] = [];
  const byCnpj = new Map<string, PrecomputedNode[]>();
  const byClientName = new Map<string, PrecomputedNode[]>();
  const byPublicIp = new Map<string, PrecomputedNode[]>();

  for (const dev of allDevices) {
    const { localIp, publicIp } = resolveDeviceNetworkIps(dev);
    const subnetPrefix = extractIpv4SubnetPrefix(localIp);
    const gatewayIp =
      normalizeIpAddress(dev.datadivas?.redeGateway) ||
      (subnetPrefix ? `${subnetPrefix}.1` : null);
    const { cnpjKey, clientNameKey } = extractClientGroupKey(dev);
    const node: PrecomputedNode = {
      dev,
      localIp,
      publicIp,
      subnetPrefix,
      gatewayIp,
      cnpjKey,
      clientNameKey,
    };
    nodes.push(node);

    if (cnpjKey) {
      const list = byCnpj.get(cnpjKey);
      if (list) list.push(node);
      else byCnpj.set(cnpjKey, [node]);
    }
    if (clientNameKey) {
      const list = byClientName.get(clientNameKey);
      if (list) list.push(node);
      else byClientName.set(clientNameKey, [node]);
    }
    if (publicIp) {
      const list = byPublicIp.get(publicIp);
      if (list) list.push(node);
      else byPublicIp.set(publicIp, [node]);
    }
  }

  for (const targetNode of nodes) {
    const target = targetNode.dev;
    const { localIp, publicIp, subnetPrefix, gatewayIp, cnpjKey, clientNameKey } = targetNode;
    const subnetRangeLabel = subnetPrefix ? `${subnetPrefix}.x` : null;
    const subnetCidr =
      target.datadivas?.redeSubrede?.trim() || (subnetPrefix ? `${subnetPrefix}.0/24` : null);
    const connectionType = target.datadivas?.redeTipo?.trim() || null;

    const configuredServerIp = normalizeIpAddress(target.datadivas?.ipDataDivas);
    const configuredServerSubnet = extractIpv4SubnetPrefix(configuredServerIp);
    const serverSubnetMismatch = Boolean(
      subnetPrefix && configuredServerSubnet && subnetPrefix !== configuredServerSubnet
    );

    const peerMap = new Map<string, PrecomputedNode>();
    if (cnpjKey) {
      for (const p of byCnpj.get(cnpjKey) || []) {
        if (p.dev.id !== target.id) peerMap.set(p.dev.id, p);
      }
    }
    if (clientNameKey) {
      for (const p of byClientName.get(clientNameKey) || []) {
        if (p.dev.id !== target.id) peerMap.set(p.dev.id, p);
      }
    }
    if (publicIp) {
      for (const p of byPublicIp.get(publicIp) || []) {
        if (p.dev.id !== target.id) peerMap.set(p.dev.id, p);
      }
    }

    const peers: NetworkPeerSummary[] = [];
    for (const peerNode of peerMap.values()) {
      let relation: NetworkPeerSummary['relation'] = 'unknown_lan';
      if (subnetPrefix && peerNode.subnetPrefix) {
        relation = subnetPrefix === peerNode.subnetPrefix ? 'same_router' : 'different_router';
      }
      peers.push({
        id: peerNode.dev.id,
        displayName: peerNode.dev.displayName,
        hostname: peerNode.dev.hostname,
        localIp: peerNode.localIp,
        publicIp: peerNode.publicIp,
        subnetPrefix: peerNode.subnetPrefix,
        gatewayIp: peerNode.gatewayIp,
        relation,
      });
    }

    const sameRouterPeers = peers.filter((p) => p.relation === 'same_router');
    const differentRouterPeers = peers.filter((p) => p.relation === 'different_router');

    if (!localIp || !subnetPrefix) {
      result.set(target.id, {
        status: 'no_lan_ip',
        localIp: null,
        publicIp,
        subnetPrefix: null,
        subnetRangeLabel: null,
        subnetCidr: null,
        gatewayIp: null,
        connectionType,
        configuredServerIp,
        serverSubnetMismatch: false,
        badgeLabel:
          peers.length > 0
            ? `📡 Rede: s/ IP Local (${peers.length + 1} PCs no grupo)`
            : '📡 Rede: s/ IP Local',
        summaryTitle: 'IP Local ainda não detectado para diagnóstico de roteador',
        summaryDescription:
          peers.length > 0
            ? `Esta máquina pertence a um grupo com mais ${peers.length} computador(es), mas ainda não reportou seu IP de rede local (LAN).`
            : 'O endereço IP da rede interna ainda não foi reportado pelo agente desta máquina.',
        peers,
        sameRouterCount: 0,
        differentRouterCount: 0,
      });
      continue;
    }

    if (serverSubnetMismatch || differentRouterPeers.length > 0) {
      const conflictTarget = serverSubnetMismatch
        ? `${configuredServerSubnet}.x (Servidor DataDivas ${configuredServerIp})`
        : `${differentRouterPeers[0]!.subnetPrefix}.x (${differentRouterPeers[0]!.displayName})`;
      const conflictSubnetShort = serverSubnetMismatch
        ? `${configuredServerSubnet}.x`
        : `${differentRouterPeers[0]!.subnetPrefix}.x`;

      result.set(target.id, {
        status: 'isolated_router',
        localIp,
        publicIp,
        subnetPrefix,
        subnetRangeLabel,
        subnetCidr,
        gatewayIp,
        connectionType,
        configuredServerIp,
        serverSubnetMismatch,
        badgeLabel: `⚠️ Outro Roteador (${subnetPrefix}.x ≠ ${conflictSubnetShort})`,
        summaryTitle: 'Alerta de Isolamento de Rede (Roteadores / Sub-redes Diferentes)',
        summaryDescription: `Esta máquina está na faixa ${subnetPrefix}.x (Roteador ${gatewayIp}), enquanto ${conflictTarget} está em outra faixa de rede. Máquinas em roteadores/sub-redes diferentes não se enxergam na rede local.`,
        peers,
        sameRouterCount: sameRouterPeers.length + 1,
        differentRouterCount: differentRouterPeers.length,
      });
      continue;
    }

    if (sameRouterPeers.length > 0) {
      const totalSame = sameRouterPeers.length + 1;
      result.set(target.id, {
        status: 'same_router',
        localIp,
        publicIp,
        subnetPrefix,
        subnetRangeLabel,
        subnetCidr,
        gatewayIp,
        connectionType,
        configuredServerIp,
        serverSubnetMismatch: false,
        badgeLabel: `🔗 Mesma Rede (${subnetPrefix}.x · ${totalSame} PCs)`,
        summaryTitle: `Todas as ${totalSame} máquinas na Mesma Rede Local (${subnetPrefix}.x)`,
        summaryDescription: `Este computador e mais ${sameRouterPeers.length} máquina(s) deste local estão conectados na mesma faixa de roteador (${subnetCidr} · Gateway ${gatewayIp}) e se enxergam normalmente na LAN.`,
        peers,
        sameRouterCount: totalSame,
        differentRouterCount: 0,
      });
      continue;
    }

    result.set(target.id, {
      status: 'single_router',
      localIp,
      publicIp,
      subnetPrefix,
      subnetRangeLabel,
      subnetCidr,
      gatewayIp,
      connectionType,
      configuredServerIp,
      serverSubnetMismatch: false,
      badgeLabel: `📡 Roteador: ${subnetPrefix}.x (GW ${gatewayIp})`,
      summaryTitle: `Sub-rede Local ${subnetCidr} (Roteador ${gatewayIp})`,
      summaryDescription: `Máquina operando na faixa local ${subnetPrefix}.x com gateway padrão ${gatewayIp}${connectionType ? ` via ${connectionType}` : ''}.`,
      peers,
      sameRouterCount: 1,
      differentRouterCount: 0,
    });
  }

  return result;
}



