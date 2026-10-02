'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('xpoint_theme') : null;
    const prefersDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      setTheme('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      setTheme('light');
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, []);

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('xpoint_theme', next);
    document.documentElement.setAttribute('data-theme', next);
  }

  if (!mounted) {
    return (
      <button
        type="button"
        className="icon-button theme-toggle-button"
        aria-label="Alternar tema claro e escuro"
        title="Alternar tema"
      >
        <span style={{ display: 'inline-block', width: 19, height: 19 }} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="icon-button theme-toggle-button"
      onClick={toggle}
      aria-label={theme === 'light' ? 'Mudar para tema escuro' : 'Mudar para tema claro'}
      title={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}
    >
      {theme === 'light' ? (
        <Moon aria-hidden="true" size={19} />
      ) : (
        <Sun aria-hidden="true" size={19} />
      )}
    </button>
  );
}
