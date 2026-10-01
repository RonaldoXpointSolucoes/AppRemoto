import { ApiClientError } from '../../lib/api';
import type { ConnectionHistoryEvent, ConnectionMode } from '@appremoto/contracts';

export type ConnectionLogEvent = Omit<ConnectionHistoryEvent, 'stage' | 'code' | 'source'> & {
  stage: string; code: string; source: 'api' | 'browser' | 'operator' | 'local';
};
const codes = new Set(['LAUNCH_AUTHORIZED', 'ACCESS_DENIED', 'DEVICE_OFFLINE', 'HEARTBEAT_UNCONFIRMED',
  'INVALID_RUSTDESK_ID', 'CREDENTIAL_UNAVAILABLE', 'CONNECT_UNAVAILABLE', 'BROWSER_LAUNCH_REQUESTED',
  'BROWSER_LAUNCH_FAILED', 'APP_NOT_OPENED', 'OPERATOR_SESSION_CONFIRMED', 'OPERATOR_SESSION_FAILED',
  'NETWORK_ERROR', 'SESSION_EXPIRED', 'REQUEST_FAILED', 'INVALID_API_RESPONSE', 'AUTHORIZATION_REQUESTED',
  'EVENT_NOT_SAVED', 'HISTORY_UNAVAILABLE', 'DETAILS_UNAVAILABLE']);
const stages = new Set(['authorized', 'rejected', 'launch_requested', 'launch_failed', 'not_opened',
  'session_confirmed', 'session_failed', 'authorization_requested', 'event_not_saved', 'history_unavailable', 'details_unavailable']);
export function safeConnectionCode(error: unknown): string {
  if (!(error instanceof ApiClientError)) return 'REQUEST_FAILED';
  if (error.status === 401) return 'SESSION_EXPIRED';
  if (error.status === 403) return 'ACCESS_DENIED';
  return codes.has(error.code) ? error.code : 'REQUEST_FAILED';
}
export function localEvent(attemptId: string, mode: ConnectionMode, stage: string, code: string, source: ConnectionLogEvent['source'] = 'local'): ConnectionLogEvent {
  return { id: crypto.randomUUID(), attemptId, at: new Date().toISOString(), mode, stage, code, source };
}
export function connectionLogText(deviceId: string, events: ConnectionLogEvent[]): string {
  const safeId = /^[A-Za-z0-9._-]{1,36}$/.test(deviceId) ? deviceId : 'device';
  return [
    'XPoint Remote — diagnóstico de tentativas de conexão', `device=${safeId}`,
    'ONLINE confirma o agente no painel; não comprova uma sessão RustDesk.',
    'Origem api = autorização; browser = tentativa de abrir; operator = relato do técnico; local = diagnóstico deste navegador.',
    ...events.map((event) => JSON.stringify({
      at: /^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/.test(event.at) ? event.at : null,
      attemptId: /^[0-9a-f-]{36}$/i.test(event.attemptId) ? event.attemptId : null,
      mode: event.mode === 'manual' ? 'manual' : 'automatic',
      source: ['api', 'browser', 'operator', 'local'].includes(event.source) ? event.source : 'local',
      stage: stages.has(event.stage) ? event.stage : 'rejected', code: codes.has(event.code) ? event.code : 'REQUEST_FAILED',
    })), '',
  ].join('\n');
}
export function downloadConnectionLog(deviceId: string, events: ConnectionLogEvent[]): void {
  const url = URL.createObjectURL(new Blob([connectionLogText(deviceId, events)], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'XPoint-conexoes.log'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export const stageLabels: Record<string, string> = {
  authorization_requested: 'Autorização solicitada', authorized: 'Abertura autorizada pela API', rejected: 'Solicitação não autorizada ou indisponível',
  launch_requested: 'Navegador tentou abrir o RustDesk', launch_failed: 'Navegador não conseguiu abrir', not_opened: 'Técnico informou: aplicativo não abriu',
  session_confirmed: 'Técnico informou: sessão conectada', session_failed: 'Técnico informou: conexão falhou',
  event_not_saved: 'Evento mantido apenas neste navegador', history_unavailable: 'Histórico remoto indisponível', details_unavailable: 'Diagnóstico remoto indisponível',
};
