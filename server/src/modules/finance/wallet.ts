/**
 * Tixit Wallet — cashback, held as lots.
 *
 * A lot is earned on a paid bill, waits `dining_cashback_release_hours` and
 * for the bill to be verified at the table, then becomes spendable until it
 * expires. Spending draws from the soonest-expiring lots first. Balances are
 * always derived from the lots, never stored.
 *
 * Ledger: release posts Dr cashback expense / Cr wallet liability; spending
 * is part of the bill posting (Dr wallet liability); expiry reverses the
 * unspent remainder. The wallet belongs to the Tixit account, not to Dine-in,
 * so the events app can spend it too.
 */
import { query, withTransaction, type Queryable } from '../../db/pool';
import { ConflictError } from '../../utils/errors';
import { getSettings } from '../../services/settings.service';
import { PLATFORM, post } from './ledger';

export async function availableBalance(userId: string, client: Queryable = { query }): Promise<number> {
  const { rows } = await client.query<{ balance: number }>(
    `SELECT COALESCE(sum(remaining_paise), 0)::bigint AS balance FROM finance.wallet_credits
      WHERE user_id = $1 AND status = 'available' AND expires_at > now()`,
    [userId],
  );
  return Number(rows[0]?.balance ?? 0);
}

export async function walletSummary(userId: string) {
  const [{ rows: totals }, { rows: activity }] = await Promise.all([
    query<{ available: number; pending: number; expiring: number; next_expiry: Date | null; lifetime: number }>(
      `SELECT COALESCE(sum(remaining_paise) FILTER (WHERE status = 'available' AND expires_at > now()), 0)::bigint AS available,
              COALESCE(sum(amount_paise) FILTER (WHERE status = 'pending'), 0)::bigint AS pending,
              COALESCE(sum(remaining_paise) FILTER (WHERE status = 'available' AND expires_at BETWEEN now() AND now() + interval '14 days'), 0)::bigint AS expiring,
              min(expires_at) FILTER (WHERE status = 'available' AND remaining_paise > 0 AND expires_at > now()) AS next_expiry,
              COALESCE(sum(amount_paise) FILTER (WHERE status IN ('available', 'expired')), 0)::bigint AS lifetime
         FROM finance.wallet_credits WHERE user_id = $1`,
      [userId],
    ),
    query<{ kind: string; amount: number; at: Date; label: string | null; status: string | null; available_at: Date | null }>(
      `SELECT * FROM (
         SELECT CASE c.status WHEN 'pending' THEN 'cashback_pending' WHEN 'clawed_back' THEN 'cashback_reversed'
                     WHEN 'expired' THEN 'cashback_expired' ELSE 'cashback' END AS kind,
                c.amount_paise AS amount, c.created_at AS at, r.name AS label, c.status::text AS status, c.available_at
           FROM finance.wallet_credits c
           LEFT JOIN dining.bill_payments b ON c.source_type = 'dining.bill_payment' AND b.id = c.source_id
           LEFT JOIN dining.restaurants r ON r.id = b.restaurant_id
          WHERE c.user_id = $1
         UNION ALL
         SELECT 'spent', -sum(w.amount_paise), min(w.created_at), r.name, NULL, NULL
           FROM finance.wallet_redemptions w
           JOIN dining.bill_payments b ON b.id = w.bill_payment_id
           JOIN dining.restaurants r ON r.id = b.restaurant_id
          WHERE w.user_id = $1 AND w.status = 'captured'
          GROUP BY w.bill_payment_id, r.name
       ) t ORDER BY at DESC LIMIT 50`,
      [userId],
    ),
  ]);
  const t = totals[0]!;
  return {
    availablePaise: Number(t.available),
    pendingPaise: Number(t.pending),
    expiringSoonPaise: Number(t.expiring),
    nextExpiry: t.next_expiry,
    lifetimeEarnedPaise: Number(t.lifetime),
    activity: activity.map((row) => ({
      kind: row.kind,
      amountPaise: Number(row.amount),
      at: row.at,
      label: row.label,
      availableAt: row.kind === 'cashback_pending' ? row.available_at : null,
    })),
  };
}

/** Reserve wallet money for an unpaid bill, soonest-expiring lots first. */
export async function holdForBill(client: Queryable, userId: string, billId: string, amountPaise: number): Promise<void> {
  if (amountPaise <= 0) return;
  const { rows } = await client.query<{ id: string; remaining_paise: number }>(
    `SELECT id, remaining_paise FROM finance.wallet_credits
      WHERE user_id = $1 AND status = 'available' AND expires_at > now() AND remaining_paise > 0
      ORDER BY expires_at, created_at
      FOR UPDATE`,
    [userId],
  );
  let needed = amountPaise;
  for (const lot of rows) {
    if (needed <= 0) break;
    const take = Math.min(needed, Number(lot.remaining_paise));
    await client.query('UPDATE finance.wallet_credits SET remaining_paise = remaining_paise - $2 WHERE id = $1', [lot.id, take]);
    await client.query(
      `INSERT INTO finance.wallet_redemptions (credit_id, user_id, bill_payment_id, amount_paise) VALUES ($1, $2, $3, $4)`,
      [lot.id, userId, billId, take],
    );
    needed -= take;
  }
  if (needed > 0) throw new ConflictError('Your wallet balance changed — please review the bill again', 'WALLET_CHANGED');
}

export async function captureForBill(client: Queryable, billId: string): Promise<void> {
  await client.query(`UPDATE finance.wallet_redemptions SET status = 'captured' WHERE bill_payment_id = $1 AND status = 'held'`, [billId]);
}

/** Give back what an abandoned bill had reserved. */
export async function releaseForBill(client: Queryable, billId: string): Promise<void> {
  const { rows } = await client.query<{ credit_id: string; amount_paise: number }>(
    `UPDATE finance.wallet_redemptions SET status = 'released'
      WHERE bill_payment_id = $1 AND status = 'held' RETURNING credit_id, amount_paise`,
    [billId],
  );
  for (const row of rows) {
    await client.query('UPDATE finance.wallet_credits SET remaining_paise = remaining_paise + $2 WHERE id = $1', [
      row.credit_id,
      row.amount_paise,
    ]);
  }
}

/** Cashback a paid bill earns (pending until released). Idempotent per bill. */
export async function accrueCashback(
  client: Queryable,
  input: { userId: string; billId: string; eligiblePaise: number },
): Promise<number> {
  const settings = await getSettings(client);
  const amount = Math.min(
    Number(settings.dining_cashback_max_paise),
    Math.round((Math.max(0, input.eligiblePaise) * Number(settings.dining_cashback_percent)) / 100),
  );
  if (amount <= 0) return 0;
  await client.query(
    `INSERT INTO finance.wallet_credits (user_id, source_type, source_id, amount_paise, remaining_paise, status, available_at, expires_at)
     VALUES ($1, 'dining.bill_payment', $2, $3, $3, 'pending',
             now() + make_interval(hours => $4), now() + make_interval(hours => $4, days => $5))
     ON CONFLICT (source_type, source_id) DO NOTHING`,
    [input.userId, input.billId, amount, Number(settings.dining_cashback_release_hours), Number(settings.dining_cashback_expiry_days)],
  );
  return amount;
}

/**
 * Release pending cashback whose wait is over and whose bill was verified at
 * the table; claw back cashback on bills that were disputed or refunded.
 */
export async function releaseCashback(): Promise<{ released: number; clawedBack: number }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; amount_paise: number; bill_status: string }>(
      `SELECT c.id, c.amount_paise, b.status AS bill_status
         FROM finance.wallet_credits c
         JOIN dining.bill_payments b ON c.source_type = 'dining.bill_payment' AND b.id = c.source_id
        WHERE c.status = 'pending' AND c.available_at <= now() AND b.status IN ('verified', 'disputed', 'refunded', 'cancelled')
        LIMIT 500
        FOR UPDATE OF c SKIP LOCKED`,
    );
    let released = 0;
    let clawedBack = 0;
    for (const row of rows) {
      if (row.bill_status === 'verified') {
        await client.query(`UPDATE finance.wallet_credits SET status = 'available' WHERE id = $1`, [row.id]);
        await post(client, {
          kind: 'cashback_released',
          sourceType: 'finance.wallet_credit',
          sourceId: row.id,
          idempotencyKey: `cashback_released:${row.id}`,
          entries: [
            { account: PLATFORM.cashbackExpense, amountPaise: Number(row.amount_paise) },
            { account: PLATFORM.walletLiability, amountPaise: -Number(row.amount_paise) },
          ],
        });
        released += 1;
      } else {
        await client.query(`UPDATE finance.wallet_credits SET status = 'clawed_back', remaining_paise = 0 WHERE id = $1`, [row.id]);
        clawedBack += 1;
      }
    }
    return { released, clawedBack };
  });
}

/** Expire unspent cashback; the unspent remainder comes back off the expense. */
export async function expireCredits(): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; remaining_paise: number }>(
      `UPDATE finance.wallet_credits SET status = 'expired'
        WHERE id IN (SELECT id FROM finance.wallet_credits WHERE status = 'available' AND expires_at <= now()
                      LIMIT 500 FOR UPDATE SKIP LOCKED)
        RETURNING id, remaining_paise`,
    );
    for (const row of rows) {
      if (Number(row.remaining_paise) <= 0) continue;
      await post(client, {
        kind: 'cashback_expired',
        sourceType: 'finance.wallet_credit',
        sourceId: row.id,
        idempotencyKey: `cashback_expired:${row.id}`,
        entries: [
          { account: PLATFORM.walletLiability, amountPaise: Number(row.remaining_paise) },
          { account: PLATFORM.cashbackExpense, amountPaise: -Number(row.remaining_paise) },
        ],
      });
    }
    return rows.length;
  });
}
