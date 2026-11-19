import { loadRazorpay, openCheckout as openTixitCheckout, type PaymentOutcome } from '@tixit/session';
import type { CheckoutSession } from './types';

/** Razorpay Checkout lives in `@tixit/session`; this adapts it to event bookings. */
export { loadRazorpay, type PaymentOutcome };

export function openCheckout(session: CheckoutSession, options: { onDismiss?: () => void } = {}): Promise<PaymentOutcome> {
  return openTixitCheckout(session, {
    description: session.eventTitle,
    notes: { bookingCode: session.bookingCode },
    onDismiss: options.onDismiss,
  });
}
