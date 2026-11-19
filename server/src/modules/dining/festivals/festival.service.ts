import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../../db/pool';
import { BadRequestError, ConflictError, NotFoundError } from '../../../utils/errors';
import { cardsByIds, type RestaurantCard } from '../catalog/catalog.service';
import { DINING_TZ } from '../time';

/**
 * Food festivals: a dated, city-wide campaign ("Jaipur Food Week"). Each
 * participating restaurant's deal is an ordinary automatic offer valid for
 * exactly the festival's dates, so pricing, who funds what, redemptions and
 * the ledger are the same machinery as every other offer. The platform can
 * co-fund a festival deal through the offer's funding split.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const festivalInput = z
  .object({
    title: z.string().trim().min(3).max(80),
    citySlug: z.string().trim().min(2).max(60),
    tagline: z.string().trim().max(140).nullish(),
    description: z.string().trim().max(2000).nullish(),
    coverUrl: z.string().url().max(500).nullish(),
    startsOn: date,
    endsOn: date,
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'The festival must end on or after it starts', path: ['endsOn'] });
export type FestivalInput = z.infer<typeof festivalInput>;

export const participantInput = z
  .object({
    restaurantId: z.string().uuid(),
    highlight: z.string().trim().max(120).nullish(),
    kind: z.enum(['percent', 'flat']),
    percentOff: z.coerce.number().min(1).max(100).nullish(),
    flatOff: z.coerce.number().min(1).max(100_000).nullish(),
    maxDiscount: z.coerce.number().min(1).max(100_000).nullish(),
    appliesTo: z.enum(['prebook', 'walkin', 'both']).default('both'),
    /** Share the restaurant funds; Tixit funds the rest. */
    restaurantFundedPct: z.coerce.number().int().min(0).max(100).default(100),
  })
  .refine((v) => (v.kind === 'percent' ? Boolean(v.percentOff) : Boolean(v.flatOff)), {
    message: 'Enter how much the festival deal takes off',
    path: ['percentOff'],
  });

function slugify(title: string): string {
  return title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

interface FestivalRow {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  cover_url: string | null;
  starts_on: string;
  ends_on: string;
  status: 'draft' | 'published' | 'archived';
  city_name: string;
  city_slug: string;
  participants: number;
}

const FESTIVAL_SELECT = `
  SELECT f.id, f.slug, f.title, f.tagline, f.description, f.cover_url, to_char(f.starts_on, 'YYYY-MM-DD') AS starts_on,
         to_char(f.ends_on, 'YYYY-MM-DD') AS ends_on, f.status, c.name AS city_name, c.slug AS city_slug,
         (SELECT count(*)::int FROM dining.festival_restaurants fr WHERE fr.festival_id = f.id) AS participants
    FROM dining.festivals f JOIN cities c ON c.id = f.city_id`;

function toFestival(row: FestivalRow) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: DINING_TZ });
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    description: row.description,
    coverUrl: row.cover_url,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    city: { name: row.city_name, slug: row.city_slug },
    participants: row.participants,
    phase: today < row.starts_on ? ('upcoming' as const) : today > row.ends_on ? ('over' as const) : ('on' as const),
  };
}
export type Festival = ReturnType<typeof toFestival>;

/** Published festivals in a city that are on now or start within three weeks. */
export async function currentFestivals(citySlug: string): Promise<Festival[]> {
  const { rows } = await query<FestivalRow>(
    `${FESTIVAL_SELECT}
      WHERE c.slug = $1 AND f.status = 'published'
        AND f.ends_on >= (now() AT TIME ZONE $2)::date
        AND f.starts_on <= (now() AT TIME ZONE $2)::date + 21
      ORDER BY f.starts_on`,
    [citySlug, DINING_TZ],
  );
  return rows.map(toFestival);
}

/** The festival page: what's on, and every participating restaurant's deal. */
export async function getFestival(slug: string, options: { includeDraft?: boolean } = {}) {
  const row = await queryOne<FestivalRow>(`${FESTIVAL_SELECT} WHERE f.slug = $1`, [slug]);
  if (!row || (!options.includeDraft && row.status !== 'published')) throw new NotFoundError('Festival');
  const { rows } = await query<{
    restaurant_id: string;
    highlight: string | null;
    offer_id: string;
    title: string;
    percent_off: string | null;
    flat_off_paise: string | null;
    applies_to: string;
    restaurant_funded_pct: number;
  }>(
    `SELECT fr.restaurant_id, fr.highlight, o.id AS offer_id, o.title, o.percent_off, o.flat_off_paise, o.applies_to,
            o.restaurant_funded_pct
       FROM dining.festival_restaurants fr JOIN dining.offers o ON o.id = fr.offer_id
      WHERE fr.festival_id = $1 AND o.status <> 'archived'
      ORDER BY fr.sort, o.percent_off DESC NULLS LAST`,
    [row.id],
  );
  const cards = new Map((await cardsByIds(rows.map((r) => r.restaurant_id))).map((card) => [card.id, card]));
  return {
    ...toFestival(row),
    restaurants: rows
      .filter((r) => cards.has(r.restaurant_id))
      .map((r) => ({
        card: cards.get(r.restaurant_id)! as RestaurantCard,
        highlight: r.highlight,
        deal: {
          offerId: r.offer_id,
          label: r.percent_off ? `${Number(r.percent_off)}% off` : `₹${Math.round(Number(r.flat_off_paise) / 100)} off`,
          appliesTo: r.applies_to,
          restaurantFundedPct: r.restaurant_funded_pct,
        },
      })),
  };
}

export async function listFestivals() {
  const { rows } = await query<FestivalRow>(`${FESTIVAL_SELECT} ORDER BY f.starts_on DESC LIMIT 100`);
  return rows.map(toFestival);
}

export async function createFestival(adminId: string, input: FestivalInput) {
  const city = await queryOne<{ id: string }>('SELECT id FROM cities WHERE slug = $1', [input.citySlug]);
  if (!city) throw new NotFoundError('City');
  const base = slugify(`${input.title}`);
  const taken = await queryOne('SELECT 1 FROM dining.festivals WHERE slug = $1', [base]);
  const slug = taken ? `${base}-${input.startsOn.slice(0, 4)}` : base;
  const row = await queryOne<{ id: string; slug: string }>(
    `INSERT INTO dining.festivals (slug, city_id, title, tagline, description, cover_url, starts_on, ends_on, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, slug`,
    [slug, city.id, input.title, input.tagline ?? null, input.description ?? null, input.coverUrl ?? null, input.startsOn, input.endsOn, adminId],
  ).catch((error: { code?: string }) => {
    if (error.code === '23505') throw new ConflictError('A festival with that name already exists', 'FESTIVAL_EXISTS');
    throw error;
  });
  return row!;
}

/** Publishing makes the page and home banner live; archiving ends every festival deal. */
export async function setFestivalStatus(id: string, status: 'draft' | 'published' | 'archived') {
  await withTransaction(async (client) => {
    const { rowCount } = await client.query('UPDATE dining.festivals SET status = $2 WHERE id = $1', [id, status]);
    if (!rowCount) throw new NotFoundError('Festival');
    if (status === 'archived') {
      await client.query(
        `UPDATE dining.offers SET status = 'archived' WHERE id IN (SELECT offer_id FROM dining.festival_restaurants WHERE festival_id = $1)`,
        [id],
      );
    }
  });
}

/**
 * Add a restaurant with its festival deal: an automatic offer valid from the
 * festival's first day to the end of its last, in restaurant-local time.
 */
export async function addParticipant(adminId: string, festivalId: string, input: z.infer<typeof participantInput>) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ title: string; city_id: string; starts_on: string; ends_on: string; status: string }>(
      `SELECT title, city_id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, status
         FROM dining.festivals WHERE id = $1 FOR UPDATE`,
      [festivalId],
    );
    const festival = rows[0];
    if (!festival) throw new NotFoundError('Festival');
    if (festival.status === 'archived') throw new ConflictError('This festival is archived', 'FESTIVAL_ARCHIVED');
    const restaurant = await client.query<{ city_id: string }>('SELECT city_id FROM dining.restaurants WHERE id = $1', [input.restaurantId]);
    if (!restaurant.rows[0]) throw new NotFoundError('Restaurant');
    if (restaurant.rows[0].city_id !== festival.city_id) throw new BadRequestError('That restaurant is in another city', 'WRONG_CITY');

    const deal = input.kind === 'percent' ? `${input.percentOff}% off` : `₹${input.flatOff} off`;
    const offer = await client.query<{ id: string }>(
      `INSERT INTO dining.offers (owner, restaurant_id, title, kind, percent_off, flat_off_paise, max_discount_paise, applies_to,
         valid_from, valid_until, restaurant_funded_pct, terms, status, created_by)
       VALUES ('restaurant', $1, $2, $3, $4, $5, $6, $7,
               ($8::date)::timestamp AT TIME ZONE $10, ($9::date + 1)::timestamp AT TIME ZONE $10, $11, $12, 'active', $13)
       RETURNING id`,
      [
        input.restaurantId,
        `${festival.title}: ${deal}`,
        input.kind,
        input.kind === 'percent' ? input.percentOff : null,
        input.kind === 'flat' ? Math.round(input.flatOff! * 100) : null,
        input.maxDiscount ? Math.round(input.maxDiscount * 100) : null,
        input.appliesTo,
        festival.starts_on,
        festival.ends_on,
        DINING_TZ,
        input.restaurantFundedPct,
        `Part of ${festival.title}. Valid ${festival.starts_on} to ${festival.ends_on}.`,
        adminId,
      ],
    );
    const inserted = await client.query(
      `INSERT INTO dining.festival_restaurants (festival_id, restaurant_id, offer_id, highlight, sort)
       VALUES ($1, $2, $3, $4, (SELECT count(*) FROM dining.festival_restaurants WHERE festival_id = $1))
       ON CONFLICT (festival_id, restaurant_id) DO NOTHING`,
      [festivalId, input.restaurantId, offer.rows[0]!.id, input.highlight ?? null],
    );
    if (!inserted.rowCount) throw new ConflictError('That restaurant is already in the festival', 'ALREADY_PARTICIPATING');
    return { offerId: offer.rows[0]!.id };
  });
}

/** Take a restaurant out: its festival deal is archived (redemptions keep their history). */
export async function removeParticipant(festivalId: string, restaurantId: string) {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ offer_id: string }>(
      'DELETE FROM dining.festival_restaurants WHERE festival_id = $1 AND restaurant_id = $2 RETURNING offer_id',
      [festivalId, restaurantId],
    );
    if (!rows[0]) throw new NotFoundError('Participant');
    await client.query(`UPDATE dining.offers SET status = 'archived' WHERE id = $1`, [rows[0].offer_id]);
  });
}
