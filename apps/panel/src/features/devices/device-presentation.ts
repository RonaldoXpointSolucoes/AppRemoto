import { extractDeviceAccessPolicy, type DeviceView } from '@appremoto/contracts';

const GENERIC_ROLE_REGEX =
  /^((SERVIDOR|SERVER|CAIXA|PDV|BALANCA|GARCOM|ESCRITORIO|COZINHA|ESTOQUE|RETAGUARDA|TOTEM|TERMINAL|ESTACAO|RECEPCAO|FINANCEIRO|DELIVERY|KDS|MAQUINA|COMPUTADOR|PC|NOTEBOOK|WORKSTATION)(\s*[-_#]?\s*\d+)?|DESKTOP-[A-Z0-9-]+|WIN-[A-Z0-9-]+|LAPTOP-[A-Z0-9-]+)$/i;

export function isGenericMachineOrRoleName(raw: string): boolean {
  const cleaned = stripAccents(raw.trim());
  return GENERIC_ROLE_REGEX.test(cleaned);
}

const COMPANY_STOPWORDS = new Set([
  'LTDA',
  'ME',
  'EPP',
  'EIRELI',
  'SA',
  'S/A',
  'CIA',
  'COMPANHIA',
  'SOCIEDADE',
  'EMPRESARIAL',
  'LIMITADA',
  'INDIVIDUAL',
  'MICROEMPRESA',
  'COMERCIO',
  'COMERCIAL',
  'SERVICOS',
  'SERVICO',
  'INDUSTRIA',
  'INDUSTRIAL',
  'DISTRIBUIDORA',
  'IMPORTACAO',
  'EXPORTACAO',
  'PARTICIPACOES',
  'HOLDING',
  'GRUPO',
  'REDE',
  'FILIAL',
  'MATRIZ',
  'UNIDADE',
  'LOJA',
  'RESTAURANTE',
  'RESTAURANTES',
  'BAR',
  'BARES',
  'LANCHONETE',
  'PADARIA',
  'PANIFICADORA',
  'CONFEITARIA',
  'PIZZARIA',
  'CHURRASCARIA',
  'HAMBURGUERIA',
  'BISTRO',
  'CAFE',
  'CAFETERIA',
  'ADEGA',
  'EMPORIO',
  'MERCADO',
  'SUPERMERCADO',
  'MINIMERCADO',
  'HORTIFRUTI',
  'ACOUGUE',
  'FARMACIA',
  'DROGARIA',
  'CLINICA',
  'CONSULTORIO',
  'LABORATORIO',
  'HOSPITAL',
  'HOTEL',
  'POUSADA',
  'MOTEL',
  'AUTO',
  'POSTO',
  'OFICINA',
  'ESTACIONAMENTO',
  'ESCRITORIO',
  'CONTABILIDADE',
  'ADVOCACIA',
  'ENGENHARIA',
  'CONSTRUTORA',
  'IMOBILIARIA',
  'ESCOLA',
  'COLEGIO',
  'ACADEMIA',
  'SALAO',
  'BARBEARIA',
  'PET',
  'SHOP',
  'ALIMENTOS',
  'BEBIDAS',
  'PRODUTOS',
  'ARTIGOS',
  'EQUIPAMENTOS',
  'SOLUCOES',
  'TECNOLOGIA',
  'INFORMATICA',
  'SISTEMAS',
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'E',
  'EM',
  'COM',
  'PARA',
  'POR',
  'NO',
  'NA',
  'NOS',
  'NAS',
  'AO',
  'AOS',
]);

const GENERIC_ORGS = new Set([
  'CLIENTES',
  'X-POINT SOLUCOES',
  'XPOINT SOLUCOES',
  'SERVIDORES E INFRA',
  'OPERACAO NORTE',
  'OPERACAO SUL',
  'REMOTE PLATFORM E2E',
  'PADRAO',
  'DEFAULT',
]);

const TITLE_CASE_LOWER_WORDS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'com',
  'para',
  'por',
  'no',
  'na',
]);

const TITLE_CASE_UPPER_WORDS = new Set([
  'LTDA',
  'ME',
  'EPP',
  'EIRELI',
  'SA',
  'BBQ',
  'TI',
  'PDV',
  'SP',
  'RJ',
  'MG',
  'PR',
  'SC',
  'RS',
  'BA',
  'GO',
  'DF',
]);

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function toTitleCasePtBr(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      const upperNoAccent = stripAccents(word).toUpperCase();
      if (TITLE_CASE_UPPER_WORDS.has(upperNoAccent)) {
        return upperNoAccent;
      }
      const lower = word.toLowerCase();
      if (index > 0 && TITLE_CASE_LOWER_WORDS.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function extractSignificantTokens(raw?: string | null): string[] {
  if (!raw) return [];
  const normalized = stripAccents(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ');
  return normalized
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !COMPANY_STOPWORDS.has(token));
}

function cleanBrandPhrase(raw: string): string {
  const words = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-ZÀ-Ú0-9\s&.-]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let start = 0;
  let end = words.length - 1;
  while (start <= end && COMPANY_STOPWORDS.has(stripAccents(words[start]))) {
    start++;
  }
  while (end >= start && COMPANY_STOPWORDS.has(stripAccents(words[end]))) {
    end--;
  }
  const sliced = start <= end ? words.slice(start, end + 1) : words;
  return sliced.slice(0, 3).join(' ');
}

export interface CoherentDevicePresentation {
  /** Linha 1 (Maior): Ex: "PANAMBY - SERVIDOR" ou "SISTEMA DEMO - CAIXA-01" */
  mainTitle: string;
  /** Nome âncora da marca extraído por referência cruzada (ex: "PANAMBY") */
  anchorBrand: string | null;
  /** Subtítulo principal (Linha 2 menor abaixo): Ex: "Penosa e Rabico Panamby" */
  subtitlePrimary: string;
  /** Subtítulo complementar: Ex: "Host: SERVIDOR" */
  subtitleSecondary: string | null;
  /** Se a tag de função já está contemplada no título principal (evita repetição visual) */
  roleIncludedInTitle: boolean;
}

export function resolveCoherentDevicePresentation(
  dev: DeviceView,
  folderName = 'Clientes',
  customEditedOverride?: boolean
): CoherentDevicePresentation {
  const rawDisplay = (dev.displayName || dev.hostname || 'COMPUTADOR').trim();
  const fantasia = dev.datadivas?.nomeFantasia?.trim() || '';
  const razao = dev.datadivas?.razaoSocial?.trim() || '';
  const org = dev.organizationName?.trim() || '';
  const orgNorm = stripAccents(org).toUpperCase();
  const effectiveRazao = razao || (!GENERIC_ORGS.has(orgNorm) ? org : '');
  const policy = extractDeviceAccessPolicy(dev.notes);
  const isExplicitlyEdited = Boolean(
    customEditedOverride || dev.customDisplayName || policy.customDisplayName
  );

  const fantasiaTokens = extractSignificantTokens(fantasia);
  const razaoTokens = extractSignificantTokens(effectiveRazao);

  let anchorBrand: string | null = null;

  if (fantasiaTokens.length > 0 && razaoTokens.length > 0) {
    const matchedTokens: string[] = [];
    for (const fTok of fantasiaTokens) {
      const rMatch = razaoTokens.find(
        (rTok) =>
          rTok === fTok ||
          (rTok.length >= 4 && fTok.length >= 4 && (fTok.startsWith(rTok) || rTok.startsWith(fTok)))
      );
      if (rMatch) {
        const chosen = rMatch.length <= fTok.length ? rMatch : fTok;
        if (!matchedTokens.includes(chosen)) {
          matchedTokens.push(chosen);
        }
      }
    }
    if (matchedTokens.length > 0) {
      anchorBrand = matchedTokens.slice(0, 3).join(' ');
    }
  }

  if (!anchorBrand) {
    if (fantasia) {
      anchorBrand = cleanBrandPhrase(fantasia) || fantasiaTokens.slice(0, 2).join(' ') || null;
    } else if (effectiveRazao && dev.datadivas) {
      anchorBrand = cleanBrandPhrase(effectiveRazao) || razaoTokens.slice(0, 2).join(' ') || null;
    } else if (
      effectiveRazao &&
      isGenericMachineOrRoleName(rawDisplay)
    ) {
      anchorBrand = cleanBrandPhrase(effectiveRazao) || razaoTokens.slice(0, 2).join(' ') || null;
    }
  }

  let mainTitle = rawDisplay;

  if (!isExplicitlyEdited) {
    const hyphenRoleMatch =
      !rawDisplay.includes(' - ') &&
      /^(.+?)\s*-\s*(SERVIDOR(?:\s*[-_#]?\s*\d+)?|SERVER(?:\s*[-_#]?\s*\d+)?|CAIXA(?:\s*[-_#]?\s*\d+)?|PDV(?:\s*[-_#]?\s*\d+)?|BALANCA(?:\s*[-_#]?\s*\d+)?|BALANÇA(?:\s*[-_#]?\s*\d+)?|GARCOM(?:\s*[-_#]?\s*\d+)?|GARÇOM(?:\s*[-_#]?\s*\d+)?|ESCRITORIO(?:\s*[-_#]?\s*\d+)?|COZINHA(?:\s*[-_#]?\s*\d+)?|ESTOQUE(?:\s*[-_#]?\s*\d+)?|RETAGUARDA(?:\s*[-_#]?\s*\d+)?|TOTEM(?:\s*[-_#]?\s*\d+)?|TERMINAL(?:\s*[-_#]?\s*\d+)?|DELIVERY(?:\s*[-_#]?\s*\d+)?)$/i.exec(
        rawDisplay
      );
    const spaceRoleMatch =
      !rawDisplay.includes(' - ') &&
      !hyphenRoleMatch &&
      /^(.+?)\s+(SERVIDOR|SERVER|CAIXA|PDV|BALANCA|BALANÇA|TOTEM|TERMINAL|DELIVERY)$/i.exec(rawDisplay);

    if (rawDisplay.includes(' - ') || hyphenRoleMatch || spaceRoleMatch) {
      let leftPart = '';
      let rightPart = '';
      if (rawDisplay.includes(' - ')) {
        const parts = rawDisplay.split(/\s+-\s+/);
        leftPart = parts[0]?.trim() || '';
        rightPart = parts.slice(1).join(' - ').trim();
      } else if (hyphenRoleMatch) {
        leftPart = hyphenRoleMatch[1]?.trim() || '';
        rightPart = hyphenRoleMatch[2]?.trim() || '';
      } else if (spaceRoleMatch) {
        leftPart = spaceRoleMatch[1]?.trim() || '';
        rightPart = spaceRoleMatch[2]?.trim() || '';
      }

      if (isGenericMachineOrRoleName(rightPart)) {
        const leftNorm = stripAccents(leftPart).toUpperCase();
        const anchorNorm = anchorBrand ? stripAccents(anchorBrand).toUpperCase() : '';

        if (anchorNorm && leftNorm !== anchorNorm && leftNorm.includes(anchorNorm) && rightPart) {
          mainTitle = `${anchorBrand} - ${rightPart.toUpperCase()}`;
        } else {
          mainTitle = `${leftPart.toUpperCase()} - ${rightPart.toUpperCase()}`;
        }
      }
    } else if (anchorBrand && isGenericMachineOrRoleName(rawDisplay)) {
      const displayNorm = stripAccents(rawDisplay).toUpperCase();
      const anchorNorm = stripAccents(anchorBrand).toUpperCase();

      let machineLabel = rawDisplay.toUpperCase();
      if (
        /^(DESKTOP-|WIN-|LAPTOP-|WORKSTATION|COMPUTADOR)/i.test(displayNorm) &&
        dev.datadivas?.funcao
      ) {
        machineLabel = dev.datadivas.funcao.trim().toUpperCase();
      }

      if (displayNorm === anchorNorm) {
        const roleFallback = (dev.datadivas?.funcao || dev.hostname || 'MAQUINA').trim().toUpperCase();
        mainTitle = `${anchorBrand} - ${roleFallback}`;
      } else if (!displayNorm.includes(anchorNorm)) {
        mainTitle = `${anchorBrand} - ${machineLabel}`;
      } else {
        mainTitle = rawDisplay.toUpperCase();
      }
    }
  }

  const titleNorm = stripAccents(mainTitle).toUpperCase();
  const hostClean = (dev.hostname || '').trim();
  const hostDiffers = Boolean(
    hostClean && stripAccents(hostClean).toUpperCase() !== titleNorm
  );

  let subtitlePrimary = folderName ? `Pasta: ${folderName}` : 'Computador Remoto';
  if (fantasia && stripAccents(fantasia).toUpperCase() !== stripAccents(anchorBrand || '').toUpperCase()) {
    subtitlePrimary = toTitleCasePtBr(fantasia);
  } else if (effectiveRazao && !titleNorm.startsWith(stripAccents(effectiveRazao).toUpperCase())) {
    subtitlePrimary = toTitleCasePtBr(effectiveRazao);
  } else if (fantasia) {
    subtitlePrimary = toTitleCasePtBr(fantasia);
  } else if (hostDiffers) {
    subtitlePrimary = `Host: ${hostClean}`;
  } else if (!GENERIC_ORGS.has(orgNorm) && org) {
    subtitlePrimary = org;
  }

  const subtitleSecondary =
    hostDiffers && !subtitlePrimary.startsWith('Host:')
      ? `Host: ${hostClean}`
      : folderName && !subtitlePrimary.startsWith('Pasta:')
        ? `Pasta: ${folderName}`
        : null;

  const roleNorm = dev.datadivas?.funcao ? stripAccents(dev.datadivas.funcao).toUpperCase() : '';
  const roleIncludedInTitle = Boolean(roleNorm && titleNorm.includes(roleNorm));

  return {
    mainTitle,
    anchorBrand,
    subtitlePrimary,
    subtitleSecondary,
    roleIncludedInTitle,
  };
}

export type DeviceSearchScope = 'all' | 'name' | 'ip' | 'razao' | 'id';

export interface DeviceSearchIndex {
  fullHaystack: string;
  nameHaystack: string;
  ipHaystack: string;
  razaoHaystack: string;
  idHaystack: string;
  digitValues: string[];
}

export function normalizeSearchText(value: string): string {
  return stripAccents(value).toLowerCase();
}

export function buildDeviceSearchIndex(
  dev: DeviceView,
  options?: {
    presentation?: CoherentDevicePresentation;
    localIp?: string | null;
    publicIp?: string | null;
    folderName?: string;
    customNotes?: string;
  }
): DeviceSearchIndex {
  const folderName = options?.folderName || 'Clientes';
  const presentation =
    options?.presentation ?? resolveCoherentDevicePresentation(dev, folderName);
  const dd = dev.datadivas;

  const nameParts = [
    presentation.mainTitle,
    presentation.anchorBrand,
    dev.displayName,
    dev.hostname,
    dd?.nomeMaq,
    dd?.windowsHostnameDesejado,
    dd?.funcao,
  ].filter(Boolean) as string[];

  const ipParts = [
    options?.localIp,
    options?.publicIp,
    dev.publicIp,
    dev.osVersion,
    dd?.ipMaq,
    dd?.ipDataDivas,
    dd?.redeSubrede,
    dd?.redeGateway,
  ].filter(Boolean) as string[];

  const razaoParts = [
    dd?.razaoSocial,
    dd?.nomeFantasia,
    presentation.subtitlePrimary,
    presentation.subtitleSecondary,
     presentation.anchorBrand,
    dev.organizationName,
    folderName,
    dd?.cidade,
    dd?.uf,
    dd?.endereco,
  ].filter(Boolean) as string[];

  const idParts = [
    dev.rustdeskId,
    dd?.cnpj,
    dd?.serial,
    dd?.ie,
  ].filter(Boolean) as string[];

  const allParts = [
    ...nameParts,
    ...ipParts,
    ...razaoParts,
    ...idParts,
    dev.operatingSystem,
    dev.notes,
    options?.customNotes,
  ].filter(Boolean) as string[];

  return {
    fullHaystack: normalizeSearchText(allParts.join(' ')),
    nameHaystack: normalizeSearchText(nameParts.join(' ')),
    ipHaystack: normalizeSearchText(ipParts.join(' ')),
    razaoHaystack: normalizeSearchText(razaoParts.join(' ')),
    idHaystack: normalizeSearchText(idParts.join(' ')),
    digitValues: idParts.map((v) => v.replace(/\D+/g, '')).filter(Boolean),
  };
}

export function matchesDeviceSearchIndex(
  index: DeviceSearchIndex,
  rawQuery: string,
  scope: DeviceSearchScope = 'all'
): boolean {
  if (!rawQuery) return true;
  const trimmed = rawQuery.trim();
  if (!trimmed) return true;

  const clauses = normalizeSearchText(trimmed)
    .split(/[,;|]+/)
    .map((c) => c.trim())
    .filter(Boolean);

  if (clauses.length === 0) return true;

  const scopedHaystack =
    scope === 'name'
      ? index.nameHaystack
      : scope === 'ip'
        ? index.ipHaystack
        : scope === 'razao'
          ? index.razaoHaystack
          : scope === 'id'
            ? index.idHaystack
            : index.fullHaystack;

  return clauses.some((clause) => {
    if (scopedHaystack.includes(clause)) return true;

    if (scope === 'all' || scope === 'id') {
      const clauseDigits = clause.replace(/\D+/g, '');
      const isNumericLike =
        clauseDigits.length >= 3 && /^[\d\s.\-/]+$/.test(clause) && !clause.includes('.');
      if (
        (clauseDigits.length >= 6 || isNumericLike) &&
        index.digitValues.some((d) => d.includes(clauseDigits))
      ) {
        return true;
      }
    }

    const tokens = clause.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;

    return tokens.every((tok) => {
      const colonIdx = tok.indexOf(':');
      if (colonIdx > 0) {
        const prefix = tok.slice(0, colonIdx);
        const val = tok.slice(colonIdx + 1);
        if (!val) return true;
        if (prefix === 'nome' || prefix === 'host' || prefix === 'pc' || prefix === 'funcao') {
          return index.nameHaystack.includes(val);
        }
        if (prefix === 'ip' || prefix === 'rede' || prefix === 'lan' || prefix === 'wan') {
          return index.ipHaystack.includes(val);
        }
        if (prefix === 'razao' || prefix === 'fantasia' || prefix === 'empresa' || prefix === 'cliente') {
          return index.razaoHaystack.includes(val);
        }
        if (prefix === 'id' || prefix === 'cnpj' || prefix === 'serial') {
          const valDigits = val.replace(/\D+/g, '');
          return (
            index.idHaystack.includes(val) ||
            (valDigits.length >= 3 && index.digitValues.some((d) => d.includes(valDigits)))
          );
        }
      }

      if (scopedHaystack.includes(tok)) return true;
      if (scope === 'all' || scope === 'id') {
        const tokDigits = tok.replace(/\D+/g, '');
        if (tokDigits.length >= 4 && index.digitValues.some((d) => d.includes(tokDigits))) {
          return true;
        }
      }
      return false;
    });
  });
}

