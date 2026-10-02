// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { beginSession } from '../auth/session-cache';
import { ApiClientError } from '../../lib/api';
import { GenericInstallerDownload, type GenericInstallerService } from './generic-setup';
import { createGenericInstallerPackage, downloadGenericInstaller, loadCompleteInstallerArtifact } from './generic-installer-package';

vi.mock('../../lib/appwrite', () => ({ createAppwriteSessionClient: vi.fn() }));
vi.mock('./generic-installer-package', () => ({ createGenericInstallerPackage: vi.fn(), downloadGenericInstaller: vi.fn(), loadCompleteInstallerArtifact: vi.fn() }));
const installer = { id: 'installer-test', name: 'Instalador geral XPoint', active: true, createdAt: '2026-10-01T00:00:00.000Z', revokedAt: null };
const token = 'synthetic-only'.padEnd(43, 't');
const response = () => ({ installer, package: { schemaVersion: 2 as const, installerId: installer.id, installerToken: token } });
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  vi.mocked(loadCompleteInstallerArtifact).mockResolvedValue(new Uint8Array([77, 90]));
  vi.mocked(createGenericInstallerPackage).mockReturnValue(new Blob(['test']));
  vi.mocked(downloadGenericInstaller).mockReturnValue(vi.fn());
});
function fixture(overrides: Partial<GenericInstallerService> = {}) {
  const client = new QueryClient(); const expired = vi.fn();
  const issued = response();
  const service = {
    getMe: vi.fn().mockResolvedValue({ id: 'tech-1', displayName: 'Admin', globalRole: 'super_admin', authorization: [] }),
    getGenericInstallers: vi.fn().mockResolvedValue({ installers: [] }),
    createGenericInstaller: vi.fn().mockResolvedValue(issued),
    getGenericInstallerPackage: vi.fn().mockImplementation(async () => ({ package: response().package })),
    revokeGenericInstaller: vi.fn().mockResolvedValue({ revoked: true }),
    expireSession: vi.fn().mockResolvedValue(undefined), ...overrides,
  };
  const rendered = render(<QueryClientProvider client={client}><GenericInstallerDownload service={service} onSessionExpired={expired} /></QueryClientProvider>);
  return { client, service, issued, expired, ...rendered };
}
async function download() {
  const button = await screen.findByRole('button', { name: 'Baixar instalador completo' });
  await waitFor(() => expect(button).toBeEnabled()); await userEvent.click(button);
}
it('checks the artifact before issuing, offers a reusable file and keeps the capability out of UI, storage and query cache', async () => {
  const f = fixture(); await download();
  await waitFor(() => expect(downloadGenericInstaller).toHaveBeenCalledTimes(1));
  expect(vi.mocked(loadCompleteInstallerArtifact).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.service.createGenericInstaller).mock.invocationCallOrder[0]!);
  expect(f.service.createGenericInstaller).toHaveBeenCalledWith('Instalador geral XPoint');
  expect(f.issued.package.installerToken).toBe('');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(document.body.innerHTML).not.toContain(token);
  expect(JSON.stringify(f.client.getQueryCache().getAll())).not.toContain(token);
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  await download();
  expect(f.service.createGenericInstaller).toHaveBeenCalledTimes(1);
  expect(f.service.getGenericInstallerPackage).toHaveBeenCalledWith(installer.id);
});
it('selects an existing authorization and never creates another when multiple active authorizations exist', async () => {
  const second = { ...installer, id: 'installer-b', name: 'Equipe B' };
  const f = fixture({ getGenericInstallers: vi.fn().mockResolvedValue({ installers: [installer, second] }) });
  await userEvent.selectOptions(await screen.findByLabelText('Autorização do instalador'), second.id);
  await download();
  expect(f.service.getGenericInstallerPackage).toHaveBeenCalledWith(second.id);
  expect(f.service.createGenericInstaller).not.toHaveBeenCalled();
});
it('does not request capabilities or expose admin controls to a technician', async () => {
  const f = fixture({ getMe: vi.fn().mockResolvedValue({ id: 'tech-1', displayName: 'Tech', globalRole: null, authorization: [] }) });
  await screen.findByText(/Peça a um administrador/);
  expect(f.service.getGenericInstallers).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Baixar instalador completo' })).not.toBeInTheDocument();
});
it('does not issue a capability if executable verification fails', async () => {
  vi.mocked(loadCompleteInstallerArtifact).mockRejectedValueOnce(new Error('raw secret never shown'));
  const f = fixture(); await download();
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível preparar');
  expect(f.service.createGenericInstaller).not.toHaveBeenCalled();
  expect(f.service.getGenericInstallerPackage).not.toHaveBeenCalled();
  expect(document.body.innerHTML).not.toContain('raw secret');
});
it.each(['session-change', 'unmount'])('discards delayed capabilities after %s', async (reason) => {
  let resolve!: (result: ReturnType<typeof response>) => void;
  const pending = new Promise<ReturnType<typeof response>>((done) => { resolve = done; });
  const f = fixture({ createGenericInstaller: vi.fn().mockReturnValue(pending) });
  await download();
  if (reason === 'session-change') await act(async () => { await beginSession(f.client); }); else f.unmount();
  const result = response(); await act(async () => resolve(result));
  expect(downloadGenericInstaller).not.toHaveBeenCalled();
  expect(result.package.installerToken).toBe('');
});
it('revokes only the selected authorization and explains that installed devices continue working', async () => {
  const f = fixture({ getGenericInstallers: vi.fn().mockResolvedValue({ installers: [installer] }) });
  await screen.findByText('Autorizações de instalação');
  await userEvent.click(screen.getByText('Autorizações de instalação'));
  await userEvent.click(await screen.findByRole('button', { name: `Revogar ${installer.name}` }));
  expect(f.service.revokeGenericInstaller).toHaveBeenCalledWith(installer.id);
  expect(await screen.findByRole('status')).toHaveTextContent('Computadores já cadastrados continuam funcionando');
  expect(screen.queryByRole('button', { name: `Revogar ${installer.name}` })).not.toBeInTheDocument();
});
it('does not claim revocation succeeded after an uncertain response', async () => {
  const f = fixture({ getGenericInstallers: vi.fn().mockResolvedValue({ installers: [installer] }), revokeGenericInstaller: vi.fn().mockRejectedValue(new Error('private response')) });
  await userEvent.click(await screen.findByText('Autorizações de instalação'));
  await userEvent.click(await screen.findByRole('button', { name: `Revogar ${installer.name}` }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar a revogação');
  expect(screen.getByRole('button', { name: 'Baixar instalador completo' })).toBeDisabled();
  expect(document.body.innerHTML).not.toContain('private response');
  expect(f.service.createGenericInstaller).not.toHaveBeenCalled();
});
it('reports an unconfigured server password without rendering the error payload', async () => {
  fixture({ createGenericInstaller: vi.fn().mockRejectedValue(new ApiClientError({ status: 503, code: 'PASSWORD_NOT_CONFIGURED', message: 'private details' })) });
  await download();
  expect(await screen.findByRole('alert')).toHaveTextContent('A senha padrão ainda não está configurada');
  expect(downloadGenericInstaller).not.toHaveBeenCalled();
});
it('expires unauthorized sessions and releases a previous download URL on session clear', async () => {
  const release = vi.fn(); vi.mocked(downloadGenericInstaller).mockReturnValue(release);
  const f = fixture({ getGenericInstallerPackage: vi.fn().mockRejectedValue(new ApiClientError({ status: 401, code: 'UNAUTHORIZED', message: 'expired' })) });
  await download(); await download();
  await waitFor(() => expect(f.expired).toHaveBeenCalledTimes(1));
  expect(f.service.expireSession).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Baixar instalador completo' })).not.toBeInTheDocument();
});
