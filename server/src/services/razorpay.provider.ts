import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { safeEqual } from '../utils/signing';
import { ServiceUnavailableError } from '../utils/errors';

/**
 * Razorpay integration with a local mock.
 *
 * When RAZORPAY_KEY_ID/SECRET are unset the provider runs in mock mode: orders
 * get a deterministic `order_mock_*` id and signatures are computed with the
 * same HMAC construction Razorpay uses, keyed by the app's QR secret. That
 * keeps the entire checkout → verify → confirm path exercisable in local
 * development and CI without credentials, while the production path is
 * byte-for-byte the real one.
 */

const client = env.razorpay.enabled
  ? new Razorpay({ key_id: env.razorpay.keyId!, key_secret: env.razorpay.keySecret! })
  : null;

export const isMockMode = !env.razorpay.enabled;

export interface ProviderOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

function mockSecret(): string {
  return `mock:${env.qr.secret}`;
}

export async function createOrder(input: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<ProviderOrder> {
  if (!client) {
    const id = `order_mock_${crypto.randomBytes(9).toString('hex')}`;
    logger.warn({ orderId: id }, 'Razorpay not configured — issuing mock order');
    return {
      id,
      amount: input.amountPaise,
      currency: env.razorpay.currency,
      receipt: input.receipt,
      status: 'created',
    };
  }

  try {
    const order = await client.orders.create({
      amount: input.amountPaise,
      currency: env.razorpay.currency,
      receipt: input.receipt,
      notes: input.notes,
      payment_capture: true,
    });
    return {
      id: order.id,
      amount: Number(order.amount),
      currency: order.currency,
      receipt: String(order.receipt ?? input.receipt),
      status: order.status,
    };
  } catch (err) {
    logger.error({ err }, 'Razorpay order creation failed');
    throw new ServiceUnavailableError('Payment gateway is unavailable, please try again');
  }
}

/**
 * Verify the checkout callback signature.
 * Razorpay signs `${order_id}|${payment_id}` with the API secret.
 */
export function verifyPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = client ? env.razorpay.keySecret! : mockSecret();
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex');
  return safeEqual(expected, input.signature);
}

/** Mock-mode helper so the local checkout page can produce a valid signature. */
export function mockSignature(orderId: string, paymentId: string): string {
  return crypto.createHmac('sha256', mockSecret()).update(`${orderId}|${paymentId}`).digest('hex');
}

/**
 * Verify a webhook body against the `x-razorpay-signature` header.
 * Must be given the RAW request body — re-serialising the parsed JSON changes
 * key order and whitespace, which breaks the HMAC.
 */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  if (!env.razorpay.webhookSecret) return false;
  const expected = crypto
    .createHmac('sha256', env.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return safeEqual(expected, signature);
}

export async function fetchPayment(paymentId: string): Promise<Record<string, unknown> | null> {
  if (!client) return { id: paymentId, status: 'captured', method: 'mock' };
  try {
    return (await client.payments.fetch(paymentId)) as unknown as Record<string, unknown>;
  } catch (err) {
    logger.error({ err, paymentId }, 'Failed to fetch payment from Razorpay');
    return null;
  }
}

export async function createRefund(input: {
  paymentId: string;
  amountPaise: number;
  notes?: Record<string, string>;
}): Promise<{ id: string; status: string }> {
  if (!client) {
    return { id: `rfnd_mock_${crypto.randomBytes(8).toString('hex')}`, status: 'processed' };
  }
  try {
    const refund = await client.payments.refund(input.paymentId, {
      amount: input.amountPaise,
      notes: input.notes,
      speed: 'normal',
    });
    return { id: refund.id, status: refund.status };
  } catch (err) {
    logger.error({ err, paymentId: input.paymentId }, 'Razorpay refund failed');
    throw new ServiceUnavailableError('Refund could not be processed by the payment gateway');
  }
}

/** Normalise Razorpay's method strings onto our payment_method enum. */
export function normaliseMethod(method: unknown): string {
  switch (String(method ?? '').toLowerCase()) {
    case 'upi':
      return 'upi';
    case 'card':
    case 'credit_card':
      return 'credit_card';
    case 'debit_card':
      return 'debit_card';
    case 'netbanking':
      return 'netbanking';
    case 'wallet':
      return 'wallet';
    case 'mock':
      return 'mock';
    default:
      return 'unknown';
  }
}
