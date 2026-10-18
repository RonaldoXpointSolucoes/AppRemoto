'use client';

import type { DeviceView } from '@appremoto/contracts';

export interface ChatbotCustomerContext {
  cnpj: string;
  formattedCnpj: string;
  contactName?: string;
  contactPhone?: string;
  contactId?: string;
  conversationId?: string;
  preferredDeviceId?: string;
  preferredRustDeskId?: string;
  preferredRole?: string;
  openCnpjModal?: boolean;
  source: 'url' | 'postMessage' | 'simulator';
  updatedAt: string;
}

export interface ChatbotDeviceSummary {
  id: string;
  displayName: string;
  hostname: string;
  rustdeskId: string;
  organizationId: string;
  organizationName: string;
  status: 'ONLINE' | 'OFFLINE';
  cnpj?: string;
  nomeFantasia?: string;
  razaoSocial?: string;
  funcao?: string;
  ipMaq?: string;
}

export type ChatbotOutboundEvent =
  | {
      type: 'XPOINT_REMOTE_READY';
      version: string;
      embedded: boolean;
      authenticated: boolean;
      activeCnpj: string | null;
      timestamp: string;
    }
  | {
      type: 'XPOINT_REMOTE_PONG';
      version: string;
      authenticated: boolean;
      activeCnpj: string | null;
      timestamp: string;
    }
  | {
      type: 'XPOINT_REMOTE_CNPJ_RESOLVED';
      cnpj: string;
      formattedCnpj: string;
      contactName?: string;
      contactId?: string;
      conversationId?: string;
      companyName: string | null;
      totalDevices: number;
      onlineDevices: number;
      offlineDevices: number;
      devices: ChatbotDeviceSummary[];
      timestamp: string;
    }
  | {
      type: 'XPOINT_REMOTE_CONTACT_ASSOCIATED';
      cnpj: string;
      formattedCnpj: string;
      contactName?: string;
      contactPhone?: string;
      contactId?: string;
      conversationId?: string;
      companyName: string;
      device?: ChatbotDeviceSummary;
      devicesCount: number;
      timestamp: string;
    }
  | {
      type: 'XPOINT_REMOTE_SESSION_STARTED';
      protocolNumber: string;
      deviceId: string;
      displayName: string;
      hostname: string;
      rustdeskId: string;
      organizationName: string;
      cnpj?: string;
      contactId?: string;
      conversationId?: string;
      startedAt: string;
    }
  | {
      type: 'XPOINT_REMOTE_SESSION_ENDED';
      protocolNumber: string;
      deviceId: string;
      displayName: string;
      rustdeskId: string;
      cnpj?: string;
      contactId?: string;
      conversationId?: string;
      summary?: string;
      endedAt: string;
    };

export type ChatbotInboundAction =
  | {
      action: 'SET_CONTEXT';
      context: ChatbotCustomerContext;
    }
  | {
      action: 'CLEAR_CONTEXT';
    }
  | {
      action: 'OPEN_CNPJ_MODAL';
      cnpj: string;
    }
  | {
      action: 'CONNECT_DEVICE';
      deviceId?: string;
      rustdeskId?: string;
      role?: string;
      cnpj?: string;
    }
  | {
      action: 'PING';
    };

const SAFE_FORWARD_PARAMS = [
  'embed',
  'cnpj',
  'cpfCnpj',
  'document',
  'contactName',
  'customerName',
  'empresa',
  'contactPhone',
  'phone',
  'whatsapp',
  'contactId',
  'conversationId',
  'ticketId',
  'deviceId',
  'rustdeskId',
  'openCnpjModal',
  'compact',
] as const;

export function normalizeDocumentDigits(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/\D+/g, '').slice(0, 14);
}

export function formatDocumentDisplay(raw?: string | null): string {
  const digits = normalizeDocumentDigits(raw);
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
  }
  return (raw || '').trim();
}

export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const embedParam = params.get('embed');
    if (embedParam === '1' || embedParam === 'true') return true;
    if (window.location.pathname.startsWith('/embed')) return true;
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function buildPreservedRoute(basePath: '/login' | '/devices', search?: string): string {
  const rawSearch = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (!rawSearch) return basePath;
  try {
    const incoming = new URLSearchParams(rawSearch);
    const outgoing = new URLSearchParams();
    for (const key of SAFE_FORWARD_PARAMS) {
      const val = incoming.get(key);
      if (val && val.trim().length > 0 && val.trim().length <= 160) {
        outgoing.set(key, val.trim());
      }
    }
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/embed') && !outgoing.has('embed')) {
      outgoing.set('embed', '1');
    }
    const qs = outgoing.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  } catch {
    return basePath;
  }
}

export function parseInitialChatbotContext(search?: string): ChatbotCustomerContext | null {
  const rawSearch = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (!rawSearch) return null;
  try {
    const params = new URLSearchParams(rawSearch);
    const rawDoc =
      params.get('cnpj') ||
      params.get('cpfCnpj') ||
      params.get('document') ||
      params.get('doc') ||
      '';
    const digits = normalizeDocumentDigits(rawDoc);
    const cleanText = rawDoc.trim();
    if (!digits && !cleanText) return null;

    const cnpjValue = digits.length >= 8 ? digits : cleanText;
    const contactName =
      params.get('contactName') ||
      params.get('customerName') ||
      params.get('empresa') ||
      params.get('name') ||
      undefined;
    const contactPhone =
      params.get('contactPhone') ||
      params.get('phone') ||
      params.get('whatsapp') ||
      undefined;
    const contactId = params.get('contactId') || params.get('externalId') || undefined;
    const conversationId =
      params.get('conversationId') ||
      params.get('ticketId') ||
      params.get('protocol') ||
      undefined;
    const preferredDeviceId = params.get('deviceId') || undefined;
    const preferredRustDeskId = params.get('rustdeskId') || undefined;
    const preferredRole = params.get('role') || undefined;
    const openModalParam = params.get('openCnpjModal') || params.get('view');
    const openCnpjModal =
      openModalParam === '1' ||
      openModalParam === 'true' ||
      openModalParam === 'cnpj_modal';

    return {
      cnpj: cnpjValue,
      formattedCnpj: formatDocumentDisplay(cnpjValue),
      ...(contactName ? { contactName: contactName.trim().slice(0, 128) } : {}),
      ...(contactPhone ? { contactPhone: contactPhone.trim().slice(0, 40) } : {}),
      ...(contactId ? { contactId: contactId.trim().slice(0, 64) } : {}),
      ...(conversationId ? { conversationId: conversationId.trim().slice(0, 64) } : {}),
      ...(preferredDeviceId ? { preferredDeviceId: preferredDeviceId.trim().slice(0, 64) } : {}),
      ...(preferredRustDeskId ? { preferredRustDeskId: preferredRustDeskId.trim().slice(0, 64) } : {}),
      ...(preferredRole ? { preferredRole: preferredRole.trim().toUpperCase().slice(0, 32) } : {}),
      openCnpjModal,
      source: 'url',
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.trim();
    }
  }
  return undefined;
}

export function parseChatbotInboundMessage(
  rawData: unknown,
  source: 'postMessage' | 'simulator' = 'postMessage',
): ChatbotInboundAction | null {
  const root = asRecord(rawData);
  if (!root) return null;

  const rawType = pickString(root, 'type', 'action', 'event');
  if (!rawType) return null;
  const normalizedType = rawType.toUpperCase().trim();

  const body =
    asRecord(root.payload) ||
    asRecord(root.data) ||
    asRecord(root.detail) ||
    root;

  if (
    normalizedType === 'XPOINT_REMOTE_PING' ||
    normalizedType === 'PING' ||
    normalizedType === 'CHATBOT_PING'
  ) {
    return { action: 'PING' };
  }

  if (
    normalizedType === 'XPOINT_REMOTE_CLEAR_CNPJ' ||
    normalizedType === 'XPOINT_REMOTE_CLEAR_CONTEXT' ||
    normalizedType === 'XPOINT_REMOTE_CLEAR_FILTER' ||
    normalizedType === 'CLEAR_CNPJ' ||
    normalizedType === 'CLEAR_CONTEXT'
  ) {
    return { action: 'CLEAR_CONTEXT' };
  }

  if (
    normalizedType === 'XPOINT_REMOTE_OPEN_CNPJ_MODAL' ||
    normalizedType === 'XPOINT_REMOTE_OPEN_CNPJ_GROUP' ||
    normalizedType === 'OPEN_CNPJ_MODAL'
  ) {
    const rawCnpj = pickString(body, 'cnpj', 'cpfCnpj', 'document', 'doc') || '';
    const digits = normalizeDocumentDigits(rawCnpj);
    if (!digits && !rawCnpj) return null;
    return {
      action: 'OPEN_CNPJ_MODAL',
      cnpj: digits.length >= 8 ? digits : rawCnpj,
    };
  }

  if (
    normalizedType === 'XPOINT_REMOTE_CONNECT_DEVICE' ||
    normalizedType === 'XPOINT_REMOTE_CONNECT' ||
    normalizedType === 'CONNECT_DEVICE'
  ) {
    const deviceId = pickString(body, 'deviceId', 'id');
    const rustdeskId = pickString(body, 'rustdeskId', 'rustdesk');
    const role = pickString(body, 'role', 'funcao');
    const cnpj = pickString(body, 'cnpj', 'cpfCnpj');
    if (!deviceId && !rustdeskId && !role) return null;
    return {
      action: 'CONNECT_DEVICE',
      ...(deviceId ? { deviceId } : {}),
      ...(rustdeskId ? { rustdeskId } : {}),
      ...(role ? { role: role.toUpperCase() } : {}),
      ...(cnpj ? { cnpj: normalizeDocumentDigits(cnpj) || cnpj } : {}),
    };
  }

  if (
    normalizedType === 'XPOINT_REMOTE_SET_CNPJ' ||
    normalizedType === 'XPOINT_REMOTE_SET_CONTEXT' ||
    normalizedType === 'SET_CNPJ' ||
    normalizedType === 'SELECT_CUSTOMER' ||
    normalizedType === 'CHATBOT_SELECT_CUSTOMER' ||
    normalizedType === 'CHATBOT_SET_CNPJ'
  ) {
    const rawCnpj = pickString(body, 'cnpj', 'cpfCnpj', 'document', 'doc', 'query') || '';
    const digits = normalizeDocumentDigits(rawCnpj);
    const cleanText = rawCnpj.trim();
    if (!digits && !cleanText) return null;

    const cnpjValue = digits.length >= 8 ? digits : cleanText;
    const contactName = pickString(body, 'contactName', 'customerName', 'empresa', 'name', 'razaoSocial', 'nomeFantasia');
    const contactPhone = pickString(body, 'contactPhone', 'phone', 'whatsapp', 'telefone');
    const contactId = pickString(body, 'contactId', 'externalId', 'customerId');
    const conversationId = pickString(body, 'conversationId', 'ticketId', 'protocol', 'chatId');
    const preferredDeviceId = pickString(body, 'deviceId');
    const preferredRustDeskId = pickString(body, 'rustdeskId');
    const preferredRole = pickString(body, 'role', 'funcao');
    const openCnpjModal = Boolean(body.openCnpjModal === true || body.openCnpjModal === '1' || body.openCnpjModal === 'true');

    return {
      action: 'SET_CONTEXT',
      context: {
        cnpj: cnpjValue,
        formattedCnpj: formatDocumentDisplay(cnpjValue),
        ...(contactName ? { contactName: contactName.slice(0, 128) } : {}),
        ...(contactPhone ? { contactPhone: contactPhone.slice(0, 40) } : {}),
        ...(contactId ? { contactId: contactId.slice(0, 64) } : {}),
        ...(conversationId ? { conversationId: conversationId.slice(0, 64) } : {}),
        ...(preferredDeviceId ? { preferredDeviceId: preferredDeviceId.slice(0, 64) } : {}),
        ...(preferredRustDeskId ? { preferredRustDeskId: preferredRustDeskId.slice(0, 64) } : {}),
        ...(preferredRole ? { preferredRole: preferredRole.toUpperCase().slice(0, 32) } : {}),
        openCnpjModal,
        source,
        updatedAt: new Date().toISOString(),
      },
    };
  }

  return null;
}

export function toChatbotDeviceSummary(dev: DeviceView): ChatbotDeviceSummary {
  return {
    id: dev.id,
    displayName: dev.displayName,
    hostname: dev.hostname,
    rustdeskId: dev.rustdeskId,
    organizationId: dev.organizationId,
    organizationName: dev.organizationName,
    status: dev.status,
    ...(dev.datadivas?.cnpj ? { cnpj: dev.datadivas.cnpj } : {}),
    ...(dev.datadivas?.nomeFantasia ? { nomeFantasia: dev.datadivas.nomeFantasia } : {}),
    ...(dev.datadivas?.razaoSocial ? { razaoSocial: dev.datadivas.razaoSocial } : {}),
    ...(dev.datadivas?.funcao ? { funcao: dev.datadivas.funcao } : {}),
    ...(dev.datadivas?.ipMaq ? { ipMaq: dev.datadivas.ipMaq } : {}),
  };
}

export function deviceMatchesCnpjContext(dev: DeviceView, cnpjFilter: string): boolean {
  if (!cnpjFilter) return true;
  const filterDigits = normalizeDocumentDigits(cnpjFilter);
  const filterLower = cnpjFilter.toLocaleLowerCase();

  const candidateTexts = [
    dev.datadivas?.cnpj,
    dev.organizationName,
    dev.displayName,
    dev.hostname,
    dev.rustdeskId,
    dev.datadivas?.nomeFantasia,
    dev.datadivas?.razaoSocial,
    dev.datadivas?.serial,
  ];

  for (const val of candidateTexts) {
    if (!val) continue;
    if (val.toLocaleLowerCase().includes(filterLower)) return true;
    if (filterDigits.length >= 6 && val.replace(/\D+/g, '').includes(filterDigits)) {
      return true;
    }
  }
  return false;
}

export function emitToChatbotHost(event: ChatbotOutboundEvent): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(event, '*');
    }
    if (window.opener && window.opener !== window) {
      window.opener.postMessage(event, '*');
    }
    window.dispatchEvent(new CustomEvent('xpoint:remote-outbound', { detail: event }));
  } catch {
    // Ignore cross-origin postMessage restrictions
  }
}

export function dispatchSimulatedChatbotMessage(payload: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('xpoint:chatbot-inbound', { detail: payload }));
}

export function subscribeToChatbotEvents(
  handler: (action: ChatbotInboundAction) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  function onWindowMessage(event: MessageEvent) {
    const parsed = parseChatbotInboundMessage(event.data, 'postMessage');
    if (parsed) {
      handler(parsed);
    }
  }

  function onCustomInbound(event: Event) {
    const custom = event as CustomEvent<unknown>;
    const parsed = parseChatbotInboundMessage(custom.detail, 'simulator');
    if (parsed) {
      handler(parsed);
    }
  }

  window.addEventListener('message', onWindowMessage);
  window.addEventListener('xpoint:chatbot-inbound', onCustomInbound);

  return () => {
    window.removeEventListener('message', onWindowMessage);
    window.removeEventListener('xpoint:chatbot-inbound', onCustomInbound);
  };
}
