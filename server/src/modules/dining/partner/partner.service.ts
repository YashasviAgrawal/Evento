import { query, queryOne } from '../../../db/pool';
import { DINING_TZ } from '../time';
import { liabilityBalance, restaurantPayable } from '../../finance/ledger';
import { capabilitiesFor, type MemberRole } from './partner.middleware';

export async function restaurantsForMember(userId: string, isAdmin: boolean) {
  const { rows } = await query<{
    id: string;
    slug: string;
    name: string;
    locality: string;
    cover_url: string | null;
    status: string;
    role: MemberRole | null;
  }>(
    `SELECT r.id, r.slug, r.name, r.locality, r.cover_url, r.status, m.role
       FROM dining.restaurants r
       LEFT JOIN dining.restaurant_members m ON m.restaurant_id = r.id AND m.user_id = $1
      WHERE m.user_id IS NOT NULL OR $2
      ORDER BY m.role IS NULL, r.name`,
    [userId, isAdmin],
  );
  return rows.map((row) => {
    const role = row.role ?? 'admin';
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      locality: row.locality,
      coverUrl: row.cover_url,
      status: row.status,
      role,
      capabilities: capabilitiesFor(role),
    };
  });
}

/** Today at a glance, for the Live screen. */
export async function todaySummary(restaurantId: string, date: string) {
  const sales = await queryOne<{ bills: number; gross: number; to_verify: number; payout: number }>(
    `SELECT count(*)::int AS bills,
            COALESCE(sum((pricing->>'billTotalPaise')::bigint), 0)::bigint AS gross,
            count(*) FILTER (WHERE status = 'paid')::int AS to_verify,
            COALESCE(sum(restaurant_payout_paise), 0)::bigint AS payout
       FROM dining.bill_payments
      WHERE restaurant_id = $1 AND status IN ('paid', 'verified', 'disputed')
        AND (paid_at AT TIME ZONE '${DINING_TZ}')::date = $2::date`,
    [restaurantId, date],
  );
  const covers = await queryOne<{ covers: number; tables: number; pending: number }>(
    `SELECT COALESCE(sum(party_size) FILTER (WHERE status IN ('placed','confirmed','seated','completed')), 0)::int AS covers,
            count(*) FILTER (WHERE status IN ('placed','confirmed','seated','completed'))::int AS tables,
            count(*) FILTER (WHERE status = 'placed')::int AS pending
       FROM dining.reservations
      WHERE restaurant_id = $1 AND (starts_at AT TIME ZONE '${DINING_TZ}')::date = $2::date`,
    [restaurantId, date],
  );
  return {
    date,
    billsPaid: Number(sales?.bills ?? 0),
    grossSalesPaise: Number(sales?.gross ?? 0),
    billsToVerify: Number(sales?.to_verify ?? 0),
    payoutEarnedPaise: Number(sales?.payout ?? 0),
    covers: Number(covers?.covers ?? 0),
    tables: Number(covers?.tables ?? 0),
    pendingRequests: Number(covers?.pending ?? 0),
  };
}

/** Balance owed (from the ledger, not a recomputation) and recent movements. */
export async function payouts(restaurantId: string) {
  const account = restaurantPayable(restaurantId);
  const [balance, { rows: movements }, { rows: settlements }] = await Promise.all([
    liabilityBalance(account.code),
    query<{ kind: string; memo: string | null; occurred_at: Date; amount: number }>(
      `SELECT t.kind, t.memo, t.occurred_at, (-sum(e.amount_paise))::bigint AS amount
         FROM finance.entries e
         JOIN finance.accounts a ON a.id = e.account_id
         JOIN finance.transactions t ON t.id = e.transaction_id
        WHERE a.code = $1
        GROUP BY t.id ORDER BY t.occurred_at DESC LIMIT 50`,
      [account.code],
    ),
    query<{ reference: string; amount_paise: number; utr: string | null; status: string; created_at: Date }>(
      `SELECT reference, amount_paise, utr, status, created_at FROM finance.settlements
        WHERE restaurant_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [restaurantId],
    ),
  ]);
  return {
    balancePaise: balance,
    movements: movements.map((m) => ({ kind: m.kind, memo: m.memo, occurredAt: m.occurred_at, amountPaise: Number(m.amount) })),
    settlements: settlements.map((s) => ({
      reference: s.reference,
      amountPaise: Number(s.amount_paise),
      utr: s.utr,
      status: s.status,
      createdAt: s.created_at,
    })),
  };
}

/** Seven-day sales trend for the Insights card. */
export async function salesTrend(restaurantId: string) {
  const { rows } = await query<{ day: string; gross: number; bills: number }>(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
            COALESCE(sum((b.pricing->>'billTotalPaise')::bigint), 0)::bigint AS gross,
            count(b.id)::int AS bills
       FROM generate_series((now() AT TIME ZONE '${DINING_TZ}')::date - 6, (now() AT TIME ZONE '${DINING_TZ}')::date, '1 day') d
       LEFT JOIN dining.bill_payments b
         ON b.restaurant_id = $1 AND b.status IN ('paid', 'verified', 'disputed')
        AND (b.paid_at AT TIME ZONE '${DINING_TZ}')::date = d
      GROUP BY d ORDER BY d`,
    [restaurantId],
  );
  return rows.map((row) => ({ day: row.day, grossPaise: Number(row.gross), bills: Number(row.bills) }));
}
