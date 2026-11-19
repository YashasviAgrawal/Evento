import { api, openCheckout } from '@tixit/session';
import type { DepositCheckout, Reservation } from './types';

/**
 * Pay a table deposit: open the order, take the payment, confirm it server
 * side. Resolves with the confirmed reservation; rejects with
 * PAYMENT_CANCELLED if the diner closes the payment sheet.
 */
export async function payDeposit(code: string): Promise<Reservation> {
  const { data: order } = await api.post<DepositCheckout>(`/dining/reservations/${code}/deposit`, {});
  const outcome = await openCheckout(order, {
    description: `Table deposit · ${order.restaurantName}`,
    notes: { reservationCode: code },
  });
  const { data } = await api.post<Reservation>(`/dining/reservations/${code}/deposit/verify`, {
    razorpayOrderId: outcome.orderId,
    razorpayPaymentId: outcome.paymentId,
    razorpaySignature: outcome.signature,
  });
  return data;
}
