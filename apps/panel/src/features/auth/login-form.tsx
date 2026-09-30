'use client';

import { useRef, useState, type FormEvent } from 'react';

import { isDisabledProfile, isInvalidCredentials, type LoginService } from './session';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextErrors: FieldErrors = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) nextErrors.email = 'Informe um e-mail valido.';
    if (!password) nextErrors.password = 'Informe sua senha.';
    setErrors(nextErrors);
    setFormError(undefined);
    if (nextErrors.email || nextErrors.password) {
      (nextErrors.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setPending(true);
    try {
      await service.createSession(email.trim(), password);
      await service.verifyProfile();
      onAuthenticated();
    } catch (error) {
      if (isInvalidCredentials(error)) {
        setFormError('E-mail ou senha invalidos.');
      } else if (isDisabledProfile(error)) {
        try { await service.removeSession(); } catch { /* Do not expose provider cleanup details. */ }
        setFormError('Seu acesso esta desabilitado.');
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
          disabled={pending}
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
          disabled={pending}
          value={password}
          aria-invalid={Boolean(errors.password)}
          aria-errormessage={errors.password ? 'password-error' : undefined}
          onChange={(event) => setPassword(event.target.value)}
        />
        {errors.password && <span className="field-error" id="password-error">{errors.password}</span>}
      </div>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
