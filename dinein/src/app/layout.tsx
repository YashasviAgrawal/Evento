import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import { Chrome } from '@/components/shell/chrome';

const SITE_URL = process.env.NEXT_PUBLIC_DINEIN_URL ?? 'http://localhost:3001';
const DESCRIPTION =
  'Book a table at the best restaurants near you, pay your bill in the app and save instantly with Tixit Dine-in. One Tixit account for dining and events.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Tixit Dine-in — Book a table. Pay the bill. Keep the savings.', template: '%s · Tixit Dine-in' },
  description: DESCRIPTION,
  applicationName: 'Tixit Dine-in',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Tixit Dine-in',
    title: 'Tixit Dine-in',
    description: DESCRIPTION,
    locale: 'en_IN',
  },
  twitter: { card: 'summary_large_image', title: 'Tixit Dine-in', description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh">
        <Providers>
          <Chrome>{children}</Chrome>
        </Providers>
      </body>
    </html>
  );
}
