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
