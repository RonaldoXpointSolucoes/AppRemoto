// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeviceView } from '@appremoto/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { OrganizationView } from '../../lib/api';
import { ApiClientError } from '../../lib/api';
import { DeviceDirectory, type DeviceDirectoryService } from './device-table';

const organizations: OrganizationView[] = [
  { id: 'org-a', name: 'Operacao Norte', slug: 'operacao-norte' },
  { id: 'org-b', name: 'Operacao Sul', slug: 'operacao-sul' },
];

function device(overrides: Partial<DeviceView> = {}): DeviceView {
  return {
    id: 'device-1', organizationId: 'org-a', organizationName: 'Operacao Norte',
    deviceUuid: '00000000-0000-4000-8000-000000000001', displayName: 'Recepcao 01',
    hostname: 'RECEPCAO-01', operatingSystem: 'Windows', osVersion: '11 Pro',
    rustdeskId: '123456789', agentVersion: '1.0.0', rustdeskVersion: '1.4.0',
    lastSeenAt: '2026-09-30T18:00:00.000Z', enabled: true, status: 'ONLINE', ...overrides,
  };
}

function service(overrides: Partial<DeviceDirectoryService> = {}): DeviceDirectoryService {
  return {
    getOrganizations: vi.fn().mockResolvedValue(organizations),
    getDevices: vi.fn().mockResolvedValue({ devices: [device()], nextCursor: null }),
    expireSession: vi.fn().mockResolvedValue(undefined), ...overrides,
  };
}

function renderDirectory(directoryService: DeviceDirectoryService, onSessionExpired = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(<QueryClientProvider client={queryClient}>
    <DeviceDirectory service={directoryService} onSessionExpired={onSessionExpired} />
  </QueryClientProvider>);
}

describe('DeviceDirectory', () => {
  it('renders only the safe device projection in the desktop hierarchy', async () => {
    renderDirectory(service());
    const table = await screen.findByRole('table', { name: 'Dispositivos remotos' });
    for (const heading of ['Dispositivo', 'Organizacao', 'Hostname', 'Sistema operacional', 'RustDesk ID', 'Status', 'Ultima atividade']) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    for (const value of ['Recepcao 01', 'Operacao Norte', 'RECEPCAO-01', 'Windows 11 Pro', '123456789', 'ONLINE']) {
      expect(within(table).getByText(value)).toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent(/token|senha|password|192\.168\./i);
  });

  it('preserves the same field hierarchy in the mobile record', async () => {
    renderDirectory(service());
    const record = await screen.findByRole('article', { name: 'Recepcao 01' });
    for (const label of ['Organizacao', 'Hostname', 'Sistema operacional', 'RustDesk ID', 'Status', 'Ultima atividade']) {
      expect(within(record).getByText(label)).toBeInTheDocument();
    }
    expect(within(record).getByText('Operacao Norte')).toBeInTheDocument();
    expect(within(record).getByText('ONLINE')).toBeInTheDocument();
  });

  it('keeps long safe values available without using them as layout dimensions', async () => {
    const longName = 'Unidade operacional com identificador extremamente longo ' + 'X'.repeat(80);
    renderDirectory(service({ getDevices: vi.fn().mockResolvedValue({
      devices: [device({ displayName: longName, hostname: 'HOST-' + 'Y'.repeat(120) })], nextCursor: null,
    }) }));
    const record = await screen.findByRole('article', { name: longName });
    expect(within(record).getByText(longName)).toHaveClass('device-value');
    expect(within(record).getByText('HOST-' + 'Y'.repeat(120))).toHaveClass('device-value');
  });

  it('shows loading before either authorized collection is available', () => {
    renderDirectory(service({ getOrganizations: vi.fn(() => new Promise<OrganizationView[]>(() => undefined)) }));
    expect(screen.getByRole('status')).toHaveTextContent('Carregando dispositivos...');
    expect(screen.queryByText('ONLINE')).not.toBeInTheDocument();
  });

  it('distinguishes no authorized organizations from an organization with no devices', async () => {
    const emptyOrganizations = service({ getOrganizations: vi.fn().mockResolvedValue([]) });
    const { unmount } = renderDirectory(emptyOrganizations);
    expect(await screen.findByText('Nenhuma organizacao autorizada.')).toBeInTheDocument();
    expect(emptyOrganizations.getDevices).not.toHaveBeenCalled();
    unmount();
    const emptyDevices = service({ getDevices: vi.fn().mockResolvedValue({ devices: [], nextCursor: null }) });
    renderDirectory(emptyDevices);
    await userEvent.selectOptions(await screen.findByLabelText('Organizacao'), 'org-a');
    expect(await screen.findByText('Esta organizacao ainda nao possui dispositivos.')).toBeInTheDocument();
  });

  it('shows a specific no-results state for search and status filters', async () => {
    renderDirectory(service({ getDevices: vi.fn().mockResolvedValue({ devices: [], nextCursor: null }) }));
    await screen.findByLabelText('Buscar dispositivos');
    await userEvent.type(screen.getByLabelText('Buscar dispositivos'), 'financeiro');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Nenhum dispositivo corresponde aos filtros.')).toBeInTheDocument();
  });

  it('expires an unauthorized session without exposing the server response', async () => {
    const expired = vi.fn();
    renderDirectory(service({ getOrganizations: vi.fn().mockRejectedValue(new ApiClientError({
      code: 'UNAUTHENTICATED', message: 'private upstream detail', status: 401,
    })) }), expired);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sessao expirada. Entre novamente.');
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
    expect(document.body).not.toHaveTextContent('private upstream detail');
  });

  it('offers a recoverable retry and never renders private error details', async () => {
    const getOrganizations = vi.fn()
      .mockRejectedValueOnce(new ApiClientError({ code: 'NETWORK_ERROR', message: 'private network detail', status: 0 }))
      .mockResolvedValueOnce(organizations);
    renderDirectory(service({ getOrganizations }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nao foi possivel carregar os dispositivos.');
    expect(document.body).not.toHaveTextContent('private network detail');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findAllByText('Recepcao 01')).not.toHaveLength(0);
  });

  it('does not represent cached online state as current while refresh is pending', async () => {
    let completeRefresh: ((value: { devices: DeviceView[]; nextCursor: null }) => void) | undefined;
    const getDevices = vi.fn().mockResolvedValueOnce({ devices: [device()], nextCursor: null })
      .mockImplementationOnce(() => new Promise((resolve) => { completeRefresh = resolve; }));
    renderDirectory(service({ getDevices }));
    await screen.findAllByText('ONLINE');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar dispositivos' }));
    expect(screen.getByRole('button', { name: 'Atualizando dispositivos' })).toBeDisabled();
    expect(screen.queryByText('ONLINE')).not.toBeInTheDocument();
    expect(screen.getAllByText('Atualizando')).not.toHaveLength(0);
    completeRefresh?.({ devices: [device({ status: 'OFFLINE' })], nextCursor: null });
    expect(await screen.findAllByText('OFFLINE')).not.toHaveLength(0);
  });

  it('composes filters and search, resets the keyset cursor, and retains controls on refresh', async () => {
    const getDevices = vi.fn().mockResolvedValueOnce({ devices: [device()], nextCursor: 'cursor-page-2' })
      .mockResolvedValue({ devices: [device({ id: 'device-2' })], nextCursor: null });
    renderDirectory(service({ getDevices }));
    await screen.findAllByText('Recepcao 01');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(getDevices).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'cursor-page-2' })));
    await userEvent.selectOptions(screen.getByLabelText('Organizacao'), 'org-b');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'OFFLINE');
    await userEvent.type(screen.getByLabelText('Buscar dispositivos'), 'caixa 02');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(getDevices).toHaveBeenLastCalledWith({
      organizationId: 'org-b', status: 'OFFLINE', search: 'caixa 02', limit: 25,
    }));
    expect(screen.getByLabelText('Organizacao')).toHaveValue('org-b');
    expect(screen.getByLabelText('Status')).toHaveValue('OFFLINE');
    expect(screen.getByLabelText('Buscar dispositivos')).toHaveValue('caixa 02');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar dispositivos' }));
    await waitFor(() => expect(getDevices).toHaveBeenLastCalledWith({
      organizationId: 'org-b', status: 'OFFLINE', search: 'caixa 02', limit: 25,
    }));
    expect(screen.getByLabelText('Organizacao')).toHaveValue('org-b');
    expect(screen.getByLabelText('Status')).toHaveValue('OFFLINE');
    expect(screen.getByLabelText('Buscar dispositivos')).toHaveValue('caixa 02');
  });
});
