// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { beginSession } from '../auth/session-cache';
import { connectionLogText, type ConnectionLogEvent } from './connection-log';
import { ApiClientError } from '../../lib/api';
import { ConnectDevice } from './connect-device';
import { launchRustDesk } from './rustdesk-launch';

vi.mock('./rustdesk-launch', async (original) => ({ ...await original<typeof import('./rustdesk-launch')>(), launchRustDesk: vi.fn() }));
beforeEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function fixture(manual = false) {
  const client = new QueryClient();
  let resolve!: (response: { launchUri: string }) => void;
  const connectDevice = vi.fn(() => new Promise<{ launchUri: string }>((done) => { resolve = done; }));
  const recordConnectionEvent = vi.fn().mockResolvedValue({ recorded: true });
  const events: ConnectionLogEvent[] = [];
  const rendered = render(<QueryClientProvider client={client}><ConnectDevice deviceId="device-1" enabled manual={manual} rustdeskId="123456789" onEvent={(event) => events.push(event)} service={{ connectDevice, recordConnectionEvent }} /></QueryClientProvider>);
  return { client, events, recordConnectionEvent, connectDevice, resolve: (response: { launchUri: string }) => resolve(response), ...rendered };
}

it('hands off once, erases the response reference and never renders or caches its credential', async () => {
  const f = fixture();
  const response = { launchUri: 'rustdesk://connect/123456789@179.199.142.157:21116?key=public&password=synthetic-only' };
  await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Abrindo…' }));
  expect(f.connectDevice).toHaveBeenCalledTimes(1);
  await act(async () => f.resolve(response));
  await waitFor(() => expect(launchRustDesk).toHaveBeenCalledTimes(1));
  expect(response.launchUri).toBe('');
  expect(document.body.innerHTML).not.toContain('synthetic-only');
  expect(JSON.stringify(f.client.getQueryCache().getAll())).not.toContain('synthetic-only');
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it.each(['session-change', 'unmount'])('never launches a delayed response after %s', async (reason) => {
  const f = fixture();
  await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
  if (reason === 'session-change') await beginSession(f.client);
  else f.unmount();
  const response = { launchUri: 'rustdesk://connect/123456789@179.199.142.157:21116?key=public&password=synthetic-only' };
  await act(async () => f.resolve(response));
  expect(launchRustDesk).not.toHaveBeenCalled();
  expect(response.launchUri).toBe('');
});


it('uses a manual password only for local handoff, encodes it and clears the password input', async () => {
  const f = fixture(true);
  const password = 'synthetic&password= /+?';
  await userEvent.type(screen.getByLabelText('Senha do RustDesk'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Conectar com esta senha' }));
  expect(f.connectDevice).toHaveBeenCalledWith('device-1', { mode: 'manual', attemptId: expect.any(String) });
  const response = { launchUri: 'rustdesk://connect/123456789@179.199.142.157:21116?key=public' };
  await act(async () => f.resolve(response));
  const launched = new URL(vi.mocked(launchRustDesk).mock.calls[0]![0]);
  expect(launched.searchParams.get('password')).toBe(password);
  expect(launched.searchParams.getAll('password')).toHaveLength(1);
  expect(screen.getByLabelText('Senha do RustDesk')).toHaveValue('');
  expect(response.launchUri).toBe('');
  expect(JSON.stringify(f.connectDevice.mock.calls)).not.toContain(password);
  expect(JSON.stringify(f.recordConnectionEvent.mock.calls)).not.toContain(password);
  expect(connectionLogText('device-1', f.events)).not.toContain(password);
  expect(document.body.innerHTML).not.toContain(password);
  expect(JSON.stringify(f.client.getQueryCache().getAll())).not.toContain(password);
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
});

it('offers one synchronous explicit retry, then destroys the prepared URI', async () => {
  const f = fixture();
  await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
  await act(async () => f.resolve({ launchUri: 'rustdesk://connect/123456789@179.199.142.157:21116?key=public&password=synthetic-only' }));
  expect(screen.getByRole('status')).toHaveTextContent('neste computador do técnico');
  expect(screen.getByRole('status')).toHaveTextContent('sessão ainda não foi confirmada');
  await userEvent.click(screen.getByRole('button', { name: 'Abrir RustDesk agora' }));
  expect(launchRustDesk).toHaveBeenCalledTimes(2);
  expect(f.connectDevice).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Abrir RustDesk agora' })).not.toBeInTheDocument();
});

it('expires the fallback in 30 seconds and erases manual input on session transition', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(true);
    fireEvent.change(screen.getByLabelText('Senha do RustDesk'), { target: { value: 'synthetic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar com esta senha' }));
    await act(async () => f.resolve({ launchUri: 'rustdesk://connect/123456789@179.199.142.157:21116?key=public' }));
    expect(screen.getByRole('button', { name: 'Abrir RustDesk agora' })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.queryByRole('button', { name: 'Abrir RustDesk agora' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Senha do RustDesk'), { target: { value: 'other-synthetic' } });
    await act(async () => { await beginSession(f.client); });
    expect(screen.getByLabelText('Senha do RustDesk')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Conectar com esta senha' }));
    expect(f.connectDevice).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it('keeps API failure evidence locally without exposing exception detail', async () => {
  const f = fixture();
  f.connectDevice.mockRejectedValueOnce(new ApiClientError({ status: 0, code: 'NETWORK_ERROR', message: 'private synthetic secret' }));
  await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
  await screen.findByText(/Não foi possível iniciar/);
  expect(f.events.at(-1)?.code).toBe('NETWORK_ERROR');
  expect(screen.queryByRole('button', { name: 'RustDesk não abriu' })).not.toBeInTheDocument();
  expect(connectionLogText('device-1', f.events)).not.toContain('private');
  expect(document.body.innerHTML).not.toContain('private');
});

it('records browser launch failure and operator reports without claiming remote success', async () => {
  const f = fixture();
  vi.mocked(launchRustDesk).mockImplementationOnce(() => { throw new Error('private uri'); });
  await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
  await act(async () => f.resolve({ launchUri: 'rustdesk://connect/123456789@179.199.142.157:21116?key=public&password=synthetic' }));
  expect(f.events.at(-1)?.stage).toBe('launch_failed');
  await userEvent.click(screen.getByRole('button', { name: 'RustDesk não abriu' }));
  expect(f.recordConnectionEvent).toHaveBeenLastCalledWith('device-1', { attemptId: expect.any(String), mode: 'automatic', event: 'not_opened' });
  expect(document.body.innerHTML).not.toContain('private uri');
});

it('resets an in-flight connection when the component switches devices and discards its stale URI', async () => {
  const client = new QueryClient();
  let finishOld!: (value: { launchUri: string }) => void;
  const connectDevice = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValueOnce({ launchUri: 'rustdesk://connect/987654321@179.199.142.157:21116?key=public&password=new-synthetic' });
  const renderDevice = (id: string) => <QueryClientProvider client={client}><ConnectDevice deviceId={id} enabled service={{ connectDevice }} /></QueryClientProvider>;
  const f = render(renderDevice('device-1'));
  await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
  f.rerender(renderDevice('device-2'));
  expect(screen.getByRole('button', { name: 'Conectar' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
  const old = { launchUri: 'rustdesk://connect/123456789@179.199.142.157:21116?key=public&password=old-synthetic' };
  await act(async () => finishOld(old));
  expect(old.launchUri).toBe(''); expect(launchRustDesk).toHaveBeenCalledTimes(1);
  expect(vi.mocked(launchRustDesk).mock.calls[0]![0]).toContain('987654321');
  expect(connectDevice).toHaveBeenNthCalledWith(2, 'device-2', { mode: 'automatic', attemptId: expect.any(String) });
});
