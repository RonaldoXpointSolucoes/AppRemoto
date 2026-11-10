'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SelfHealingRuntimeBoundary } from '../components/self-healing-boundary';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: {
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  } } }));

  return (
    <QueryClientProvider client={queryClient}>
      <SelfHealingRuntimeBoundary>{children}</SelfHealingRuntimeBoundary>
    </QueryClientProvider>
  );
}
