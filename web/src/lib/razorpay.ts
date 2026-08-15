import type { CheckoutSession } from './types';

/**
 * Razorpay Checkout is loaded lazily from the CDN the first time a customer
 * reaches the payment step, so it costs nothing on every other page.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayHandlerResponse) => void;
  prefill: { name: string; email: string; contact: string };
  notes?: Record<string, string>;
  theme?: { color: string };
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (payload: { error?: { code?: string; description?: string } }) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let loader: Promise<boolean> | null = null;

export function loadRazorpay(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (loader) return loader;

  loader = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

  return loader;
}

export interface PaymentOutcome {
  orderId: string;
  paymentId: string;
  signature: string;
}

/**
 * Open the payment sheet and resolve with the verification triple.
 *
 * In mock mode (no Razorpay keys configured) the server has already produced a
 * valid signature, so we resolve immediately — the rest of the flow, including
 * server-side signature verification, runs exactly as it does in production.
 */
export function openCheckout(
  session: CheckoutSession,
  options: { onDismiss?: () => void } = {},
): Promise<PaymentOutcome> {
  if (session.mockMode) {
    return Promise.resolve({
      orderId: session.orderId,
      paymentId: session.mockPaymentId!,
      signature: session.mockSignature!,
    });
  }

  return new Promise<PaymentOutcome>((resolve, reject) => {
    if (!window.Razorpay || !session.keyId) {
      reject(new Error('Payment gateway failed to load. Please refresh and try again.'));
      return;
    }

    const instance = new window.Razorpay({
      key: session.keyId,
      amount: session.amountPaise,
      currency: session.currency,
      name: 'Tixit',
      description: session.eventTitle,
      order_id: session.orderId,
      prefill: session.prefill,
      notes: { bookingCode: session.bookingCode },
      theme: { color: '#e11d48' },
      handler: (response) =>
        resolve({
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }),
      modal: {
        ondismiss: () => {
          options.onDismiss?.();
          reject(new Error('PAYMENT_CANCELLED'));
        },
      },
    });

    instance.on('payment.failed', (payload) => {
      reject(new Error(payload.error?.description ?? 'Your payment could not be completed'));
    });

    instance.open();
  });
}
