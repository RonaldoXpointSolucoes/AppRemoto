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

