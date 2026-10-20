'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        void reg.update().catch(() => {});
        if ('caches' in window) {
          const currentPath = window.location.pathname || '/devices';
          void caches
            .open('xpoint-remote-v3')
            .then((cache) => cache.add(currentPath))
            .catch(() => {});
        }
      })
      .catch(() => {
        // Failed to register SW
      });
  }, []);

  return null;
}
