import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { query, queryOne, withTransaction, type Queryable } from '../../../db/pool';
import { BadRequestError, NotFoundError } from '../../../utils/errors';
import { financialYear, GSTIN_PATTERN, splitGst, stateCodeFor, stateNameFor } from '../../../utils/gst';
import { DINING_TZ } from '../time';

/**
 * Monthly commission invoices.
 *
 * One document per restaurant per calendar month (IST) in which Tixit earned
 * commission: on bills paid through Tixit, and on table deposits the
 * restaurant kept. Amounts come from what was frozen and posted at the time —
 * each bill's own commission and GST, the ledger's forfeit postings — so the
 * invoice always agrees with the books.
 *
 * Place of supply is the restaurant's state (B2B, CGST/IGST Act s.12(2)):
 * the same state as ours means CGST + SGST, otherwise IGST.
 */

/** Other support services n.e.c. — commission for facilitating sales. */
export const COMMISSION_SAC = '998599';
/** Sale of internet advertising space. */
export const ADVERTISING_SAC = '998365';
const NUMBER_PREFIX = 'TXD';

export interface InvoiceParty {
  legalName: string;
  gstin: string | null;
  address: string;
  stateCode: string;
  stateName: string;
}

export interface InvoiceLine {
  description: string;
  /** Overrides the invoice's SAC for this line (advertising differs from commission). */
  sac?: string;
  quantity: number;
  basePaise: number;
  taxablePaise: number;
  gstPaise: number;
}

export interface Invoice {
  id: string;
  number: string;
  kind: 'tax_invoice' | 'statement';
  periodStart: string;
  periodEnd: string;
  issuedAt: Date;
  supplier: InvoiceParty;
  recipient: InvoiceParty;
  placeOfSupply: string;
  sac: string;
  lines: InvoiceLine[];
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  restaurant: { id: string; name: string };
}

/** 'YYYY-MM' → the month's first and last day. */
export function monthBounds(month: string): { start: string; end: string; year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new BadRequestError('Month must look like 2026-10', 'INVALID_MONTH');
  const year = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) throw new BadRequestError('Month must look like 2026-10', 'INVALID_MONTH');
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { start: `${match[1]}-${match[2]}-01`, end: `${match[1]}-${match[2]}-${String(last).padStart(2, '0')}`, year, month: m };
}

/** The calendar month before today, in IST. */
export function previousMonth(now = new Date()): string {
  const local = new Date(now.toLocaleString('en-US', { timeZone: DINING_TZ }));
  const d = new Date(Date.UTC(local.getFullYear(), local.getMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function supplierParty(): InvoiceParty {
  const gstin = env.supplier.gstin && GSTIN_PATTERN.test(env.supplier.gstin) ? env.supplier.gstin : null;
  const stateCode = gstin ? gstin.slice(0, 2) : env.supplier.stateCode;
  return { legalName: env.supplier.legalName, gstin, address: env.supplier.address, stateCode, stateName: stateNameFor(stateCode) };
}

interface Earnings {
  restaurant_id: string;
  name: string;
  legal_name: string | null;
  gstin: string | null;
  address: string;
  billing_address: string | null;
  state: string;
  bills: number;
  bill_base: number;
  bill_commission: number;
  bill_gst: number;
  forfeits: number;
  forfeit_base: number;
  forfeit_commission: number;
  forfeit_gst: number;
  promos: number;
  promo_days: number;
  promo_net: number;
  promo_gst: number;
}

/**
 * Commission earned per restaurant in a month. Bills count by when they were
 * paid; refunded and cancelled bills earn nothing. Forfeits come from the
 * ledger, where the commission on them was posted.
 */
async function earningsFor(start: string, end: string, client: Queryable, restaurantId?: string): Promise<Earnings[]> {
  const { rows } = await client.query<Earnings>(
    `WITH period AS (
       SELECT ($1::date)::timestamp AT TIME ZONE $3 AS from_ts, ($2::date + 1)::timestamp AT TIME ZONE $3 AS to_ts
     ),
     bills AS (
       SELECT b.restaurant_id, count(*)::int AS bills, sum(b.commission_base_paise)::bigint AS base,
              sum(b.commission_paise)::bigint AS commission, sum(b.commission_gst_paise)::bigint AS gst
         FROM dining.bill_payments b, period
        WHERE b.status IN ('paid', 'verified', 'disputed') AND b.paid_at >= period.from_ts AND b.paid_at < period.to_ts
        GROUP BY b.restaurant_id
     ),
     forfeits AS (
       SELECT v.restaurant_id, count(DISTINCT t.id)::int AS forfeits,
              sum(v.cover_paise) FILTER (WHERE a.code = 'platform:commission_revenue')::bigint AS base,
              -sum(e.amount_paise) FILTER (WHERE a.code = 'platform:commission_revenue')::bigint AS commission,
              -sum(e.amount_paise) FILTER (WHERE a.code = 'tax:gst_output')::bigint AS gst
         FROM finance.transactions t
         JOIN finance.entries e ON e.transaction_id = t.id
         JOIN finance.accounts a ON a.id = e.account_id
         JOIN dining.reservations v ON v.id = t.source_id, period
        WHERE t.kind = 'cover_forfeited' AND t.occurred_at >= period.from_ts AND t.occurred_at < period.to_ts
        GROUP BY v.restaurant_id
     ),
     -- Sponsored listings, invoiced in the month they start (they can only be
     -- cancelled before starting, so an issued invoice never needs undoing).
     promos AS (
       SELECT p.restaurant_id, count(*)::int AS promos, sum(p.ends_on - p.starts_on + 1)::int AS days,
              sum(p.net_paise)::bigint AS net, sum(p.gst_paise)::bigint AS gst
         FROM dining.promotions p
        WHERE p.status = 'active' AND p.starts_on BETWEEN $1::date AND $2::date
        GROUP BY p.restaurant_id
     )
     SELECT r.id AS restaurant_id, r.name, r.legal_name, r.gstin, r.address, r.billing_address, c.state,
            COALESCE(b.bills, 0) AS bills, COALESCE(b.base, 0) AS bill_base, COALESCE(b.commission, 0) AS bill_commission,
            COALESCE(b.gst, 0) AS bill_gst, COALESCE(f.forfeits, 0) AS forfeits, COALESCE(f.base, 0) AS forfeit_base,
            COALESCE(f.commission, 0) AS forfeit_commission, COALESCE(f.gst, 0) AS forfeit_gst,
            COALESCE(pr.promos, 0) AS promos, COALESCE(pr.days, 0) AS promo_days, COALESCE(pr.net, 0) AS promo_net,
            COALESCE(pr.gst, 0) AS promo_gst
       FROM dining.restaurants r
       JOIN cities c ON c.id = r.city_id
       LEFT JOIN bills b ON b.restaurant_id = r.id
       LEFT JOIN forfeits f ON f.restaurant_id = r.id
       LEFT JOIN promos pr ON pr.restaurant_id = r.id
      WHERE (b.restaurant_id IS NOT NULL OR f.restaurant_id IS NOT NULL OR pr.restaurant_id IS NOT NULL)
        AND ($4::uuid IS NULL OR r.id = $4)
        AND COALESCE(b.commission, 0) + COALESCE(f.commission, 0) + COALESCE(pr.net, 0) > 0
      ORDER BY r.name`,
    [start, end, DINING_TZ, restaurantId ?? null],
  );
  return rows;
}

/** Next number in the financial year's gapless sequence (row-locked until commit). */
async function nextNumber(client: Queryable, fy: string): Promise<{ seq: number; number: string }> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO finance.invoice_sequences (fy, last_seq) VALUES ($1, 1)
     ON CONFLICT (fy) DO UPDATE SET last_seq = finance.invoice_sequences.last_seq + 1
     RETURNING last_seq`,
    [fy],
  );
  const seq = rows[0]!.last_seq;
  // TXD2627/00042 — 13 characters, within the 16 the rules allow.
  return { seq, number: `${NUMBER_PREFIX}${fy.slice(2, 4)}${fy.slice(5, 7)}/${String(seq).padStart(5, '0')}` };
}

/**
 * Issue the month's invoices. Idempotent: a restaurant already invoiced for
 * the month is skipped, so the scheduler and an admin can both run it.
 */
export async function generateInvoices(month: string, options: { restaurantId?: string } = {}): Promise<{ issued: number; skipped: number }> {
  const { start, end, year, month: m } = monthBounds(month);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: DINING_TZ });
  if (end >= today) throw new BadRequestError('A month can be invoiced once it has ended', 'MONTH_NOT_OVER');

  const fy = financialYear(year, m);
  const supplier = supplierParty();
  let issued = 0;
  let skipped = 0;

  const candidates = await earningsFor(start, end, { query }, options.restaurantId);
  for (const row of candidates) {
    const created = await withTransaction(async (client) => {
      // Serialise per restaurant and month, then re-check inside the lock.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice:${row.restaurant_id}:${start}`]);
      const exists = await client.query('SELECT 1 FROM finance.invoices WHERE restaurant_id = $1 AND period_start = $2', [row.restaurant_id, start]);
      if (exists.rowCount) return false;

      const recipientGstin = row.gstin && GSTIN_PATTERN.test(row.gstin) ? row.gstin : null;
      const recipientState = recipientGstin ? recipientGstin.slice(0, 2) : stateCodeFor(row.state) ?? supplier.stateCode;
      const recipient: InvoiceParty = {
        legalName: row.legal_name ?? row.name,
        gstin: recipientGstin,
        address: row.billing_address ?? row.address,
        stateCode: recipientState,
        stateName: stateNameFor(recipientState),
      };

      const lines: InvoiceLine[] = [];
      if (Number(row.bill_commission) > 0) {
        lines.push({
          description: 'Commission on dine-in bills paid through Tixit',
          quantity: row.bills,
          basePaise: Number(row.bill_base),
          taxablePaise: Number(row.bill_commission),
          gstPaise: Number(row.bill_gst),
        });
      }
      if (Number(row.forfeit_commission) > 0) {
        lines.push({
          description: 'Commission on table deposits retained (late cancellations and no-shows)',
          quantity: row.forfeits,
          basePaise: Number(row.forfeit_base),
          taxablePaise: Number(row.forfeit_commission),
          gstPaise: Number(row.forfeit_gst),
        });
      }
      if (Number(row.promo_net) > 0) {
        lines.push({
          description: `Sponsored listing on Tixit Dine-in (${row.promo_days} days)`,
          sac: ADVERTISING_SAC,
          quantity: row.promos,
          basePaise: Number(row.promo_net),
          taxablePaise: Number(row.promo_net),
          gstPaise: Number(row.promo_gst),
        });
      }
      const taxable = lines.reduce((sum, line) => sum + line.taxablePaise, 0);
      const gst = lines.reduce((sum, line) => sum + line.gstPaise, 0);
      const tax = splitGst(gst, recipient.stateCode === supplier.stateCode);
      const { seq, number } = await nextNumber(client, fy);

      await client.query(
        `INSERT INTO finance.invoices (number, fy, seq, kind, restaurant_id, period_start, period_end, supplier, recipient,
           place_of_supply, sac, lines, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          number,
          fy,
          seq,
          supplier.gstin ? 'tax_invoice' : 'statement',
          row.restaurant_id,
          start,
          end,
          JSON.stringify(supplier),
          JSON.stringify(recipient),
          recipient.stateCode,
          COMMISSION_SAC,
          JSON.stringify(lines),
          taxable,
          tax.cgst,
          tax.sgst,
          tax.igst,
          taxable + gst,
        ],
      );
      return true;
    });
    if (created) issued += 1;
    else skipped += 1;
  }
  if (issued) logger.info({ month, issued }, 'Commission invoices issued');
  return { issued, skipped };
}

/** Scheduler: on the 1st–5th of each month, invoice the month just ended. */
export async function invoicePreviousMonth(): Promise<number> {
  const day = Number(new Date().toLocaleDateString('en-CA', { timeZone: DINING_TZ }).slice(8, 10));
  if (day > 5) return 0;
  return (await generateInvoices(previousMonth())).issued;
}

/* ───────────────────────── reading ───────────────────────── */

interface InvoiceRow {
  id: string;
  number: string;
  kind: Invoice['kind'];
  period_start: string;
  period_end: string;
  issued_at: Date;
  supplier: InvoiceParty;
  recipient: InvoiceParty;
  place_of_supply: string;
  sac: string;
  lines: InvoiceLine[];
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  restaurant_id: string;
  restaurant_name: string;
}

const INVOICE_SELECT = `
  SELECT i.id, i.number, i.kind, to_char(i.period_start, 'YYYY-MM-DD') AS period_start,
         to_char(i.period_end, 'YYYY-MM-DD') AS period_end, i.issued_at, i.supplier, i.recipient, i.place_of_supply,
         i.sac, i.lines, i.taxable_paise, i.cgst_paise, i.sgst_paise, i.igst_paise, i.total_paise,
         r.id AS restaurant_id, r.name AS restaurant_name
    FROM finance.invoices i JOIN dining.restaurants r ON r.id = i.restaurant_id`;

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    issuedAt: row.issued_at,
    supplier: row.supplier,
    recipient: row.recipient,
    placeOfSupply: row.place_of_supply,
    sac: row.sac,
    lines: row.lines,
    taxablePaise: Number(row.taxable_paise),
    cgstPaise: Number(row.cgst_paise),
    sgstPaise: Number(row.sgst_paise),
    igstPaise: Number(row.igst_paise),
    totalPaise: Number(row.total_paise),
    restaurant: { id: row.restaurant_id, name: row.restaurant_name },
  };
}

export async function listInvoicesForRestaurant(restaurantId: string): Promise<Invoice[]> {
  const { rows } = await query<InvoiceRow>(`${INVOICE_SELECT} WHERE i.restaurant_id = $1 ORDER BY i.period_start DESC LIMIT 36`, [
    restaurantId,
  ]);
  return rows.map(toInvoice);
}

export async function listInvoicesForMonth(month: string): Promise<Invoice[]> {
  const { start } = monthBounds(month);
  const { rows } = await query<InvoiceRow>(`${INVOICE_SELECT} WHERE i.period_start = $1 ORDER BY i.seq`, [start]);
  return rows.map(toInvoice);
}

/** Scoped by restaurant when the caller is a partner; admins pass none. */
export async function getInvoice(id: string, restaurantId?: string): Promise<Invoice> {
  const row = await queryOne<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1 AND ($2::uuid IS NULL OR i.restaurant_id = $2)`, [
    id,
    restaurantId ?? null,
  ]);
  if (!row) throw new NotFoundError('Invoice');
  return toInvoice(row);
}
