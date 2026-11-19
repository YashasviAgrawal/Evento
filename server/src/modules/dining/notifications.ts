/**
 * Dine-in emails. Fired after the change commits and never awaited by the
 * request: a slow mail provider must not slow a booking or a payment, and a
 * failed send is recorded in `notifications` for retry (see mail.service).
 */
import { env } from '../../config/env';
import { query, queryOne } from '../../db/pool';
import { logger } from '../../config/logger';
import { sendMailAsync } from '../../services/mail.service';
import type { TemplateData } from '../../services/mail.templates';
import { DINING_TZ } from './time';
import type { BillPricing } from './offers/engine';

function when(date: Date): string {
  return date.toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: DINING_TZ,
  });
}

export function notifyReservation(reservationId: string, kind: TemplateData['dining_reservation']['kind']): void {
  void (async () => {
    const row = await queryOne<{
      code: string;
      starts_at: Date;
      party_size: number;
      offer_snapshot: { headline?: string } | null;
      user_id: string;
      full_name: string;
      email: string;
      restaurant: string;
      address: string;
    }>(
      `SELECT v.code, v.starts_at, v.party_size, v.offer_snapshot, u.id AS user_id, u.full_name, u.email,
              r.name AS restaurant, r.address
         FROM dining.reservations v
         JOIN users u ON u.id = v.user_id
         JOIN dining.restaurants r ON r.id = v.restaurant_id
        WHERE v.id = $1`,
      [reservationId],
    );
    if (!row) return;
    sendMailAsync({
      to: row.email,
      template: 'dining_reservation',
      userId: row.user_id,
      data: {
        name: row.full_name.split(' ')[0] ?? row.full_name,
        kind,
        code: row.code,
        restaurant: row.restaurant,
        address: row.address,
        when: when(row.starts_at),
        partySize: row.party_size,
        offer: row.offer_snapshot?.headline ?? null,
        url: kind === 'declined' ? `${env.dineinBaseUrl}/restaurants?openNow=1` : `${env.dineinBaseUrl}/bookings/${row.code}`,
      },
    });
  })().catch((err) => logger.error({ err, reservationId }, 'Could not queue reservation email'));
}

export function notifyBillPaid(billId: string): void {
  void (async () => {
    const row = await queryOne<{
      code: string;
      paid_at: Date;
      pricing: BillPricing;
      amount_payable_paise: number;
      user_id: string;
      full_name: string;
      email: string;
      restaurant: string;
    }>(
      `SELECT b.code, b.paid_at, b.pricing, b.amount_payable_paise, u.id AS user_id, u.full_name, u.email,
              r.name AS restaurant
         FROM dining.bill_payments b
         JOIN users u ON u.id = b.user_id
         JOIN dining.restaurants r ON r.id = b.restaurant_id
        WHERE b.id = $1`,
      [billId],
    );
    if (!row) return;
    sendMailAsync({
      to: row.email,
      template: 'dining_bill_receipt',
      userId: row.user_id,
      data: {
        name: row.full_name.split(' ')[0] ?? row.full_name,
        code: row.code,
        restaurant: row.restaurant,
        paidAt: when(row.paid_at),
        billTotalPaise: row.pricing.billTotalPaise,
        savedPaise: row.pricing.totalDiscountPaise,
        amountPaise: Number(row.amount_payable_paise),
        lines: row.pricing.lines
          .filter((line) => line.key !== 'non_discountable')
          .map((line) => ({ label: line.label, amountPaise: line.amountPaise })),
        url: `${env.dineinBaseUrl}/bills/${row.code}`,
      },
    });
  })().catch((err) => logger.error({ err, billId }, 'Could not queue receipt email'));
}

/**
 * Remind diners two hours before their table. Each row is claimed with a
 * guarded UPDATE before mailing, so concurrent runs never double-send.
 */
export async function sendReservationReminders(): Promise<number> {
  const { rows } = await query<{ id: string }>(
    `UPDATE dining.reservations SET reminded_at = now()
      WHERE id IN (
        SELECT id FROM dining.reservations
         WHERE reminded_at IS NULL AND status IN ('placed', 'confirmed')
           AND starts_at BETWEEN now() + interval '30 minutes' AND now() + interval '2 hours 15 minutes'
         LIMIT 200 FOR UPDATE SKIP LOCKED)
      RETURNING id`,
  );
  rows.forEach((row) => notifyReservation(row.id, 'reminder'));
  return rows.length;
}
