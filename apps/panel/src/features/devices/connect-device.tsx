'use client';

import type { ConnectionEventInput, ConnectionMode } from '@appremoto/contracts';
import { MonitorUp } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../../lib/api';
import { onSessionClear, sessionEpoch } from '../auth/session-cache';
import { launchRustDesk, manualRustDeskUri } from './rustdesk-launch';
import { localEvent, safeConnectionCode, type ConnectionLogEvent } from './connection-log';

export interface ConnectionService {
  connectDevice(deviceId: string, options: { mode: ConnectionMode; attemptId: string }): Promise<{ launchUri: string; attemptId?: string; mode?: ConnectionMode }>;
  recordConnectionEvent?(deviceId: string, input: ConnectionEventInput): Promise<{ recorded: boolean }>;
}
interface Attempt { attemptId: string; mode: ConnectionMode }
const handoffLifetimeMs = 30_000;
export function ConnectDevice({ deviceId, enabled, service, manual = false, rustdeskId, onEvent, onHelp, onSessionExpired }: {
  deviceId: string; enabled: boolean; service: ConnectionService; manual?: boolean; rustdeskId?: string;
  onEvent?(event: ConnectionLogEvent): void; onHelp?(): void; onSessionExpired?(): void;
}) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>();
  const passwordInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const active = useRef(false);
  const scope = useRef({ deviceId, epoch: sessionEpoch(client) });
  const handoff = useRef<{ uri: string; until: number; attempt: Attempt } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const events = useRef(onEvent); events.current = onEvent;
  const currentEnabled = useRef(enabled); currentEnabled.current = enabled;
  function valid() { return active.current && sessionEpoch(client) === scope.current.epoch; }
  function clearHandoff() { handoff.current = undefined; clearTimeout(timer.current); setRetryAvailable(false); }
  function clearPassword() { if (passwordInput.current) passwordInput.current.value = ''; }
  useEffect(() => {
    scope.current = { deviceId, epoch: sessionEpoch(client) }; active.current = true;
    lock.current = false; clearHandoff(); clearPassword(); setAttempt(undefined); setMessage(''); setPending(false);
    const remove = onSessionClear(client, () => {
      active.current = false; clearHandoff(); clearPassword(); setAttempt(undefined); setMessage(''); setPending(false);
    });
    return () => { active.current = false; remove(); handoff.current = undefined; clearTimeout(timer.current); clearPassword(); };
  }, [client, deviceId]);
  useEffect(() => { if (!enabled) { clearHandoff(); clearPassword(); } }, [enabled]);
  function append(value: ConnectionLogEvent) { if (valid()) events.current?.(value); }
  function report(current: Attempt, event: ConnectionEventInput['event']) {
    if (!valid()) return;
    const expected = scope.current;
    const code = { launch_requested: 'BROWSER_LAUNCH_REQUESTED', launch_failed: 'BROWSER_LAUNCH_FAILED',
      not_opened: 'APP_NOT_OPENED', session_confirmed: 'OPERATOR_SESSION_CONFIRMED', session_failed: 'OPERATOR_SESSION_FAILED' }[event];
    append(localEvent(current.attemptId, current.mode, event, code, event.startsWith('launch_') ? 'browser' : 'operator'));
    if (service.recordConnectionEvent) void service.recordConnectionEvent(deviceId, { ...current, event }).catch((error) => {
      if (valid() && scope.current === expected && error instanceof ApiClientError && error.status === 401 && onSessionExpired) { onSessionExpired(); return; }
      if (scope.current === expected) append(localEvent(current.attemptId, current.mode, 'event_not_saved', 'EVENT_NOT_SAVED'));
    });
  }
  function launch(current: Attempt, uri: string) {
    if (!valid() || !currentEnabled.current) return;
    try {
      launchRustDesk(uri); report(current, 'launch_requested');
      setMessage('Tentamos abrir o RustDesk neste computador do técnico. Confirme a abertura no navegador. A sessão ainda não foi confirmada.');
    } catch { report(current, 'launch_failed'); setMessage('O navegador não conseguiu abrir o RustDesk. Use as instruções abaixo.'); }
  }
  async function connect(event?: FormEvent) {
    event?.preventDefault();
    if (!enabled || lock.current || !valid()) return;
    if (manual && !passwordInput.current?.value) return;
    lock.current = true; clearHandoff(); setPending(true); setMessage('');
    const current: Attempt = { attemptId: crypto.randomUUID(), mode: manual ? 'manual' : 'automatic' };
    const expected = scope.current;
    setAttempt(undefined); append(localEvent(current.attemptId, current.mode, 'authorization_requested', 'AUTHORIZATION_REQUESTED'));
    try {
      const result = await service.connectDevice(deviceId, current);
      try {
        if (!valid() || scope.current !== expected || !currentEnabled.current) return;
        if ((result.attemptId && result.attemptId !== current.attemptId) || (result.mode && result.mode !== current.mode)) throw new Error('Invalid attempt');
        let uri = manual ? manualRustDeskUri(result.launchUri, passwordInput.current?.value ?? '') : result.launchUri;
        clearPassword(); setAttempt(current);
        handoff.current = { uri, until: Date.now() + handoffLifetimeMs, attempt: current };
        setRetryAvailable(true); timer.current = setTimeout(clearHandoff, handoffLifetimeMs);
        launch(current, uri); uri = '';
      } finally { result.launchUri = ''; }
    } catch (error) {
      if (valid() && scope.current === expected) {
        if (error instanceof ApiClientError && error.status === 401 && onSessionExpired) { onSessionExpired(); return; }
        append(localEvent(current.attemptId, current.mode, 'rejected', safeConnectionCode(error)));
        setMessage('Não foi possível iniciar o acesso. Abra os detalhes e consulte o diagnóstico desta tentativa.');
      }
    } finally { if (scope.current === expected) { clearPassword(); lock.current = false; if (valid()) setPending(false); } }
  }
  function retry() {
    const prepared = handoff.current;
    // This call is synchronous within the click, preserving browser user activation.
    if (prepared && prepared.until > Date.now() && enabled && valid()) launch(prepared.attempt, prepared.uri);
    clearHandoff();
  }
  function operatorReport(event: 'not_opened' | 'session_confirmed' | 'session_failed') {
    if (!attempt || !valid()) return;
    report(attempt, event); clearHandoff();
    setMessage('Você informou o resultado desta tentativa. Consulte o diagnóstico para conferir o registro e baixar o log.');
    if (event === 'not_opened') onHelp?.();
  }
  const button = <button type={manual ? 'submit' : 'button'} className="primary-button guide-link" disabled={!enabled || pending}
    onClick={manual ? undefined : () => void connect()} title={!enabled ? 'Aguarde o dispositivo ficar online e a atualização terminar.' : 'Abrir RustDesk neste computador'}>
    <MonitorUp size={18} aria-hidden="true" />{pending ? 'Abrindo…' : manual ? 'Conectar com esta senha' : 'Conectar'}
  </button>;
  return <div className="device-connect">
    {manual ? <form className="device-manual-form" onSubmit={(event) => void connect(event)} autoComplete="off">
      <label className="field">ID RustDesk<input value={rustdeskId ?? ''} readOnly /></label>
      <label className="field">Senha do RustDesk<input ref={passwordInput} type="password" autoComplete="new-password" maxLength={256} required disabled={pending || !enabled} /></label>
      <p>Use a senha do RustDesk desse cliente. Não é o usuário ou a senha do Windows. Ela será usada apenas para abrir o aplicativo neste computador.</p>{button}
    </form> : button}
    {message && <p role="status">{message}</p>}
    {retryAvailable && <button type="button" className="command-button" onClick={retry}>Abrir RustDesk agora</button>}
    {attempt && !pending && <div className="connection-outcomes">
      <button type="button" className="text-button" onClick={() => operatorReport('not_opened')}>RustDesk não abriu</button>
    </div>}
  </div>;
}
