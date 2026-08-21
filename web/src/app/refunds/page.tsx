import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalList, LegalPage, LegalSection } from '@/components/legal/legal-page';

export const metadata: Metadata = {
  title: 'Refund Policy',
  description: 'When ticket purchases on Tixit are eligible for a refund, and how to request one.',
  alternates: { canonical: '/refunds' },
};

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund Policy"
      intro="Tickets sold through Tixit are issued by the event organizer, who sets the cancellation terms for their event. This policy explains the standard rules that apply across the Platform and how refunds are processed."
      updated="August 15, 2026"
    >
      <LegalSection heading="1. General Ticket Policy">
        <p>
          Unless stated otherwise on the event page at the time of booking, ticket purchases are{' '}
          <strong>final and non-refundable</strong>, and cannot be exchanged once a booking is confirmed. This
          reflects standard practice across movies, concerts, comedy shows, sports, and other live experiences, where
          organizers plan capacity, staffing, and production around confirmed sales.
        </p>
      </LegalSection>

      <LegalSection heading="2. When You Are Entitled to a Refund">
        <p>You are entitled to a full refund of the ticket price, including any convenience fee, in the following cases:</p>
        <LegalList
          items={[
            <>
              <strong>Event cancelled</strong> — if the organizer cancels the event outright, all confirmed bookings
              are automatically refunded to the original payment method.
            </>,
            <>
              <strong>Event postponed or rescheduled</strong> — your ticket remains valid for the new date by default.
              If you cannot attend the new date, you may request a full refund within the window announced by the
              organizer (or within 7 days of the reschedule notice if none is specified).
            </>,
            <>
              <strong>Material change</strong> — if the venue, city, or core line-up of the event changes materially
              from what was advertised at the time of booking.
            </>,
            <>
              <strong>Duplicate or failed transaction</strong> — if you were charged more than once for the same
              order, or charged without receiving a confirmed booking, the extra or failed amount is refunded in
              full.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection heading="3. Organizer-Specific Cancellation Windows">
        <p>
          Some organizers choose to offer attendee-initiated cancellations (for example, up to 24–72 hours before the
          event, subject to a cancellation fee). When an organizer enables this, the specific terms are shown on the
          event page and at checkout before you pay, and those terms govern that booking. Where no such option is
          shown, the general policy in Section 1 applies.
        </p>
      </LegalSection>

      <LegalSection heading="4. Convenience Fees & Payment Gateway Charges">
        <p>
          Convenience fees are refunded in full when a refund is issued under Section 2. Where a refund is issued at
          the organizer&apos;s discretion outside of those cases, the convenience fee and any payment gateway charges
          may be deducted, and this will be disclosed before the refund is confirmed.
        </p>
      </LegalSection>

      <LegalSection heading="5. How Refunds Are Processed">
        <LegalList
          items={[
            'Refunds are issued to the original payment method used at checkout, via our payment partner Razorpay.',
            'Processing typically takes 5–10 business days to reflect in your account, depending on your bank or card issuer.',
            'You will receive an email confirmation once a refund has been initiated, and again once it settles.',
          ]}
        />
      </LegalSection>

      <LegalSection heading="6. How to Request a Refund">
        <p>
          For eligible cases, go to{' '}
          <Link href="/account/bookings" className="font-medium text-brand-600 hover:underline">
            My Bookings
          </Link>{' '}
          and select the booking in question, or contact our support team with your booking code. We aim to respond
          to refund requests within 2 business days.
        </p>
      </LegalSection>

      <LegalSection heading="7. Contact Us">
        <p>
          For help with a refund, reach us at{' '}
          <a href="mailto:support@tixit.in" className="font-medium text-brand-600 hover:underline">
            support@tixit.in
          </a>{' '}
          with your booking code, or see our{' '}
          <Link href="/terms" className="font-medium text-brand-600 hover:underline">
            Terms &amp; Conditions
          </Link>{' '}
          for the full terms governing ticket purchases.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
