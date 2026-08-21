import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'List Your Event — Become an Organizer',
  description:
    'Sell tickets on Tixit in minutes. Set up flexible ticket tiers, accept UPI/card/net-banking payments, scan QR tickets at the door, and track sales in real time.',
  alternates: { canonical: '/organizer/register' },
  openGraph: {
    title: 'List Your Event — Become an Organizer',
    description:
      'Sell tickets on Tixit in minutes. Set up flexible ticket tiers, accept UPI/card/net-banking payments, scan QR tickets at the door, and track sales in real time.',
    url: '/organizer/register',
  },
};

export default function OrganizerRegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
