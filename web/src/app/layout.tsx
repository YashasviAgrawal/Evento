import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ToastProvider } from '@/components/ui/toast';
import { Navbar } from '@/components/layout/navbar';
import { Footer } from '@/components/layout/footer';
import { PageTransition } from '@/components/layout/page-transition';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Evento';

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — Discover & book events near you`,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    'Discover concerts, comedy nights, workshops, sport and more across India. Book tickets in a single tap and get an instant QR ticket.',
  keywords: ['events', 'tickets', 'concerts', 'comedy', 'workshops', 'India', 'book tickets'],
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Discover & book events near you`,
    description: 'Concerts, comedy, workshops and sport across India. Book in a single tap.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#e11d48',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <ToastProvider>
          <AuthProvider>
            {/* Navbar reads useSearchParams, which requires a Suspense boundary
                so the rest of the shell can still be statically rendered. */}
            <Suspense fallback={<div className="h-16 border-b border-ink-200 bg-white" />}>
              <Navbar />
            </Suspense>
            <PageTransition>{children}</PageTransition>
            <Footer />
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
