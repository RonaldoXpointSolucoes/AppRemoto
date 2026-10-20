'use client';

import { verifyDeviceAccessPassword, type ConnectionEventInput, type ConnectionMode } from '@appremoto/contracts';
import { KeyRound, Lock, MonitorUp, ShieldAlert, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../../lib/api';
import { onSessionClear, sessionEpoch } from '../auth/session-cache';
import { launchRustDesk, manualRustDeskUri } from './rustdesk-launch';
import { localEvent, safeConnectionCode, type ConnectionLogEvent } from './connection-log';

export interface ConnectionService {
  connectDevice(deviceId: string, options: { mode: ConnectionMode; attemptId: string; accessCode?: string }): Promise<{ launchUri: string; attemptId?: string; mode?: ConnectionMode }>;
  recordConnectionEvent?(deviceId: string, input: ConnectionEventInput): Promise<{ recorded: boolean }>;
}
interface Attempt { attemptId: string; mode: ConnectionMode }
const handoffLifetimeMs = 30_000;
export function ConnectDevice({
  deviceId,
  enabled,
  service,
  manual = false,
  rustdeskId,
  peerAlias,
  requiresAccessPassword = false,
  accessPasswordHash = null,
  adminOnlyBlocked = false,
  deviceDisplayName,
  onEvent,
  onHelp,
  onSessionExpired,
  onConnectStarted,
  trigger,
}: {
  deviceId: string;
  enabled: boolean;
  service: ConnectionService;
  manual?: boolean;
  rustdeskId?: string;
  peerAlias?: string;
  requiresAccessPassword?: boolean;
  accessPasswordHash?: string | null;
  adminOnlyBlocked?: boolean;
  deviceDisplayName?: string;
  onEvent?(event: ConnectionLogEvent): void;
  onHelp?(): void;
  onSessionExpired?(): void;
  onConnectStarted?(): void;
  trigger?: (props: { connect: () => void; pending: boolean; enabled: boolean }) => React.ReactNode;
}) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>();
  const [dismissed, setDismissed] = useState(false);
  const [isErrorFeedback, setIsErrorFeedback] = useState(false);
  const [isAccessModalOpen, setIsAccessModalOpen] = useState(false);
  const [typedAccessPassword, setTypedAccessPassword] = useState('');
  const [accessPasswordError, setAccessPasswordError] = useState('');
  const passwordInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const active = useRef(false);
  const scope = useRef({ deviceId, epoch: sessionEpoch(client) });
  const handoff = useRef<{ uri: string; until: number; attempt: Attempt } | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const events = useRef(onEvent); events.current = onEvent;
  const currentEnabled = useRef(enabled); currentEnabled.current = enabled;
  function valid() { return active.current && sessionEpoch(client) === scope.current.epoch; }
  function clearHandoff() { handoff.current = undefined; clearTimeout(timer.current); setRetryAvailable(false); }
  function clearPassword() { if (passwordInput.current) passwordInput.current.value = ''; }
  useEffect(() => {
    scope.current = { deviceId, epoch: sessionEpoch(client) }; active.current = true;
    lock.current = false; clearHandoff(); clearPassword(); setAttempt(undefined); setMessage(''); setPending(false); setDismissed(false); setIsErrorFeedback(false);
    clearTimeout(autoDismissTimer.current);
    const remove = onSessionClear(client, () => {
      active.current = false; clearHandoff(); clearPassword(); setAttempt(undefined); setMessage(''); setPending(false); setDismissed(false); setIsErrorFeedback(false);
      clearTimeout(autoDismissTimer.current);
    });
    return () => {
      active.current = false; remove(); handoff.current = undefined; clearTimeout(timer.current); clearTimeout(autoDismissTimer.current); clearPassword();
    };
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
  function dismissFeedback(e?: React.MouseEvent) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    clearTimeout(autoDismissTimer.current);
    clearHandoff();
    setDismissed(true);
    setIsErrorFeedback(false);
    setMessage('');
    setAttempt(undefined);
  }
  function launch(current: Attempt, uri: string) {
    if (!valid() || !currentEnabled.current) return;
    try {
      launchRustDesk(uri, peerAlias); report(current, 'launch_requested');
      setIsErrorFeedback(false);
      onConnectStarted?.();
      setMessage('Tentamos abrir o RustDesk neste computador do técnico. Confirme a abertura no navegador. A sessão ainda não foi confirmada.');
      clearTimeout(autoDismissTimer.current);
      autoDismissTimer.current = setTimeout(() => {
        if (valid()) {
          setDismissed(true);
          setMessage('');
        }
      }, 15_000);
    } catch {
      report(current, 'launch_failed');
      setIsErrorFeedback(true);
      setMessage('O navegador não conseguiu abrir o RustDesk. Use as instruções abaixo.');
    }
  }
  async function executeConnect(event?: FormEvent, verifiedAccessCode?: string) {
    event?.preventDefault();
    if (!enabled || lock.current || !valid()) return;
    if (manual && !passwordInput.current?.value) return;
    lock.current = true; clearHandoff(); setPending(true); setMessage(''); setDismissed(false); setIsErrorFeedback(false);
    clearTimeout(autoDismissTimer.current);
    const current: Attempt = { attemptId: crypto.randomUUID(), mode: manual ? 'manual' : 'automatic' };
    const expected = scope.current;
    setAttempt(undefined); append(localEvent(current.attemptId, current.mode, 'authorization_requested', 'AUTHORIZATION_REQUESTED'));
    try {
      const payload = verifiedAccessCode ? { ...current, accessCode: verifiedAccessCode } : current;
      const result = await service.connectDevice(deviceId, payload);
      try {
        if (!valid() || scope.current !== expected || !currentEnabled.current) return;
        if ((result.attemptId && result.attemptId !== current.attemptId) || (result.mode && result.mode !== current.mode)) throw new Error('Invalid attempt');
        let uri = manual ? manualRustDeskUri(result.launchUri, passwordInput.current?.value ?? '', peerAlias) : result.launchUri;
        clearPassword(); setAttempt(current);
        handoff.current = { uri, until: Date.now() + handoffLifetimeMs, attempt: current };
        setRetryAvailable(true); timer.current = setTimeout(clearHandoff, handoffLifetimeMs);
        launch(current, uri); uri = '';
      } finally { result.launchUri = ''; }
    } catch (error) {
      if (valid() && scope.current === expected) {
        if (error instanceof ApiClientError && error.status === 401 && onSessionExpired) { onSessionExpired(); return; }
        append(localEvent(current.attemptId, current.mode, 'rejected', safeConnectionCode(error)));
        setIsErrorFeedback(true);
        if (error instanceof ApiClientError && error.status === 403) {
          setMessage(
            requiresAccessPassword
              ? 'Senha de acesso incorreta ou permissão negada para este computador.'
              : 'Acesso restrito: este computador só pode ser acessado por um Administrador.'
          );
        } else {
          setMessage('Não foi possível iniciar o acesso. Abra os detalhes e consulte o diagnóstico desta tentativa.');
        }
      }
    } finally { if (scope.current === expected) { clearPassword(); lock.current = false; if (valid()) setPending(false); } }
  }
  function connect(event?: FormEvent) {
    event?.preventDefault();
    if (!enabled || lock.current || !valid()) return;
    if (adminOnlyBlocked) {
      setDismissed(false);
      setIsErrorFeedback(true);
      setMessage('Acesso restrito: este computador está configurado para acesso somente por Administrador.');
      return;
    }
    if (!manual && requiresAccessPassword) {
      setTypedAccessPassword('');
      setAccessPasswordError('');
      setIsAccessModalOpen(true);
      return;
    }
    void executeConnect(event);
  }
  function handleConfirmAccessPassword(e: FormEvent) {
    e.preventDefault();
    const trimmed = typedAccessPassword.trim();
    if (!trimmed) {
      setAccessPasswordError('Informe a senha de acesso para continuar.');
      return;
    }
    if (accessPasswordHash && !verifyDeviceAccessPassword(trimmed, accessPasswordHash)) {
      setAccessPasswordError('Senha de acesso incorreta. Verifique e tente novamente.');
      return;
    }
    setIsAccessModalOpen(false);
    setTypedAccessPassword('');
    setAccessPasswordError('');
    void executeConnect(undefined, trimmed);
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
    if (event === 'not_opened' || event === 'session_failed') setIsErrorFeedback(true);
    setMessage('Você informou o resultado desta tentativa. Consulte o diagnóstico para conferir o registro e baixar o log.');
    if (event === 'not_opened') onHelp?.();
  }
  const defaultButton = <button type={manual ? 'submit' : 'button'} className="primary-button guide-link" disabled={!enabled || pending}
    onClick={manual ? undefined : () => void connect()} title={!enabled ? 'Aguarde o dispositivo ficar online e a atualização terminar.' : 'Abrir RustDesk neste computador'}>
    <MonitorUp size={18} aria-hidden="true" />{pending ? 'Abrindo…' : manual ? 'Conectar com esta senha' : 'Conectar'}
  </button>;
  const button = (!manual && trigger) ? trigger({ connect: () => void connect(), pending, enabled }) : defaultButton;
  const hasFeedback = !dismissed && Boolean(message || retryAvailable || (attempt && !pending));
  return <div className="device-connect">
    {manual ? <form className="device-manual-form" onSubmit={(event) => void connect(event)} autoComplete="off">
      <label className="field">ID RustDesk<input value={rustdeskId ?? ''} readOnly /></label>
      <label className="field">Senha do RustDesk<input ref={passwordInput} type="password" autoComplete="new-password" maxLength={256} required disabled={pending || !enabled} /></label>
      <p>Use a senha do RustDesk desse cliente. Não é o usuário ou a senha do Windows. Ela será usada apenas para abrir o aplicativo neste computador.</p>{button}
    </form> : button}
    {hasFeedback && (
      <div
        className={`connection-feedback-card ${isErrorFeedback ? 'is-error-only' : 'is-routine-handoff'}`}
        role="region"
        aria-label="Status da tentativa de conexão"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="connection-feedback-header">
          <span className="connection-feedback-title">Status da Conexão</span>
          <button
            type="button"
            className="connection-feedback-close"
            onClick={dismissFeedback}
            title="Fechar aviso de conexão"
            aria-label="Fechar aviso de conexão"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        {message && <p role="status">{message}</p>}
        {retryAvailable && <button type="button" className="command-button" onClick={retry}>Abrir RustDesk agora</button>}
        {attempt && !pending && (
          <div className="connection-outcomes">
            <button
              type="button"
              className="text-button"
              onClick={(e) => {
                e.stopPropagation();
                operatorReport('not_opened');
              }}
            >
              RustDesk não abriu
            </button>
            <button
              type="button"
              className="connection-feedback-dismiss-btn"
              onClick={dismissFeedback}
              title="Fechar este aviso"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    )}
    {isAccessModalOpen && (
      <div
        className="tv-modal-backdrop"
        onClick={(e) => {
          e.stopPropagation();
          setIsAccessModalOpen(false);
        }}
      >
        <div
          className="tv-modal-card sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`access-pwd-title-${deviceId}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="tv-modal-header">
            <div className="tv-modal-title-wrap">
              <KeyRound size={18} className="text-amber-400" />
              <h3 id={`access-pwd-title-${deviceId}`}>Senha de Acesso</h3>
            </div>
            <button
              type="button"
              className="tv-modal-close-btn"
              onClick={() => setIsAccessModalOpen(false)}
              aria-label="Fechar solicitação de senha"
            >
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleConfirmAccessPassword} className="tv-modal-body">
            <p style={{ margin: '0 0 10px 0', fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              A estação <strong>{deviceDisplayName || peerAlias || 'selecionada'}</strong> está protegida por senha de acesso. Digite a senha abaixo para iniciar a conexão remota:
            </p>
            {accessPasswordError && (
              <div className="tv-modal-error" role="alert" style={{ marginBottom: 10 }}>
                {accessPasswordError}
              </div>
            )}
            <div className="tv-form-field">
              <label htmlFor={`access-pwd-input-${deviceId}`} className="tv-field-label">
                Senha de Acesso da Máquina:
              </label>
              <input
                id={`access-pwd-input-${deviceId}`}
                type="password"
                className="tv-text-input"
                value={typedAccessPassword}
                onChange={(e) => {
                  setTypedAccessPassword(e.target.value);
                  if (accessPasswordError) setAccessPasswordError('');
                }}
                placeholder="Digite a senha de acesso..."
                autoFocus
                autoComplete="off"
                required
              />
            </div>
            <div className="tv-modal-actions">
              <button
                type="button"
                className="tv-btn-secondary"
                onClick={() => setIsAccessModalOpen(false)}
              >
                Cancelar
              </button>
              <button type="submit" className="tv-btn-primary">
                <Lock size={15} />
                <span>Conectar Agora</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
  </div>;
}
