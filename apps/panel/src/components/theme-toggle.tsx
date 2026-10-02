'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const currentAttr = document.documentElement.getAttribute('data-theme') as 'light' | 'dark' | null;
      const stored = typeof localStorage !== 'undefined' ? (localStorage.getItem('xpoint_theme') as 'light' | 'dark' | null) : null;
      const prefersDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
      
      const activeTheme: 'light' | 'dark' = currentAttr || (stored === 'light' || stored === 'dark' ? stored : prefersDark ? 'dark' : 'light');
      
      setTheme(activeTheme);
      document.documentElement.setAttribute('data-theme', activeTheme);
      if (activeTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch {
      // Ignora falhas de acesso a storage
    } finally {
      setMounted(true);
    }
  }, []);

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('xpoint_theme', next);
      }
    } catch {
      // Ignora falha de storage se bloqueado
    }
    document.documentElement.setAttribute('data-theme', next);
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  return (
    <button
      type="button"
      className={`icon-button theme-toggle-button ${className ?? ''}`}
      onClick={toggle}
      aria-label={theme === 'light' ? 'Mudar para tema escuro' : 'Mudar para tema claro'}
      title={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}
    >
      {theme === 'light' ? (
        <Moon aria-hidden="true" size={19} className="theme-toggle-icon moon-icon" />
      ) : (
        <Sun aria-hidden="true" size={19} className="theme-toggle-icon sun-icon" />
      )}
    </button>
  );
}

