import { query, queryOne } from '../../../db/pool';
import { NotFoundError } from '../../../utils/errors';
import { buildPageMeta, type PageMeta } from '../../../utils/http';
import { DINING_TZ, toLocalMoment, timeToMinutes } from '../time';
import { OFFER_COLUMNS, toPublicOffer, type OfferRow } from '../offers/offer.service';
import { materializeSlots, upcomingSlots, type SlotView } from '../reservations/availability.service';

/* ───────────────────────── shapes ───────────────────────── */

type Hours = Record<string, Array<[string, string]>>;

interface CardRow {
  id: string;
  slug: string;
  name: string;
  locality: string;
  city_name: string;
  city_slug: string;
  cuisines: string[];
  tags: string[];
  cost_for_two_paise: number;
  cover_url: string | null;
  logo_url: string | null;
  rating_avg: string | number;
  rating_count: number;
  pay_bill_enabled: boolean;
  booking_enabled: boolean;
  is_featured: boolean;
  hours: Hours;
  lat: string | number;
  lng: string | number;
  best_percent: string | number | null;
  best_flat_paise: number | null;
  best_applies_to: 'prebook' | 'walkin' | 'both' | null;
  distance_km?: number | null;
}

export interface RestaurantCard {
  id: string;
  slug: string;
  name: string;
  locality: string;
  city: { name: string; slug: string };
  cuisines: string[];
  tags: string[];
  costForTwoPaise: number;
  coverUrl: string | null;
  logoUrl: string | null;
  rating: number;
  ratingCount: number;
  payBillEnabled: boolean;
  bookingEnabled: boolean;
  isFeatured: boolean;
  openNow: boolean;
  closesAt: string | null;
  distanceKm: number | null;
  bestOffer: { label: string; appliesTo: 'prebook' | 'walkin' | 'both'; percentOff: number | null; flatOffPaise: number | null } | null;
  nextSlots?: SlotView[];
}

/**
 * Card columns plus the headline offer, found with a LATERAL subquery so the
 * list query stays one round trip whatever the page size. `extra` adds
 * computed columns (distance, search rank) that callers sort by.
 */
function cardSelect(extra = ''): string {
  return `
  SELECT r.id, r.slug, r.name, r.locality, c.name AS city_name, c.slug AS city_slug, r.cuisines, r.tags,
         r.cost_for_two_paise, r.cover_url, r.logo_url, r.rating_avg, r.rating_count, r.pay_bill_enabled,
         r.booking_enabled, r.is_featured, r.hours, r.lat, r.lng,
         bo.percent_off AS best_percent, bo.flat_off_paise AS best_flat_paise, bo.applies_to AS best_applies_to
         ${extra}
    FROM dining.restaurants r
    JOIN cities c ON c.id = r.city_id
    LEFT JOIN LATERAL (
      SELECT o.percent_off, o.flat_off_paise, o.applies_to
        FROM dining.offers o
       WHERE o.restaurant_id = r.id AND o.owner = 'restaurant' AND o.code IS NULL AND o.status = 'active'
         AND (o.valid_until IS NULL OR o.valid_until > now())
       ORDER BY o.percent_off DESC NULLS LAST, o.flat_off_paise DESC NULLS LAST
       LIMIT 1
    ) bo ON true`;
}
const CARD_SELECT = cardSelect();

/** Today's opening state from the weekly hours, in restaurant-local time. */
export function openState(hours: Hours, now = new Date()): { openNow: boolean; closesAt: string | null; opensAt: string | null } {
  const local = toLocalMoment(now);
  const shifts = hours[String(local.weekday)] ?? [];
  for (const [open, close] of shifts) {
    const start = timeToMinutes(open);
    // A close of 01:00 means past midnight.
    const end = timeToMinutes(close) <= start ? timeToMinutes(close) + 24 * 60 : timeToMinutes(close);
    if (local.minutes >= start && local.minutes < end) return { openNow: true, closesAt: close, opensAt: null };
  }
  const later = shifts.find(([open]) => timeToMinutes(open) > local.minutes);
  return { openNow: false, closesAt: null, opensAt: later?.[0] ?? null };
}

function offerLabel(percent: string | number | null, flat: number | null): string | null {
  if (percent !== null && percent !== undefined) return `Flat ${Number(percent)}% off`;
  if (flat) return `₹${Math.round(Number(flat) / 100).toLocaleString('en-IN')} off`;
  return null;
}

function toCard(row: CardRow): RestaurantCard {
  const label = offerLabel(row.best_percent, row.best_flat_paise);
  const state = openState(row.hours ?? {});
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    locality: row.locality,
    city: { name: row.city_name, slug: row.city_slug },
    cuisines: row.cuisines,
    tags: row.tags,
    costForTwoPaise: Number(row.cost_for_two_paise),
    coverUrl: row.cover_url,
    logoUrl: row.logo_url,
    rating: Number(row.rating_avg),
    ratingCount: row.rating_count,
    payBillEnabled: row.pay_bill_enabled,
    bookingEnabled: row.booking_enabled,
    isFeatured: row.is_featured,
    openNow: state.openNow,
    closesAt: state.closesAt,
    distanceKm: row.distance_km === undefined || row.distance_km === null ? null : Math.round(Number(row.distance_km) * 10) / 10,
    bestOffer:
      label && row.best_applies_to
        ? {
            label,
            appliesTo: row.best_applies_to,
            percentOff: row.best_percent === null ? null : Number(row.best_percent),
            flatOffPaise: row.best_flat_paise === null ? null : Number(row.best_flat_paise),
          }
        : null,
  };
}

/** Haversine distance in km, in SQL, from parameters $lat/$lng. */
function distanceSql(latParam: string, lngParam: string): string {
  return `(6371 * 2 * asin(sqrt(
    power(sin(radians((r.lat - ${latParam}) / 2)), 2) +
    cos(radians(${latParam})) * cos(radians(r.lat)) * power(sin(radians((r.lng - ${lngParam}) / 2)), 2)
  )))`;
}

/* ───────────────────────── search ───────────────────────── */

export interface SearchInput {
  q?: string;
  city?: string;
  cuisine?: string;
  tag?: string;
  offers?: boolean;
  payBill?: boolean;
  openNow?: boolean;
  maxCostForTwo?: number;
  sort?: 'relevance' | 'rating' | 'distance' | 'cost_low' | 'cost_high' | 'offer';
  lat?: number;
  lng?: number;
  page: number;
  limit: number;
}

export async function searchRestaurants(input: SearchInput): Promise<{ items: RestaurantCard[]; meta: PageMeta }> {
  const where: string[] = [`r.status = 'live'`];
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (input.city) where.push(`c.slug = ${add(input.city)}`);
  if (input.cuisine) where.push(`${add(input.cuisine)} = ANY(r.cuisines)`);
  if (input.tag) where.push(`${add(input.tag)} = ANY(r.tags)`);
  if (input.payBill) where.push('r.pay_bill_enabled');
  if (input.offers) where.push('(bo.percent_off IS NOT NULL OR bo.flat_off_paise IS NOT NULL)');
  if (input.maxCostForTwo) where.push(`r.cost_for_two_paise <= ${add(input.maxCostForTwo * 100)}`);

  let rank = '0';
  if (input.q?.trim()) {
    const term = input.q.trim();
    const ts = add(term);
    const like = add(`%${term}%`);
    where.push(`(r.search_vector @@ plainto_tsquery('simple', ${ts}) OR r.name ILIKE ${like} OR r.locality ILIKE ${like}
                 OR EXISTS (SELECT 1 FROM unnest(r.cuisines) cu WHERE cu ILIKE ${like}))`);
    rank = `ts_rank(r.search_vector, plainto_tsquery('simple', ${ts}))`;
  }

  const hasGeo = input.lat !== undefined && input.lng !== undefined;
  const distance = hasGeo ? distanceSql(add(input.lat), add(input.lng)) : 'NULL::float';

  // Sorts run on the outer query's computed columns, never on raw SQL text.
  const order: Record<NonNullable<SearchInput['sort']>, string> = {
    relevance: 's.rank DESC, s.is_featured DESC, s.rating_avg DESC, s.rating_count DESC',
    rating: 's.rating_avg DESC, s.rating_count DESC',
    distance: hasGeo ? 's.distance_km ASC' : 's.rating_avg DESC',
    cost_low: 's.cost_for_two_paise ASC',
    cost_high: 's.cost_for_two_paise DESC',
    offer: 's.best_percent DESC NULLS LAST, s.best_flat_paise DESC NULLS LAST, s.rating_avg DESC',
  };

  const inner = `${cardSelect(`, ${distance} AS distance_km, ${rank} AS rank`)} WHERE ${where.join(' AND ')}`;
  const { rows } = await query<CardRow & { total: number }>(
    `SELECT s.*, count(*) OVER () AS total FROM (${inner}) s
      ORDER BY ${order[input.sort ?? 'relevance']}, s.id
      LIMIT ${add(input.limit)} OFFSET ${add((input.page - 1) * input.limit)}`,
    params,
  );

  let items = rows.map(toCard);
  if (input.openNow) items = items.filter((item) => item.openNow);
  const total = rows[0] ? Number(rows[0].total) : 0;
  return { items, meta: buildPageMeta(input.page, input.limit, total) };
}

/* ─────────────────────────── home ─────────────────────────── */

export async function homeFeed(citySlug: string) {
  const city = await queryOne<{ id: string; name: string; slug: string }>(
    'SELECT id, name, slug FROM cities WHERE slug = $1',
    [citySlug],
  );
  if (!city) throw new NotFoundError('City');

  const { rows: cardRows } = await query<CardRow>(
    `${CARD_SELECT} WHERE r.status = 'live' AND r.city_id = $1
      ORDER BY r.is_featured DESC, r.rating_avg DESC, r.rating_count DESC LIMIT 40`,
    [city.id],
  );
  const cards = cardRows.map(toCard);

  // "Tonight near you": bookable places with real tables left this evening.
  const bookable = cards.filter((card) => card.bookingEnabled).slice(0, 8);
  const today = toLocalMoment(new Date()).date;
  await materializeSlots(bookable.map((card) => card.id), today);
  const slotsByRestaurant = await upcomingSlots(bookable.map((card) => card.id), 3);
  const tonight = bookable
    .map((card) => ({ ...card, nextSlots: slotsByRestaurant[card.id] ?? [] }))
    .filter((card) => card.nextSlots.length > 0);

  const bestOffers = [...cards]
    .filter((card) => card.bestOffer)
    .sort(
      (a, b) =>
        (b.bestOffer!.percentOff ?? 0) - (a.bestOffer!.percentOff ?? 0) ||
        (b.bestOffer!.flatOffPaise ?? 0) - (a.bestOffer!.flatOffPaise ?? 0),
    )
    .slice(0, 8);

  const { rows: collections } = await query<{
    slug: string;
    title: string;
    subtitle: string | null;
    cover_url: string | null;
    count: number;
  }>(
    `SELECT co.slug, co.title, co.subtitle, co.cover_url,
            (SELECT count(*)::int FROM dining.restaurants r
              WHERE r.status = 'live' AND r.city_id = $1 AND r.tags && co.match_tags) AS count
       FROM dining.collections co
      WHERE co.is_active AND (co.city_id IS NULL OR co.city_id = $1)
      ORDER BY co.sort, co.title`,
    [city.id],
  );

  const { rows: cuisines } = await query<{ name: string; count: number }>(
    `SELECT cu AS name, count(*)::int AS count
       FROM dining.restaurants r, unnest(r.cuisines) cu
      WHERE r.status = 'live' AND r.city_id = $1
      GROUP BY cu ORDER BY count DESC, cu LIMIT 12`,
    [city.id],
  );

  return {
    city,
    restaurantCount: cards.length,
    tonight,
    bestOffers,
    topRated: [...cards].sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount).slice(0, 8),
    collections: collections.filter((collection) => collection.count > 0).map((collection) => ({
      slug: collection.slug,
      title: collection.title,
      subtitle: collection.subtitle,
      coverUrl: collection.cover_url,
      count: collection.count,
    })),
    cuisines,
  };
}

export async function getCollection(slug: string) {
  const collection = await queryOne<{ slug: string; title: string; subtitle: string | null; cover_url: string | null; match_tags: string[]; city_id: string | null }>(
    'SELECT slug, title, subtitle, cover_url, match_tags, city_id FROM dining.collections WHERE slug = $1 AND is_active',
    [slug],
  );
  if (!collection) throw new NotFoundError('Collection');
  const { rows } = await query<CardRow>(
    `${CARD_SELECT} WHERE r.status = 'live' AND r.tags && $1 AND ($2::uuid IS NULL OR r.city_id = $2)
      ORDER BY r.rating_avg DESC LIMIT 60`,
    [collection.match_tags, collection.city_id],
  );
  return {
    slug: collection.slug,
    title: collection.title,
    subtitle: collection.subtitle,
    coverUrl: collection.cover_url,
    restaurants: rows.map(toCard),
  };
}

/* ────────────────────────── detail ────────────────────────── */

export async function getRestaurant(slug: string) {
  const row = await queryOne<
    CardRow & {
      description: string | null;
      address: string;
      phone: string | null;
      service_charge_percent: string | number;
    }
  >(
    `SELECT x.*, r2.description, r2.address, r2.phone, r2.service_charge_percent
       FROM (${CARD_SELECT} WHERE r.slug = $1 AND r.status IN ('live', 'paused')) x
       JOIN dining.restaurants r2 ON r2.id = x.id`,
    [slug],
  );
  if (!row) throw new NotFoundError('Restaurant');

  const [media, offers, reviews, distribution] = await Promise.all([
    query<{ kind: string; url: string; caption: string | null }>(
      'SELECT kind, url, caption FROM dining.restaurant_media WHERE restaurant_id = $1 ORDER BY sort, created_at',
      [row.id],
    ),
    query<OfferRow>(
      `SELECT ${OFFER_COLUMNS} FROM dining.offers o
        WHERE o.restaurant_id = $1 AND o.owner = 'restaurant' AND o.code IS NULL AND o.status = 'active'
          AND (o.valid_until IS NULL OR o.valid_until > now())
        ORDER BY CASE o.applies_to WHEN 'prebook' THEN 0 WHEN 'both' THEN 1 ELSE 2 END, o.percent_off DESC NULLS LAST`,
      [row.id],
    ),
    query<{ rating: number; body: string | null; reply: string | null; created_at: Date; full_name: string }>(
      `SELECT rv.rating, rv.body, rv.reply, rv.created_at, u.full_name
         FROM dining.reviews rv JOIN users u ON u.id = rv.user_id
        WHERE rv.restaurant_id = $1 AND rv.body IS NOT NULL
        ORDER BY rv.created_at DESC LIMIT 6`,
      [row.id],
    ),
    query<{ rating: number; count: number }>(
      'SELECT rating, count(*)::int AS count FROM dining.reviews WHERE restaurant_id = $1 GROUP BY rating',
      [row.id],
    ),
  ]);

  const state = openState(row.hours ?? {});
  return {
    ...toCard(row),
    description: row.description,
    address: row.address,
    phone: row.phone,
    lat: Number(row.lat),
    lng: Number(row.lng),
    hours: row.hours,
    opensAt: state.opensAt,
    serviceChargePercent: Number(row.service_charge_percent),
    timezone: DINING_TZ,
    gallery: media.rows.map((m) => ({ kind: m.kind, url: m.url, caption: m.caption })),
    offers: offers.rows.map(toPublicOffer),
    reviews: reviews.rows.map((review) => ({
      rating: review.rating,
      body: review.body,
      reply: review.reply,
      createdAt: review.created_at,
      // First name and initial only — enough to feel human, not enough to identify.
      author: review.full_name.split(' ').map((part, i) => (i === 0 ? part : `${part[0]}.`)).join(' '),
    })),
    ratingDistribution: [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: distribution.rows.find((d) => d.rating === stars)?.count ?? 0,
    })),
  };
}
