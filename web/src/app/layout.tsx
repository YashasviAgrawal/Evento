import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ToastProvider } from '@/components/ui/toast';
import { Navbar } from '@/components/layout/navbar';
import { Footer } from '@/components/layout/footer';
import { PageTransition } from '@/components/layout/page-transition';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Tixit';
const SITE_DESCRIPTION =
  'Tixit is a modern ticketing and experiences platform that makes it easy to discover and book movies, events, concerts, comedy shows, sports, and more. With seamless online booking, digital QR tickets, secure payments, and powerful tools for organizers, Tixit brings everything you need to experience and manage events in one place.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002'),
  title: {
    default: `${SITE_NAME} — Find Your Moment`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'events',
    'tickets',
    'movies',
    'concerts',
    'comedy shows',
    'sports',
    'ticketing platform',
    'QR tickets',
    'book tickets online',
    'event organizers',
    'India',
  ],
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Find Your Moment`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Find Your Moment`,
    description: SITE_DESCRIPTION,
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
