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
});
