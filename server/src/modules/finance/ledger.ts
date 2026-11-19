/**
 * Double-entry ledger (schema `finance`, migration 0021).
 *
 * Positive amounts are debits, negative are credits; every transaction must
 * sum to zero, which the database enforces at COMMIT. Callers pass their own
 * transaction client so a posting commits or rolls back with the business
 * change that caused it — a bill can never be "paid" without its ledger lines.
 */
import { query, type Queryable } from '../../db/pool';

type AccountKind = 'asset' | 'liability' | 'revenue' | 'expense';
type OwnerType = 'platform' | 'restaurant' | 'organizer' | 'user' | 'bank' | 'tax';

interface AccountSpec {
  code: string;
  name: string;
  kind: AccountKind;
  ownerType: OwnerType;
  ownerId?: string | null;
}

/** The platform's own chart of accounts. */
export const PLATFORM = {
  gatewayClearing: { code: 'platform:gateway_clearing', name: 'Payment gateway clearing', kind: 'asset', ownerType: 'platform' },
  promoExpense: { code: 'platform:promo_expense', name: 'Platform-funded discounts', kind: 'expense', ownerType: 'platform' },
  feeRevenue: { code: 'platform:fee_revenue', name: 'Platform fee revenue', kind: 'revenue', ownerType: 'platform' },
  commissionRevenue: { code: 'platform:commission_revenue', name: 'Commission revenue', kind: 'revenue', ownerType: 'platform' },
  gstOutput: { code: 'tax:gst_output', name: 'GST output payable', kind: 'liability', ownerType: 'tax' },
  /** Cashback diners have earned and not yet spent. */
  walletLiability: { code: 'platform:wallet_liability', name: 'Tixit Wallet balances', kind: 'liability', ownerType: 'platform' },
  cashbackExpense: { code: 'platform:cashback_expense', name: 'Cashback (net of expiry)', kind: 'expense', ownerType: 'platform' },
  /** Cover charges paid at booking, held until credited, refunded or forfeited. */
  coverDeposits: { code: 'platform:cover_deposits', name: 'Table deposits held', kind: 'liability', ownerType: 'platform' },
  /** Shares of a split bill collected before the last one lands. */
  /** Tixit Pass sales, net of GST. */
  membershipRevenue: { code: 'platform:membership_revenue', name: 'Tixit Pass revenue', kind: 'revenue', ownerType: 'platform' },
  /** Promoted listings sold to restaurants, net of GST. */
  advertisingRevenue: { code: 'platform:advertising_revenue', name: 'Promoted listing revenue', kind: 'revenue', ownerType: 'platform' },
  splitCollections: { code: 'platform:split_collections', name: 'Split-bill shares held', kind: 'liability', ownerType: 'platform' },
} as const satisfies Record<string, AccountSpec>;

/** What a bank owes us for instant discounts it funds on its cards. */
export function bankReceivable(bankName: string): AccountSpec {
  const slug = bankName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { code: `bank:${slug}:receivable`, name: `${bankName} — offer receivable`, kind: 'asset', ownerType: 'bank' };
}

export function restaurantPayable(restaurantId: string, name = 'Restaurant'): AccountSpec {
  return {
    code: `restaurant:${restaurantId}:payable`,
    name: `${name} — payable`,
    kind: 'liability',
    ownerType: 'restaurant',
    ownerId: restaurantId,
  };
}

async function accountId(client: Queryable, spec: AccountSpec): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO finance.accounts (code, name, kind, owner_type, owner_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
     RETURNING id`,
    [spec.code, spec.name, spec.kind, spec.ownerType, spec.ownerId ?? null],
  );
  return rows[0]!.id;
}

export interface Posting {
  kind: string;
  sourceType: string;
  sourceId: string;
  /** Posting the same key twice is a no-op, so retries and webhooks are safe. */
  idempotencyKey: string;
  memo?: string;
  entries: Array<{ account: AccountSpec; amountPaise: number }>;
}

/** Post a balanced transaction. Returns its id, or null if it was already posted. */
export async function post(client: Queryable, posting: Posting): Promise<string | null> {
  const lines = posting.entries.filter((entry) => entry.amountPaise !== 0);
  const total = lines.reduce((sum, entry) => sum + entry.amountPaise, 0);
  // Fail fast with a readable error; the database trigger is the backstop.
  if (total !== 0) throw new Error(`Unbalanced posting ${posting.idempotencyKey}: off by ${total} paise`);

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO finance.transactions (kind, source_type, source_id, idempotency_key, memo)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [posting.kind, posting.sourceType, posting.sourceId, posting.idempotencyKey, posting.memo ?? null],
  );
  const transactionId = rows[0]?.id;
  if (!transactionId) return null;

  for (const line of lines) {
    await client.query('INSERT INTO finance.entries (transaction_id, account_id, amount_paise) VALUES ($1, $2, $3)', [
      transactionId,
      await accountId(client, line.account),
      line.amountPaise,
    ]);
  }
  return transactionId;
}

/** Credit balance of a liability account (what we owe), in paise. */
export async function liabilityBalance(code: string, client: Queryable = { query }): Promise<number> {
  const { rows } = await client.query<{ balance: number }>(
    `SELECT COALESCE(-SUM(e.amount_paise), 0)::bigint AS balance
       FROM finance.entries e JOIN finance.accounts a ON a.id = e.account_id
      WHERE a.code = $1`,
    [code],
  );
  return Number(rows[0]?.balance ?? 0);
}
