import { z } from 'zod';
import { query, withTransaction } from '../../../db/pool';
import { BadRequestError, ConflictError, NotFoundError } from '../../../utils/errors';
import { PLATFORM, post, restaurantPayable } from '../../finance/ledger';
import { DINING_TZ } from '../time';

/**
 * Promoted listings: a restaurant pays a daily rate to sit at the top of the
 * default search in its city. The whole campaign is charged up front against
 * its payouts (it shows on Payouts and on the month's invoice), and diners
 * always see a "Sponsored" label — paid placement is never disguised.
 *
 * A campaign can be cancelled until it starts, with the charge reversed.
 */

const GST_PERCENT = 18;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const promotionInput = z
  .object({
    restaurantId: z.string().uuid(),
    startsOn: date,
    endsOn: date,
    dailyPrice: z.coerce.number().min(50).max(100_000),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'The campaign must end on or after it starts', path: ['endsOn'] });

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: DINING_TZ });
}

function days(startsOn: string, endsOn: string): number {
  return Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000) + 1;
}

export async function createPromotion(adminId: string, input: z.infer<typeof promotionInput>) {
  if (input.startsOn < today()) throw new BadRequestError('A campaign cannot start in the past', 'START_IN_PAST');
  const daily = Math.round(input.dailyPrice * 100);
  const net = daily * days(input.startsOn, input.endsOn);
  const gst = Math.round((net * GST_PERCENT) / 100);

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ name: string }>('SELECT name FROM dining.restaurants WHERE id = $1 FOR UPDATE', [input.restaurantId]);
    if (!rows[0]) throw new NotFoundError('Restaurant');
    const overlap = await client.query(
      `SELECT 1 FROM dining.promotions WHERE restaurant_id = $1 AND status = 'active' AND starts_on <= $3 AND ends_on >= $2`,
      [input.restaurantId, input.startsOn, input.endsOn],
    );
    if (overlap.rowCount) throw new ConflictError('This restaurant already has a campaign on those dates', 'PROMOTION_OVERLAP');

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO dining.promotions (restaurant_id, starts_on, ends_on, daily_price_paise, net_paise, gst_paise, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.restaurantId, input.startsOn, input.endsOn, daily, net, gst, adminId],
    );
    const id = inserted.rows[0]!.id;
    // Charged against what we owe the restaurant (it can go negative and is
    // recovered from the next bills).
    await post(client, {
      kind: 'promotion_charged',
      sourceType: 'dining.promotion',
      sourceId: id,
      idempotencyKey: `promotion_charged:${id}`,
      memo: `Sponsored listing ${input.startsOn} to ${input.endsOn}`,
      entries: [
        { account: restaurantPayable(input.restaurantId, rows[0].name), amountPaise: net + gst },
        { account: PLATFORM.advertisingRevenue, amountPaise: -net },
        { account: PLATFORM.gstOutput, amountPaise: -gst },
      ],
    });
    return { id, netPaise: net, gstPaise: gst, totalPaise: net + gst };
  });
}

export async function cancelPromotion(id: string) {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ restaurant_id: string; name: string; net_paise: number; gst_paise: number; starts_on: string }>(
      `SELECT p.restaurant_id, r.name, p.net_paise, p.gst_paise, to_char(p.starts_on, 'YYYY-MM-DD') AS starts_on
         FROM dining.promotions p JOIN dining.restaurants r ON r.id = p.restaurant_id
        WHERE p.id = $1 AND p.status = 'active' FOR UPDATE OF p`,
      [id],
    );
    const promo = rows[0];
    if (!promo) throw new NotFoundError('Campaign');
    if (promo.starts_on <= today()) throw new ConflictError('A campaign that has started runs to its end', 'PROMOTION_STARTED');
    await client.query(`UPDATE dining.promotions SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [id]);
    const net = Number(promo.net_paise);
    const gst = Number(promo.gst_paise);
    await post(client, {
      kind: 'promotion_cancelled',
      sourceType: 'dining.promotion',
      sourceId: id,
      idempotencyKey: `promotion_cancelled:${id}`,
      entries: [
        { account: restaurantPayable(promo.restaurant_id, promo.name), amountPaise: -(net + gst) },
        { account: PLATFORM.advertisingRevenue, amountPaise: net },
        { account: PLATFORM.gstOutput, amountPaise: gst },
      ],
    });
  });
}

export async function listPromotions() {
  const { rows } = await query<{
    id: string;
    restaurant_id: string;
    restaurant_name: string;
    city: string;
    starts_on: string;
    ends_on: string;
    daily_price_paise: number;
    net_paise: number;
    gst_paise: number;
    status: string;
  }>(
    `SELECT p.id, p.restaurant_id, r.name AS restaurant_name, c.name AS city, to_char(p.starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(p.ends_on, 'YYYY-MM-DD') AS ends_on, p.daily_price_paise, p.net_paise, p.gst_paise, p.status
       FROM dining.promotions p JOIN dining.restaurants r ON r.id = p.restaurant_id JOIN cities c ON c.id = r.city_id
      ORDER BY p.ends_on DESC LIMIT 200`,
  );
  const now = today();
  return rows.map((row) => ({
    id: row.id,
    restaurant: { id: row.restaurant_id, name: row.restaurant_name, city: row.city },
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    dailyPricePaise: Number(row.daily_price_paise),
    totalPaise: Number(row.net_paise) + Number(row.gst_paise),
    status: row.status,
    phase: row.status !== 'active' ? 'cancelled' : now < row.starts_on ? 'scheduled' : now > row.ends_on ? 'ended' : 'live',
  }));
}
