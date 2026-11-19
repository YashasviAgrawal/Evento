'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@tixit/session';
import { ToastProvider } from '@tixit/ui';
import { QueryProvider } from '@/lib/query';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <QueryProvider>{children}</QueryProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
