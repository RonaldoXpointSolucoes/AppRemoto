// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  defaultGroups,
  getDeviceGroups,
  saveDeviceGroups,
  createDeviceGroup,
  renameDeviceGroup,
  deleteDeviceGroup,
  assignDeviceToGroup,
  getDeviceFolderMap,
  parseDeviceNotes,
  encodeDeviceNotes,
  saveDeviceCustomMetadata,
  getCustomMetadataMap,
  getFavoriteDeviceIds,
  toggleFavoriteDeviceId,
} from './teamviewer-storage';

describe('teamviewer-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('retorna os grupos padrão quando storage está vazio', () => {
    const groups = getDeviceGroups();
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.name)).toEqual(['Clientes', 'X-Point Soluções', 'Servidores & Infra']);
  });

  it('permite criar uma nova pasta sem duplicar', () => {
    const updated = createDeviceGroup('Totens de Autoatendimento');
    expect(updated).toHaveLength(4);
    expect(updated.some((g) => g.name === 'Totens de Autoatendimento')).toBe(true);

    // Tentativa duplicada não adiciona
    const dup = createDeviceGroup('Totens de Autoatendimento');
    expect(dup).toHaveLength(4);
  });

  it('permite renomear uma pasta existente', () => {
    const initial = createDeviceGroup('Filiais');
    const created = initial.find((g) => g.name === 'Filiais')!;

    const renamed = renameDeviceGroup(created.id, 'Filiais Sul');
    expect(renamed.find((g) => g.id === created.id)?.name).toBe('Filiais Sul');
  });

  it('move computadores para "Clientes" ao excluir uma pasta', () => {
    const withGroup = createDeviceGroup('Temporarios');
    const targetGroup = withGroup.find((g) => g.name === 'Temporarios')!;

    assignDeviceToGroup('dev-123', targetGroup.id, { rustdeskId: '999888777', hostname: 'PC-TESTE' });
    const folderMapBefore = getDeviceFolderMap();
    expect(folderMapBefore['dev-123']).toBe(targetGroup.id);

    const afterDelete = deleteDeviceGroup(targetGroup.id);
    expect(afterDelete.some((g) => g.id === targetGroup.id)).toBe(false);

    const clientsGroup = afterDelete.find((g) => g.id === 'group_clients')!;
    expect(clientsGroup.deviceIds).toContain('dev-123');

    const folderMapAfter = getDeviceFolderMap();
    expect(folderMapAfter['dev-123']).toBe('group_clients');
  });

  it('codifica e decodifica notas com tags de pasta para persistência no banco', () => {
    const encoded = encodeDeviceNotes({
      folderName: 'Totens de Balcão',
      notes: 'IP 192.168.1.100, suporte 24h',
    });
    expect(encoded).toBe('[pasta:Totens de Balcão]\nIP 192.168.1.100, suporte 24h');

    const parsed = parseDeviceNotes(encoded);
    expect(parsed.folderName).toBe('Totens de Balcão');
    expect(parsed.notes).toBe('IP 192.168.1.100, suporte 24h');

    // Sem notas extras
    const encodedOnlyFolder = encodeDeviceNotes({ folderName: 'Servidores' });
    expect(encodedOnlyFolder).toBe('[pasta:Servidores]');
    const parsedOnlyFolder = parseDeviceNotes(encodedOnlyFolder);
    expect(parsedOnlyFolder.folderName).toBe('Servidores');
    expect(parsedOnlyFolder.notes).toBe('');

    // Texto livre normal sem tag de pasta
    const normalText = parseDeviceNotes('Apenas anotação comum do técnico');
    expect(normalText.folderName).toBeUndefined();
    expect(normalText.notes).toBe('Apenas anotação comum do técnico');
  });

  it('salva e recupera metadados customizados do dispositivo', () => {
    saveDeviceCustomMetadata('dev-999', {
      displayName: 'Totem Principal',
      notes: 'Entrada da loja',
      folderId: 'group_clients',
    });

    const metaMap = getCustomMetadataMap();
    expect(metaMap['dev-999']).toEqual({
      displayName: 'Totem Principal',
      notes: 'Entrada da loja',
      folderId: 'group_clients',
    });
  });

  it('fixa e desafixa computadores favoritos no topo para operação rápida', () => {
    expect(getFavoriteDeviceIds()).toEqual([]);

    const afterAdd = toggleFavoriteDeviceId('dev-a');
    expect(afterAdd).toEqual(['dev-a']);
    expect(getFavoriteDeviceIds()).toEqual(['dev-a']);

    const afterAddSecond = toggleFavoriteDeviceId('dev-b');
    expect(afterAddSecond).toEqual(['dev-b', 'dev-a']);

    const afterRemove = toggleFavoriteDeviceId('dev-a');
    expect(afterRemove).toEqual(['dev-b']);
  });

  it('gera protocolo unico e laudo tecnico automatizado com telemetria completa', async () => {
    const {
      saveRecentConnection,
      updateRecentConnectionNotes,
      getRecentConnections,
    } = await import('./teamviewer-storage');

    const startedAt = '2026-10-17T21:38:00.000Z';
    saveRecentConnection({
      deviceId: 'dev-totem-01',
      displayName: 'Burguer Plus Totem Balcão',
      hostname: 'DESKTOP-S7VUVBE',
      organizationName: 'XPoint',
      folderName: 'Clientes',
      rustdeskId: '1987892321',
      operatingSystem: 'Windows 10 (22H2)',
      osBuild: 'Build 19045',
      osBadge: 'Win 10',
      localIp: '192.168.15.42',
      technicianName: 'Ronaldo',
      connectedAt: startedAt,
      mode: 'automatic',
    });

    const initialList = getRecentConnections();
    expect(initialList).toHaveLength(1);
    expect(initialList[0].protocolNumber).toMatch(/^XP-20261017-\d{4}$/);
    expect(initialList[0].autoReportText).toContain('LAUDO TÉCNICO AUTOMATIZADO');
    expect(initialList[0].autoReportText).toContain('Burguer Plus Totem Balcão (DESKTOP-S7VUVBE)');
    expect(initialList[0].autoReportText).toContain('Windows 10 (22H2) (Build 19045)');

    updateRecentConnectionNotes(
      'dev-totem-01',
      startedAt,
      'Totem destravado e impressora testada',
      71,
      {
        resolutionStatus: 'resolved',
        executedActions: [
          'Reinício / Destravamento de Totem ou PDV',
          'Configuração de Impressora Térmica / Spooler',
        ],
      }
    );

    const updatedList = getRecentConnections();
    expect(updatedList[0].durationSeconds).toBe(71);
    expect(updatedList[0].executedActions).toHaveLength(2);
    expect(updatedList[0].autoReportText).toContain('1m 11s (71s)');
    expect(updatedList[0].autoReportText).toContain('Reinício / Destravamento de Totem ou PDV');
  });

  it('mantem salvos os filtros, ordenacao, densidade e favoritos separadamente para cada usuario', async () => {
    const {
      getUserViewPreferences,
      saveUserViewPreferences,
      getLastActiveUserId,
      setLastActiveUserId,
    } = await import('./teamviewer-storage');

    // Usuário 1 (Ronaldo) escolhe pasta X-Point Soluções, status ONLINE, ordenação por nome e modo compacto
    setLastActiveUserId('user-ronaldo');
    saveUserViewPreferences('user-ronaldo', {
      organizationId: 'group_xpoint',
      status: 'ONLINE',
      search: 'Servidor',
      onlyOnlineQuickFilter: true,
      sortBy: 'name',
      compactMode: true,
    });
    toggleFavoriteDeviceId('dev-srv-01', 'user-ronaldo');

    // Usuário 2 (Arthur) escolhe pasta Clientes, busca "Totem", modo tabela
    setLastActiveUserId('user-arthur');
    saveUserViewPreferences('user-arthur', {
      organizationId: 'group_clients',
      status: '',
      search: 'Totem',
      viewMode: 'table',
      onlyFavoritesQuickFilter: true,
    });
    toggleFavoriteDeviceId('dev-totem-99', 'user-arthur');

    expect(getLastActiveUserId()).toBe('user-arthur');

    const prefsRonaldo = getUserViewPreferences('user-ronaldo');
    expect(prefsRonaldo.organizationId).toBe('group_xpoint');
    expect(prefsRonaldo.status).toBe('ONLINE');
    expect(prefsRonaldo.search).toBe('');
    expect(prefsRonaldo.onlyOnlineQuickFilter).toBe(true);
    expect(prefsRonaldo.sortBy).toBe('name');
    expect(prefsRonaldo.compactMode).toBe(true);
    expect(prefsRonaldo.viewMode).toBe('teamviewer');
    expect(getFavoriteDeviceIds('user-ronaldo')).toEqual(['dev-srv-01']);

    const prefsArthur = getUserViewPreferences('user-arthur');
    expect(prefsArthur.organizationId).toBe('group_clients');
    expect(prefsArthur.status).toBe('');
    expect(prefsArthur.search).toBe('');
    expect(prefsArthur.viewMode).toBe('table');
    expect(prefsArthur.onlyFavoritesQuickFilter).toBe(true);
    expect(prefsArthur.compactMode).toBe(false);
    expect(getFavoriteDeviceIds('user-arthur')).toEqual(['dev-totem-99']);
  });

  it('persiste e restaura a sessao ativa caso o navegador mobile recarregue ao voltar do RustDesk', async () => {
    const {
      saveActiveSessionDraft,
      getActiveSessionDraft,
    } = await import('./teamviewer-storage');

    expect(getActiveSessionDraft()).toBeNull();

    const draft = {
      protocolNumber: 'XP-20261017-9641',
      deviceId: 'dev-bar-ne',
      displayName: 'BAR DA NE SERVIDOR',
      hostname: 'SERVIDOR',
      organizationName: 'XPoint',
      folderName: 'Clientes',
      rustdeskId: '1546924957',
      operatingSystem: 'Windows 11 (23H2)',
      osBuild: 'Build 22631',
      osBadge: 'Win 11',
      technicianName: 'Ronaldo',
      startedAt: new Date().toISOString(),
    };

    saveActiveSessionDraft(draft);
    expect(getActiveSessionDraft()).toEqual(draft);

    saveActiveSessionDraft(null);
    expect(getActiveSessionDraft()).toBeNull();

    const { saveActiveSessionsDraft, getActiveSessionsDraft } = await import('./teamviewer-storage');
    const draft1 = { ...draft, deviceId: 'dev-1', displayName: 'Máquina 1', draftNotes: 'Obs 1' };
    const draft2 = { ...draft, deviceId: 'dev-2', displayName: 'Máquina 2', draftNotes: 'Obs 2' };
    const draft3 = { ...draft, deviceId: 'dev-3', displayName: 'Máquina 3', draftNotes: 'Obs 3' };
    saveActiveSessionsDraft([draft1, draft2, draft3]);
    expect(getActiveSessionsDraft()).toHaveLength(3);
    expect(getActiveSessionsDraft().map((s) => s.draftNotes)).toEqual(['Obs 1', 'Obs 2', 'Obs 3']);
  });

  it('ativa por padrao o filtro de computadores online e nao ressuscita tecnicos deletados ao voltar para a tela', async () => {
    const { DEFAULT_USER_VIEW_PREFERENCES, getUserViewPreferences } = await import('./teamviewer-storage');
    const { getTechnicians, deleteTechnician } = await import('../technicians/technician-service');

    expect(DEFAULT_USER_VIEW_PREFERENCES.onlyOnlineQuickFilter).toBe(false);
    expect(DEFAULT_USER_VIEW_PREFERENCES.sortBy).toBe('smart');
    expect(getUserViewPreferences('new-user').onlyOnlineQuickFilter).toBe(false);

    const initial = getTechnicians();
    const david = initial.find((t) => t.email === 'david_ladivas@hotmail.com')!;
    expect(david).toBeDefined();

    const afterDelete = deleteTechnician(david);
    expect(afterDelete.some((t) => t.email === 'david_ladivas@hotmail.com')).toBe(false);

    // Quando o usuario retorna para a tela de tecnicos, o tecnico deletado nao reaparece
    const reloaded = getTechnicians();
    expect(reloaded.some((t) => t.email === 'david_ladivas@hotmail.com')).toBe(false);
  });

  it('registra logs detalhados de auditoria para edicao de nome de cliente existente e exclusao de maquina', async () => {
    const { recordDeviceAuditLog, getDeviceAuditLogs } = await import('./teamviewer-storage');

    expect(getDeviceAuditLogs()).toEqual([]);

    recordDeviceAuditLog({
      action: 'EDIT_NAME',
      deviceId: 'dev-100',
      rustdeskId: '123456789',
      hostname: 'CAIXA-01',
      organizationName: 'XPoint',
      previousDisplayName: 'Cliente Antigo',
      newDisplayName: 'Burguer Plus - Caixa 01',
      previousFolderName: 'Clientes',
      newFolderName: 'Clientes',
      adminOnlyAccess: true,
      technicianName: 'Ronaldo',
    });

    recordDeviceAuditLog({
      action: 'DELETE_DEVICE',
      deviceId: 'dev-200',
      rustdeskId: '987654321',
      hostname: 'PC-ANTIGO',
      organizationName: 'XPoint',
      previousDisplayName: 'Máquina Desativada',
      newDisplayName: 'Máquina Desativada',
      technicianName: 'Ronaldo',
    });

    const logs = getDeviceAuditLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].action).toBe('DELETE_DEVICE');
    expect(logs[0].summary).toContain('Exclusão do cliente/máquina "Máquina Desativada"');
    expect(logs[1].action).toBe('EDIT_NAME');
    expect(logs[1].previousDisplayName).toBe('Cliente Antigo');
    expect(logs[1].newDisplayName).toBe('Burguer Plus - Caixa 01');
    expect(logs[1].summary).toContain('de "Cliente Antigo" para "Burguer Plus - Caixa 01"');
  });
});



