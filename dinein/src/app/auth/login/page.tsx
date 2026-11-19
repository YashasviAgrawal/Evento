import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthScreen } from './auth-screen';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function LoginPage() {
  return (
    <Suspense>
      <AuthScreen />
    </Suspense>
  );
}
