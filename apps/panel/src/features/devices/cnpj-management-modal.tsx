'use client';

import {
  COMPUTER_ROLE_CATALOG,
  type AdminCnpjNamingActionRequest,
  type CnpjCompanyGroupView,
  type CnpjGroupsListResponse,
  type CnpjMigrationRequest,
  type CnpjMigrationResponse,
  type ComputerRoleCode,
  type ExistingCompanyComputer,
  type SuggestNameRequest,
  type SuggestNameResponse,
} from '@appremoto/contracts';
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  CheckCircle2,
  Clock,
  Edit3,
  History,
  Loader2,
  Monitor,
  RefreshCw,
  Search,
  Sparkles,
  Unlock,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export interface CnpjManagementService {
  getCnpjGroups(cnpj?: string): Promise<CnpjGroupsListResponse>;
  suggestCnpjName(input: SuggestNameRequest): Promise<SuggestNameResponse>;
  executeCnpjGroupAction(input: AdminCnpjNamingActionRequest): Promise<CnpjCompanyGroupView>;
  migrateCnpjGroups(input: CnpjMigrationRequest): Promise<CnpjMigrationResponse>;
}

interface CnpjManagementModalProps {
  api: CnpjManagementService;
  initialCnpj?: string | null;
  onClose: () => void;
  onChanged: () => void;
}

function renameStatusBadge(status: string, desired?: string | null, actual?: string) {
  switch (status) {
    case 'CONFIRMADO':
      return {
        label: 'Windows Confirmado',
        cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      };
    case 'APLICADO_AGUARDANDO_REBOOT':
      return {
        label: `Aguardando Reboot${desired ? ` → ${desired}` : ''}`,
        cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      };
    case 'RESERVADO':
      return {
        label: `Reservado${desired ? ` → ${desired}` : ''}`,
        cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
      };
    case 'DIVERGENTE':
      return {
        label: `Divergente${desired ? ` (${desired})` : ''}`,
        cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      };
    case 'ERRO':
      return {
        label: 'Erro ao Renomear Windows',
        cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      };
    default:
      if (desired && actual && desired.toUpperCase() === actual.toUpperCase()) {
        return {
          label: 'Windows Sincronizado',
          cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        };
      }
      return {
        label: 'Não Solicitado',
        cls: 'bg-slate-800/80 text-slate-400 border-slate-700/60',
      };
  }
}

export function CnpjManagementModal({
  api,
  initialCnpj,
  onClose,
  onChanged,
}: CnpjManagementModalProps) {
  const [groups, setGroups] = useState<CnpjCompanyGroupView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(initialCnpj ?? '');
  const [selectedCnpj, setSelectedCnpj] = useState<string | null>(initialCnpj ?? null);
  const [activeTab, setActiveTab] = useState<'computers' | 'reservations' | 'history' | 'migration'>('computers');

  // Estado de edição de computador (Alterar Função / Nome ou Transferir)
  const [editingComp, setEditingComp] = useState<ExistingCompanyComputer | null>(null);
  const [editRole, setEditRole] = useState<ComputerRoleCode>('CAIXA');
  const [editName, setEditName] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editAvailable, setEditAvailable] = useState(true);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const [transferComp, setTransferComp] = useState<ExistingCompanyComputer | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Estado da migração
  const [migrationReport, setMigrationReport] = useState<CnpjMigrationResponse | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);

  const loadGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCnpjGroups();
      setGroups(res.groups);
      if (res.groups.length > 0) {
        const initDigits = (initialCnpj ?? '').replace(/\D+/g, '');
        const found = initDigits
          ? res.groups.find((g) => g.cnpj === initDigits)
          : null;
        if (found) {
          setSelectedCnpj(found.cnpj);
        } else if (!selectedCnpj || !res.groups.some((g) => g.cnpj === selectedCnpj)) {
          setSelectedCnpj(res.groups[0]!.cnpj);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar grupos empresariais por CNPJ.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGroups();
  }, []);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    const qDigits = q.replace(/\D+/g, '');
    return groups.filter((g) => {
      if (qDigits && g.cnpj.includes(qDigits)) return true;
      if (g.formattedCnpj.toLowerCase().includes(q)) return true;
      if ((g.razaoSocial ?? '').toLowerCase().includes(q)) return true;
      if ((g.nomeFantasia ?? '').toLowerCase().includes(q)) return true;
      if (g.organizationName.toLowerCase().includes(q)) return true;
      return g.computers.some(
        (c) =>
          c.displayName.toLowerCase().includes(q) ||
          c.windowsHostnameAtual.toLowerCase().includes(q) ||
          (c.windowsHostnameDesejado ?? '').toLowerCase().includes(q) ||
          c.rustdeskId.includes(q),
      );
    });
  }, [groups, search]);

  const currentGroup = useMemo(
    () => groups.find((g) => g.cnpj === selectedCnpj) ?? filteredGroups[0] ?? null,
    [groups, filteredGroups, selectedCnpj],
  );

  const openEditModal = async (comp: ExistingCompanyComputer, cnpj: string) => {
    const effectiveName = comp.windowsHostnameDesejado || comp.displayName;
    setEditingComp(comp);
    setEditRole(comp.role);
    setEditName(effectiveName);
    setEditReason('Nome atual atribuído a este computador.');
    setEditAvailable(true);
    setSuggestLoading(true);
    try {
      const sug = await api.suggestCnpjName({
        cnpj,
        role: comp.role,
        deviceUuid: comp.deviceUuid,
        replaceDeviceId: comp.deviceId,
      });
      setEditReason(sug.explanation);
      setEditAvailable(sug.available);
    } catch {
      // mantém estado local
    } finally {
      setSuggestLoading(false);
    }
  };

  const handleRoleChangeInEdit = async (nextRole: ComputerRoleCode) => {
    setEditRole(nextRole);
    if (!currentGroup || !editingComp) return;
    setSuggestLoading(true);
    try {
      const sug = await api.suggestCnpjName({
        cnpj: currentGroup.cnpj,
        role: nextRole,
        deviceUuid: editingComp.deviceUuid,
        replaceDeviceId: editingComp.deviceId,
      });
      setEditName(sug.suggestedName);
      setEditReason(sug.explanation);
      setEditAvailable(sug.available);
    } catch (err) {
      setEditReason(err instanceof Error ? err.message : 'Não foi possível calcular sugestão.');
    } finally {
      setSuggestLoading(false);
    }
  };

  const submitEditRoleAndName = async () => {
    if (!currentGroup || !editingComp || !editName.trim()) return;
    setActionBusy(true);
    setFeedback(null);
    try {
      const desired = editName.trim().toUpperCase();
      await api.executeCnpjGroupAction({
        action: 'UPDATE_ROLE_AND_NAME',
        cnpj: currentGroup.cnpj,
        deviceId: editingComp.deviceId,
        role: editRole,
        desiredName: desired,
      });
      setFeedback({
        type: 'ok',
        text: `Função e nome atualizados para ${desired} (${editRole}) com sucesso.`,
      });
      setEditingComp(null);
      await loadGroups();
      onChanged();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao atualizar função e nome.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleReleaseName = async (comp: ExistingCompanyComputer) => {
    if (!currentGroup) return;
    const normName = (comp.windowsHostnameDesejado || comp.displayName).toUpperCase();
    if (
      !window.confirm(
        `Liberar o nome "${normName}" no CNPJ ${currentGroup.formattedCnpj}?\n\nIsso liberará a reserva administrativa e permitirá reutilizar o nome "${normName}" em uma nova instalação.`,
      )
    ) {
      return;
    }
    setActionBusy(true);
    setFeedback(null);
    try {
      await api.executeCnpjGroupAction({
        action: 'RELEASE_NAME',
        cnpj: currentGroup.cnpj,
        normalizedName: normName,
        deviceId: comp.deviceId,
      });
      setFeedback({
        type: 'ok',
        text: `Nome ${normName} liberado administrativamente no CNPJ ${currentGroup.formattedCnpj}.`,
      });
      await loadGroups();
      onChanged();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao liberar nome.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const submitTransferName = async () => {
    if (!currentGroup || !transferComp || !transferTargetId) return;
    setActionBusy(true);
    setFeedback(null);
    try {
      const transferredName = (transferComp.windowsHostnameDesejado || transferComp.displayName).toUpperCase();
      await api.executeCnpjGroupAction({
        action: 'TRANSFER_NAME',
        cnpj: currentGroup.cnpj,
        fromDeviceId: transferComp.deviceId,
        toDeviceId: transferTargetId,
      });
      setFeedback({
        type: 'ok',
        text: `Nome ${transferredName} transferido com sucesso para o computador selecionado.`,
      });
      setTransferComp(null);
      setTransferTargetId('');
      await loadGroups();
      onChanged();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao transferir nome.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const runMigration = async (dryRun: boolean) => {
    setMigrationBusy(true);
    setFeedback(null);
    try {
      const res = await api.migrateCnpjGroups({ dryRun });
      setMigrationReport(res);
      setFeedback({
        type: 'ok',
        text: dryRun
          ? `Simulação concluída: ${res.validCnpjGroups} grupo(s) CNPJ analisados, ${res.registeredReservations} computador(es) padronizados.`
          : `Migração aplicada com sucesso: ${res.validCnpjGroups} grupo(s) CNPJ consolidados e ${res.registeredReservations} computador(es) padronizados!`,
      });
      if (!dryRun) {
        await loadGroups();
        onChanged();
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao executar migração por CNPJ.',
      });
    } finally {
      setMigrationBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-3 sm:p-6 backdrop-blur-md">
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/95 text-slate-100 shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 text-cyan-300">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-white">
                Gestão Inteligente de Computadores por CNPJ
              </h2>
              <p className="text-xs text-slate-400">
                Agrupamento empresarial automático (14 dígitos), catálogo de funções, sugestão sequencial e renomeação real do Windows
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab('migration');
                if (!migrationReport) void runMigration(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Migrar / Consolidar Base
            </button>
            <button
              type="button"
              onClick={() => void loadGroups()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700/70 transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-800 bg-slate-800/60 p-2 text-slate-400 hover:bg-slate-700/60 hover:text-white transition"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {feedback && (
          <div
            className={`flex items-center justify-between gap-2 border-b px-5 py-2.5 text-xs font-medium ${
              feedback.type === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            }`}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-current opacity-75 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* Corpo Principal */}
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Coluna Esquerda: Lista de Grupos CNPJ */}
          <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-slate-800/80 lg:col-span-4 bg-slate-950/40 overflow-hidden">
            <div className="p-3 border-b border-slate-800/70">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por CNPJ, Razão Social ou PC..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/90 py-2 pl-9 pr-3 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50 max-h-56 lg:max-h-none">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                  Consultando grupos por CNPJ...
                </div>
              ) : error ? (
                <div className="p-4 text-xs text-rose-400">{error}</div>
              ) : filteredGroups.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  Nenhum grupo empresarial com CNPJ encontrado. Clique em{' '}
                  <strong className="text-amber-300">Migrar / Consolidar Base</strong> para organizar computadores existentes.
                </div>
              ) : (
                filteredGroups.map((g) => {
                  const active = currentGroup?.cnpj === g.cnpj && activeTab !== 'migration';
                  const offlineCount = Math.max(0, g.totalComputers - g.onlineComputers);
                  return (
                    <button
                      key={g.cnpj}
                      type="button"
                      onClick={() => {
                        setSelectedCnpj(g.cnpj);
                        if (activeTab === 'migration') setActiveTab('computers');
                      }}
                      className={`w-full text-left px-4 py-3.5 transition flex flex-col gap-1 ${
                        active
                          ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400'
                          : 'hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-cyan-300">
                          {g.formattedCnpj}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                          <Monitor className="h-3 w-3 text-cyan-400" />
                          {g.totalComputers} PC{g.totalComputers === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-white line-clamp-1">
                        {g.nomeFantasia || g.razaoSocial || g.organizationName}
                      </div>
                      {g.nomeFantasia && g.razaoSocial && g.nomeFantasia !== g.razaoSocial && (
                        <div className="text-[11px] text-slate-400 line-clamp-1">
                          {g.razaoSocial}
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                        <span className="text-emerald-400">{g.onlineComputers} online</span>
                        <span>•</span>
                        <span>{offlineCount} offline</span>
                        {g.pendingRenameCount > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-amber-300">{g.pendingRenameCount} reboot pend.</span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Coluna Direita: Detalhes do CNPJ ou Migração */}
          <div className="flex flex-col lg:col-span-8 overflow-hidden">
            {/* Abas */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/60 px-5 py-2.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('computers')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'computers'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Computadores ({currentGroup?.computers.length ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('reservations')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'reservations'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Reservas ({currentGroup?.reservations.length ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'history'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Histórico ({currentGroup?.history.length ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('migration')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'migration'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Migração da Base
                </button>
              </div>

              {currentGroup && activeTab !== 'migration' && (
                <div className="text-xs text-slate-400">
                  CNPJ: <strong className="font-mono text-slate-200">{currentGroup.formattedCnpj}</strong>
                </div>
              )}
            </div>

            {/* Conteúdo da Aba */}
            <div className="flex-1 overflow-y-auto p-5">
              {activeTab === 'migration' ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-400" />
                      Rotina de Migração e Consolidação por CNPJ
                    </h3>
                    <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                      Esta rotina localiza todos os computadores já cadastrados que possuem CNPJ no{' '}
                      <code className="text-amber-300">config.ini</code>, agrupa-os automaticamente na organização do CNPJ (14 dígitos),
                      infere a função (<code className="text-cyan-300">SERVIDOR</code>, <code className="text-cyan-300">CAIXA-01</code>, etc.)
                      e gera o relatório de possíveis conflitos sem apagar nenhum histórico.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={migrationBusy}
                        onClick={() => void runMigration(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 transition disabled:opacity-50"
                      >
                        {migrationBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                        Simular Migração (Dry-Run)
                      </button>
                      <button
                        type="button"
                        disabled={migrationBusy}
                        onClick={() => void runMigration(false)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow hover:from-cyan-400 hover:to-blue-500 transition disabled:opacity-50"
                      >
                        {migrationBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Aplicar Consolidação e Nomenclatura Agora
                      </button>
                    </div>
                  </div>

                  {migrationReport && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                          <div className="text-[11px] text-slate-400">Modo</div>
                          <div className="text-sm font-bold text-white">
                            {migrationReport.dryRun ? 'Simulação (Dry-Run)' : 'Aplicado no Banco'}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                          <div className="text-[11px] text-slate-400">Grupos CNPJ</div>
                          <div className="text-sm font-bold text-cyan-300">{migrationReport.validCnpjGroups}</div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                          <div className="text-[11px] text-slate-400">Reservas / Nomes</div>
                          <div className="text-sm font-bold text-emerald-300">{migrationReport.registeredReservations}</div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                          <div className="text-[11px] text-slate-400">Alertas / Anomalias</div>
                          <div className="text-sm font-bold text-amber-300">{migrationReport.anomalies.length}</div>
                        </div>
                      </div>

                      {migrationReport.anomalies.length === 0 ? (
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200">
                          Nenhuma anomalia ou conflito detectado nos {migrationReport.scannedDevices} computadores analisados.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {migrationReport.anomalies.map((item, idx) => (
                            <div
                              key={`${item.deviceId}-${idx}`}
                              className="rounded-xl border border-slate-800/90 bg-slate-950/50 p-3.5 text-xs space-y-1.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                                  <span className="font-mono font-bold text-white">{item.displayName}</span>
                                  <span className="text-slate-400">(Host: {item.hostname})</span>
                                </div>
                                {item.cnpj && (
                                  <span className="font-mono text-cyan-300">CNPJ: {item.cnpj}</span>
                                )}
                              </div>
                              <div className="text-slate-300">{item.detail}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : !currentGroup ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  Selecione uma empresa/CNPJ à esquerda para gerenciar seus computadores.
                </div>
              ) : activeTab === 'computers' ? (
                <div className="space-y-3">
                  {currentGroup.computers.map((comp) => {
                    const effectiveName = comp.windowsHostnameDesejado || comp.displayName;
                    const badge = renameStatusBadge(
                      comp.renameStatus,
                      comp.windowsHostnameDesejado,
                      comp.windowsHostnameAtual,
                    );
                    return (
                      <div
                        key={comp.deviceId}
                        className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-4 transition hover:border-slate-700"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-base font-bold text-white">
                                {effectiveName}
                              </span>
                              <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-300">
                                {comp.roleLabel}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  comp.status === 'ONLINE'
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                    : comp.status === 'DISABLED'
                                      ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                                }`}
                              >
                                {comp.status}
                              </span>
                              <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                              <span>
                                Host Windows atual:{' '}
                                <strong className="font-mono text-slate-200">{comp.windowsHostnameAtual}</strong>
                              </span>
                              {comp.windowsHostnameDesejado && (
                                <span>
                                  Host Windows desejado:{' '}
                                  <strong className="font-mono text-cyan-300">{comp.windowsHostnameDesejado}</strong>
                                </span>
                              )}
                              <span>
                                RustDesk ID: <strong className="font-mono text-slate-200">{comp.rustdeskId}</strong>
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void openEditModal(comp, currentGroup.cnpj)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
                            >
                              <Edit3 className="h-3.5 w-3.5 text-cyan-400" />
                              Função / Nome
                            </button>
                            {currentGroup.computers.length > 1 && comp.status !== 'DISABLED' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setTransferComp(comp);
                                  const firstOther = currentGroup.computers.find((c) => c.deviceId !== comp.deviceId);
                                  setTransferTargetId(firstOther?.deviceId ?? '');
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5 text-amber-400" />
                                Transferir
                              </button>
                            )}
                            {comp.status !== 'DISABLED' && (
                              <button
                                type="button"
                                onClick={() => void handleReleaseName(comp)}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition"
                              >
                                <Unlock className="h-3.5 w-3.5" />
                                Liberar Nome
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : activeTab === 'reservations' ? (
                <div className="space-y-2.5">
                  {currentGroup.reservations.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400">
                      Nenhuma reserva de nome registrada para este CNPJ.
                    </div>
                  ) : (
                    currentGroup.reservations.map((res) => (
                      <div
                        key={res.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 text-xs"
                      >
                        <div>
                          <span className="font-mono font-bold text-white">{res.normalizedName}</span>{' '}
                          <span className="text-cyan-300">({res.role})</span>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Chave única: <code className="text-slate-300">{res.uniqueKey}</code>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-slate-200">
                            {res.status}
                          </span>
                          {res.expiresAt && (
                            <span className="text-[11px] text-slate-400 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Expira: {new Date(res.expiresAt).toLocaleString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {currentGroup.history.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400">
                      Nenhum histórico de alteração de nome registrado para este CNPJ.
                    </div>
                  ) : (
                    currentGroup.history.map((h) => (
                      <div
                        key={h.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <History className="h-3.5 w-3.5 text-cyan-400" />
                            <span className="font-semibold text-white">{h.eventType}</span>
                            {h.normalizedName && (
                              <span className="font-mono font-bold text-emerald-300">{h.normalizedName}</span>
                            )}
                            {h.role && <span className="text-cyan-300">({h.role})</span>}
                          </div>
                          {h.detail && <div className="text-[11px] text-slate-400">{h.detail}</div>}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {new Date(h.at).toLocaleString('pt-BR')}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sub-modal: Editar Função e Nome */}
        {editingComp && currentGroup && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">
                  Alterar Função / Nome — {editingComp.windowsHostnameDesejado || editingComp.displayName}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingComp(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Função do Computador</label>
                  <select
                    value={editRole}
                    onChange={(e) => void handleRoleChangeInEdit(e.target.value as ComputerRoleCode)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  >
                    {COMPUTER_ROLE_CATALOG.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label} ({r.sampleName})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1">
                    Nome Padronizado (máx. 15 caracteres A-Z, 0-9 e hífen)
                  </label>
                  <input
                    type="text"
                    maxLength={15}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value.toUpperCase())}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm font-bold text-white"
                  />
                </div>

                <div
                  className={`rounded-xl border p-2.5 text-[11px] ${
                    editAvailable
                      ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  {suggestLoading ? 'Calculando disponibilidade no CNPJ...' : editReason}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingComp(null)}
                  className="rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={actionBusy || !editName.trim()}
                  onClick={() => void submitEditRoleAndName()}
                  className="rounded-xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
                >
                  {actionBusy ? 'Salvando...' : 'Salvar Função e Nome'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sub-modal: Transferir Nome */}
        {transferComp && currentGroup && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">
                  Transferir Nome {transferComp.windowsHostnameDesejado || transferComp.displayName}
                </h3>
                <button
                  type="button"
                  onClick={() => setTransferComp(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Selecione o computador de destino dentro do CNPJ{' '}
                <strong className="text-cyan-300">{currentGroup.formattedCnpj}</strong> que receberá o nome{' '}
                <strong className="font-mono text-white">
                  {transferComp.windowsHostnameDesejado || transferComp.displayName}
                </strong>{' '}
                ({transferComp.roleLabel}). O computador de origem será marcado como substituído.
              </p>

              <div className="text-xs">
                <label className="block font-semibold text-slate-300 mb-1">Computador de Destino</label>
                <select
                  value={transferTargetId}
                  onChange={(e) => setTransferTargetId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                >
                  {currentGroup.computers
                    .filter((c) => c.deviceId !== transferComp.deviceId)
                    .map((c) => (
                      <option key={c.deviceId} value={c.deviceId}>
                        {c.windowsHostnameDesejado || c.displayName} — Host: {c.windowsHostnameAtual} ({c.status})
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTransferComp(null)}
                  className="rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={actionBusy || !transferTargetId}
                  onClick={() => void submitTransferName()}
                  className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  {actionBusy ? 'Transferindo...' : 'Confirmar Transferência'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
