'use client';

import type { DeviceDetailsResponse, DeviceView, ConnectionHistoryEvent } from '@appremoto/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onSessionClear, sessionEpoch } from '../auth/session-cache';
import { ApiClientError } from '../../lib/api';
import { RustDeskServerConfig } from '../setup/rustdesk-server-config';
import { ConnectDevice } from './connect-device';
import { downloadConnectionLog, localEvent, stageLabels, type ConnectionLogEvent } from './connection-log';
import type { DeviceDirectoryService } from './use-devices';
import { formatLastSeen } from './device-record';

export function DeviceTools({ device, service, canConnect, canManage, events, onEvent, onClose, onSaved, onSessionExpired }: {
  device: DeviceView; service: DeviceDirectoryService; canConnect: boolean; canManage: boolean;
  events: ConnectionLogEvent[]; onEvent(event: ConnectionLogEvent): void; onClose(): void; onSaved(): void; onSessionExpired?(): void;
}) {
  const client = useQueryClient();
  const [epoch] = useState(() => sessionEpoch(client));
  const panel = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<DeviceDetailsResponse>();
  const [history, setHistory] = useState<ConnectionHistoryEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(device.displayName);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [readError, setReadError] = useState(false);
  const [probe, setProbe] = useState('');
  const [revision, setRevision] = useState(0);
  const active = useRef(true);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const expiredRef = useRef(onSessionExpired); expiredRef.current = onSessionExpired;
  const eventRef = useRef(onEvent); eventRef.current = onEvent;
  useEffect(() => {
    active.current = true;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const unsubscribe = onSessionClear(client, () => {
      active.current = false; setDetails(undefined); setHistory([]); setNotes(''); setDisplayName(''); closeRef.current();
    });
    return () => { active.current = false; unsubscribe(); previous?.focus(); };
  }, [client]);
  const current = () => active.current && epoch === sessionEpoch(client);
  useEffect(() => {
    let cancelled = false;
    setReadError(false); setBusy(true);
    void Promise.allSettled([service.getDeviceDetails!(device.id), service.getConnectionHistory!(device.id)]).then(([detail, log]) => {
      if (cancelled || !active.current || epoch !== sessionEpoch(client)) return;
      if ([detail, log].some((result) => result.status === 'rejected' && result.reason instanceof ApiClientError && result.reason.status === 401) && expiredRef.current) { expiredRef.current(); return; }
      if (detail.status === 'fulfilled') { setDetails(detail.value); setDisplayName(detail.value.device.displayName); setNotes(detail.value.notes); }
      else { setReadError(true); eventRef.current(localEvent(crypto.randomUUID(), 'automatic', 'details_unavailable', 'DETAILS_UNAVAILABLE')); }
      if (log.status === 'fulfilled') setHistory(log.value.events);
      else { setReadError(true); eventRef.current(localEvent(crypto.randomUUID(), 'automatic', 'history_unavailable', 'HISTORY_UNAVAILABLE')); }
      setBusy(false);
    });
    return () => { cancelled = true; };
  }, [client, device.id, epoch, revision, service]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !service.updateDevice || busy || !current()) return;
    setBusy(true); setMessage('');
    try {
      const result = await service.updateDevice(device.id, { displayName: displayName.trim(), notes: notes.trim() });
      if (!current()) return;
      setDetails((old) => old ? { ...old, ...result } : old); setEditing(false);
      setMessage('Dados do computador atualizados.'); onSaved();
    } catch (error) { if (current() && error instanceof ApiClientError && error.status === 401 && expiredRef.current) { expiredRef.current(); return; } if (current()) setMessage(error instanceof ApiClientError && error.code === 'DEVICE_BUSY' ? 'O computador está atualizando a comunicação com o painel. Aguarde alguns segundos e salve novamente.' : 'Não foi possível salvar. Confira a conexão e sua permissão antes de tentar novamente.'); }
    finally { if (current()) setBusy(false); }
  }
  function testOpening() {
    try { window.location.assign('rustdesk://'); setProbe('Tentamos abrir o RustDesk neste computador do técnico. Confirme a abertura no navegador. Este teste não acessa o cliente.'); }
    catch { setProbe('O navegador não conseguiu abrir o RustDesk. Confira a instalação neste computador e a permissão do navegador.'); }
  }
  const merged = new Map<string, ConnectionLogEvent>();
  for (const event of [...events, ...history]) merged.set(`${event.attemptId}:${event.source}:${event.stage}:${event.code}`, event);
  const allEvents = [...merged.values()].sort((a, b) => b.at.localeCompare(a.at));
  const latestLocalAttempt = events.findLast((event) => event.stage === 'launch_requested' || event.stage === 'launch_failed');
  function reportOutcome(event: 'session_confirmed' | 'session_failed') {
    if (!latestLocalAttempt || !canConnect || !current() || !service.recordConnectionEvent) return;
    const { attemptId, mode } = latestLocalAttempt;
    onEvent(localEvent(attemptId, mode, event, event === 'session_confirmed' ? 'OPERATOR_SESSION_CONFIRMED' : 'OPERATOR_SESSION_FAILED', 'operator'));
    void service.recordConnectionEvent(device.id, { attemptId, mode, event }).catch((error) => {
      if (current() && error instanceof ApiClientError && error.status === 401 && expiredRef.current) { expiredRef.current(); return; }
      if (current()) onEvent(localEvent(attemptId, mode, 'event_not_saved', 'EVENT_NOT_SAVED'));
    });
  }
  const checks = details?.diagnostics;
  return <div className="device-dialog-backdrop">
    <div ref={panel} className="device-dialog" role="dialog" aria-modal="true" aria-label={details?.device.displayName ?? device.displayName} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], summary') ?? []);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="device-dialog-header"><div><p className="product-name">Detalhes do computador</p><h2>{details?.device.displayName ?? device.displayName}</h2></div>
        <button className="command-button" type="button" onClick={onClose}>Fechar</button></header>
      <p className="device-tools-context">{device.hostname} · {device.organizationName} · ID RustDesk {device.rustdeskId}</p>
      {busy && <p role="status">Atualizando dados…</p>}
      {readError && <p role="alert">Parte do diagnóstico não pôde ser carregada. O log local continua disponível.</p>}
      <section className="device-tools-section"><h3>Preparar o computador do técnico</h3>
        <p>O RustDesk precisa estar instalado <strong>nos dois computadores</strong>. O botão Conectar abre o aplicativo neste computador, onde você está usando o painel.</p>
        <ol className="connection-checklist">
          <li>Instale o <a href="https://rustdesk.com/" target="_blank" rel="noreferrer">RustDesk no computador do técnico</a> e abra-o uma vez.</li>
          <li>Teste a abertura abaixo e autorize o navegador a abrir o RustDesk.</li>
          <li>Volte ao painel e clique em Conectar. A máquina do cliente deve estar ligada e com o RustDesk pronto.</li>
        </ol>
        <p>Depois de conectar, para ajustar a imagem à janela, abra o menu de exibição da sessão RustDesk e selecione <strong>Escala adaptada (Scale adaptive)</strong>.</p>
        <button type="button" className="command-button" onClick={testOpening}>Testar abertura do RustDesk</button>
        {probe && <p role="status">{probe}</p>}
        <details className="connection-server-help"><summary>Abriu, mas não conectou?</summary><p>O acesso pelo painel já inclui o servidor XPoint. Se você conectar digitando o ID diretamente no RustDesk, confira os mesmos dados de servidor nos dois computadores.</p><RustDeskServerConfig /></details>
      </section>
      <section className="device-tools-section"><h3>Conectar com senha</h3>
        {device.status !== 'ONLINE' && <p>O agente está offline no painel. Você ainda pode tentar a senha manual se o RustDesk do cliente estiver aberto e pronto.</p>}
        {service.connectDevice && canConnect ? <ConnectDevice deviceId={device.id} rustdeskId={device.rustdeskId} manual enabled={device.enabled}
          service={{ connectDevice: service.connectDevice, recordConnectionEvent: service.recordConnectionEvent }} onEvent={onEvent} onSessionExpired={onSessionExpired} />
          : <p>Seu perfil não tem permissão para iniciar conexões neste cliente.</p>}
      </section>
      <section className="device-tools-section"><div className="device-section-heading"><h3>Informações do computador</h3>
        {canManage && service.updateDevice && details && !editing && <button className="command-button" type="button" onClick={() => setEditing(true)}>Editar informações</button>}</div>
        {editing ? <form className="device-edit-form" onSubmit={(event) => void save(event)}>
          <label className="field">Nome do computador<input value={displayName} required maxLength={128} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="field">Observações<textarea value={notes} maxLength={2048} rows={4} disabled={busy} onChange={(event) => setNotes(event.target.value)} /></label>
          <p>Use para contato, localização e instruções de atendimento. Não inclua senhas.</p>
          <div className="device-inline-actions"><button className="primary-button" disabled={busy || !canManage || !displayName.trim()} type="submit">Salvar alterações</button>
          <button className="command-button" type="button" disabled={busy} onClick={() => { setEditing(false); setDisplayName(details?.device.displayName ?? device.displayName); setNotes(details?.notes ?? ''); }}>Cancelar edição</button></div>
        </form> : <><p className="device-notes">{details?.notes || 'Nenhuma observação cadastrada.'}</p><p>Agente: {device.agentVersion ?? 'não informado'} · RustDesk: {device.rustdeskVersion ?? 'não informado'}</p></>}
        {message && <p role="status">{message}</p>}
      </section>
      <section className="device-tools-section"><div className="device-section-heading"><h3>Diagnóstico e tentativas</h3>
        <button type="button" className="command-button" disabled={busy || editing} onClick={() => setRevision((value) => value + 1)}>Atualizar diagnóstico</button></div>
        <p><strong>ONLINE confirma a comunicação do agente com o painel.</strong> Não confirma que o RustDesk do técnico abriu nem que uma sessão remota foi estabelecida.</p>
        {checks && <ul className="diagnostic-checks">
          <li>{checks.agentOnline ? '✓' : '—'} Agente online</li><li>{checks.heartbeatConfirmed ? '✓' : '—'} Comunicação confirmada pela API</li>
          <li>{checks.rustdeskIdValid ? '✓' : '—'} ID RustDesk válido</li><li>{checks.credentialAvailable ? '✓' : '—'} Credencial para um clique disponível</li>
        </ul>}
        <p>API: autorização. Navegador: tentativa de abrir. Técnico: resultado informado por quem fez o acesso. Nenhum desses eventos, sozinho, comprova uma sessão remota.</p>
        {latestLocalAttempt && canConnect && service.recordConnectionEvent && <div className="device-inline-actions" aria-label="Resultado da última tentativa neste navegador">
          <button className="command-button" type="button" onClick={() => reportOutcome('session_confirmed')}>Consegui conectar</button>
          <button className="command-button" type="button" onClick={() => reportOutcome('session_failed')}>Abriu, mas não conectou</button>
        </div>}
        <button className="command-button" type="button" onClick={() => downloadConnectionLog(device.id, allEvents)}>Baixar log de conexão</button>
        {allEvents.length === 0 ? <p>Nenhuma tentativa registrada.</p> : <ol className="connection-history">{allEvents.map((event) => <li key={`${event.source}-${event.id}`}>
          <strong>{stageLabels[event.stage] ?? 'Tentativa registrada'}</strong><span>{formatLastSeen(event.at)} · {event.mode === 'manual' ? 'Com senha' : 'Um clique'} · {event.source === 'api' ? 'API' : event.source === 'operator' ? 'Técnico' : event.source === 'browser' ? 'Navegador' : 'Local'}</span>
          <code>{event.code}</code><small>Tentativa: {event.attemptId}</small>
        </li>)}</ol>}
        <p>O arquivo contém códigos e horários, sem senhas, links de acesso ou tokens. Eventos ainda não salvos na API ficam apenas nesta página até encerrar a sessão ou recarregar.</p>
      </section>
    </div>
  </div>;
}
