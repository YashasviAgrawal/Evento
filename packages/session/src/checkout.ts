/**
 * Razorpay Checkout, shared by every Tixit product that takes a payment.
 *
 * The script is loaded lazily the first time someone reaches a payment step.
 * In mock mode (no Razorpay keys on the server) the server has already signed
 * the order, so this resolves immediately and the rest of the flow — including
 * server-side signature verification — runs exactly as in production.
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
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      loader = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return loader;
}

/** What any Tixit payment endpoint returns to start a checkout. */
export interface CheckoutOrder {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string | null;
  mockMode: boolean;
  mockPaymentId?: string;
  mockSignature?: string;
  prefill: { name: string; email: string; contact: string };
}

export interface PaymentOutcome {
  orderId: string;
  paymentId: string;
  signature: string;
}

/** Thrown when the person closes the payment sheet — not an error to show. */
export const PAYMENT_CANCELLED = 'PAYMENT_CANCELLED';

export async function openCheckout(
  order: CheckoutOrder,
  details: { description: string; notes?: Record<string, string>; onDismiss?: () => void },
): Promise<PaymentOutcome> {
  if (order.mockMode) {
    return { orderId: order.orderId, paymentId: order.mockPaymentId!, signature: order.mockSignature! };
  }
  await loadRazorpay();

  return new Promise<PaymentOutcome>((resolve, reject) => {
    if (!window.Razorpay || !order.keyId) {
      reject(new Error('Payment gateway failed to load. Please refresh and try again.'));
      return;
    }
    const instance = new window.Razorpay({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      name: 'Tixit',
      description: details.description,
      order_id: order.orderId,
      prefill: order.prefill,
      notes: details.notes,
      theme: { color: '#e11d48' },
      handler: (response) =>
        resolve({
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }),
      modal: {
        ondismiss: () => {
          details.onDismiss?.();
          reject(new Error(PAYMENT_CANCELLED));
        },
      },
    });
    instance.on('payment.failed', (payload) => {
      reject(new Error(payload.error?.description ?? 'Your payment could not be completed'));
    });
    instance.open();
  });
}
