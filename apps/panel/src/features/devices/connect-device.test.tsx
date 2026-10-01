// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { beginSession } from '../auth/session-cache';
import { ConnectDevice } from './connect-device';
import { launchRustDesk } from './rustdesk-launch';

vi.mock('./rustdesk-launch', () => ({ launchRustDesk: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

function fixture() {
  const client = new QueryClient();
  let resolve!: (response: { launchUri: string }) => void;
  const connectDevice = vi.fn(() => new Promise<{ launchUri: string }>((done) => { resolve = done; }));
  const rendered = render(<QueryClientProvider client={client}><ConnectDevice deviceId="device-1" enabled service={{ connectDevice }} /></QueryClientProvider>);
  return { client, connectDevice, resolve: (response: { launchUri: string }) => resolve(response), ...rendered };
}

it('hands off once, erases the response reference and never renders or caches its credential', async () => {
  const f = fixture();
  const response = { launchUri: 'rustdesk://connect/123456789?password=synthetic-only' };
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
  const response = { launchUri: 'rustdesk://connect/123456789?password=synthetic-only' };
  await act(async () => f.resolve(response));
  expect(launchRustDesk).not.toHaveBeenCalled();
  expect(response.launchUri).toBe('');
});
