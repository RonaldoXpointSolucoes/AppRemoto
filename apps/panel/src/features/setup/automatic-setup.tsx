'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { EnrollmentStatusResponse } from '@appremoto/contracts';
import { Download, CheckCircle2, LoaderCircle } from 'lucide-react';
import Link from 'next/link';

import { ApiClientError, createApiClient, type OrganizationView } from '../../lib/api';
import { createAppwriteSessionClient } from '../../lib/appwrite';
import { getPublicConfig } from '../../lib/config';
import { expireSession, sessionEpoch } from '../auth/session-cache';
import { isDisabledProfile } from '../auth/session';
import { ConnectDevice } from '../devices/connect-device';
import { createInstallerPackage, downloadInstaller, loadInstallerArtifact } from './installer-package';

interface PendingInstallation {
  enrollmentId: string;
  expiresAt: string;
  organizationId: string;
  deviceDisplayName: string;
}

export function AutomaticSetup() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [epoch] = useState(() => sessionEpoch(queryClient));
  const { api, removeSession } = useMemo(() => {
    const config = getPublicConfig();
    const { account, getJwt } = createAppwriteSessionClient(config);
    return { api: createApiClient({ baseUrl: config.apiBaseUrl, getJwt }),
      removeSession: async () => { await account.deleteSession('current'); } };
  }, []);
  const [organizations, setOrganizations] = useState<OrganizationView[]>([]);
  const [connectOrganizations, setConnectOrganizations] = useState<string[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [deviceDisplayName, setDeviceDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [installation, setInstallation] = useState<PendingInstallation | null>(null);
  const [status, setStatus] = useState<EnrollmentStatusResponse | null>(null);
  const [pollError, setPollError] = useState(false);
  const [expired, setExpired] = useState(false);
  const mounted = useRef(false);
  const generationLock = useRef(false);
  const sessionEnded = useRef(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const handleTerminalSession = useCallback(async (failure: unknown) => {
    if (!(failure instanceof ApiClientError && failure.status === 401) && !isDisabledProfile(failure)) return false;
    if (sessionEpoch(queryClient) !== epoch || sessionEnded.current) return true;
    sessionEnded.current = true;
    setSessionExpired(true);
    setInstallation(null); setStatus(null); setOrganizations([]); setConnectOrganizations([]); setDeviceDisplayName('');
    if (await expireSession(queryClient, epoch, removeSession)) router.replace('/login');
    return true;
  }, [epoch, queryClient, removeSession, router]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void Promise.all([api.getMe(), api.getOrganizations()]).then(([me, all]) => {
      if (!active || sessionEpoch(queryClient) !== epoch) return;
      const permitted = all.filter((org) => me.globalRole === 'super_admin'
        || me.authorization.some((permission) => permission.organizationId === org.id && permission.canManageDevices));
      setOrganizations(permitted);
      setConnectOrganizations(permitted.filter((org) => me.globalRole === 'super_admin'
        || me.authorization.some((permission) => permission.organizationId === org.id && permission.canConnect)).map((org) => org.id));
      if (permitted.length === 1) setOrganizationId(permitted[0].id);
    }).catch(async (failure: unknown) => {
      if (active && !await handleTerminalSession(failure)) setError('Não foi possível carregar seus clientes. Atualize a página ou entre novamente.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [api, epoch, handleTerminalSession, queryClient]);

  useEffect(() => {
    if (!installation) return;
    let active = true;
    let confirmed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (!active || sessionEpoch(queryClient) !== epoch) return;
      try {
        const result = await api.getEnrollmentStatus(installation!.enrollmentId);
        if (!active || sessionEpoch(queryClient) !== epoch) return;
        setStatus(result);
        setPollError(false);
        confirmed = confirmed || Boolean(result.device);
        // Expiry limits provisioning only. A committed device continues to be monitored.
        if (!confirmed && Date.now() >= Date.parse(installation!.expiresAt)) {
          setExpired(true);
          return;
        }
      } catch (failure) {
        if (!active || sessionEpoch(queryClient) !== epoch) return;
        if (await handleTerminalSession(failure)) return;
        setPollError(true);
        if (!confirmed && Date.now() >= Date.parse(installation!.expiresAt)) { setExpired(true); return; }
      }
      if (active) timer = setTimeout(() => void poll(), 5_000);
    }
    void poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [api, epoch, handleTerminalSession, installation, queryClient]);

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (generationLock.current || !organizationId || !deviceDisplayName.trim()) return;
    generationLock.current = true;
    setBusy(true);
    setError('');
    try {
      const base = await loadInstallerArtifact();
      if (!mounted.current || sessionEpoch(queryClient) !== epoch) return;
      const enrollment = await api.createEnrollmentToken(organizationId, deviceDisplayName.trim());
      try {
        if (!mounted.current || sessionEpoch(queryClient) !== epoch) return;
        const pending = { enrollmentId: enrollment.enrollmentId, expiresAt: enrollment.expiresAt, organizationId, deviceDisplayName: deviceDisplayName.trim() };
        const installer = createInstallerPackage(base, { schemaVersion: 1, ...pending, enrollmentToken: enrollment.enrollmentToken });
        downloadInstaller(installer);
        setStatus(null);
        setPollError(false);
        setExpired(false);
        setInstallation(pending);
      } finally { enrollment.enrollmentToken = ''; }
    } catch (failure) {
      if (mounted.current && sessionEpoch(queryClient) === epoch && !await handleTerminalSession(failure)) setError('Não foi possível preparar o instalador. Confira sua conexão e tente novamente.');
    } finally {
      generationLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (sessionExpired) return <p role="status">Sessão expirada. Entre novamente.</p>;
  const currentlyOnline = status?.status === 'online' && !pollError;
  return <section className="automatic-setup" aria-labelledby="automatic-setup-title">
    <div className="setup-introduction">
      <p className="eyebrow">Instalação automática · Windows 64 bits</p>
      <h1 id="automatic-setup-title">Instale. O computador aparece aqui.</h1>
      <p>Um único instalador configura os servidores, a senha permanente exclusiva e o serviço que inicia com o Windows.</p>
    </div>
    {!installation && <form className="installer-form" onSubmit={(event) => void generate(event)}>
      {loading ? <p role="status">Carregando clientes...</p> : organizations.length === 0
        ? <p role="status">Sua conta não tem clientes com permissão para cadastrar computadores.</p>
        : <>
          <div className="installer-field"><label htmlFor="installer-organization">Cliente</label><select id="installer-organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required disabled={busy}>
            <option value="">Selecione o cliente</option>
            {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select></div>
          <div className="installer-field"><label htmlFor="installer-device-name">Nome do computador</label><input id="installer-device-name" value={deviceDisplayName} onChange={(event) => setDeviceDisplayName(event.target.value)} maxLength={128} placeholder="Ex.: Recepção" required disabled={busy} autoComplete="off" /></div>
          <button className="primary-button guide-link" type="submit" disabled={busy || !organizationId || !deviceDisplayName.trim()}>
            {busy ? <LoaderCircle size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
            {busy ? 'Preparando instalador...' : 'Baixar instalador do cliente'}
          </button>
          <p className="field-hint">Válido por 30 minutos, para um computador deste cliente. Baixe um novo instalador para cada computador.</p>
        </>}
    </form>}
    {error && <p role="alert" className="error-state">{error}</p>}
    {installation && <div className="installation-progress" aria-live="polite">
      <h2>{pollError ? 'Verificação de conexão indisponível' : currentlyOnline ? 'Computador conectado ao painel' : expired ? 'Prazo de instalação encerrado' : 'Agora, execute no computador do cliente'}</h2>
      <p className="device-value"><strong>{installation.deviceDisplayName}</strong> · {organizations.find((org) => org.id === installation.organizationId)?.name}</p>
      <ol className="automatic-steps">
        <li><CheckCircle2 aria-hidden="true" size={20} /><div><strong>Instalador preparado</strong><p>Abra XPoint-Instalar-Cliente.exe no computador do cliente e aceite a solicitação de administrador do Windows.</p></div></li>
        <li><span aria-hidden="true">{status?.device ? '✓' : '2'}</span><div><strong>{status?.device ? 'Computador cadastrado' : 'Aguardando instalação'}</strong><p>O instalador faz a configuração. Mantenha o computador ligado e com internet até a mensagem de conclusão.</p></div></li>
        <li><span aria-hidden="true">{currentlyOnline ? '✓' : '3'}</span><div><strong>{currentlyOnline ? 'Comunicação recebida' : 'Aguardando comunicação do computador'}</strong><p>{status?.status === 'offline' ? 'O cadastro foi recebido. Aguardando o serviço ficar online.' : 'Esta tela confirma automaticamente quando o serviço começa a se comunicar.'}</p></div></li>
      </ol>
      {pollError && <p role="alert">Não foi possível consultar o progresso. Tentando novamente; não reinstale enquanto isso.</p>}
      {expired && <p role="status">Se a instalação já começou, confira a mensagem no computador antes de gerar outro pacote. O prazo limita novos cadastros, sem desligar computadores já cadastrados.</p>}
      {status?.device && connectOrganizations.includes(installation.organizationId) && <ConnectDevice deviceId={status.device.id} enabled={currentlyOnline && status.device.enabled} service={api} />}
      {status?.device && <Link className="command-button guide-link" href="/devices">Ver todos os dispositivos</Link>}
      <button className="command-button" type="button" onClick={() => { setInstallation(null); setStatus(null); setDeviceDisplayName(''); }}>Preparar outro computador</button>
    </div>}
    <aside className="technician-note"><strong>No computador do técnico</strong><p>Instale o <a href="https://rustdesk.com/download" target="_blank" rel="noreferrer">RustDesk</a> uma vez. O botão Conectar do painel abrirá esse aplicativo. O navegador pode pedir confirmação para abri-lo.</p></aside>
  </section>;
}
