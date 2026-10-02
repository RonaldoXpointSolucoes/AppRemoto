import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { Providers } from './providers';
import { PwaRegister } from '../components/pwa-register';

export const viewport: Viewport = {
  themeColor: '#0b1320',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: 'XPoint Remote',
  description: 'Painel operacional de acesso remoto',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'XPoint Remote',
  },
  icons: {
    icon: '/icons/favicon-32.png',
    apple: '/icons/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('xpoint_theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.setAttribute('data-theme','dark');}else{document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Providers>
          <PwaRegister />
          {children}
        </Providers>
      </body>
    </html>
  );
}
