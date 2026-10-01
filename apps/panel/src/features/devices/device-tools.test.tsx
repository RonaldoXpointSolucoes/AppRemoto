// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeviceDetailsResponse, DeviceView } from '@appremoto/contracts';
import { beforeEach, expect, it, vi } from 'vitest';
import { DeviceTools } from './device-tools';
import { connectionLogText, downloadConnectionLog, localEvent } from './connection-log';
import { beginSession } from '../auth/session-cache';
vi.mock('./connection-log', async (original) => ({ ...await original<typeof import('./connection-log')>(), downloadConnectionLog: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const device: DeviceView = {
  id: 'device-1', organizationId: 'org-a', organizationName: 'Cliente', deviceUuid: '00000000-0000-4000-8000-000000000001',
  displayName: 'Recepção', hostname: 'CLIENT-PC', operatingSystem: 'Windows', osVersion: '11',
  rustdeskId: '123456789', agentVersion: '1.0.3', rustdeskVersion: '1.4.9',
  lastSeenAt: '2026-10-01T20:00:00Z', enabled: true, status: 'ONLINE',
};
const details: DeviceDetailsResponse = { device, notes: 'Andar 2', diagnostics: { agentOnline: true, heartbeatConfirmed: true, rustdeskIdValid: true, credentialAvailable: true } };
function fixture(canManage = true) {
  const client = new QueryClient();
  const service = { getOrganizations: vi.fn(), getDevices: vi.fn(), expireSession: vi.fn(),
    getDeviceDetails: vi.fn().mockResolvedValue(details), getConnectionHistory: vi.fn().mockResolvedValue({ events: [] }),
    updateDevice: vi.fn().mockImplementation(async (_id, input) => ({ device: { ...device, displayName: input.displayName }, notes: input.notes })),
    connectDevice: vi.fn(), recordConnectionEvent: vi.fn().mockResolvedValue({ recorded: true }),
  };
  const onSaved = vi.fn(); const onClose = vi.fn(); const onEvent = vi.fn();
  const event = localEvent('00000000-0000-4000-8000-000000000010', 'automatic', 'rejected', 'NETWORK_ERROR');
  const rendered = render(<QueryClientProvider client={client}><DeviceTools device={device} service={service} canConnect canManage={canManage}
    events={[event]} onEvent={onEvent} onClose={onClose} onSaved={onSaved} /></QueryClientProvider>);
  return { ...rendered, client, service, onSaved, onClose, onEvent, event };
}
it('edits name and notes with explicit save and exports only connection evidence', async () => {
  const f = fixture();
  await userEvent.click(await screen.findByRole('button', { name: 'Editar informações' }));
  const name = screen.getByLabelText('Nome do computador');
  await userEvent.clear(name); await userEvent.type(name, 'Caixa novo');
  await userEvent.clear(screen.getByLabelText('Observações')); await userEvent.type(screen.getByLabelText('Observações'), 'Sala 12');
  await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  await screen.findByText('Dados do computador atualizados.');
  expect(f.service.updateDevice).toHaveBeenCalledWith('device-1', { displayName: 'Caixa novo', notes: 'Sala 12' });
  expect(f.onSaved).toHaveBeenCalledOnce();
  expect(screen.getByRole('heading', { name: 'Caixa novo' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Baixar log de conexão' }));
  expect(downloadConnectionLog).toHaveBeenCalledWith('device-1', [f.event]);
  expect(screen.getByText(/ONLINE confirma/)).toBeInTheDocument();
});
it('allows viewing diagnostics without the manage permission', async () => {
  fixture(false);
  await screen.findByText('Andar 2');
  expect(screen.queryByRole('button', { name: 'Editar informações' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Nome do computador')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Baixar log de conexão' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Testar abertura do RustDesk' })).toBeEnabled();
  expect(within(screen.getByRole('dialog')).getByText('nos dois computadores', { exact: true })).toBeInTheDocument();
});
it('clears details and draft on session change and ignores a delayed update', async () => {
  const f = fixture();
  await userEvent.click(await screen.findByRole('button', { name: 'Editar informações' }));
  let finish!: (value: { device: DeviceView; notes: string }) => void;
  f.service.updateDevice.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.change(screen.getByLabelText('Observações'), { target: { value: 'private draft' } });
  await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
  await act(async () => { await beginSession(f.client); finish({ device, notes: 'private late result' }); });
  expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onSaved).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent('private late result');
  expect(screen.getByLabelText('Observações')).toHaveValue('');
});
it('preserves local diagnostics when both remote reads fail', async () => {
  const f = fixture();
  await screen.findByText('Andar 2');
  f.service.getDeviceDetails.mockRejectedValueOnce(new Error('private token'));
  f.service.getConnectionHistory.mockRejectedValueOnce(new Error('private URI'));
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar diagnóstico' }));
  await screen.findByRole('alert');
  expect(f.onEvent).toHaveBeenCalledTimes(2);
  expect(screen.getByText('NETWORK_ERROR')).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('private token');
  expect(document.body).not.toHaveTextContent('private URI');
  await userEvent.click(screen.getByRole('button', { name: 'Baixar log de conexão' }));
  expect(downloadConnectionLog).toHaveBeenCalledOnce();
});
it('projects a log defensively without allowing arbitrary exception text or extra fields', () => {
  const event = localEvent('00000000-0000-4000-8000-000000000010', 'manual', 'launch_failed', 'BROWSER_LAUNCH_FAILED');
  const text = connectionLogText('device-1', [{ ...event, code: 'password=private', stage: 'rustdesk://secret', secret: 'private token' } as typeof event]);
  expect(text).toContain('REQUEST_FAILED'); expect(text).not.toContain('private'); expect(text).not.toContain('rustdesk://');
});
