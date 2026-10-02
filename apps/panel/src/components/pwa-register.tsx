'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // SW registered successfully
        })
        .catch(() => {
          // Failed to register SW
        });
    }
  }, []);

  return null;
}
