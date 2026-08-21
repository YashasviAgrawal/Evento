import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalList, LegalPage, LegalSection } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: 'The terms that govern your use of Tixit to discover, book, and manage event tickets.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      intro="These Terms & Conditions (“Terms”) govern your access to and use of Tixit to discover and book movies, events, concerts, comedy shows, sports, and other experiences. By creating an account, browsing, or booking a ticket on Tixit, you agree to these Terms."
      updated="August 15, 2026"
    >
      <LegalSection heading="1. Acceptance of Terms">
        <p>
          By accessing or using Tixit (the &ldquo;Platform&rdquo;), you agree to be bound by these Terms and our{' '}
          <Link href="/privacy" className="font-medium text-brand-600 hover:underline">
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link href="/refunds" className="font-medium text-brand-600 hover:underline">
            Refund Policy
          </Link>
          , which are incorporated by reference. If you do not agree, please do not use the Platform.
        </p>
      </LegalSection>

      <LegalSection heading="2. Eligibility & Accounts">
        <LegalList
          items={[
            'You must be at least 18 years old, or hold a parent/guardian’s permission, to create an account and book tickets.',
            'You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account.',
            'You agree to provide accurate, current information when registering and booking, since it is used for entry and communication.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="3. Booking Tickets">
        <p>
          Tixit acts as a ticketing platform connecting you with independent event organizers. Each listing, its
          pricing, ticket tiers, and any age or entry restrictions are set by the organizer. Availability is not
          guaranteed until your payment is confirmed and a booking code is issued.
        </p>
      </LegalSection>

      <LegalSection heading="4. Pricing & Payments">
        <LegalList
          items={[
            'Ticket prices are set by the organizer and may include a Tixit convenience fee and applicable taxes, shown before you complete checkout.',
            'Payments are processed securely by our payment partner, Razorpay, via UPI, cards, or net banking. Tixit does not store your full payment credentials.',
            'Prices may vary by demand, tier, or timing at the organizer’s discretion, and are not locked in until payment is complete.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="5. QR Tickets & Entry">
        <LegalList
          items={[
            'Confirmed bookings generate a digital QR ticket, which is scanned once at the venue for entry.',
            'Each QR ticket is valid for a single scan; screenshots or forwarded copies do not create additional valid entries, and duplicate scan attempts will be declined.',
            'You may be asked to present a valid photo ID matching the booking at entry, at the organizer’s discretion.',
            'Tixit and organizers are not responsible for entry issues caused by lost, shared, or resold QR codes.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="6. Cancellations & Refunds">
        <p>
          Ticket cancellations and refund eligibility — including for cancelled or rescheduled events — are governed
          by our{' '}
          <Link href="/refunds" className="font-medium text-brand-600 hover:underline">
            Refund Policy
          </Link>
          . Please review it before booking.
        </p>
      </LegalSection>

      <LegalSection heading="7. Organizer Terms">
        <p>If you list events as an organizer on Tixit, you additionally agree that:</p>
        <LegalList
          items={[
            'The information you publish (event details, pricing, images, and policies) is accurate and lawful, and you hold the rights to publish it.',
            'You are responsible for delivering the event as advertised, and for honoring the cancellation and refund terms shown to attendees at checkout.',
            'Tixit deducts an agreed platform fee from ticket revenue before payout, as shown in your organizer dashboard.',
            'Tixit may suspend or remove listings that violate these Terms, applicable law, or venue and safety requirements.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="8. Prohibited Conduct">
        <p>You agree not to:</p>
        <LegalList
          items={[
            'Resell tickets for profit or circumvent per-order purchase limits without the organizer’s written permission.',
            'Use bots, scripts, or automated means to book tickets or scrape the Platform.',
            'Upload unlawful, infringing, or misleading content, or impersonate another person or organization.',
            'Interfere with the security or normal operation of the Platform.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="9. Intellectual Property">
        <p>
          The Tixit name, logo, and Platform design are owned by Tixit and may not be used without permission. Event
          content (images, descriptions) remains the property of the respective organizer, who grants Tixit a
          license to display it on the Platform.
        </p>
      </LegalSection>

      <LegalSection heading="10. Third-Party Services">
        <p>
          The Platform relies on third-party services, including Razorpay for payments. Your use of those services is
          also subject to their own terms, and Tixit is not responsible for outages or issues originating from
          third-party providers.
        </p>
      </LegalSection>

      <LegalSection heading="11. Disclaimers & Limitation of Liability">
        <p>
          Tixit provides the Platform on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We do not
          guarantee that events will meet your expectations, as event content and delivery are the responsibility of
          the organizer. To the fullest extent permitted by law, Tixit&apos;s liability for any claim relating to the
          Platform is limited to the amount you paid for the relevant booking.
        </p>
      </LegalSection>

      <LegalSection heading="12. Termination">
        <p>
          We may suspend or terminate your account if you violate these Terms, engage in fraudulent activity, or
          misuse the Platform. You may stop using Tixit and close your account at any time by contacting support.
        </p>
      </LegalSection>

      <LegalSection heading="13. Governing Law">
        <p>
          These Terms are governed by the laws of India. Any disputes arising from your use of the Platform will be
          subject to the exclusive jurisdiction of the courts of Jaipur, Rajasthan.
        </p>
      </LegalSection>

      <LegalSection heading="14. Changes to These Terms">
        <p>
          We may update these Terms from time to time. Continued use of the Platform after changes take effect
          constitutes acceptance of the revised Terms. We will update the &ldquo;Last updated&rdquo; date above when
          changes are made.
        </p>
      </LegalSection>

      <LegalSection heading="15. Contact Us">
        <p>
          Questions about these Terms can be sent to{' '}
          <a href="mailto:support@tixit.in" className="font-medium text-brand-600 hover:underline">
            support@tixit.in
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
