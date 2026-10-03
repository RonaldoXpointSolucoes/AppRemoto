'use client';

import React, { useMemo, useState } from 'react';
import {
  Users,
  UserPlus,
  ShieldCheck,
  Search,
  Copy,
  Check,
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
  Sparkles,
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
  currentTechnicianName = 'Ronaldo (Super Admin)',
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
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        tech.displayName.toLowerCase().includes(q) ||
        tech.email.toLowerCase().includes(q);
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
          <CheckCircle2 size={16} className="tv-toast-icon" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header com Ações e Apresentação Executiva */}
      <div className="tv-tech-header-card">
        <div className="tv-tech-header-title">
          <div className="tv-tech-icon-circle">
            <Users size={24} />
          </div>
          <div className="tv-tech-title-texts">
            <div className="tv-tech-title-badge-row">
              <h2>Gestão de Equipe & Técnicos</h2>
              <span className="tv-badge-pill-header">
                <Sparkles size={12} />
                Controle de Acessos
              </span>
            </div>
            <p>Gerencie operadores remotos, gere links de convite e controle permissões administrativas.</p>
          </div>
        </div>

        <button
          type="button"
          className="tv-btn-primary-invite"
          onClick={() => {
            setFormData({ displayName: '', email: '', role: 'technician' });
            setCreatedInvite(null);
            setIsCreateOpen(true);
          }}
        >
          <UserPlus size={18} />
          <span>Novo Técnico & Gerar Convite</span>
        </button>
      </div>

      {/* 3 KPI Cards com Glassmorphism e Cores Semânticas */}
      <div className="tv-kpi-grid">
        <div className="tv-kpi-card kpi-total">
          <div className="tv-kpi-inner">
            <div className="tv-kpi-meta">
              <span className="tv-kpi-label">Total de Membros</span>
              <div className="tv-kpi-value">{technicians.length}</div>
            </div>
            <div className="tv-kpi-icon-wrap icon-blue">
              <Users size={22} />
            </div>
          </div>
          <div className="tv-kpi-footer">
            <span className="tv-kpi-status-dot online" />
            <span>{activeCount} ativos na plataforma</span>
          </div>
        </div>

        <div className="tv-kpi-card kpi-admins">
          <div className="tv-kpi-inner">
            <div className="tv-kpi-meta">
              <span className="tv-kpi-label">Super Administradores</span>
              <div className="tv-kpi-value">{adminCount}</div>
            </div>
            <div className="tv-kpi-icon-wrap icon-purple">
              <ShieldCheck size={22} />
            </div>
          </div>
          <div className="tv-kpi-footer">
            <span className="tv-kpi-status-dot purple" />
            <span>Acesso irrestrito a todos dispositivos</span>
          </div>
        </div>

        <div className="tv-kpi-card kpi-pending">
          <div className="tv-kpi-inner">
            <div className="tv-kpi-meta">
              <span className="tv-kpi-label">Convites Pendentes</span>
              <div className="tv-kpi-value">{pendingInvitesCount}</div>
            </div>
            <div className="tv-kpi-icon-wrap icon-amber">
              <Clock size={22} />
            </div>
          </div>
          <div className="tv-kpi-footer">
            <span className="tv-kpi-status-dot amber" />
            <span>Aguardando ativação por link</span>
          </div>
        </div>
      </div>

      {/* Barra de Busca e Filtros Expandida e Ergonômica */}
      <div className="tv-tech-filter-bar">
        <div className="tv-tech-search-box">
          <Search size={18} className="tv-search-icon" />
          <input
            type="search"
            placeholder="Buscar por nome ou e-mail do técnico..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar técnicos"
          />
          {search && (
            <button
              type="button"
              className="tv-search-clear-btn"
              onClick={() => setSearch('')}
              title="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="tv-tech-filters">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="tv-tech-select"
            aria-label="Filtrar por função"
          >
            <option value="all">Todas as funções</option>
            <option value="super_admin">Super Administradores</option>
            <option value="technician">Técnicos Operacionais</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="tv-tech-select"
            aria-label="Filtrar por status"
          >
            <option value="all">Todos os status</option>
            <option value="active">Somente Ativos</option>
            <option value="inactive">Somente Inativos</option>
          </select>
        </div>
      </div>

      {/* Tabela de Membros com Design SaaS Premium */}
      <div className="tv-tech-table-wrap">
        <table className="tv-tech-table">
          <thead>
            <tr>
              <th>Técnico</th>
              <th>Função / Permissão</th>
              <th>Status</th>
              <th>Data de Cadastro</th>
              <th className="text-right">Ações & Convite</th>
            </tr>
          </thead>
          <tbody>
            {filteredTechs.length === 0 ? (
              <tr>
                <td colSpan={5} className="tv-empty-tech-row">
                  <div className="tv-empty-tech-container">
                    <Users size={36} className="text-muted" />
                    <p>Nenhum técnico encontrado com os filtros selecionados.</p>
                  </div>
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
                const techInvite = invites.find((i) => i.email.toLowerCase() === tech.email.toLowerCase());
                const isSuperAdmin = tech.globalRole === 'super_admin';

                return (
                  <tr key={tech.id} className={!tech.active ? 'tech-row-inactive' : ''}>
                    <td>
                      <div className="tv-tech-user-info">
                        <div className={`tv-tech-avatar ${isSuperAdmin ? 'avatar-super-admin' : 'avatar-technician'}`}>
                          {initials}
                        </div>
                        <div className="tv-tech-names">
                          <strong className="tv-tech-name">
                            {tech.displayName}
                            {tech.email === 'ronaldo.xpointsolucoes@gmail.com' && (
                              <span className="tv-tech-you-badge">Você</span>
                            )}
                          </strong>
                          <span className="tv-tech-email">
                            <Mail size={12} className="inline mr-1 opacity-70" />
                            {tech.email}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td>
                      {isSuperAdmin ? (
                        <span className="tv-role-badge super-admin" title="Acesso Total Irrestrito">
                          <ShieldCheck size={14} />
                          Super Admin
                        </span>
                      ) : (
                        <span className="tv-role-badge technician" title="Operador de Acesso Remoto">
                          <User size={14} />
                          Técnico Operacional
                        </span>
                      )}
                    </td>

                    <td>
                      <span className={`tv-pill-status ${tech.active ? 'status-online' : 'status-offline'}`}>
                        <span className={`tv-pill-dot ${tech.active ? 'pulse' : ''}`} />
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
                              className="tv-action-btn-copy"
                              title="Copiar link de convite exclusivo"
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
                              className="tv-action-btn-whatsapp"
                              title="Enviar convite direto pelo WhatsApp"
                            >
                              <MessageCircle size={15} />
                              <span>WhatsApp</span>
                            </a>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="tv-action-btn-generate"
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
                            aria-label="Opções do técnico"
                          >
                            <MoreVertical size={16} />
                          </button>

                          {menuOpenForId === tech.id && (
                            <div className="tv-dropdown-menu right-aligned">
                              <button
                                type="button"
                                className="tv-dropdown-item"
                                onClick={() => handleToggleActive(tech)}
                              >
                                <Power size={14} />
                                <span>{tech.active ? 'Desativar Acesso' : 'Ativar Acesso'}</span>
                              </button>
                              {tech.userId !== 'remote-bootstrap-admin' && tech.email !== 'ronaldo.xpointsolucoes@gmail.com' && (
                                <button
                                  type="button"
                                  className="tv-dropdown-item danger"
                                  onClick={() => handleDelete(tech)}
                                >
                                  <Trash2 size={14} />
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
        <div className="tv-modal-backdrop" onClick={() => !createdInvite && setIsCreateOpen(false)}>
          <div className="tv-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tv-modal-header">
              <div className="tv-modal-title-group">
                <div className="tv-modal-icon-badge">
                  <UserPlus size={20} />
                </div>
                <h2>Criar Conta & Gerar Convite</h2>
              </div>
              <button
                type="button"
                className="tv-modal-close-btn"
                onClick={() => setIsCreateOpen(false)}
                aria-label="Fechar modal"
              >
                <X size={18} />
              </button>
            </div>

            {!createdInvite ? (
              <form onSubmit={handleCreate}>
                <div className="tv-modal-body">
                  <div className="tv-modal-form-group">
                    <label htmlFor="tech-name">Nome Completo</label>
                    <input
                      id="tech-name"
                      type="text"
                      required
                      placeholder="Ex: Carlos Oliveira"
                      value={formData.displayName}
                      onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                    />
                  </div>

                  <div className="tv-modal-form-group">
                    <label htmlFor="tech-email">E-mail Corporativo ou Gmail</label>
                    <input
                      id="tech-email"
                      type="email"
                      required
                      placeholder="Ex: carlos.suporte@xpointsolucoes.com.br"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>

                  <div className="tv-modal-form-group">
                    <label>Nível de Permissão</label>
                    <div className="tv-modal-radio-group">
                      <div
                        className={`tv-modal-radio-card ${formData.role === 'technician' ? 'selected' : ''}`}
                        onClick={() => setFormData({ ...formData, role: 'technician' })}
                      >
                        <User size={18} className="text-primary" />
                        <div className="tv-modal-radio-meta">
                          <strong>Técnico Operacional</strong>
                          <span>Acessa e conecta aos computadores autorizados</span>
                        </div>
                      </div>

                      <div
                        className={`tv-modal-radio-card ${formData.role === 'super_admin' ? 'selected' : ''}`}
                        onClick={() => setFormData({ ...formData, role: 'super_admin' })}
                      >
                        <ShieldCheck size={18} className="text-purple-400" />
                        <div className="tv-modal-radio-meta">
                          <strong>Super Admin</strong>
                          <span>Acesso irrestrito a todas as máquinas e gestão</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="tv-modal-footer">
                  <button
                    type="button"
                    className="tv-modal-btn-cancel"
                    onClick={() => setIsCreateOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="tv-modal-btn-submit">
                    <UserPlus size={16} />
                    <span>Convidar e Gerar Link</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="tv-modal-body">
                <div className="tv-invite-success-box">
                  <div className="tv-invite-success-header">
                    <CheckCircle2 size={24} className="text-emerald-400" />
                    <div>
                      <strong className="text-base text-white block">Técnico Cadastrado com Sucesso!</strong>
                      <span className="text-xs text-muted block">
                        Envie o link exclusivo de convite para {formData.displayName}:
                      </span>
                    </div>
                  </div>

                  <div className="tv-invite-url-container">
                    <input
                      type="text"
                      readOnly
                      value={createdInvite.inviteUrl}
                      className="tv-invite-input"
                    />
                    <button
                      type="button"
                      className="tv-btn-copy-invite"
                      onClick={() => handleCopyInvite(createdInvite)}
                    >
                      {copiedToken === createdInvite.token ? <Check size={16} /> : <Copy size={16} />}
                      <span>{copiedToken === createdInvite.token ? 'Copiado!' : 'Copiar'}</span>
                    </button>
                  </div>

                  <a
                    href={buildWhatsAppInviteUrl(createdInvite)}
                    target="_blank"
                    rel="noreferrer"
                    className="tv-whatsapp-share-btn"
                  >
                    <MessageCircle size={18} />
                    <span>Enviar Convite pelo WhatsApp</span>
                  </a>
                </div>

                <div className="tv-modal-footer mt-4">
                  <button
                    type="button"
                    className="tv-modal-btn-cancel"
                    onClick={() => {
                      setCreatedInvite(null);
                      setIsCreateOpen(false);
                    }}
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
