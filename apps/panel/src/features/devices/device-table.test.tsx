// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeviceView } from '@appremoto/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { OrganizationView } from '../../lib/api';
import { ApiClientError } from '../../lib/api';
import { DeviceDirectory, type DeviceDirectoryService } from './device-table';
import { LoginForm } from '../auth/login-form';

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
  return { ...render(<QueryClientProvider client={queryClient}>
    <DeviceDirectory service={directoryService} onSessionExpired={onSessionExpired} />
  </QueryClientProvider>), queryClient };
}

describe('DeviceDirectory', () => {
  it('awaits one remote logout before clearing the session cache and redirecting', async () => {
    let finishLogout!: () => void;
    const expireSession = vi.fn(() => new Promise<void>((resolve) => { finishLogout = resolve; }));
    const onSessionExpired = vi.fn();
    const { queryClient } = renderDirectory(service({ expireSession }), onSessionExpired);
    queryClient.setQueryData(['private-session-state'], { retained: true });
    const logout = await screen.findByRole('button', { name: 'Sair da conta' });

    await userEvent.click(logout);
    await userEvent.click(logout);

    expect(logout).toBeDisabled();
    expect(expireSession).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['private-session-state'])).toEqual({ retained: true });

    await act(async () => finishLogout());
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    expect(queryClient.getQueryData(['private-session-state'])).toBeUndefined();
  });

  it('keeps the active session and shows a safe accessible error when logout fails', async () => {
    const expireSession = vi.fn().mockRejectedValue(new Error('private Appwrite failure'));
    const onSessionExpired = vi.fn();
    const { queryClient } = renderDirectory(service({ expireSession }), onSessionExpired);
    queryClient.setQueryData(['private-session-state'], { retained: true });

    await userEvent.click(await screen.findByRole('button', { name: 'Sair da conta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nao foi possivel sair. Tente novamente.');
    expect(screen.getByRole('button', { name: 'Sair da conta' })).toBeEnabled();
    expect(expireSession).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['private-session-state'])).toEqual({ retained: true });
    expect(document.body).not.toHaveTextContent('private Appwrite failure');
  });

  it('starts a fresh snapshot without the old cursor when refreshing a filtered second page', async () => {
    const getDevices = vi.fn().mockImplementation(async (query) => ({
      devices: [device({ displayName: query.cursor ? 'Pagina dois antiga' : 'Snapshot novo' })],
      nextCursor: query.cursor ? null : 'snapshot-old-page-2',
    }));
    renderDirectory(service({ getDevices }));
    await userEvent.selectOptions(await screen.findByLabelText('Organizacao'), 'org-b');
    await userEvent.click(await screen.findByRole('button', { name: 'Proxima pagina' }));
    await screen.findAllByText('Pagina dois antiga');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar dispositivos' }));
    await waitFor(() => expect(getDevices).toHaveBeenLastCalledWith({ organizationId: 'org-b', limit: 25 }));
    expect(await screen.findAllByText('Snapshot novo')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Pagina anterior' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Organizacao')).toHaveValue('org-b');
  });

  it('polls fresh snapshots through five minutes, masks failures and recovers without overlapping requests', async () => {
    const getDevices = vi.fn().mockResolvedValue({ devices: [device()], nextCursor: 'old-cursor' });
    vi.useFakeTimers();
    try {
      renderDirectory(service({ getDevices }));
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getAllByText('ONLINE')).not.toHaveLength(0);
      for (let tick = 1; tick <= 10; tick += 1) {
        getDevices.mockResolvedValue({ devices: [device({ status: tick >= 4 ? 'OFFLINE' : 'ONLINE' })], nextCursor: null });
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(getDevices).toHaveBeenCalledTimes(tick + 1);
        expect(getDevices).toHaveBeenLastCalledWith({ limit: 25 });
      }
      expect(screen.getAllByText('OFFLINE')).not.toHaveLength(0);
      let rejectSlow!: (reason: Error) => void;
      getDevices.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSlow = reject; }));
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(screen.queryByText('OFFLINE')).not.toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(getDevices).toHaveBeenCalledTimes(12);
      await act(async () => { rejectSlow(new Error('temporary')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getAllByText('Indisponivel')).not.toHaveLength(0);
      getDevices.mockResolvedValue({ devices: [device()], nextCursor: null });
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getAllByText('ONLINE')).not.toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it.each(['cached', 'deferred'])('does not let a %s session A 401 expire session B after login', async (kind) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const expired = new ApiClientError({ status: 401, code: 'UNAUTHENTICATED', message: 'expired A' });
    let rejectOld!: (error: Error) => void;
    const oldService = service({ getOrganizations: vi.fn(() => new Promise<OrganizationView[]>((_resolve, reject) => { rejectOld = reject; })) });
    const removed = vi.fn();
    const old = render(<QueryClientProvider client={client}><DeviceDirectory service={oldService} onSessionExpired={removed} /></QueryClientProvider>);
    if (kind === 'cached') {
      await act(async () => rejectOld(expired));
      await waitFor(() => expect(removed).toHaveBeenCalledOnce());
    }
    old.unmount();
    const auth = { createSession: vi.fn().mockResolvedValue(undefined), verifyProfile: vi.fn().mockResolvedValue(undefined), removeSession: vi.fn() };
    const signedIn = vi.fn();
    const login = render(<QueryClientProvider client={client}><LoginForm service={auth} onAuthenticated={signedIn} /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'b@example.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'password-b' } });
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(signedIn).toHaveBeenCalledOnce());
    login.unmount();
    const newService = service({ getDevices: vi.fn().mockResolvedValue({ devices: [device({ displayName: 'Sessao B' })], nextCursor: null }) });
    render(<QueryClientProvider client={client}><DeviceDirectory service={newService} onSessionExpired={vi.fn()} /></QueryClientProvider>);
    if (kind === 'deferred') await act(async () => rejectOld(expired));
    expect(await screen.findAllByText('Sessao B')).not.toHaveLength(0);
    expect(newService.expireSession).not.toHaveBeenCalled();
    expect(oldService.expireSession).toHaveBeenCalledTimes(kind === 'cached' ? 1 : 0);
  });
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

  it('does not represent cached online state as current while refresh is pending or after it fails', async () => {
    let failRefresh: ((reason: Error) => void) | undefined;
    const getDevices = vi.fn().mockResolvedValueOnce({ devices: [device()], nextCursor: null })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { failRefresh = reject; }));
    renderDirectory(service({ getDevices }));
    await screen.findAllByText('ONLINE');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar dispositivos' }));
    expect(screen.getByRole('button', { name: 'Atualizando dispositivos' })).toBeDisabled();
    expect(screen.queryByText('ONLINE')).not.toBeInTheDocument();
    expect(screen.getAllByText('Atualizando')).not.toHaveLength(0);
    await act(async () => failRefresh?.(new Error('private refresh detail')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nao foi possivel atualizar os dispositivos.');
    expect(screen.getByLabelText('Organizacao')).toHaveValue('');
    expect(screen.getByLabelText('Status')).toHaveValue('');
    expect(screen.getByLabelText('Buscar dispositivos')).toHaveValue('');
    expect(screen.queryByText('ONLINE')).not.toBeInTheDocument();
    expect(screen.getAllByText('Indisponivel')).not.toHaveLength(0);
    expect(document.body).not.toHaveTextContent('private refresh detail');
  });

  it('shows one keyset page at a time and returns to a known previous cursor', async () => {
    const first = device({ id: 'device-page-1', displayName: 'Pagina um' });
    const second = device({ id: 'device-page-2', displayName: 'Pagina dois' });
    const getDevices = vi.fn().mockImplementation(async (query) => query.cursor
      ? { devices: [second], nextCursor: null }
      : { devices: [first], nextCursor: 'cursor-page-2' });
    renderDirectory(service({ getDevices }));
    await screen.findAllByText('Pagina um');
    await userEvent.click(screen.getByRole('button', { name: 'Proxima pagina' }));
    await waitFor(() => expect(getDevices).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'cursor-page-2' })));
    expect(await screen.findAllByText('Pagina dois')).not.toHaveLength(0);
    expect(screen.queryByText('Pagina um')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pagina anterior' }));
    expect(await screen.findAllByText('Pagina um')).not.toHaveLength(0);
    expect(screen.queryByText('Pagina dois')).not.toBeInTheDocument();
    expect(getDevices).toHaveBeenLastCalledWith({ limit: 25 });
  });

  it('resets pagination when filters compose and ignores an older page response', async () => {
    let resolveOldPage: ((value: { devices: DeviceView[]; nextCursor: null }) => void) | undefined;
    let resolveFiltered: ((value: { devices: DeviceView[]; nextCursor: null }) => void) | undefined;
    const pageOne = device({ id: 'device-page-1', displayName: 'Pagina antiga um' });
    const pageTwo = device({ id: 'device-page-2', displayName: 'Pagina antiga dois' });
    const filtered = device({ id: 'device-filtered', organizationId: 'org-b', organizationName: 'Operacao Sul', displayName: 'Caixa filtrado', status: 'OFFLINE' });
    const getDevices = vi.fn().mockImplementation((query) => {
      if (query.cursor) return new Promise((resolve) => { resolveOldPage = resolve; });
      if (query.organizationId === 'org-b' && query.status === 'OFFLINE' && query.search === 'caixa 02') {
        return new Promise((resolve) => { resolveFiltered = resolve; });
      }
      if (query.organizationId === 'org-b') return Promise.resolve({ devices: [], nextCursor: null });
      return Promise.resolve({ devices: [pageOne], nextCursor: 'cursor-page-2' });
    });
    renderDirectory(service({ getDevices }));
    await screen.findAllByText('Pagina antiga um');
    await userEvent.click(screen.getByRole('button', { name: 'Proxima pagina' }));
    await waitFor(() => expect(getDevices).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'cursor-page-2' })));
    await userEvent.selectOptions(screen.getByLabelText('Organizacao'), 'org-b');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'OFFLINE');
    await userEvent.type(screen.getByLabelText('Buscar dispositivos'), 'caixa 02');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(getDevices).toHaveBeenLastCalledWith({
      organizationId: 'org-b', status: 'OFFLINE', search: 'caixa 02', limit: 25,
    }));
    expect(screen.queryByText('Pagina antiga um')).not.toBeInTheDocument();
    expect(screen.queryByText('Pagina antiga dois')).not.toBeInTheDocument();
    await act(async () => resolveFiltered?.({ devices: [filtered], nextCursor: null }));
    expect(await screen.findAllByText('Caixa filtrado')).not.toHaveLength(0);
    await act(async () => resolveOldPage?.({ devices: [pageTwo], nextCursor: null }));
    expect(screen.getAllByText('Caixa filtrado')).not.toHaveLength(0);
    expect(screen.queryByText('Pagina antiga dois')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Organizacao')).toHaveValue('org-b');
    expect(screen.getByLabelText('Status')).toHaveValue('OFFLINE');
    expect(screen.getByLabelText('Buscar dispositivos')).toHaveValue('caixa 02');
    expect(screen.queryByRole('button', { name: 'Pagina anterior' })).not.toBeInTheDocument();
  });
});
