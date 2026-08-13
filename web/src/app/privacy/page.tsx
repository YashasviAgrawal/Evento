import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/layout/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Evento collects, uses, and protects your personal information.',
};

const UPDATED = '13 August 2026';

const SECTIONS: LegalSection[] = [
  {
    heading: 'Introduction',
    body: (
      <p>
        This Privacy Policy explains how Evento (“we”, “us”, “our”) collects, uses, shares, and
        safeguards your information when you use our website and services to discover and book
        tickets for events. By using Evento, you agree to the practices described here.
      </p>
    ),
  },
  {
    heading: 'Information we collect',
    body: (
      <>
        <p>We collect information that you provide directly and information gathered automatically:</p>
        <ul>
          <li>
            <strong>Account details</strong> — your name, email address, phone number, and password
            when you register.
          </li>
          <li>
            <strong>Booking information</strong> — the events you book, ticket quantities, and
            attendee details.
          </li>
          <li>
            <strong>Payment information</strong> — processed securely by our payment partner
            (Razorpay). We do not store your full card or UPI credentials on our servers.
          </li>
          <li>
            <strong>Usage data</strong> — device, browser, IP address, and pages viewed, collected
            through cookies and similar technologies.
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: 'How we use your information',
    body: (
      <ul>
        <li>To create and manage your account and process your bookings.</li>
        <li>To issue tickets, send booking confirmations, and deliver QR entry passes.</li>
        <li>To process payments and, where applicable, refunds.</li>
        <li>To provide customer support and respond to your requests.</li>
        <li>To send service updates and, with your consent, promotional messages.</li>
        <li>To detect fraud, secure our platform, and comply with legal obligations.</li>
      </ul>
    ),
  },
  {
    heading: 'How we share information',
    body: (
      <>
        <p>We share your information only where necessary:</p>
        <ul>
          <li>
            <strong>Event organizers</strong> — the details needed to admit you to their event and
            manage attendance.
          </li>
          <li>
            <strong>Service providers</strong> — payment processors, email and hosting providers who
            act on our behalf under confidentiality obligations.
          </li>
          <li>
            <strong>Legal authorities</strong> — when required by law or to protect our rights and
            users.
          </li>
        </ul>
        <p>We do not sell your personal information to third parties.</p>
      </>
    ),
  },
  {
    heading: 'Cookies',
    body: (
      <p>
        We use cookies to keep you signed in, remember your preferences, and understand how the
        platform is used. You can control cookies through your browser settings, though disabling
        them may affect some features.
      </p>
    ),
  },
  {
    heading: 'Data security & retention',
    body: (
      <p>
        We apply reasonable technical and organizational measures to protect your information. We
        retain personal data for as long as your account is active or as needed to provide our
        services and meet legal, tax, and accounting requirements.
      </p>
    ),
  },
  {
    heading: 'Your rights',
    body: (
      <>
        <p>Subject to applicable law, you may:</p>
        <ul>
          <li>Access, correct, or update your personal information from your account profile.</li>
          <li>Request deletion of your account and associated data.</li>
          <li>Opt out of promotional communications at any time.</li>
        </ul>
        <p>
          To exercise these rights, contact us at <a href="mailto:support@evento.test">support@evento.test</a>.
        </p>
      </>
    ),
  },
  {
    heading: "Children's privacy",
    body: (
      <p>
        Evento is not directed to children under 13, and we do not knowingly collect personal
        information from them. If you believe a child has provided us information, please contact us
        so we can remove it.
      </p>
    ),
  },
  {
    heading: 'Changes to this policy',
    body: (
      <p>
        We may update this Privacy Policy from time to time. Material changes will be posted on this
        page with a revised “last updated” date. Continued use of Evento after changes take effect
        means you accept the updated policy.
      </p>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      summary="Your privacy matters to us. This policy describes what information we collect, how we use it, and the choices you have."
      updated={UPDATED}
      sections={SECTIONS}
    />
  );
}
