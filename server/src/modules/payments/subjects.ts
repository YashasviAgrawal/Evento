/**
 * Payment subjects.
 *
 * `payments` rows belong to exactly one subject (an event booking, a dine-in
 * bill, …), enforced by `payments_one_subject`. The gateway plumbing — orders,
 * signatures, webhooks — is shared; what "captured" *means* belongs to the
 * owning module, which registers a handler here. That keeps this module free
 * of imports from every product built on top of it.
 */
export type PaymentSubjectKind = 'bill_payment' | 'reservation';

export interface CaptureContext {
  method: string;
  paymentId: string;
}

export interface PaymentSubjectHandler {
  /** Must be idempotent: the client callback and the webhook can both arrive. */
  captured(subjectId: string, context: CaptureContext): Promise<void>;
}

const handlers = new Map<PaymentSubjectKind, PaymentSubjectHandler>();

export function registerPaymentSubject(kind: PaymentSubjectKind, handler: PaymentSubjectHandler): void {
  handlers.set(kind, handler);
}

export function paymentSubjectHandler(kind: PaymentSubjectKind): PaymentSubjectHandler {
  const handler = handlers.get(kind);
  if (!handler) throw new Error(`No payment subject handler registered for ${kind}`);
  return handler;
}
