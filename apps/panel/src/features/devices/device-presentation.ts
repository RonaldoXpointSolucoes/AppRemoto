import { extractDeviceAccessPolicy, type DataDivasInfo, type DeviceView } from '@appremoto/contracts';

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
  mainTitleNorm: string;
  displayNameNorm: string;
  hostnameNorm: string;
  subtitlePrimaryNorm: string;
  mainTitleWords: string[];
  titleWords: string[];
  subtitleWords: string[];
  fullHaystack: string;
  nameHaystack: string;
  ipHaystack: string;
  razaoHaystack: string;
  idHaystack: string;
  compactIdentityHaystack: string;
  cnpjDigits: string[];
  digitValues: string[];
}

export function normalizeSearchText(value: string): string {
  return stripAccents(value).toLowerCase();
}

function splitSearchWords(normalizedText: string): string[] {
  return normalizedText.split(/[^a-z0-9]+/).filter(Boolean);
}

const DOC_DIGIT_CANDIDATE_REGEX = /\b\d{2,3}\.?\d{3}\.?\d{3}[/.]?\d{3,4}-?\d{2}\b|\b\d{11,14}\b/g;

function extractDocumentDigitCandidates(sources: Array<string | null | undefined>): string[] {
  const candidates = new Set<string>();
  for (const src of sources) {
    if (!src) continue;
    const matches = src.match(DOC_DIGIT_CANDIDATE_REGEX);
    if (!matches) continue;
    for (const m of matches) {
      const digits = m.replace(/\D+/g, '');
      if (digits.length >= 11 && digits.length <= 14) {
        candidates.add(digits);
      }
    }
  }
  return Array.from(candidates);
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

  const mainTitleNorm = normalizeSearchText(presentation.mainTitle || '').trim();
  const displayNameNorm = normalizeSearchText(dev.displayName || '').trim();
  const hostnameNorm = normalizeSearchText(dev.hostname || '').trim();
  const subtitlePrimaryNorm = normalizeSearchText(presentation.subtitlePrimary || '').trim();
  const mainTitleWords = splitSearchWords(mainTitleNorm);
  const titleWords = splitSearchWords(`${mainTitleNorm} ${displayNameNorm}`);
  const subtitleWords = splitSearchWords(
    normalizeSearchText(
      [presentation.subtitlePrimary, dd?.nomeFantasia, dd?.razaoSocial, dev.organizationName]
        .filter(Boolean)
        .join(' ')
    )
  );

  const nameParts = [
    presentation.mainTitle,
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

  const extractedDocDigits = extractDocumentDigitCandidates([
    dd?.cnpj,
    dev.organizationName,
    dev.displayName,
    dd?.razaoSocial,
    dd?.nomeFantasia,
    dev.notes,
    options?.customNotes,
  ]);
  const rawCnpjDigits = dd?.cnpj ? dd.cnpj.replace(/\D+/g, '') : '';
  const cnpjDigitsSet = new Set<string>(extractedDocDigits);
  if (rawCnpjDigits.length >= 6) {
    cnpjDigitsSet.add(rawCnpjDigits);
  }
  const cnpjDigits = Array.from(cnpjDigitsSet);

  const idParts = [
    dev.rustdeskId,
    dd?.cnpj,
    ...cnpjDigits,
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

  const compactIdentityHaystack = [...nameParts, ...razaoParts]
    .map((p) => normalizeSearchText(p).replace(/[^a-z0-9]+/g, ''))
    .filter(Boolean)
    .join(' ');

  const digitValuesSet = new Set<string>(
    idParts.map((v) => v.replace(/\D+/g, '')).filter(Boolean)
  );
  for (const c of cnpjDigits) {
    digitValuesSet.add(c);
  }

  return {
    mainTitleNorm,
    displayNameNorm,
    hostnameNorm,
    subtitlePrimaryNorm,
    mainTitleWords,
    titleWords,
    subtitleWords,
    fullHaystack: normalizeSearchText(allParts.join(' ')),
    nameHaystack: normalizeSearchText(nameParts.join(' ')),
    ipHaystack: normalizeSearchText(ipParts.join(' ')),
    razaoHaystack: normalizeSearchText(razaoParts.join(' ')),
    idHaystack: normalizeSearchText(idParts.join(' ')),
    compactIdentityHaystack,
    cnpjDigits,
    digitValues: Array.from(digitValuesSet),
  };
}

interface PreparedSearchToken {
  raw: string;
  prefix: string | null;
  val: string;
  digits: string;
}

interface PreparedSearchClause {
  raw: string;
  cleanTokens: string[];
  cleanClause: string;
  clauseDigits: string;
  isNumericLike: boolean;
  tokens: PreparedSearchToken[];
}

let cachedRawQuery = '';
let cachedPreparedClauses: PreparedSearchClause[] = [];

function getPreparedSearchClauses(rawQuery: string): PreparedSearchClause[] {
  if (!rawQuery) return [];
  if (rawQuery === cachedRawQuery) return cachedPreparedClauses;

  const trimmed = rawQuery.trim();
  if (!trimmed) {
    cachedRawQuery = rawQuery;
    cachedPreparedClauses = [];
    return cachedPreparedClauses;
  }

  const rawClauses = normalizeSearchText(trimmed)
    .split(/[,;|]+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const prepared: PreparedSearchClause[] = [];
  for (const clause of rawClauses) {
    const rawTokens = clause.split(/\s+/).filter(Boolean);
    const tokens: PreparedSearchToken[] = [];
    const cleanTokens: string[] = [];

    for (const tok of rawTokens) {
      const colonIdx = tok.indexOf(':');
      const prefix = colonIdx > 0 ? tok.slice(0, colonIdx) : null;
      const val = colonIdx > 0 ? tok.slice(colonIdx + 1) : tok;
      if (val) {
        cleanTokens.push(val);
      }
      tokens.push({
        raw: tok,
        prefix,
        val,
        digits: val.replace(/\D+/g, ''),
      });
    }

    const cleanClause = cleanTokens.join(' ');
    const clauseDigits = clause.replace(/\D+/g, '');
    const isNumericLike =
      clauseDigits.length >= 3 && /^[\d\s.\-/]+$/.test(clause) && !clause.includes('.');

    prepared.push({
      raw: clause,
      cleanTokens,
      cleanClause,
      clauseDigits,
      isNumericLike,
      tokens,
    });
  }

  cachedRawQuery = rawQuery;
  cachedPreparedClauses = prepared;
  return prepared;
}

function scorePreparedClauseMatch(
  index: DeviceSearchIndex,
  clause: PreparedSearchClause
): number {
  const { cleanTokens, cleanClause, clauseDigits } = clause;
  if (cleanTokens.length === 0) return 0;

  const {
    mainTitleNorm,
    displayNameNorm,
    hostnameNorm,
    subtitlePrimaryNorm,
    mainTitleWords,
    titleWords,
    subtitleWords,
  } = index;

  // 0. Prioridade máxima: Match exato ou de documento (CNPJ/CPF)
  if (
    clauseDigits.length >= 8 &&
    index.cnpjDigits.some((c) => c === clauseDigits || c.includes(clauseDigits))
  ) {
    return 1000;
  }

  // 1. Nome principal (mainTitle / displayName) idêntico ao filtro
  if (mainTitleNorm === cleanClause || displayNameNorm === cleanClause) {
    return 1000;
  }

  // 2. Nome principal (mainTitle / displayName) começa exatamente com o termo pesquisado (ex: "BURGUER PLUS - SERVIDOR" para "burguer")
  if (mainTitleNorm.startsWith(cleanClause) || displayNameNorm.startsWith(cleanClause)) {
    const firstWordExact = titleWords[0] === cleanTokens[0];
    return firstWordExact ? 960 : 920;
  }

  // 3. Todas as palavras do filtro batem com o início de palavras do Nome Principal
  const allTokensMatchTitleWordPrefix =
    mainTitleWords.length > 0 &&
    cleanTokens.every((tok) => titleWords.some((w) => w.startsWith(tok)));

  if (allTokensMatchTitleWordPrefix) {
    if (mainTitleWords[0]?.startsWith(cleanTokens[0])) {
      return mainTitleWords[0] === cleanTokens[0] ? 900 : 890;
    }
    const firstIdx = mainTitleWords.findIndex((w) => w.startsWith(cleanTokens[0]));
    const penalty = firstIdx >= 0 ? Math.min(firstIdx, 10) * 2 : 10;
    const exactFirstToken = mainTitleWords.some((w) => w === cleanTokens[0]);
    return (exactFirstToken ? 850 : 820) - penalty;
  }

  // 4. Nome principal contém o termo como substring (ex: "HAMBURGUER CAMPEÃO - SERVIDOR" contém "burguer")
  if (mainTitleNorm.includes(cleanClause) || displayNameNorm.includes(cleanClause)) {
    return 720;
  }
  if (cleanTokens.every((tok) => mainTitleNorm.includes(tok) || displayNameNorm.includes(tok))) {
    return 700;
  }

  // 4b. Nome colado (CamelCase / sem espaços, ex: "ClienteXYZ" batendo em "Cliente XYZ")
  const compactClause = cleanClause.replace(/[^a-z0-9]+/g, '');
  if (compactClause.length >= 4 && index.compactIdentityHaystack.includes(compactClause)) {
    const compactTitle = mainTitleNorm.replace(/[^a-z0-9]+/g, '');
    if (compactTitle.startsWith(compactClause)) return 880;
    if (compactTitle.includes(compactClause)) return 690;
  }

  // 5. Busca combinada (ex: Nome + Função/IP) onde ao menos o primeiro termo está no Nome Principal
  if (cleanTokens.length > 1 && mainTitleWords[0]?.startsWith(cleanTokens[0])) {
    return 660;
  }

  // 6. Match em Hostname ou outros campos de nome técnico (nomeMaq, funcao)
  if (hostnameNorm && hostnameNorm === cleanClause) return 640;
  if (hostnameNorm && hostnameNorm.startsWith(cleanClause)) return 620;
  if (hostnameNorm && hostnameNorm.includes(cleanClause)) return 600;
  if (cleanTokens.every((tok) => index.nameHaystack.includes(tok))) return 580;

  // 7. Match direto por IP, ID RustDesk ou CNPJ
  if (
    index.ipHaystack.includes(cleanClause) ||
    index.idHaystack.includes(cleanClause) ||
    (clauseDigits.length >= 4 && index.digitValues.some((d) => d.includes(clauseDigits)))
  ) {
    return 520;
  }

  // 8. Match em Subtítulo / Nome Fantasia / Razão Social (quando o Nome da máquina NÃO tem o termo)
  if (subtitlePrimaryNorm.startsWith(cleanClause)) {
    return 450;
  }
  if (cleanTokens.every((tok) => subtitleWords.some((w) => w.startsWith(tok)))) {
    return 420;
  }
  if (subtitlePrimaryNorm.includes(cleanClause)) {
    return 350;
  }
  if (
    index.razaoHaystack.includes(cleanClause) ||
    cleanTokens.every((tok) => index.razaoHaystack.includes(tok))
  ) {
    return 200;
  }
  if (compactClause.length >= 4 && index.compactIdentityHaystack.includes(compactClause)) {
    return 220;
  }

  // 9. Match residual em observações / sistema operacional
  return 100;
}

export function scoreDeviceSearchMatch(
  index: DeviceSearchIndex,
  rawQuery: string,
  _scope: DeviceSearchScope = 'all'
): number {
  const clauses = getPreparedSearchClauses(rawQuery);
  if (clauses.length === 0) return 0;

  let bestScore = 0;
  for (let i = 0; i < clauses.length; i++) {
    const score = scorePreparedClauseMatch(index, clauses[i]);
    if (score > bestScore) bestScore = score;
  }
  return bestScore;
}

export function matchesDeviceSearchIndex(
  index: DeviceSearchIndex,
  rawQuery: string,
  scope: DeviceSearchScope = 'all'
): boolean {
  const clauses = getPreparedSearchClauses(rawQuery);
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

  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    if (scopedHaystack.includes(clause.raw)) return true;

    // Match prioritário por CNPJ/CPF (com ou sem pontuação)
    if (
      clause.clauseDigits.length >= 11 &&
      (index.cnpjDigits.some((c) => c.includes(clause.clauseDigits)) ||
        index.digitValues.some((d) => d.includes(clause.clauseDigits)))
    ) {
      return true;
    }

    if (scope === 'all' || scope === 'id') {
      if (
        (clause.clauseDigits.length >= 6 || clause.isNumericLike) &&
        index.digitValues.some((d) => d.includes(clause.clauseDigits))
      ) {
        return true;
      }
    }

    // Match por nome sem espaços / CamelCase (ex.: "ClienteXYZ" -> "Cliente XYZ")
    if (scope === 'all' || scope === 'name' || scope === 'razao') {
      const compactClause = clause.cleanClause.replace(/[^a-z0-9]+/g, '');
      if (
        compactClause.length >= 4 &&
        !/^\d+$/.test(compactClause) &&
        index.compactIdentityHaystack.includes(compactClause)
      ) {
        return true;
      }
    }

    const { tokens } = clause;
    if (tokens.length === 0) continue;

    let allMatch = true;
    for (let j = 0; j < tokens.length; j++) {
      const tok = tokens[j];
      if (tok.prefix) {
        if (!tok.val) continue;
        const p = tok.prefix;
        if (p === 'nome' || p === 'host' || p === 'pc' || p === 'funcao') {
          if (!index.nameHaystack.includes(tok.val)) {
            allMatch = false;
            break;
          }
          continue;
        }
        if (p === 'ip' || p === 'rede' || p === 'lan' || p === 'wan') {
          if (!index.ipHaystack.includes(tok.val)) {
            allMatch = false;
            break;
          }
          continue;
        }
        if (p === 'razao' || p === 'fantasia' || p === 'empresa' || p === 'cliente') {
          if (!index.razaoHaystack.includes(tok.val)) {
            allMatch = false;
            break;
          }
          continue;
        }
        if (p === 'id' || p === 'cnpj' || p === 'serial') {
          const matchedId =
            index.idHaystack.includes(tok.val) ||
            (tok.digits.length >= 3 && index.digitValues.some((d) => d.includes(tok.digits)));
          if (!matchedId) {
            allMatch = false;
            break;
          }
          continue;
        }
      }

      if (scopedHaystack.includes(tok.raw)) continue;
      if (scope === 'all' || scope === 'id') {
        if (tok.digits.length >= 4 && index.digitValues.some((d) => d.includes(tok.digits))) {
          continue;
        }
      }
      allMatch = false;
      break;
    }

    if (allMatch) return true;
  }

  return false;
}

export function normalizeRustDeskIdKey(rawId?: string | null): string {
  if (!rawId) return '';
  const trimmed = rawId.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length >= 6 && /^[\d\s.-]+$/.test(trimmed)) {
    return digits;
  }
  return trimmed.toLowerCase();
}

function isGenericOrAutoDisplayName(name: string, rustdeskId?: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  const rdDigits = (rustdeskId ?? '').replace(/\D+/g, '');
  const nameDigits = trimmed.replace(/\D+/g, '');
  if (rdDigits.length >= 6 && nameDigits === rdDigits) {
    return true;
  }
  if (
    /^((DESKTOP|WIN|LAPTOP|WORKSTATION|PC|COMPUTADOR|MAQUINA)[-_\s]|[A-Z0-9À-Ú]+\s*-\s*PC$)/i.test(
      trimmed
    )
  ) {
    return true;
  }
  return false;
}

export function scoreDeviceForDeduplication(dev: DeviceView): number {
  let score = 0;
  const policy = extractDeviceAccessPolicy(dev.notes);
  if (dev.customDisplayName || policy.customDisplayName) {
    score += 1000;
  }
  if (dev.status === 'ONLINE') {
    score += 200;
  }
  if (dev.enabled !== false) {
    score += 50;
  }
  const dd = dev.datadivas;
  if (dd?.cnpj?.trim()) score += 80;
  if (dd?.razaoSocial?.trim() || dd?.nomeFantasia?.trim()) score += 60;
  if (dd?.funcao?.trim()) score += 50;
  if (dd?.ipMaq?.trim()) score += 20;
  if (dev.notes && /\[pasta:[^\]]+\]/i.test(dev.notes)) {
    score += 40;
  }
  if (
    dev.requiresAccessPassword ||
    policy.requiresAccessPassword ||
    dev.adminOnlyAccess ||
    policy.adminOnlyAccess
  ) {
    score += 30;
  }
  const display = (dev.displayName || '').trim();
  if (display && !isGenericOrAutoDisplayName(display, dev.rustdeskId)) {
    score += 35;
    if (/^[A-Z0-9À-Ú]+(?:-[A-Z0-9À-Ú]+)+$/.test(display) && display === display.toUpperCase()) {
      score += 25;
    }
  }
  return score;
}

function pickNewerIso(a?: string | null, b?: string | null): string | null {
  const msA = a ? Date.parse(a) : NaN;
  const msB = b ? Date.parse(b) : NaN;
  if (Number.isFinite(msA) && Number.isFinite(msB)) {
    return msA >= msB ? a! : b!;
  }
  if (Number.isFinite(msA)) return a!;
  if (Number.isFinite(msB)) return b!;
  return a ?? b ?? null;
}

function mergeCleanNotes(primaryNotes?: string | null, secondaryNotes?: string | null): string | undefined {
  const p = (primaryNotes ?? '').trim();
  const s = (secondaryNotes ?? '').trim();
  if (!p && !s) return undefined;
  if (!s) return p;
  if (!p) return s;

  let merged = p;
  const secFolder = /\[pasta:[^\]]+\]/i.exec(s);
  if (secFolder && !/\[pasta:[^\]]+\]/i.test(merged)) {
    merged = `${secFolder[0]} ${merged}`.trim();
  }
  const secAccess = /\[acesso:\{[^\]]*\}\]/i.exec(s);
  if (secAccess && !/\[acesso:\{[^\]]*\}\]/i.test(merged)) {
    merged = `${secAccess[0]} ${merged}`.trim();
  }
  return merged.slice(0, 2000);
}

export function mergeDuplicateDeviceViews(a: DeviceView, b: DeviceView): DeviceView {
  const scoreA = scoreDeviceForDeduplication(a);
  const scoreB = scoreDeviceForDeduplication(b);
  let primary = a;
  let secondary = b;
  if (scoreB > scoreA) {
    primary = b;
    secondary = a;
  } else if (scoreB === scoreA) {
    const createdA = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const createdB = b.createdAt ? Date.parse(b.createdAt) : NaN;
    if (Number.isFinite(createdB) && (!Number.isFinite(createdA) || createdB > createdA)) {
      primary = b;
      secondary = a;
    } else if (!Number.isFinite(createdA) && !Number.isFinite(createdB)) {
      const seenA = a.lastSeenAt ? Date.parse(a.lastSeenAt) : NaN;
      const seenB = b.lastSeenAt ? Date.parse(b.lastSeenAt) : NaN;
      if (Number.isFinite(seenB) && (!Number.isFinite(seenA) || seenB > seenA)) {
        primary = b;
        secondary = a;
      }
    }
  }

  const mergedCreatedAt = pickNewerIso(primary.createdAt, secondary.createdAt);
  const mergedLastSeenAt = pickNewerIso(primary.lastSeenAt, secondary.lastSeenAt);
  const mergedStatus: DeviceView['status'] =
    primary.status === 'ONLINE' || secondary.status === 'ONLINE' ? 'ONLINE' : primary.status;

  let mergedHostname = primary.hostname;
  if (
    (!mergedHostname || mergedHostname.trim().toUpperCase() === primary.displayName.trim().toUpperCase()) &&
    secondary.hostname &&
    secondary.hostname.trim().toUpperCase() !== secondary.displayName.trim().toUpperCase()
  ) {
    mergedHostname = secondary.hostname;
  }

  let mergedOsVersion = primary.osVersion;
  if (!mergedOsVersion.includes('IP ') && secondary.osVersion.includes('IP ')) {
    mergedOsVersion = secondary.osVersion;
  }

  let mergedDataDivas: DataDivasInfo | undefined;
  if (primary.datadivas || secondary.datadivas) {
    const combined: Record<string, unknown> = { ...(secondary.datadivas ?? {}) };
    for (const [key, val] of Object.entries(primary.datadivas ?? {})) {
      if (val !== undefined && val !== '') {
        combined[key] = val;
      }
    }
    mergedDataDivas = combined as DataDivasInfo;
  }

  const mergedNotes = mergeCleanNotes(primary.notes, secondary.notes);
  const mergedPublicIp = primary.publicIp || secondary.publicIp;
  const requiresAccessPassword = Boolean(primary.requiresAccessPassword || secondary.requiresAccessPassword);
  const adminOnlyAccess = Boolean(primary.adminOnlyAccess || secondary.adminOnlyAccess);
  const customDisplayName = Boolean(primary.customDisplayName || secondary.customDisplayName);

  return {
    ...primary,
    ...(mergedCreatedAt ? { createdAt: mergedCreatedAt } : {}),
    hostname: mergedHostname,
    osVersion: mergedOsVersion,
    agentVersion: primary.agentVersion ?? secondary.agentVersion,
    rustdeskVersion: primary.rustdeskVersion ?? secondary.rustdeskVersion,
    lastSeenAt: mergedLastSeenAt,
    ...(mergedPublicIp ? { publicIp: mergedPublicIp } : {}),
    enabled: Boolean(primary.enabled || secondary.enabled),
    status: mergedStatus,
    ...(mergedDataDivas ? { datadivas: mergedDataDivas } : {}),
    ...(mergedNotes ? { notes: mergedNotes } : {}),
    ...(requiresAccessPassword ? { requiresAccessPassword: true } : {}),
    ...(adminOnlyAccess ? { adminOnlyAccess: true } : {}),
    ...(customDisplayName ? { customDisplayName: true } : {}),
  };
}

export function deduplicateDevicesByRustDeskId(devices: DeviceView[]): DeviceView[] {
  if (devices.length <= 1) return devices;
  const out: DeviceView[] = [];
  const indexByKey = new Map<string, number>();

  for (let i = 0; i < devices.length; i++) {
    const dev = devices[i];
    const key = normalizeRustDeskIdKey(dev.rustdeskId);
    if (!key) {
      out.push(dev);
      continue;
    }
    const existingIdx = indexByKey.get(key);
    if (existingIdx !== undefined) {
      out[existingIdx] = mergeDuplicateDeviceViews(out[existingIdx], dev);
      continue;
    }
    indexByKey.set(key, out.length);
    out.push(dev);
  }

  return out;
}


