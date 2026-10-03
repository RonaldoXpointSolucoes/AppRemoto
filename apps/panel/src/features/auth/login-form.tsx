'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { isDisabledProfile, isExpiredSession, isInvalidCredentials, type LoginService } from './session';
import { beginSession, expireSession, sessionEpoch } from './session-cache';

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
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<'credentials' | 'profile-retry'>('credentials');
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextErrors: FieldErrors = {};
    if (step === 'credentials') {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) nextErrors.email = 'Informe um e-mail valido.';
      if (!password) nextErrors.password = 'Informe sua senha.';
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
        await service.createSession(email.trim(), password);
        sessionEstablished = true;
        setStep('profile-retry');
        setPassword('');
      }
      await service.verifyProfile();
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
          onChange={(event) => setEmail(event.target.value)}
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
          autoComplete="current-password"
          disabled={pending || step === 'profile-retry'}
          value={password}
          aria-invalid={Boolean(errors.password)}
          aria-errormessage={errors.password ? 'password-error' : undefined}
          onChange={(event) => setPassword(event.target.value)}
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
            onClick={() => {
              setPending(true);
              service.createGoogleSession?.();
            }}
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
