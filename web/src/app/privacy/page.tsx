import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalList, LegalPage, LegalSection } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Tixit collects, uses, and protects your personal information.',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="This policy explains what information Tixit collects when you discover and book movies, events, concerts, comedy shows, and sports experiences, and how we use, share, and protect it."
      updated="August 15, 2026"
    >
      <LegalSection heading="1. Overview">
        <p>
          Tixit (&ldquo;Tixit&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) operates a ticketing
          and experiences platform that connects attendees with event organizers. This Privacy Policy applies to the
          Tixit website, mobile experience, and related services (collectively, the &ldquo;Platform&rdquo;), and
          describes how we handle personal information for customers, organizers, and visitors.
        </p>
      </LegalSection>

      <LegalSection heading="2. Information We Collect">
        <p>We collect information in three ways: what you give us, what we collect automatically, and what we receive from others.</p>
        <LegalList
          items={[
            <>
              <strong>Account information</strong> — name, email address, phone number, and password when you register,
              sign in, or update your profile.
            </>,
            <>
              <strong>Booking information</strong> — the events, tickets, seat or tier selections, and attendee details
              associated with each order.
            </>,
            <>
              <strong>Payment information</strong> — Tixit does not store your full card, UPI, or net banking
              credentials. Payments are processed by our payment partner, Razorpay, which shares only the information
              necessary to confirm and reconcile your booking (such as transaction ID, payment status, and the last
              four digits of a card where applicable).
            </>,
            <>
              <strong>Device and usage information</strong> — IP address, browser type, pages viewed, referring URLs,
              and approximate location, collected automatically through cookies and similar technologies.
            </>,
            <>
              <strong>Organizer information</strong> — business name, contact details, bank or payout details, and
              event content submitted by organizers who list events on Tixit.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection heading="3. How We Use Your Information">
        <LegalList
          items={[
            'Create and manage your account, and process ticket bookings and payments.',
            'Generate and validate your digital QR tickets for entry at the venue.',
            'Send booking confirmations, event reminders, schedule changes, and support communications.',
            'Detect and prevent fraud, abuse, and unauthorized ticket resale.',
            'Improve the Platform, including personalizing event recommendations and measuring performance.',
            'Comply with legal obligations and enforce our Terms & Conditions.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="4. How We Share Information">
        <p>We share personal information only as needed to operate the Platform:</p>
        <LegalList
          items={[
            <>
              <strong>Event organizers</strong> — when you book a ticket, the organizer of that event receives your
              name, contact details, and ticket/attendee details to manage entry, seating, and event communications.
            </>,
            <>
              <strong>Payment and infrastructure partners</strong> — including Razorpay for payment processing, and
              hosting, analytics, and communication providers who process data on our behalf under contractual
              confidentiality obligations.
            </>,
            <>
              <strong>Legal and safety</strong> — where required by law, court order, or to protect the rights,
              property, or safety of Tixit, our users, or the public.
            </>,
            'We do not sell your personal information to third parties.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="5. Cookies & Tracking">
        <p>
          We use cookies and similar technologies to keep you signed in, remember your preferences (such as city and
          search filters), and understand how the Platform is used. You can control cookies through your browser
          settings; disabling them may limit some features, such as staying signed in.
        </p>
      </LegalSection>

      <LegalSection heading="6. Data Retention">
        <p>
          We retain booking and payment records for as long as needed to fulfil your order, meet accounting and tax
          obligations, resolve disputes, and comply with law. Account information is retained until you request
          deletion, subject to records we are legally required to keep.
        </p>
      </LegalSection>

      <LegalSection heading="7. Your Rights & Choices">
        <p>
          You can review and update your account details from your profile at any time. To request access,
          correction, or deletion of your personal information, contact us using the details below — we will respond
          within a reasonable time and in accordance with applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="8. Children's Privacy">
        <p>
          Tixit is not directed at children under 18. We do not knowingly collect personal information from children.
          If you believe a child has provided us with personal information, please contact us so we can remove it.
        </p>
      </LegalSection>

      <LegalSection heading="9. Data Security">
        <p>
          We use industry-standard technical and organizational measures — including encryption in transit and access
          controls — to protect your information. No method of transmission or storage is completely secure, so we
          cannot guarantee absolute security.
        </p>
      </LegalSection>

      <LegalSection heading="10. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time to reflect changes to our practices or for legal
          reasons. We will post the updated policy on this page with a revised &ldquo;Last updated&rdquo; date, and,
          where changes are material, provide additional notice.
        </p>
      </LegalSection>

      <LegalSection heading="11. Contact Us">
        <p>
          Questions about this Privacy Policy or your personal information can be sent to{' '}
          <a href="mailto:support@tixit.in" className="font-medium text-brand-600 hover:underline">
            support@tixit.in
          </a>{' '}
          or reviewed alongside our{' '}
          <Link href="/terms" className="font-medium text-brand-600 hover:underline">
            Terms &amp; Conditions
          </Link>{' '}
          and{' '}
          <Link href="/refunds" className="font-medium text-brand-600 hover:underline">
            Refund Policy
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
