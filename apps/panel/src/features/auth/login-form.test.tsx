// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppwriteException } from 'appwrite';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../../lib/api';
import { LoginForm, type LoginService } from './login-form';

function service(overrides: Partial<LoginService> = {}): LoginService {
  return {
    createSession: vi.fn().mockResolvedValue(undefined),
    verifyProfile: vi.fn().mockResolvedValue(undefined),
    removeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('LoginForm', () => {
  it('shows accessible validation and keeps focus on the first invalid field', async () => {
    const auth = service();
    render(<LoginForm service={auth} onAuthenticated={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(screen.getByLabelText('E-mail')).toHaveAccessibleErrorMessage('Informe um e-mail valido.');
    expect(screen.getByLabelText('Senha')).toHaveAccessibleErrorMessage('Informe sua senha.');
    expect(screen.getByLabelText('E-mail')).toHaveFocus();
    expect(auth.createSession).not.toHaveBeenCalled();
  });

  it('disables the form while pending and prevents duplicate submission', async () => {
    let completeLogin: (() => void) | undefined;
    const auth = service({
      createSession: vi.fn(() => new Promise<void>((resolve) => { completeLogin = resolve; })),
    });
    render(<LoginForm service={auth} onAuthenticated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'tecnico@example.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-segura');

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(screen.getByRole('button', { name: 'Entrando...' })).toBeDisabled();
    expect(screen.getByLabelText('E-mail')).toBeDisabled();
    expect(screen.getByLabelText('Senha')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Entrando...' }));
    expect(auth.createSession).toHaveBeenCalledTimes(1);
    completeLogin?.();
    await waitFor(() => expect(auth.verifyProfile).toHaveBeenCalledTimes(1));
  });

  it('shows a generic message for invalid credentials without leaking provider details', async () => {
    const auth = service({
      createSession: vi.fn().mockRejectedValue(new AppwriteException('user secret detail', 401, 'user_invalid_credentials')),
    });
    render(<LoginForm service={auth} onAuthenticated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'tecnico@example.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-incorreta');

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha invalidos.');
    expect(screen.queryByText(/user secret detail/i)).not.toBeInTheDocument();
  });

  it('removes the Appwrite session when the API reports a disabled profile', async () => {
    const auth = service({
      verifyProfile: vi.fn().mockRejectedValue(new ApiClientError({
        code: 'TECHNICIAN_DISABLED', message: 'internal profile detail', status: 403,
      })),
    });
    render(<LoginForm service={auth} onAuthenticated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'tecnico@example.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-segura');

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Seu acesso esta desabilitado.');
    expect(auth.removeSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/internal profile detail/i)).not.toBeInTheDocument();
  });

  it('redirects to devices only after the profile is verified', async () => {
    const onAuthenticated = vi.fn();
    const auth = service();
    render(<LoginForm service={auth} onAuthenticated={onAuthenticated} />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'tecnico@example.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-segura');

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(auth.verifyProfile).toHaveBeenCalledTimes(1);
  });

  it('retries only profile verification after a recoverable post-login failure', async () => {
    const onAuthenticated = vi.fn();
    const auth = service({
      verifyProfile: vi.fn()
        .mockRejectedValueOnce(new ApiClientError({ code: 'NETWORK_ERROR', message: 'private network detail', status: 0 }))
        .mockResolvedValueOnce(undefined),
    });
    render(<LoginForm service={auth} onAuthenticated={onAuthenticated} />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'tecnico@example.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-segura');

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nao foi possivel verificar seu acesso.');

    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(auth.createSession).toHaveBeenCalledTimes(1);
    expect(auth.verifyProfile).toHaveBeenCalledTimes(2);
    expect(auth.removeSession).not.toHaveBeenCalled();
  });

  it('removes the established session when profile retry reports disabled', async () => {
    const auth = service({
      verifyProfile: vi.fn()
        .mockRejectedValueOnce(new ApiClientError({ code: 'NETWORK_ERROR', message: 'private network detail', status: 0 }))
        .mockRejectedValueOnce(new ApiClientError({ code: 'TECHNICIAN_DISABLED', message: 'private profile detail', status: 403 })),
    });
    render(<LoginForm service={auth} onAuthenticated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'tecnico@example.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-segura');

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByRole('button', { name: 'Tentar novamente' });
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Seu acesso esta desabilitado.');
    expect(auth.createSession).toHaveBeenCalledTimes(1);
    expect(auth.verifyProfile).toHaveBeenCalledTimes(2);
    expect(auth.removeSession).toHaveBeenCalledTimes(1);
  });
});
