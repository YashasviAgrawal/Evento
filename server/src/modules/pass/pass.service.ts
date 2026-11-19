import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { query, queryOne, withTransaction, type Queryable } from '../../db/pool';
import * as gateway from '../../services/razorpay.provider';
import { getSettings } from '../../services/settings.service';
import { readableCode } from '../../utils/ids';
import { NotFoundError, PaymentError } from '../../utils/errors';
import { PLATFORM, post } from '../finance/ledger';
import { registerPaymentSubject } from '../payments/subjects';

/**
 * Tixit Pass — the membership.
 *
 * Perks, each enforced where the money is computed, never by the UI:
 *   · no platform fee on dine-in bills       (pricing engine `feeWaived`)
 *   · cashback × `pass_cashback_multiplier`  (wallet accrual at settlement)
 *
 * Price and length come from settings, so they can change without a deploy;
 * each purchase freezes its own price and days. The price is GST inclusive.
 */

const GST_PERCENT = 18;

export interface PassCheckout {
  code: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string | null;
  mockMode: boolean;
  mockPaymentId?: string;
  mockSignature?: string;
  restaurantName: string;
  prefill: { name: string; email: string; contact: string };
}

/** The pass covering this moment, if any. */
export async function activePass(userId: string, client: Queryable = { query }): Promise<{ endsAt: Date } | null> {
  const { rows } = await client.query<{ ends_at: Date }>(
    `SELECT max(ends_at) AS ends_at FROM memberships
      WHERE user_id = $1 AND status = 'active' AND starts_at <= now() AND ends_at > now()`,
    [userId],
  );
  return rows[0]?.ends_at ? { endsAt: rows[0].ends_at } : null;
}

export async function isMember(userId: string | null, client: Queryable = { query }): Promise<boolean> {
  return userId ? Boolean(await activePass(userId, client)) : false;
}

/** Plan, the viewer's status, and what the pass has saved them so far. */
export async function getPass(userId: string | null) {
  const settings = await getSettings();
  const plan = {
    pricePaise: Number(settings.pass_price_paise),
    days: Number(settings.pass_days),
    cashbackMultiplier: Number(settings.pass_cashback_multiplier),
    feePaise: Number(settings.dining_convenience_fee_paise),
  };
  if (!userId) return { plan, membership: null };

  const [current, latest, saved] = await Promise.all([
    activePass(userId),
    queryOne<{ ends_at: Date }>(
      `SELECT max(ends_at) AS ends_at FROM memberships WHERE user_id = $1 AND status = 'active'`,
      [userId],
    ),
    queryOne<{ fees: number; bills: number }>(
      `SELECT COALESCE(sum(pass_savings_paise), 0)::bigint AS fees, count(*) FILTER (WHERE pass_savings_paise > 0)::int AS bills
         FROM dining.bill_payments WHERE user_id = $1 AND status IN ('paid', 'verified', 'disputed')`,
      [userId],
    ),
  ]);
  return {
    plan,
    membership: {
      active: Boolean(current),
      // Includes renewals bought ahead of time.
      validUntil: latest?.ends_at ?? null,
      feesSavedPaise: Number(saved?.fees ?? 0),
      billsWithPass: Number(saved?.bills ?? 0),
    },
  };
}

/** Open (or reuse) a pending purchase and its gateway order. */
export async function startPassCheckout(userId: string): Promise<PassCheckout> {
  const settings = await getSettings();
  const price = Number(settings.pass_price_paise);
  const days = Number(settings.pass_days);
  const user = await queryOne<{ full_name: string; email: string; phone: string | null }>(
    'SELECT full_name, email, phone FROM users WHERE id = $1',
    [userId],
  );
  if (!user) throw new NotFoundError('User');

  // Reuse a recent unpaid purchase at today's price, so retries don't pile up rows.
  let pending = await queryOne<{ id: string; code: string; order_id: string | null }>(
    `SELECT m.id, m.code,
            (SELECT p.provider_order_id FROM payments p WHERE p.membership_id = m.id AND p.status IN ('created', 'pending')
              ORDER BY p.created_at DESC LIMIT 1) AS order_id
       FROM memberships m
      WHERE m.user_id = $1 AND m.status = 'pending_payment' AND m.price_paise = $2 AND m.days = $3
        AND m.created_at > now() - interval '1 hour'
      ORDER BY m.created_at DESC LIMIT 1`,
    [userId, price, days],
  );
  if (!pending) {
    const gst = Math.round((price * GST_PERCENT) / (100 + GST_PERCENT));
    pending = await queryOne<{ id: string; code: string; order_id: null }>(
      `INSERT INTO memberships (code, user_id, plan, price_paise, gst_paise, days)
       VALUES ($1, $2, 'tixit_pass', $3, $4, $5) RETURNING id, code, NULL::text AS order_id`,
      [`PASS-${readableCode(6)}`, userId, price, gst, days],
    );
  }

  let orderId = pending!.order_id;
  if (!orderId) {
    const order = await gateway.createOrder({ amountPaise: price, receipt: pending!.code, notes: { membership: pending!.code, product: 'tixit_pass' } });
    orderId = order.id;
    await query(
      `INSERT INTO payments (membership_id, provider, provider_order_id, amount_paise, currency, status)
       VALUES ($1, $2, $3, $4, $5, 'created')`,
      [pending!.id, gateway.isMockMode ? 'mock' : 'razorpay', orderId, price, env.razorpay.currency],
    );
  }

  const session: PassCheckout = {
    code: pending!.code,
    orderId,
    amountPaise: price,
    currency: env.razorpay.currency,
    keyId: env.razorpay.keyId ?? null,
    mockMode: gateway.isMockMode,
    restaurantName: 'Tixit Pass',
    prefill: { name: user.full_name, email: user.email, contact: user.phone ?? '' },
  };
  if (gateway.isMockMode) {
    session.mockPaymentId = `pay_mock_${orderId.slice(-12)}`;
    session.mockSignature = gateway.mockSignature(orderId, session.mockPaymentId);
  }
  return session;
}

export async function verifyPassPayment(userId: string, input: { orderId: string; paymentId: string; signature: string }) {
  const payment = await queryOne<{ id: string; status: string; membership_id: string; user_id: string }>(
    `SELECT p.id, p.status, p.membership_id, m.user_id
       FROM payments p JOIN memberships m ON m.id = p.membership_id
      WHERE p.provider_order_id = $1`,
    [input.orderId],
  );
  if (!payment || payment.user_id !== userId) throw new NotFoundError('Payment order');
  if (payment.status !== 'success') {
    if (!gateway.verifyPaymentSignature(input)) {
      await query(`UPDATE payments SET status = 'failed', error_code = 'SIGNATURE_MISMATCH' WHERE id = $1 AND status <> 'success'`, [payment.id]);
      throw new PaymentError('Payment could not be verified', 'SIGNATURE_MISMATCH');
    }
    const remote = await gateway.fetchPayment(input.paymentId);
    await query(
      `UPDATE payments SET status = 'success', provider_payment_id = $2, provider_signature = $3,
              method = $4::payment_method, captured_at = now(), raw_response = $5::jsonb
        WHERE id = $1 AND status <> 'success'`,
      [payment.id, input.paymentId, input.signature, gateway.normaliseMethod(remote?.method), JSON.stringify(remote ?? {})],
    );
    await activatePass(payment.membership_id);
  }
  return getPass(userId);
}

/**
 * Captured: the pass starts now, or when the running one ends. Idempotent —
 * the guarded UPDATE means callback and webhook cannot both activate it.
 */
export async function activatePass(membershipId: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ user_id: string; code: string; price_paise: number; gst_paise: number; days: number }>(
      `SELECT user_id, code, price_paise, gst_paise, days FROM memberships WHERE id = $1 AND status = 'pending_payment' FOR UPDATE`,
      [membershipId],
    );
    const pass = rows[0];
    if (!pass) return;
    // Serialise a user's purchases so two renewals cannot start at the same moment.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pass:${pass.user_id}`]);
    await client.query(
      `UPDATE memberships SET status = 'active', paid_at = now(),
              starts_at = GREATEST(now(), COALESCE((SELECT max(ends_at) FROM memberships
                                                      WHERE user_id = $2 AND status = 'active'), now())),
              ends_at = GREATEST(now(), COALESCE((SELECT max(ends_at) FROM memberships
                                                    WHERE user_id = $2 AND status = 'active'), now())) + make_interval(days => $3)
        WHERE id = $1`,
      [membershipId, pass.user_id, pass.days],
    );
    const price = Number(pass.price_paise);
    const gst = Number(pass.gst_paise);
    await post(client, {
      kind: 'pass_sold',
      sourceType: 'membership',
      sourceId: membershipId,
      idempotencyKey: `pass_sold:${membershipId}`,
      memo: pass.code,
      entries: [
        { account: PLATFORM.gatewayClearing, amountPaise: price },
        { account: PLATFORM.membershipRevenue, amountPaise: -(price - gst) },
        { account: PLATFORM.gstOutput, amountPaise: -gst },
      ],
    });
    logger.info({ pass: pass.code }, 'Tixit Pass activated');
  });
}

registerPaymentSubject('membership', {
  async captured(membershipId) {
    await activatePass(membershipId);
  },
});
