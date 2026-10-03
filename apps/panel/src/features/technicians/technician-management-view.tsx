'use client';

import React, { useMemo, useState } from 'react';
import {
  Users,
  UserPlus,
  ShieldCheck,
  ShieldAlert,
  Search,
  Copy,
  Check,
  ExternalLink,
  MessageCircle,
  MoreVertical,
  CheckCircle2,
  X,
  Mail,
  User,
  Clock,
  Trash2,
  Power,
  RotateCw,
} from 'lucide-react';
import {
  buildWhatsAppInviteUrl,
  createTechnicianWithInvite,
  deleteTechnician,
  getInvites,
  getTechnicians,
  toggleTechnicianActive,
} from './technician-service';
import type {
  CreateTechnicianInput,
  GlobalRole,
  TechnicianInvite,
  TechnicianProfileView,
} from './technician-types';

interface TechnicianManagementViewProps {
  currentTechnicianName?: string;
}

export function TechnicianManagementView({
  currentTechnicianName = 'Administrador',
}: TechnicianManagementViewProps) {
  const [technicians, setTechnicians] = useState<TechnicianProfileView[]>(() => getTechnicians());
  const [invites, setInvites] = useState<TechnicianInvite[]>(() => getInvites());
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | GlobalRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Estados de Modal e Convite
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formData, setFormData] = useState<CreateTechnicianInput>({
    displayName: '',
    email: '',
    role: 'technician',
  });
  const [createdInvite, setCreatedInvite] = useState<TechnicianInvite | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [menuOpenForId, setMenuOpenForId] = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.displayName.trim() || !formData.email.trim()) return;

    const result = createTechnicianWithInvite(formData, currentTechnicianName);
    setTechnicians(getTechnicians());
    setInvites(getInvites());
    setCreatedInvite(result.invite);
    showToast(`Convite gerado com sucesso para ${result.technician.displayName}!`);
  }

  function handleCopyInvite(invite: TechnicianInvite) {
    void navigator.clipboard.writeText(invite.inviteUrl).then(() => {
      setCopiedToken(invite.token);
      showToast('Link do convite copiado para a área de transferência!');
      setTimeout(() => setCopiedToken(null), 2500);
    });
  }

  function handleToggleActive(tech: TechnicianProfileView) {
    const updated = toggleTechnicianActive(tech.id);
    setTechnicians(updated);
    setMenuOpenForId(null);
    showToast(`Técnico ${tech.displayName} agora está ${tech.active ? 'desativado' : 'ativo'}.`);
  }

  function handleDelete(tech: TechnicianProfileView) {
    if (confirm(`Tem certeza de que deseja remover o técnico "${tech.displayName}"?`)) {
      const updated = deleteTechnician(tech.id);
      setTechnicians(updated);
      setMenuOpenForId(null);
      showToast(`Técnico ${tech.displayName} removido.`);
    }
  }

  // Filtragem dos técnicos
  const filteredTechs = useMemo(() => {
    return technicians.filter((tech) => {
      const q = search.toLowerCase();
      const matchesSearch =
        tech.displayName.toLowerCase().includes(q) || tech.email.toLowerCase().includes(q);
      const matchesRole = roleFilter === 'all' || tech.globalRole === roleFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && tech.active) ||
        (statusFilter === 'inactive' && !tech.active);
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [technicians, search, roleFilter, statusFilter]);

  const activeCount = technicians.filter((t) => t.active).length;
  const adminCount = technicians.filter((t) => t.globalRole === 'super_admin').length;
  const pendingInvitesCount = invites.filter((i) => i.status === 'pending').length;

  return (
    <div className="tv-technicians-view">
      {/* Toast Notification Flutuante */}
      {toastMessage && (
        <div className="tv-toast-notification" role="status">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header com Ações */}
      <div className="tv-tech-header-card">
        <div className="tv-tech-header-title">
          <div className="tv-tech-icon-circle">
            <Users size={22} className="text-primary" />
          </div>
          <div>
            <h2>Gestão de Equipe & Técnicos</h2>
            <p>Gerencie operadores remotos, gere links de convite e configure o acesso via Google OAuth.</p>
          </div>
        </div>

        <button
          type="button"
          className="tv-btn-primary tv-btn-invite"
          onClick={() => {
            setFormData({ displayName: '', email: '', role: 'technician' });
            setCreatedInvite(null);
            setIsCreateOpen(true);
          }}
        >
          <UserPlus size={16} />
          <span>Novo Técnico & Gerar Convite</span>
        </button>
      </div>

      {/* 3 KPI Cards */}
      <div className="tv-kpi-grid">
        <div className="tv-kpi-card">
          <div className="tv-kpi-header">
            <span className="tv-kpi-label">Total de Membros</span>
            <Users size={16} className="text-muted" />
          </div>
          <div className="tv-kpi-value">{technicians.length}</div>
          <div className="tv-kpi-footer text-emerald-400">
            <span>{activeCount} ativos na plataforma</span>
          </div>
        </div>

        <div className="tv-kpi-card">
          <div className="tv-kpi-header">
            <span className="tv-kpi-label">Super Administradores</span>
            <ShieldCheck size={16} className="text-purple-400" />
          </div>
          <div className="tv-kpi-value">{adminCount}</div>
          <div className="tv-kpi-footer">
            <span>Acesso irrestrito a dispositivos</span>
          </div>
        </div>

        <div className="tv-kpi-card">
          <div className="tv-kpi-header">
            <span className="tv-kpi-label">Convites Pendentes</span>
            <Clock size={16} className="text-amber-400" />
          </div>
          <div className="tv-kpi-value">{pendingInvitesCount}</div>
          <div className="tv-kpi-footer text-amber-400">
            <span>Aguardando ativação por link</span>
          </div>
        </div>
      </div>

      {/* Barra de Busca e Filtros */}
      <div className="tv-tech-filter-bar">
        <div className="tv-tech-search-input">
          <Search size={16} className="text-muted" />
          <input
            type="search"
            placeholder="Buscar por nome ou e-mail do técnico..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="tv-tech-filters">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="tv-tech-select"
          >
            <option value="all">Todas as funções</option>
            <option value="super_admin">Super Administradores</option>
            <option value="technician">Técnicos Operacionais</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="tv-tech-select"
          >
            <option value="all">Todos os status</option>
            <option value="active">Somente Ativos</option>
            <option value="inactive">Somente Inativos</option>
          </select>
        </div>
      </div>

      {/* Tabela de Técnicos */}
      <div className="tv-tech-table-wrap">
        <table className="tv-tech-table">
          <thead>
            <tr>
              <th>Técnico</th>
              <th>Função / Permissão</th>
              <th>Status</th>
              <th>Data de Entrada</th>
              <th className="text-right">Ações & Convite</th>
            </tr>
          </thead>
          <tbody>
            {filteredTechs.length === 0 ? (
              <tr>
                <td colSpan={5} className="tv-empty-tech-row">
                  Nenhum técnico encontrado com os filtros selecionados.
                </td>
              </tr>
            ) : (
              filteredTechs.map((tech) => {
                const initials = tech.displayName
                  .split(' ')
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join('')
                  .toUpperCase();
                const techInvite = invites.find((i) => i.email === tech.email);

                return (
                  <tr key={tech.id} className={!tech.active ? 'tech-row-inactive' : ''}>
                    <td>
                      <div className="tv-tech-user-info">
                        <div className={`tv-tech-avatar ${tech.globalRole}`}>
                          {initials}
                        </div>
                        <div>
                          <strong className="tv-tech-name">{tech.displayName}</strong>
                          <span className="tv-tech-email">{tech.email}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      {tech.globalRole === 'super_admin' ? (
                        <span className="tv-role-badge super-admin" title="Administrador Geral">
                          <ShieldCheck size={13} />
                          Super Admin
                        </span>
                      ) : (
                        <span className="tv-role-badge technician" title="Técnico de Acesso Remoto">
                          <User size={13} />
                          Técnico Operacional
                        </span>
                      )}
                    </td>

                    <td>
                      <span className={`tv-pill-status ${tech.active ? 'status-online' : 'status-offline'}`}>
                        <span className="tv-pill-dot" />
                        <span>{tech.active ? 'Ativo' : 'Desativado'}</span>
                      </span>
                    </td>

                    <td className="tv-date-text">
                      {new Date(tech.createdAt).toLocaleDateString('pt-BR')}
                    </td>

                    <td className="text-right">
                      <div className="tv-tech-action-buttons">
                        {techInvite ? (
                          <>
                            <button
                              type="button"
                              className="tv-action-btn-sm"
                              title="Copiar link de convite"
                              onClick={() => handleCopyInvite(techInvite)}
                            >
                              {copiedToken === techInvite.token ? (
                                <Check size={14} className="text-emerald-400" />
                              ) : (
                                <Copy size={14} />
                              )}
                              <span>{copiedToken === techInvite.token ? 'Copiado!' : 'Copiar Convite'}</span>
                            </button>

                            <a
                              href={buildWhatsAppInviteUrl(techInvite)}
                              target="_blank"
                              rel="noreferrer"
                              className="tv-action-btn-sm whatsapp"
                              title="Enviar convite por WhatsApp"
                            >
                              <MessageCircle size={14} />
                              <span>WhatsApp</span>
                            </a>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="tv-action-btn-sm"
                            title="Gerar novo link de convite para este técnico"
                            onClick={() => {
                              const res = createTechnicianWithInvite(
                                { displayName: tech.displayName, email: tech.email, role: tech.globalRole },
                                currentTechnicianName
                              );
                              setInvites(getInvites());
                              handleCopyInvite(res.invite);
                            }}
                          >
                            <Copy size={14} />
                            <span>Gerar Link</span>
                          </button>
                        )}

                        <div className="tv-menu-container">
                          <button
                            type="button"
                            className="tv-icon-action-btn"
                            title="Mais opções"
                            onClick={() => setMenuOpenForId(menuOpenForId === tech.id ? null : tech.id)}
                          >
                            <MoreVertical size={14} />
                          </button>

                          {menuOpenForId === tech.id && (
                            <div className="tv-dropdown-menu right-aligned">
                              <button
                                type="button"
                                className="tv-dropdown-item"
                                onClick={() => handleToggleActive(tech)}
                              >
                                <Power size={13} />
                                <span>{tech.active ? 'Desativar Acesso' : 'Ativar Acesso'}</span>
                              </button>
                              {tech.userId !== 'remote-bootstrap-admin' && (
                                <button
                                  type="button"
                                  className="tv-dropdown-item danger"
                                  onClick={() => handleDelete(tech)}
                                >
                                  <Trash2 size={13} />
                                  <span>Remover Técnico</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de Criação de Técnico & Convite */}
      {isCreateOpen && (
        <div className="device-dialog-backdrop" onClick={() => setIsCreateOpen(false)}>
          <div
            className="confirm-dialog tv-create-tech-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-tech-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tv-modal-header">
              <h3 id="create-tech-title">
                <UserPlus size={20} className="text-primary" />
                Criar Conta & Gerar Convite
              </h3>
              <button
                type="button"
                className="tv-modal-close"
                onClick={() => setIsCreateOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            {!createdInvite ? (
              <form onSubmit={handleCreate} className="tv-tech-form">
                <p className="tv-form-intro">
                  Cadastre o técnico e gere um link de convite exclusivo. O técnico poderá acessar
                  instantaneamente com sua <strong>Conta Google (Google OAuth)</strong> ou definir sua senha.
                </p>

                <div className="tv-form-group">
                  <label htmlFor="tech-name">Nome Completo do Técnico</label>
                  <input
                    id="tech-name"
                    type="text"
                    required
                    placeholder="Ex: Carlos Oliveira"
                    value={formData.displayName}
                    onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  />
                </div>

                <div className="tv-form-group">
                  <label htmlFor="tech-email">E-mail Profissional ou Gmail</label>
                  <input
                    id="tech-email"
                    type="email"
                    required
                    placeholder="carlos@empresa.com.br ou carlos@gmail.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                  <span className="tv-form-hint">
                    💡 Se o e-mail for do Google (Gmail/Workspace), ele poderá entrar com 1 clique no botão &quot;Continuar com o Google&quot;.
                  </span>
                </div>

                <div className="tv-form-group">
                  <label htmlFor="tech-role">Função / Nível de Permissão</label>
                  <select
                    id="tech-role"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as GlobalRole })}
                  >
                    <option value="technician">Técnico Operacional (Conexão Remota e Suporte)</option>
                    <option value="super_admin">Super Administrador (Acesso total e Gerenciamento)</option>
                  </select>
                </div>

                <div className="confirm-dialog-actions">
                  <button
                    type="button"
                    className="command-button"
                    onClick={() => setIsCreateOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="tv-btn-primary">
                    <UserPlus size={16} />
                    <span>Gerar Convite & Salvar</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="tv-invite-created-card">
                <div className="tv-invite-success-badge">
                  <CheckCircle2 size={32} className="text-emerald-400" />
                  <h4>Técnico Cadastrado com Sucesso!</h4>
                  <p>Envie o link de convite abaixo para que <strong>{createdInvite.name}</strong> acesse o painel.</p>
                </div>

                <div className="tv-invite-link-box">
                  <label>Link Exclusivo de Convite (Válido por 7 dias):</label>
                  <div className="tv-invite-link-row">
                    <input type="text" readOnly value={createdInvite.inviteUrl} />
                    <button
                      type="button"
                      className="tv-btn-primary"
                      onClick={() => handleCopyInvite(createdInvite)}
                    >
                      {copiedToken === createdInvite.token ? <Check size={16} /> : <Copy size={16} />}
                      <span>{copiedToken === createdInvite.token ? 'Copiado!' : 'Copiar'}</span>
                    </button>
                  </div>
                </div>

                <div className="tv-invite-quick-share">
                  <a
                    href={buildWhatsAppInviteUrl(createdInvite)}
                    target="_blank"
                    rel="noreferrer"
                    className="tv-btn-whatsapp-share"
                  >
                    <MessageCircle size={18} />
                    <span>Enviar Convite pelo WhatsApp</span>
                  </a>
                </div>

                <div className="confirm-dialog-actions" style={{ marginTop: '20px' }}>
                  <button
                    type="button"
                    className="command-button"
                    onClick={() => setIsCreateOpen(false)}
                  >
                    Concluir e Fechar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
