'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Copy, Download, LoaderCircle } from 'lucide-react';
import type { GenericInstallerPackage, GenericInstallerView } from '@appremoto/contracts';
import { ApiClientError, createApiClient, type TechnicianView } from '../../lib/api';
import { createAppwriteSessionClient } from '../../lib/appwrite';
import { getPublicConfig } from '../../lib/config';
import { expireSession, onSessionClear, sessionEpoch } from '../auth/session-cache';
import { createGenericInstallerPackage, downloadGenericInstaller, loadCompleteInstallerArtifact } from './generic-installer-package';

export interface GenericInstallerService {
  getMe(): Promise<TechnicianView>;
  getGenericInstallers(): Promise<{ installers: GenericInstallerView[] }>;
  createGenericInstaller(name: string): Promise<{ installer: GenericInstallerView; package: GenericInstallerPackage }>;
  getGenericInstallerPackage(installerId: string): Promise<{ package: GenericInstallerPackage }>;
  revokeGenericInstaller(installerId: string): Promise<{ revoked: boolean }>;
  expireSession(): Promise<void>;
}
function createService(): GenericInstallerService {
  const config = getPublicConfig();
  const { account, getJwt } = createAppwriteSessionClient(config);
  return { ...createApiClient({ baseUrl: config.apiBaseUrl, getJwt }), expireSession: async () => { await account.deleteSession('current'); } };
}
export function GenericSetup() {
  const service = useMemo(createService, []);
  const router = useRouter();
  return <GenericInstallerDownload service={service} onSessionExpired={() => router.replace('/login')} />;
}
export function GenericInstallerDownload({ service, onSessionExpired }: { service: GenericInstallerService; onSessionExpired(): void }) {
  const client = useQueryClient();
  const [epoch] = useState(() => sessionEpoch(client));
  const active = useRef(false); const lock = useRef(false);
  const releaseDownload = useRef<(() => void) | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installers, setInstallers] = useState<GenericInstallerView[]>([]);
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const current = () => active.current && sessionEpoch(client) === epoch;
  async function terminal(failure: unknown) {
    if (!(failure instanceof ApiClientError && failure.status === 401)) return false;
    if (current() && await expireSession(client, epoch, () => service.expireSession())) onSessionExpired();
    return true;
  }
  function acceptList(list: GenericInstallerView[]) {
    setInstallers(list);
    setSelected((old) => list.some((item) => item.id === old && item.active && !item.revokedAt) ? old : list.find((item) => item.active && !item.revokedAt)?.id ?? '');
    setReady(true);
  }
  useEffect(() => {
    active.current = true;
    const unsubscribe = onSessionClear(client, () => {
      active.current = false; releaseDownload.current?.(); releaseDownload.current = undefined;
      setInstallers([]); setSelected(''); setAdmin(false); setReady(false); setMessage(''); setError(''); setBusy(false);
    });
    return () => { active.current = false; unsubscribe(); releaseDownload.current?.(); releaseDownload.current = undefined; };
  }, [client]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setReady(false); setError('');
    void (async () => {
      try {
        const me = await service.getMe();
        if (cancelled || !current()) return;
        setAdmin(me.globalRole === 'super_admin');
        if (me.globalRole !== 'super_admin') return;
        const result = await service.getGenericInstallers();
        if (!cancelled && current()) acceptList(result.installers);
      } catch (failure) {
        if (!cancelled && current() && !await terminal(failure)) setError('Não foi possível consultar os instaladores. Tente novamente.');
      } finally { if (!cancelled && current()) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [service, revision, epoch]);
  async function download() {
    if (!current() || !admin || !ready || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      // Verify the bundled executable before asking the API for an enrollment capability.
      const base = await loadCompleteInstallerArtifact();
      if (!current()) return;
      const existing = installers.find((item) => item.id === selected && item.active && !item.revokedAt);
      const result: { package: GenericInstallerPackage; installer?: GenericInstallerView } = existing ? await service.getGenericInstallerPackage(existing.id) : await service.createGenericInstaller('Instalador geral XPoint');
      try {
        if (!current()) return;
        const blob = createGenericInstallerPackage(base, result.package);
        releaseDownload.current?.(); releaseDownload.current = downloadGenericInstaller(blob);
        if (result.installer) acceptList([result.installer, ...installers]);
        setMessage('Arquivo preparado. Use o mesmo instalador nos computadores dos clientes.');
      } finally { result.package.installerToken = ''; }
    } catch (failure) {
      if (!current() || await terminal(failure)) return;
      setError(failure instanceof ApiClientError && failure.code === 'PASSWORD_NOT_CONFIGURED'
        ? 'A senha padrão ainda não está configurada no serviço. Solicite a configuração ao administrador.'
        : 'Não foi possível preparar o instalador. Confira a conexão e tente novamente.');
      // A response may be lost after issuance. Refresh metadata before offering another issue.
      try { const fresh = await service.getGenericInstallers(); if (current()) acceptList(fresh.installers); }
      catch (next) { if (current() && !await terminal(next)) setReady(false); }
    } finally { lock.current = false; if (current()) setBusy(false); }
  }
  async function copyDownloadLink() {
    if (!current() || !admin || !ready || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const existing = installers.find((item) => item.id === selected && item.active && !item.revokedAt);
      const result: { package: GenericInstallerPackage; installer?: GenericInstallerView } = existing
        ? await service.getGenericInstallerPackage(existing.id)
        : await service.createGenericInstaller('Instalador geral XPoint');
      try {
        if (!current()) return;
        const jsonPayload = JSON.stringify({
          schemaVersion: 2,
          installerId: result.package.installerId,
          installerToken: result.package.installerToken,
        });
        const bytes = new TextEncoder().encode(jsonPayload);
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        const origin = typeof window !== 'undefined' ? window.location.origin : 'https://remoto.xpointsolucoes.com.br';
        const downloadUrl = `${origin}/api/installer/download?p=${encoded}`;
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(downloadUrl);
        }
        if (result.installer) acceptList([result.installer, ...installers]);
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 3500);
        setMessage('Link de download copiado! Envie para o cliente baixar o instalador pronto.');
      } finally {
        result.package.installerToken = '';
      }
    } catch (failure) {
      if (!current() || await terminal(failure)) return;
      setError(
        failure instanceof ApiClientError && failure.code === 'PASSWORD_NOT_CONFIGURED'
          ? 'A senha padrão ainda não está configurada no serviço. Solicite a configuração ao administrador.'
          : 'Não foi possível gerar o link do instalador. Confira a conexão e tente novamente.'
      );
      try { const fresh = await service.getGenericInstallers(); if (current()) acceptList(fresh.installers); }
      catch (next) { if (current() && !await terminal(next)) setReady(false); }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  async function revoke(installer: GenericInstallerView) {
    if (!current() || !admin || lock.current || !installer.active) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await service.revokeGenericInstaller(installer.id);
      if (!current()) return;
      // Revocation is permanent for this authorization; existing enrolled devices are untouched.
      acceptList(installers.map((item) => item.id === installer.id ? { ...item, active: false, revokedAt: new Date().toISOString() } : item));
      setMessage('Autorização revogada. Computadores já cadastrados continuam funcionando.');
    } catch (failure) {
      if (current() && !await terminal(failure)) { setReady(false); setError('Não foi possível confirmar a revogação. Atualize as autorizações antes de tentar novamente.'); }
    } finally { lock.current = false; if (current()) setBusy(false); }
  }
  const available = installers.filter((item) => item.active && !item.revokedAt);
  return <section className="automatic-setup" aria-labelledby="generic-setup-title">
    <div className="setup-introduction">
      <p className="eyebrow">Instalador completo 1.3.2 · Windows 64 bits · UI Enterprise Segura</p>
      <h1 id="generic-setup-title">Um instalador para todos os computadores.</h1>
      <p>Baixe uma vez e use o mesmo arquivo nos computadores dos clientes. Se o RustDesk já estiver instalado, ele aplica os padrões da XPoint. Se não estiver, instala tudo com interface moderna de alta confiança, lê automaticamente os dados do <code>C:\DataDivas\config.ini</code>, sugere a função e numeração sequencial por CNPJ e permite renomear o Windows sem reiniciar à força.</p>
    </div>
    {loading ? <p role="status">Carregando instalador…</p> : !admin ? <p role="status">Peça a um administrador o instalador completo. Depois de receber o arquivo, você pode instalar sem entrar no painel.</p> : <div className="installer-form">
      {available.length > 1 && <div className="installer-field"><label htmlFor="generic-installer-selection">Autorização do instalador</label>
        <select id="generic-installer-selection" value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
          {available.map((item) => <option key={item.id} value={item.id}>{item.name} · {new Date(item.createdAt).toLocaleDateString('pt-BR')}</option>)}
        </select></div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}><button type="button" className="primary-button guide-link" disabled={busy || !ready} onClick={() => void download()}>
        {busy ? <LoaderCircle aria-hidden="true" size={18} /> : <Download aria-hidden="true" size={18} />}
        {busy ? 'Preparando…' : 'Baixar instalador completo'}</button><button type="button" className="command-button guide-link" disabled={busy || !ready} onClick={() => void copyDownloadLink()} title="Copia o link direto de download do instalador completo para enviar ao cliente">{copiedLink ? <Check aria-hidden="true" size={18} className="text-emerald-400" /> : <Copy aria-hidden="true" size={18} />}{copiedLink ? 'Link copiado!' : 'Copiar link de download'}
      </button></div>
      <p className="field-hint">Empresa, grupo por CNPJ e função padronizada do computador são sugeridos automaticamente durante a instalação. Não é necessário abrir nem entrar no painel no computador do cliente.</p>
    </div>}
    {error && <p className="error-state" role="alert">{error}</p>}
    {error && !loading && <button className="command-button guide-link" type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Atualizar autorizações</button>}
    {message && <p role="status">{message}</p>}
    <ol className="automatic-steps" aria-label="Como instalar">
      <li><span aria-hidden="true">1</span><div><strong>Execute no computador do cliente</strong><p>Abra XPoint-Instalar-Completo.exe e aceite a solicitação de administrador do Windows. O cabeçalho de segurança confirma a autenticidade e criptografia TLS.</p></div></li>
      <li><span aria-hidden="true">2</span><div><strong>Confira o CNPJ, a função e o nome sugerido</strong><p>O instalador lê o C:\DataDivas\config.ini, sincroniza os computadores do CNPJ, sugere o próximo número livre (ex.: CAIXA-01, SERVIDOR) e aplica a senha padrão de acesso.</p></div></li>
      <li><span aria-hidden="true">3</span><div><strong>Aguarde a conclusão com controle de reinicialização</strong><p>A janela mostra cada etapa com transparência. O computador nunca é reiniciado sem permissão e aparece imediatamente no painel com o botão Conectar.</p></div></li>
    </ol>
    <p>Se houver falha, o instalador cria um <strong>log com o mesmo nome do executável</strong>, na mesma pasta. Ele informa a etapa e o código do erro.</p>
    <Link href="/devices" className="command-button guide-link">Ver dispositivos</Link>
    {admin && !loading && <details className="generic-authorizations"><summary>Autorizações de instalação</summary>
      <p>Revogar impede novos cadastros e reinstalações com os arquivos vinculados a esta autorização. Computadores já cadastrados continuam funcionando.</p>
      {installers.length === 0 ? <p>A autorização será criada no primeiro download.</p> : <ul className="generic-authorization-list">
        {installers.map((item) => <li key={item.id}><div><strong>{item.name}</strong><p>Criada em {new Date(item.createdAt).toLocaleString('pt-BR')} · {item.active && !item.revokedAt ? 'Ativa' : 'Revogada'}</p></div>
          {item.active && !item.revokedAt && <button type="button" className="command-button guide-link" disabled={busy} onClick={() => void revoke(item)} aria-label={`Revogar ${item.name}`}>Revogar autorização</button>}
        </li>)}
      </ul>}
    </details>}
    <aside className="technician-note"><strong>No computador do técnico</strong><p>Instale o <a href="https://rustdesk.com/download" target="_blank" rel="noreferrer">RustDesk</a> e abra-o uma vez. O botão Conectar abre esse aplicativo neste computador.</p>
      <p>Para ajustar a imagem à janela, no RustDesk do técnico abra <strong>Configurações → Tela → Estilo de visualização padrão → Adaptada</strong>. Durante a sessão, a opção também está no menu de exibição.</p>
      <p><a href="https://github.com/rustdesk/rustdesk/tree/1.4.9" target="_blank" rel="noreferrer">RustDesk: licença e código-fonte</a></p>
    </aside>
  </section>;
}
