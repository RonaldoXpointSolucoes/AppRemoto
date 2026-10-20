import type { DeviceView } from '@appremoto/contracts';

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
  folderName = 'Clientes'
): CoherentDevicePresentation {
  const rawDisplay = (dev.displayName || dev.hostname || 'COMPUTADOR').trim();
  const fantasia = dev.datadivas?.nomeFantasia?.trim() || '';
  const razao = dev.datadivas?.razaoSocial?.trim() || '';
  const org = dev.organizationName?.trim() || '';
  const orgNorm = stripAccents(org).toUpperCase();
  const effectiveRazao = razao || (!GENERIC_ORGS.has(orgNorm) ? org : '');

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
      /^(SERVIDOR|CAIXA|PDV|BALANCA|GARCOM|ESCRITORIO|COZINHA|ESTOQUE|RETAGUARDA|TERMINAL|ESTACAO|PC\b|DESKTOP-|WIN-)/i.test(
        stripAccents(rawDisplay)
      )
    ) {
      anchorBrand = cleanBrandPhrase(effectiveRazao) || razaoTokens.slice(0, 2).join(' ') || null;
    }
  }

  let mainTitle = rawDisplay;

  const hyphenRoleMatch =
    !rawDisplay.includes(' - ') &&
    /^(.+?)\s*-\s*(SERVIDOR.*|SERVER.*|CAIXA.*|PDV.*|BALAN.*|GAR.*|ESCRIT.*|COZINHA.*|ESTOQUE.*|RETAGUARDA.*|TOTEM.*|TERMINAL.*|DELIVERY.*)$/i.exec(
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

    const leftNorm = stripAccents(leftPart).toUpperCase();
    const anchorNorm = anchorBrand ? stripAccents(anchorBrand).toUpperCase() : '';

    if (anchorNorm && leftNorm !== anchorNorm && leftNorm.includes(anchorNorm) && rightPart) {
      mainTitle = `${anchorBrand} - ${rightPart.toUpperCase()}`;
    } else {
      mainTitle = `${leftPart.toUpperCase()} - ${rightPart.toUpperCase()}`;
    }
  } else if (anchorBrand) {
    const displayNorm = stripAccents(rawDisplay).toUpperCase();
    const anchorNorm = stripAccents(anchorBrand).toUpperCase();

    let machineLabel = rawDisplay.toUpperCase();
    if (
      /^(DESKTOP-|WIN-|WORKSTATION|COMPUTADOR)/i.test(displayNorm) &&
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
