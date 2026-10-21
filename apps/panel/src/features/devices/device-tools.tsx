'use client';

import type { DeviceDetailsResponse, DeviceView, ConnectionHistoryEvent } from '@appremoto/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { onSessionClear, sessionEpoch } from '../auth/session-cache';
import { ApiClientError } from '../../lib/api';
import { RustDeskServerConfig } from '../setup/rustdesk-server-config';
import { ConnectDevice } from './connect-device';
import { buildRustDeskPeerAliasPowerShellCommand, probeRustDeskApp } from './rustdesk-launch';
import { downloadConnectionLog, localEvent, stageLabels, type ConnectionLogEvent } from './connection-log';
import type { DeviceDirectoryService } from './use-devices';
import { formatLastSeen } from './device-record';
import { parseSystemInfo, resolveDeviceNetworkIps } from './system-info';
import { resolveCoherentDevicePresentation } from './device-presentation';
import { parseDeviceNotes, encodeDeviceNotes, hashDeviceAccessPassword, saveDeviceCustomMetadata } from './teamviewer-storage';

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
  const [folderName, setFolderName] = useState<string | undefined>(undefined);
  const [adminOnlyAccess, setAdminOnlyAccess] = useState(false);
  const [accessPasswordHash, setAccessPasswordHash] = useState<string | null>(null);
  const [newAccessPassword, setNewAccessPassword] = useState('');
  const [clearAccessPassword, setClearAccessPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [readError, setReadError] = useState(false);
  const [probe, setProbe] = useState('');
  const [revision, setRevision] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);
  const [copiedPublicIp, setCopiedPublicIp] = useState(false);
  const [copiedDataDivasField, setCopiedDataDivasField] = useState<string | null>(null);
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
      if (detail.status === 'fulfilled') {
        const parsed = parseDeviceNotes(detail.value.notes);
        setDetails(detail.value);
        setDisplayName(detail.value.device.displayName);
        setNotes(parsed.notes);
        setFolderName(parsed.folderName);
        setAdminOnlyAccess(parsed.adminOnlyAccess);
        setAccessPasswordHash(parsed.accessPasswordHash);
        setNewAccessPassword('');
        setClearAccessPassword(false);
      }
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
      const nextPasswordHash = newAccessPassword.trim()
        ? hashDeviceAccessPassword(newAccessPassword.trim())
        : clearAccessPassword
          ? null
          : accessPasswordHash;
      const encodedNotes = encodeDeviceNotes({
        folderName,
        adminOnlyAccess,
        accessPasswordHash: nextPasswordHash,
        notes: notes.trim(),
      });
      saveDeviceCustomMetadata(device.id, {
        displayName: displayName.trim(),
        notes: notes.trim(),
        adminOnlyAccess,
        accessPasswordHash: nextPasswordHash,
      });
      const result = await service.updateDevice(device.id, { displayName: displayName.trim(), notes: encodedNotes });
      if (!current()) return;
      setAccessPasswordHash(nextPasswordHash);
      setNewAccessPassword('');
      setClearAccessPassword(false);
      setDetails((old) => old ? { ...old, ...result } : old); setEditing(false);
      setMessage('Dados do computador atualizados.'); onSaved();
    } catch (error) { if (current() && error instanceof ApiClientError && error.status === 401 && expiredRef.current) { expiredRef.current(); return; } if (current()) setMessage(error instanceof ApiClientError && error.code === 'DEVICE_BUSY' ? 'O computador está atualizando a comunicação com o painel. Aguarde alguns segundos e salve novamente.' : 'Não foi possível salvar. Confira a conexão e sua permissão antes de tentar novamente.'); }
    finally { if (current()) setBusy(false); }
  }
  function testOpening() {
    try { probeRustDeskApp(); setProbe('Tentamos abrir o RustDesk neste computador do técnico. Confirme a abertura no navegador. Este teste não acessa o cliente.'); }
    catch { setProbe('O navegador não conseguiu abrir o RustDesk. Confira a instalação neste computador e a permissão do navegador.'); }
  }

  const currentDev = details?.device ?? device;
  const coherentPresentation = resolveCoherentDevicePresentation(currentDev);
  const targetAlias = coherentPresentation.mainTitle || currentDev.displayName || currentDev.hostname || 'SERVIDOR';
  const rustdeskAliasCommand = buildRustDeskPeerAliasPowerShellCommand(currentDev.rustdeskId, targetAlias);

  function copyAliasCommand() {
    void navigator.clipboard.writeText(rustdeskAliasCommand).then(() => {
      setCopiedCommand(true);
      setTimeout(() => setCopiedCommand(false), 3500);
    });
  }
  async function handleDelete() {
    if (!canManage || !service.deleteDevice || deleteBusy || !current()) return;
    setDeleteBusy(true); setDeleteError('');
    try {
      await service.deleteDevice(device.id);
      if (!current()) return;
      onSaved();
      onClose();
    } catch (error) {
      if (current() && error instanceof ApiClientError && error.status === 401 && expiredRef.current) {
        expiredRef.current();
        return;
      }
      if (current()) {
        setDeleteError('Não foi possível excluir o computador. Verifique sua conexão e permissões.');
        setDeleteBusy(false);
      }
    }
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
  function copyIp(ipAddress: string) {
    void navigator.clipboard.writeText(ipAddress).then(() => {
      setCopiedIp(true);
      setTimeout(() => setCopiedIp(false), 3000);
    });
  }

  function copyPublicIp(ipAddress: string) {
    void navigator.clipboard.writeText(ipAddress).then(() => {
      setCopiedPublicIp(true);
      setTimeout(() => setCopiedPublicIp(false), 3000);
    });
  }

  function copyDataDivasValue(key: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopiedDataDivasField(key);
      setTimeout(() => setCopiedDataDivasField(null), 2800);
    });
  }

  const sys = parseSystemInfo(currentDev.operatingSystem, currentDev.osVersion);
  const dd = currentDev.datadivas ?? device.datadivas;
  const { localIp, publicIp } = resolveDeviceNetworkIps({
    operatingSystem: currentDev.operatingSystem,
    osVersion: currentDev.osVersion,
    publicIp: currentDev.publicIp ?? device.publicIp,
    datadivas: dd,
  });
  const hasDataDivas = Boolean(
    dd &&
      (dd.nomeFantasia ||
        dd.razaoSocial ||
        dd.cnpj ||
        dd.serial ||
        dd.ie ||
        dd.endereco ||
        dd.cidade ||
        dd.uf ||
        dd.ipMaq ||
        dd.ipDataDivas ||
        dd.nomeMaq ||
        dd.banco ||
        dd.funcao ||
        dd.windowsHostnameDesejado ||
        dd.statusRenomeacao)
  );
  const fullAddress = dd
    ? [dd.endereco, [dd.cidade, dd.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ')
    : '';

  function copyFullDataDivasSummary() {
    if (!dd) return;
    const summaryLines = [
      `📋 FICHA CADASTRAL DATADIVAS (${currentDev.displayName})`,
      dd.nomeFantasia ? `Nome Fantasia: ${dd.nomeFantasia}` : '',
      dd.razaoSocial ? `Razão Social: ${dd.razaoSocial}` : '',
      dd.cnpj ? `CNPJ / CPF: ${dd.cnpj}` : '',
      dd.funcao ? `Função no CNPJ: ${dd.funcao}` : '',
      dd.windowsHostnameDesejado ? `Hostname Desejado: ${dd.windowsHostnameDesejado} (${dd.statusRenomeacao || 'CONFIRMADO'})` : '',
      dd.serial ? `Serial: ${dd.serial}` : '',
      `IE: ${dd.ie || 'Não informado'}`,
      fullAddress ? `Endereço: ${fullAddress}` : '',
      dd.ipMaq || dd.nomeMaq ? `IP Máquina: ${dd.ipMaq || '—'}${dd.nomeMaq ? ` (${dd.nomeMaq})` : ''}` : '',
      dd.ipDataDivas ? `IP DataDivas: ${dd.ipDataDivas}${dd.banco ? ` (${dd.banco})` : ''}` : '',
      `RustDesk ID: ${currentDev.rustdeskId}`,
    ].filter(Boolean);
    copyDataDivasValue('all', summaryLines.join('\n'));
  }

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

      {/* Card com Especificações Técnicas do PC para o Técnico */}
      <div className="device-spec-card">
        <div className="device-spec-item">
          <span className="spec-label">Sistema Operacional</span>
          <div className="spec-val-row">
            <span className={`tv-badge-os ${sys.badge.toLowerCase().replace(/\s+/g, '')}`}>
              {sys.badge}
            </span>
            <strong className="spec-val">{sys.osName}</strong>
          </div>
        </div>

        <div className="device-spec-item">
          <span className="spec-label">Edição / Compilação</span>
          <strong className="spec-val">{sys.versionLabel || 'Padrão'}</strong>
        </div>

        <div className="device-spec-item">
          <span className="spec-label">Endereço IP Local</span>
          <div className="spec-ip-box">
            <strong className="spec-val">{localIp || 'Não detectado'}</strong>
            {localIp && (
              <button
                type="button"
                className="spec-copy-btn"
                title="Copiar IP Local"
                onClick={() => copyIp(localIp)}
              >
                {copiedIp ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedIp ? 'Copiado!' : 'Copiar'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="device-spec-item">
          <span className="spec-label">Endereço IP Público</span>
          <div className="spec-ip-box">
            <strong className="spec-val">{publicIp || 'Não detectado'}</strong>
            {publicIp && (
              <button
                type="button"
                className="spec-copy-btn"
                title="Copiar IP Público"
                onClick={() => copyPublicIp(publicIp)}
              >
                {copiedPublicIp ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedPublicIp ? 'Copiado!' : 'Copiar'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="device-spec-item">
          <span className="spec-label">Hostname da Máquina</span>
          <strong className="spec-val">{currentDev.hostname}</strong>
        </div>
      </div>

      {/* Card com Dados Cadastrais do Cliente lidos de C:\DataDivas\config.ini */}
      {hasDataDivas && dd && (
        <section className="datadivas-client-card" aria-label="Dados cadastrais DataDivas">
          <div className="datadivas-card-header">
            <div className="datadivas-card-title-group">
              <span className="datadivas-card-badge">C:\DataDivas\config.ini</span>
              <h3>Dados Cadastrais do Cliente (DataDivas)</h3>
            </div>
            <button
              type="button"
              className="spec-copy-btn"
              onClick={copyFullDataDivasSummary}
              title="Copiar todos os dados cadastrais do cliente"
            >
              {copiedDataDivasField === 'all' ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedDataDivasField === 'all' ? 'Ficha copiada!' : 'Copiar Ficha Completa'}</span>
            </button>
          </div>

          <div className="datadivas-grid">
            <div className="datadivas-field">
              <span className="spec-label">Nome Fantasia</span>
              <strong className="spec-val">{dd.nomeFantasia || '—'}</strong>
            </div>

            <div className="datadivas-field">
              <span className="spec-label">Razão Social</span>
              <strong className="spec-val">{dd.razaoSocial || '—'}</strong>
            </div>

            <div className="datadivas-field">
              <span className="spec-label">CNPJ / CPF</span>
              <div className="spec-ip-box">
                <strong className="spec-val mono">{dd.cnpj || '—'}</strong>
                {dd.cnpj && (
                  <button
                    type="button"
                    className="spec-copy-btn"
                    onClick={() => copyDataDivasValue('cnpj', dd.cnpj!)}
                  >
                    {copiedDataDivasField === 'cnpj' ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedDataDivasField === 'cnpj' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="datadivas-field">
              <span className="spec-label">Serial DataDivas</span>
              <div className="spec-ip-box">
                <strong className="spec-val mono">{dd.serial || '—'}</strong>
                {dd.serial && (
                  <button
                    type="button"
                    className="spec-copy-btn"
                    onClick={() => copyDataDivasValue('serial', dd.serial!)}
                  >
                    {copiedDataDivasField === 'serial' ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedDataDivasField === 'serial' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="datadivas-field">
              <span className="spec-label">Inscrição Estadual (IE)</span>
              <strong className="spec-val mono">{dd.ie || 'Isento / Não informado'}</strong>
            </div>

            <div className="datadivas-field">
              <span className="spec-label">Endereço Completo</span>
              <strong className="spec-val">{fullAddress || '—'}</strong>
            </div>

            <div className="datadivas-field">
              <span className="spec-label">IP Máquina (ipmaq / nomemaq)</span>
              <div className="spec-ip-box">
                <strong className="spec-val mono">
                  {dd.ipMaq || sys.ip || '—'}
                  {dd.nomeMaq ? ` (${dd.nomeMaq})` : ''}
                </strong>
                {(dd.ipMaq || sys.ip) && (
                  <button
                    type="button"
                    className="spec-copy-btn"
                    onClick={() => copyDataDivasValue('ipMaq', (dd.ipMaq || sys.ip)!)}
                  >
                    {copiedDataDivasField === 'ipMaq' ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedDataDivasField === 'ipMaq' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="datadivas-field">
              <span className="spec-label">IP Servidor DataDivas</span>
              <div className="spec-ip-box">
                <strong className="spec-val mono" title={dd.banco || undefined}>
                  {dd.ipDataDivas || '—'}
                </strong>
                {dd.ipDataDivas && (
                  <button
                    type="button"
                    className="spec-copy-btn"
                    onClick={() => copyDataDivasValue('ipDataDivas', dd.ipDataDivas!)}
                  >
                    {copiedDataDivasField === 'ipDataDivas' ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedDataDivasField === 'ipDataDivas' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                )}
              </div>
              {dd.banco && <small className="datadivas-db-subtext">Banco: {dd.banco}</small>}
            </div>

            <div className="datadivas-field">
              <span className="spec-label">Função Padronizada no CNPJ</span>
              <strong className="spec-val mono">{dd.funcao || '—'}</strong>
            </div>

            <div className="datadivas-field">
              <span className="spec-label">Renomeação Real do Windows</span>
              <strong className="spec-val">
                {dd.statusRenomeacao === 'APLICADO_AGUARDANDO_REBOOT' || dd.statusRenomeacao === 'PENDING_REBOOT'
                  ? `⏳ Reinício Pendente (${dd.windowsHostnameDesejado || 'Windows'})`
                  : dd.statusRenomeacao === 'CONFIRMADO' || dd.statusRenomeacao === 'COMPLETED'
                    ? `✅ Concluído (${dd.windowsHostnameDesejado || currentDev.hostname})`
                    : dd.statusRenomeacao === 'BLOCKED_DOMAIN'
                      ? '🔒 Bloqueado (Domínio AD)'
                      : dd.statusRenomeacao === 'ERRO' || dd.statusRenomeacao === 'FAILED'
                        ? `⚠️ Falhou (${dd.erroRenomeacao || 'Erro'})`
                        : 'Não solicitado'}
              </strong>
            </div>
          </div>
        </section>
      )}

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

        <div className="rustdesk-alias-box">
          <h4>Exibição do apelido nas abas do RustDesk ({targetAlias})</h4>
          <p>
            O painel envia automaticamente o apelido concatenado <strong>{targetAlias}</strong> no link de conexão. Para gravar este nome diretamente na configuração local das abas do RustDesk neste computador:
          </p>
          <ol className="connection-checklist" style={{ margin: '4px 0', paddingLeft: '20px' }}>
            <li>Com a ponte de protocolo ativa no Windows, o apelido <strong>{targetAlias}</strong> já aparece automaticamente na aba da sessão ao clicar em Conectar.</li>
            <li>Ou execute este comando rápido no PowerShell para gravar o apelido desta máquina imediatamente:</li>
          </ol>
          <div className="rustdesk-alias-code-wrap">
            <code className="rustdesk-alias-code">{rustdeskAliasCommand}</code>
            <div className="device-inline-actions">
              <button type="button" className="command-button" onClick={copyAliasCommand}>
                {copiedCommand ? <><Check size={16} aria-hidden="true" /> Comando copiado!</> : <><Copy size={16} aria-hidden="true" /> Copiar comando PowerShell</>}
              </button>
              {copiedCommand && <span className="copy-feedback-badge">Copiado para a área de transferência!</span>}
            </div>
          </div>
        </div>

        <details className="connection-server-help"><summary>Abriu, mas não conectou?</summary><p>O acesso pelo painel já inclui o servidor XPoint. Se você conectar digitando o ID diretamente no RustDesk, confira os mesmos dados de servidor nos dois computadores.</p><RustDeskServerConfig /></details>
      </section>
      <section className="device-tools-section"><h3>Conectar com senha</h3>
        {device.status !== 'ONLINE' && <p>O agente está offline no painel. Você ainda pode tentar a senha manual se o RustDesk do cliente estiver aberto e pronto.</p>}
        {service.connectDevice && canConnect ? <ConnectDevice deviceId={device.id} rustdeskId={device.rustdeskId} peerAlias={targetAlias} manual enabled={device.enabled}
          service={{ connectDevice: service.connectDevice, recordConnectionEvent: service.recordConnectionEvent }} onEvent={onEvent} onSessionExpired={onSessionExpired} />
          : <p>Seu perfil não tem permissão para iniciar conexões neste cliente.</p>}
      </section>
      <section className="device-tools-section"><div className="device-section-heading"><h3>Informações do computador</h3>
        {canManage && service.updateDevice && details && !editing && <button className="command-button" type="button" onClick={() => setEditing(true)}>Editar informações</button>}</div>
        {editing ? <form className="device-edit-form" onSubmit={(event) => void save(event)}>
          <label className="field">Nome do computador<input value={displayName} required maxLength={128} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="field">Observações<textarea value={notes} maxLength={2048} rows={4} disabled={busy} onChange={(event) => setNotes(event.target.value)} /></label>
          <p>Use para contato, localização e instruções de atendimento. Não inclua senhas.</p>
          <label className="field">Senha de Acesso ao Conectar (opcional)
            <input
              type="password"
              value={newAccessPassword}
              disabled={busy}
              placeholder={accessPasswordHash && !clearAccessPassword ? 'Digite nova senha para alterar (ou deixe em branco para manter)...' : 'Definir senha de acesso ao clicar em Conectar...'}
              onChange={(event) => {
                setNewAccessPassword(event.target.value);
                if (event.target.value.trim()) setClearAccessPassword(false);
              }}
            />
          </label>
          {accessPasswordHash && !clearAccessPassword && (
            <div>
              <button type="button" className="command-button" disabled={busy} onClick={() => { setClearAccessPassword(true); setNewAccessPassword(''); }}>
                Remover senha de acesso atual
              </button>
            </div>
          )}
          <label className="field" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={adminOnlyAccess} disabled={busy} onChange={(event) => setAdminOnlyAccess(event.target.checked)} />
            <span>Acesso restrito somente a Administrador</span>
          </label>
          <div className="device-inline-actions"><button className="primary-button" disabled={busy || !canManage || !displayName.trim()} type="submit">Salvar alterações</button>
          <button className="command-button" type="button" disabled={busy} onClick={() => {
            const parsed = parseDeviceNotes(details?.notes ?? '');
            setEditing(false);
            setDisplayName(details?.device.displayName ?? device.displayName);
            setNotes(parsed.notes);
            setAdminOnlyAccess(parsed.adminOnlyAccess);
            setAccessPasswordHash(parsed.accessPasswordHash);
            setNewAccessPassword('');
            setClearAccessPassword(false);
          }}>Cancelar edição</button></div>
        </form> : <><p className="device-notes">{parseDeviceNotes(details?.notes).notes || 'Nenhuma observação cadastrada.'}</p><p>Agente: {device.agentVersion ?? 'não informado'} · RustDesk: {device.rustdeskVersion ?? 'não informado'}</p></>}
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

      {canManage && service.deleteDevice && (
        <section className="device-tools-section">
          <div className="device-section-heading">
            <h3>Zona de exclusão</h3>
          </div>
          <div className="danger-zone">
            <h4>Excluir computador do portal</h4>
            <p>
              Remove permanentemente <strong>{device.displayName}</strong> ({device.hostname}) da lista de computadores e revoga imediatamente todas as credenciais de acesso remoto do agente.
            </p>
            {!confirmDelete ? (
              <div>
                <button
                  type="button"
                  className="danger-outline-button"
                  disabled={busy || deleteBusy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Excluir computador...
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                <p style={{ color: 'var(--danger)', fontWeight: 600 }}>
                  Tem certeza que deseja excluir permanentemente este computador? Esta ação não pode ser desfeita.
                </p>
                {deleteError && <p className="field-error" role="alert">{deleteError}</p>}
                <div className="device-inline-actions">
                  <button
                    type="button"
                    className="danger-button"
                    disabled={deleteBusy}
                    onClick={() => void handleDelete()}
                  >
                    {deleteBusy ? 'Excluindo...' : 'Confirmar exclusão definitiva'}
                  </button>
                  <button
                    type="button"
                    className="command-button"
                    disabled={deleteBusy}
                    onClick={() => { setConfirmDelete(false); setDeleteError(''); }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  </div>;
}
