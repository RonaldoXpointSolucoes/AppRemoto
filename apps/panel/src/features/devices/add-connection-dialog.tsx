'use client';

import { useState, type FormEvent } from 'react';
import { Plus, X, FolderPlus, Monitor, Download, Zap, Check } from 'lucide-react';
import Link from 'next/link';
import { createDeviceGroup, saveRecentConnection } from './teamviewer-storage';
import { launchRustDesk, manualRustDeskUri } from './rustdesk-launch';

export function AddConnectionDialog({
  isOpen,
  onClose,
  onGroupCreated,
  technicianName,
}: {
  isOpen: boolean;
  onClose(): void;
  onGroupCreated?(): void;
  technicianName: string;
}) {
  const [tab, setTab] = useState<'quick_connect' | 'new_group' | 'installer'>('quick_connect');
  const [rustdeskId, setRustdeskId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupCreatedSuccess, setGroupCreatedSuccess] = useState(false);
  const [connectError, setConnectError] = useState('');

  if (!isOpen) return null;

  function handleQuickConnect(e: FormEvent) {
    e.preventDefault();
    setConnectError('');
    const cleanId = rustdeskId.replace(/\s+/g, '');
    if (!cleanId || !/^[0-9]{6,16}$/.test(cleanId)) {
      setConnectError('Informe um ID do RustDesk válido (6 a 16 dígitos numéricos).');
      return;
    }
    try {
      const serverHost = '179.199.142.157:21116';
      const publicKey = 'i44K4wFmI7+wE42H70q8xG2E6eQ5J+Lp40uK18rXkGQ=';
      const baseUri = `rustdesk://connect/${cleanId}@${serverHost}?key=${encodeURIComponent(publicKey)}`;
      const targetUri = password ? manualRustDeskUri(baseUri, password) : baseUri;
      launchRustDesk(targetUri);

      // Salva no histórico de recentes
      saveRecentConnection({
        deviceId: `manual_${cleanId}`,
        displayName: displayName.trim() || `ID ${cleanId}`,
        hostname: displayName.trim() || cleanId,
        organizationName: 'Conexão Manual',
        rustdeskId: cleanId,
        technicianName: technicianName || 'Técnico',
        mode: password ? 'automatic' : 'manual',
      });

      onClose();
    } catch {
      setConnectError('Não foi possível iniciar o RustDesk no seu navegador. Certifique-se de que o RustDesk está instalado.');
    }
  }

  function handleCreateGroup(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    createDeviceGroup(groupName.trim());
    setGroupCreatedSuccess(true);
    setGroupName('');
    onGroupCreated?.();
    setTimeout(() => {
      setGroupCreatedSuccess(false);
      onClose();
    }, 1000);
  }

  return (
    <div className="add-dialog-overlay" onClick={onClose}>
      <div className="add-dialog-card animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="add-dialog-header">
          <div className="add-dialog-title">
            <Plus size={20} className="text-primary" />
            <h3>Adicionar e Conectar</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="add-dialog-tabs">
          <button
            type="button"
            className={`add-tab-btn ${tab === 'quick_connect' ? 'active' : ''}`}
            onClick={() => setTab('quick_connect')}
          >
            <Zap size={16} />
            Conexão Rápida / Manual
          </button>
          <button
            type="button"
            className={`add-tab-btn ${tab === 'new_group' ? 'active' : ''}`}
            onClick={() => setTab('new_group')}
          >
            <FolderPlus size={16} />
            Criar Nova Pasta / Grupo
          </button>
          <button
            type="button"
            className={`add-tab-btn ${tab === 'installer' ? 'active' : ''}`}
            onClick={() => setTab('installer')}
          >
            <Download size={16} />
            Instalador no Cliente
          </button>
        </div>

        <div className="add-dialog-body">
          {tab === 'quick_connect' && (
            <form onSubmit={handleQuickConnect} className="add-form">
              <p className="add-form-hint">
                Conecte-se imediatamente a qualquer computador informando o ID do RustDesk. A conexão usará o servidor exclusivo XPoint com latência ultrabaixa.
              </p>

              <div className="field">
                <label htmlFor="quick-rustdesk-id">ID do RustDesk (obrigatório):</label>
                <input
                  id="quick-rustdesk-id"
                  type="text"
                  placeholder="Ex: 264 741 357"
                  value={rustdeskId}
                  onChange={(e) => setRustdeskId(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="quick-display-name">Nome ou identificação (opcional):</label>
                <input
                  id="quick-display-name"
                  type="text"
                  placeholder="Ex: Servidor de Backup, Caixa 01"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="quick-password">Senha fixa do cliente (opcional para 1 clique):</label>
                <input
                  id="quick-password"
                  type="password"
                  placeholder="Deixe em branco para pedir na tela"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {connectError && <p className="field-error" role="alert">{connectError}</p>}

              <div className="add-dialog-footer">
                <button type="button" className="command-button" onClick={onClose}>
                  Cancelar
                </button>
                <button type="submit" className="primary-button guide-link">
                  <Monitor size={18} />
                  Conectar Imediatamente
                </button>
              </div>
            </form>
          )}

          {tab === 'new_group' && (
            <form onSubmit={handleCreateGroup} className="add-form">
              <p className="add-form-hint">
                Crie pastas para organizar computadores por cliente, tipo ou filial (ex: <em>Clientes VIP</em>, <em>Servidores</em>, <em>Totens</em>).
              </p>

              <div className="field">
                <label htmlFor="group-name-input">Nome da nova pasta / grupo:</label>
                <input
                  id="group-name-input"
                  type="text"
                  placeholder="Ex: Restaurantes, Escritório Central"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {groupCreatedSuccess && (
                <p className="session-save-success" role="status">
                  <Check size={16} /> Grupo criado com sucesso!
                </p>
              )}

              <div className="add-dialog-footer">
                <button type="button" className="command-button" onClick={onClose}>
                  Cancelar
                </button>
                <button type="submit" className="primary-button guide-link">
                  <FolderPlus size={18} />
                  Criar Pasta
                </button>
              </div>
            </form>
          )}

          {tab === 'installer' && (
            <div className="add-installer-tab">
              <p className="add-form-hint">
                Para que o computador do cliente apareça automaticamente nas listas e permita acesso com 1 clique a qualquer momento sem pedir senha, instale o agente XPoint.
              </p>
              <div className="installer-card-promo">
                <h4>Instalador Completo Automatizado</h4>
                <p>Configura o RustDesk com criptografia forte, inicialização como serviço e presença em tempo real.</p>
                <Link href="/setup" className="primary-button guide-link" onClick={onClose}>
                  <Download size={18} />
                  Ir para Download do Instalador
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
