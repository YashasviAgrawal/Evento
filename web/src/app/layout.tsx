import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ToastProvider } from '@/components/ui/toast';
import { Navbar } from '@/components/layout/navbar';
import { Footer } from '@/components/layout/footer';
import { PageTransition } from '@/components/layout/page-transition';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Tixit';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002';
const SITE_DESCRIPTION =
  'Tixit is a modern ticketing and experiences platform that makes it easy to discover and book movies, events, concerts, comedy shows, sports, and more. With seamless online booking, digital QR tickets, secure payments, and powerful tools for organizers, Tixit brings everything you need to experience and manage events in one place.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
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
  alternates: { canonical: '/' },
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Find Your Moment`,
    description: SITE_DESCRIPTION,
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Find Your Moment`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

/** Sitewide Organization + WebSite structured data for the knowledge panel and sitelinks search box. */
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon`,
  description: SITE_DESCRIPTION,
  email: 'support@tixit.in',
  telephone: '+91-78777-01381',
  address: {
    '@type': 'PostalAddress',
    addressLocality: 'Jaipur',
    addressRegion: 'Rajasthan',
    addressCountry: 'IN',
  },
  sameAs: ['https://www.instagram.com/tixit.in/'],
};

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: SITE_URL,
  potentialAction: {
    '@type': 'SearchAction',
    target: `${SITE_URL}/events?q={search_term_string}`,
    'query-input': 'required name=search_term_string',
  },
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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }} />
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
