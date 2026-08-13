import Link from 'next/link';
import type { Metadata } from 'next';
import { LegalPage, type LegalSection } from '@/components/layout/legal-page';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy',
  description: 'When you can cancel a booking and how refunds are processed on Evento.',
};

const UPDATED = '13 August 2026';

const SECTIONS: LegalSection[] = [
  {
    heading: 'Overview',
    body: (
      <p>
        This Refund &amp; Cancellation Policy explains when you can cancel a booking made on Evento
        and how eligible refunds are handled. It forms part of our{' '}
        <Link href="/terms">Terms of Service</Link>. Because organizers set the terms for their own
        events, some events may carry additional or stricter conditions, which are shown on the event
        page before you book.
      </p>
    ),
  },
  {
    heading: 'Cancellation window',
    body: (
      <>
        <p>
          You may cancel a confirmed booking from your{' '}
          <Link href="/account/bookings">Bookings</Link> page, provided you do so at least{' '}
          <strong>48 hours before the event start time</strong>. Once this window has closed,
          bookings can no longer be cancelled and are non-refundable.
        </p>
        <p>
          The exact cancellation window may vary by event; the applicable cut-off is enforced
          automatically when you request a cancellation.
        </p>
      </>
    ),
  },
  {
    heading: 'How refunds are processed',
    body: (
      <>
        <p>When you cancel an eligible paid booking:</p>
        <ul>
          <li>Your tickets are immediately voided and returned to the event’s inventory.</li>
          <li>
            A refund request is opened for the amount paid and reviewed by our team. Refunds are not
            issued automatically — they are approved before any money is returned.
          </li>
          <li>
            Once approved, the refund is credited to your original payment method through Razorpay.
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: 'Refund timeline',
    body: (
      <p>
        After a refund is approved, it typically reaches your original payment method within{' '}
        <strong>5–7 business days</strong>, depending on your bank or payment provider. You will
        receive an email confirmation once the refund has been initiated.
      </p>
    ),
  },
  {
    heading: 'Convenience fees',
    body: (
      <p>
        Any convenience or processing fees shown at checkout are non-refundable, unless the event is
        cancelled or rescheduled by the organizer. Where a full refund is warranted, the ticket
        amount is refunded in full.
      </p>
    ),
  },
  {
    heading: 'Events cancelled or rescheduled by the organizer',
    body: (
      <>
        <p>If an organizer cancels or reschedules an event:</p>
        <ul>
          <li>
            <strong>Cancelled events</strong> — you are entitled to a full refund of the amount paid,
            including fees. No action is usually required from you.
          </li>
          <li>
            <strong>Rescheduled events</strong> — your existing ticket remains valid for the new date.
            If you cannot attend the new date, you may request a refund.
          </li>
        </ul>
        <p>We will notify you by email of any cancellation or change and the options available.</p>
      </>
    ),
  },
  {
    heading: 'Free events',
    body: (
      <p>
        Bookings for free events carry no charge and therefore no refund. You may still cancel a free
        booking to release your seat for other attendees.
      </p>
    ),
  },
  {
    heading: 'Non-refundable situations',
    body: (
      <ul>
        <li>Cancellation requests made after the cancellation window has closed.</li>
        <li>No-shows or failure to attend the event.</li>
        <li>Denied entry due to a violation of the organizer’s or venue’s rules.</li>
      </ul>
    ),
  },
  {
    heading: 'Need help?',
    body: (
      <p>
        If you have a question about a cancellation or refund, or believe a refund is delayed, contact
        us at <a href="mailto:support@evento.test">support@evento.test</a> with your booking reference
        and we’ll look into it.
      </p>
    ),
  },
];

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund & Cancellation Policy"
      summary="Understand when you can cancel a booking and how eligible refunds are reviewed and returned."
      updated={UPDATED}
      sections={SECTIONS}
    />
  );
}
