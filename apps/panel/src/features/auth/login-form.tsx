'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiClientError } from '../../lib/api';
import {
  isDisabledProfile,
  isExpiredSession,
  isInvalidCredentials,
  LAST_LOGIN_EMAIL_STORAGE_KEY,
  type LoginService,
} from './session';
import { beginSession, expireSession, markSessionVerified, sessionEpoch } from './session-cache';

export type { LoginService } from './session';

interface LoginFormProps {
  service: LoginService;
  onAuthenticated: () => void;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

export function LoginForm({ service, onAuthenticated }: LoginFormProps) {
  const queryClient = useQueryClient();
  const epoch = useRef(sessionEpoch(queryClient));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteToken, setInviteToken] = useState<string | undefined>(undefined);
  const [googlePromptMode, setGooglePromptMode] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<'credentials' | 'profile-retry'>('credentials');
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const invitedEmail = params.get('email')?.trim();
      const invitedToken = params.get('invite')?.trim();
      if (invitedEmail) {
        setEmail(invitedEmail);
      }
      if (invitedToken) {
        setInviteToken(invitedToken);
      }
    } catch {
      // Ignore malformed search params
    }
  }, []);

  async function handleGoogleLogin() {
    if (pending || !service.createGoogleSession) return;
    let cleanEmail = email.trim();
    if (!cleanEmail && typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(LAST_LOGIN_EMAIL_STORAGE_KEY)?.trim();
        if (saved && /^\S+@\S+\.\S+$/.test(saved)) {
          cleanEmail = saved;
          setEmail(saved);
        }
      } catch {
        // Ignore storage error
      }
    }
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setGooglePromptMode(true);
      setErrors({ email: 'Informe seu e-mail liberado na lista de Técnicos para entrar com o Google.' });
      setFormError(undefined);
      emailRef.current?.focus();
      return;
    }

    setErrors({});
    setFormError(undefined);
    setPending(true);
    let sessionEstablished = false;
    try {
      epoch.current = await beginSession(queryClient);
      await service.createGoogleSession(cleanEmail, inviteToken);
      sessionEstablished = true;
      setStep('profile-retry');
      setPassword('');
      await service.verifyProfile();
      markSessionVerified();
      onAuthenticated();
    } catch (error) {
      if (isDisabledProfile(error) || (sessionEstablished && isExpiredSession(error))) {
        if (sessionEstablished) {
          await expireSession(queryClient, epoch.current, () => service.removeSession());
        }
        setStep('credentials');
        setFormError(
          error instanceof ApiClientError && error.code === 'TECHNICIAN_NOT_AUTHORIZED'
            ? 'Este e-mail não consta na lista de técnicos liberados. Solicite liberação ao administrador.'
            : 'Seu acesso esta desabilitado.'
        );
      } else if (sessionEstablished) {
        setFormError('Nao foi possivel verificar seu acesso.');
      } else {
        setFormError('Nao foi possivel entrar com o Google agora. Verifique seu e-mail liberado e tente novamente.');
      }
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    if (step === 'credentials' && googlePromptMode && !password && service.createGoogleSession) {
      await handleGoogleLogin();
      return;
    }

    const nextErrors: FieldErrors = {};
    if (step === 'credentials') {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) nextErrors.email = 'Informe um e-mail valido.';
      if (!password) nextErrors.password = 'Informe sua senha.';
      else if (inviteToken && password.length < 8) nextErrors.password = 'A senha do convite deve ter no mínimo 8 caracteres.';
      setErrors(nextErrors);
    }
    setFormError(undefined);
    if (nextErrors.email || nextErrors.password) {
      (nextErrors.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setPending(true);
    let sessionEstablished = step === 'profile-retry';
    try {
      if (!sessionEstablished) {
        epoch.current = await beginSession(queryClient);
        if (inviteToken && service.activateInviteSession) {
          await service.activateInviteSession({
            email: email.trim(),
            password,
            inviteToken,
          });
        } else {
          await service.createSession(email.trim(), password);
        }
        sessionEstablished = true;
        setStep('profile-retry');
        setPassword('');
      }
      await service.verifyProfile();
      markSessionVerified();
      onAuthenticated();
    } catch (error) {
      if (!sessionEstablished && isInvalidCredentials(error)) {
        setFormError('E-mail ou senha invalidos.');
      } else if (isDisabledProfile(error) || (sessionEstablished && isExpiredSession(error))) {
        await expireSession(queryClient, epoch.current, () => service.removeSession());
        setStep('credentials');
        setFormError(isDisabledProfile(error) ? 'Seu acesso esta desabilitado.' : 'Sessao expirada. Entre novamente.');
      } else if (sessionEstablished) {
        setFormError('Nao foi possivel verificar seu acesso.');
      } else {
        setFormError('Nao foi possivel entrar agora. Tente novamente.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" noValidate onSubmit={submit}>
      {inviteToken && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '10px',
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            color: '#6ee7b7',
            fontSize: '0.82rem',
            lineHeight: 1.45,
            marginBottom: '6px',
          }}
        >
          <strong>Convite de Equipe Ativo:</strong> clique em{' '}
          <strong>Continuar com o Google</strong> para acesso imediato ou defina sua senha abaixo (mín. 8 caracteres) para concluir o cadastro.
        </div>
      )}
      {googlePromptMode && !inviteToken && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '10px',
            background: 'rgba(56, 189, 248, 0.12)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            color: '#7dd3fc',
            fontSize: '0.82rem',
            lineHeight: 1.45,
            marginBottom: '6px',
          }}
        >
          Digite abaixo o seu <strong>e-mail liberado na lista de Técnicos</strong> e clique em{' '}
          <strong>Continuar com o Google</strong> para entrar automaticamente.
        </div>
      )}
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          disabled={pending || step === 'profile-retry'}
          value={email}
          aria-invalid={Boolean(errors.email)}
          aria-errormessage={errors.email ? 'email-error' : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
          }}
        />
        {errors.email && <span className="field-error" id="email-error">{errors.email}</span>}
      </div>
      <div className="field">
        <label htmlFor="password">Senha</label>
        <input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          autoComplete={inviteToken ? 'new-password' : 'current-password'}
          placeholder={inviteToken ? 'Crie sua senha (mín. 8 caracteres) ou use o botão Google abaixo' : undefined}
          disabled={pending || step === 'profile-retry'}
          value={password}
          aria-invalid={Boolean(errors.password)}
          aria-errormessage={errors.password ? 'password-error' : undefined}
          onChange={(event) => {
            setPassword(event.target.value);
            if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
          }}
        />
        {errors.password && <span className="field-error" id="password-error">{errors.password}</span>}
      </div>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? (step === 'profile-retry' ? 'Verificando...' : 'Entrando...')
          : (step === 'profile-retry' ? 'Tentar novamente' : 'Entrar')}
      </button>

      {service.createGoogleSession && (
        <>
          <div className="login-divider">
            <span>ou</span>
          </div>
          <button
            type="button"
            className="google-login-button"
            disabled={pending}
            onClick={() => void handleGoogleLogin()}
          >
            <svg className="google-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Continuar com o Google</span>
          </button>
        </>
      )}
    </form>
  );
}
