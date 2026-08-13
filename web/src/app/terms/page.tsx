import Link from 'next/link';
import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/layout/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms and conditions that govern your use of Evento.',
};

const UPDATED = '13 August 2026';

const SECTIONS: LegalSection[] = [
  {
    heading: 'Acceptance of terms',
    body: (
      <p>
        These Terms of Service (“Terms”) govern your access to and use of Evento (“we”, “us”, “our”)
        and the services we provide for discovering events and booking tickets. By creating an
        account or using the platform, you agree to be bound by these Terms. If you do not agree,
        please do not use Evento.
      </p>
    ),
  },
  {
    heading: 'Your account',
    body: (
      <ul>
        <li>You must provide accurate, current information when registering.</li>
        <li>You are responsible for keeping your password secure and for all activity on your account.</li>
        <li>You must be at least 18 years old, or have the consent of a parent or guardian.</li>
        <li>Notify us promptly of any unauthorized use of your account.</li>
      </ul>
    ),
  },
  {
    heading: 'The role of Evento',
    body: (
      <p>
        Evento is a marketplace that connects attendees with event organizers. Organizers are solely
        responsible for their events — including scheduling, venue, content, and any changes or
        cancellations. Evento facilitates ticket sales and payments but is not the organizer of the
        events listed unless expressly stated.
      </p>
    ),
  },
  {
    heading: 'Bookings & tickets',
    body: (
      <ul>
        <li>A booking is confirmed only once payment is successfully completed.</li>
        <li>Each ticket is issued with a unique QR code and is valid for a single admission.</li>
        <li>Tickets must not be duplicated, resold at a markup, or transferred in violation of an organizer’s rules.</li>
        <li>Prices displayed include applicable taxes and any convenience fees shown at checkout.</li>
      </ul>
    ),
  },
  {
    heading: 'Payments',
    body: (
      <p>
        Payments are processed securely through our payment partner, Razorpay, supporting UPI, cards,
        and net banking. By making a booking, you authorize us to charge the total amount shown at
        checkout. We do not store your full payment credentials.
      </p>
    ),
  },
  {
    heading: 'Cancellations & refunds',
    body: (
      <p>
        Cancellations and refunds are governed by our{' '}
        <Link href="/refund">Refund &amp; Cancellation Policy</Link>. Please review it before making a
        booking, as refund eligibility depends on how far in advance you cancel and the organizer’s
        terms for that event.
      </p>
    ),
  },
  {
    heading: 'Acceptable use',
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>Use the platform for any unlawful, fraudulent, or abusive purpose.</li>
          <li>Interfere with the platform’s security or attempt to gain unauthorized access.</li>
          <li>Scrape, copy, or resell content or data without permission.</li>
          <li>Create listings or tickets that are misleading or infringe others’ rights.</li>
        </ul>
      </>
    ),
  },
  {
    heading: 'Organizer responsibilities',
    body: (
      <p>
        Organizers listing events on Evento warrant that they have the right to host the event and
        sell tickets, that their listings are accurate, and that they will honor valid tickets. Payout
        and settlement terms for organizers are set out in a separate organizer agreement.
      </p>
    ),
  },
  {
    heading: 'Intellectual property',
    body: (
      <p>
        The Evento name, logo, and platform are our property or licensed to us. Event content is owned
        by the respective organizers. You may not use any of these marks or content without prior
        written permission.
      </p>
    ),
  },
  {
    heading: 'Limitation of liability',
    body: (
      <p>
        To the fullest extent permitted by law, Evento is not liable for indirect, incidental, or
        consequential damages arising from your use of the platform or attendance at any event. Our
        total liability for any claim is limited to the amount you paid for the booking in question.
      </p>
    ),
  },
  {
    heading: 'Changes & termination',
    body: (
      <p>
        We may update these Terms or suspend accounts that violate them. Material changes will be
        posted on this page with a revised “last updated” date. Continued use of Evento after changes
        take effect means you accept the updated Terms.
      </p>
    ),
  },
  {
    heading: 'Governing law',
    body: (
      <p>
        These Terms are governed by the laws of India, and any disputes are subject to the exclusive
        jurisdiction of the courts of Bengaluru, Karnataka.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      summary="These terms and conditions govern your use of Evento. Please read them carefully before booking."
      updated={UPDATED}
      sections={SECTIONS}
    />
  );
}
