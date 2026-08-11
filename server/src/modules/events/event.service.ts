import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../db/pool';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors';
import { uniqueSlug, isUuid } from '../../utils/ids';
import { dayWindow, resolveDateFilter } from '../../utils/dates';
import { rupeesToPaise } from '../../utils/money';
import { getSettings } from '../../services/settings.service';
import type { AuthenticatedUser } from '../../middleware/auth';
import type { CreateEventInput, EventListQuery, TicketTypeInput, UpdateEventInput } from './event.schema';

/* ────────────────────────────── shapes ────────────────────────────── */

export interface EventCard {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  bannerUrl: string | null;
  thumbnailUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  isFree: boolean;
  isFeatured: boolean;
  minPricePaise: number;
  maxPricePaise: number;
  ticketsSold: number;
  totalCapacity: number;
  ticketsAvailable: number;
  soldOut: boolean;
  category: { id: string; name: string; slug: string; color: string; icon: string | null };
  city: { id: string; name: string; slug: string };
  venue: { id: string; name: string };
  organizer: { id: string; name: string; slug: string };
  status?: string;
}

const CARD_COLUMNS = `
  e.id, e.slug, e.title, e.subtitle, e.banner_url, e.thumbnail_url,
  e.starts_at, e.ends_at, e.is_free, e.is_featured, e.status,
  e.min_price_paise, e.max_price_paise, e.tickets_sold, e.total_capacity,
  c.id AS category_id, c.name AS category_name, c.slug AS category_slug, c.color AS category_color, c.icon AS category_icon,
  ci.id AS city_id, ci.name AS city_name, ci.slug AS city_slug,
  v.id AS venue_id, v.name AS venue_name,
  o.id AS organizer_id, o.display_name AS organizer_name, o.slug AS organizer_slug`;

const CARD_JOINS = `
  FROM events e
  JOIN categories c  ON c.id  = e.category_id
  JOIN cities     ci ON ci.id = e.city_id
  JOIN venues     v  ON v.id  = e.venue_id
  JOIN organizers o  ON o.id  = e.organizer_id`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapCard(row: any): EventCard {
  const available = Math.max(0, Number(row.total_capacity) - Number(row.tickets_sold));
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    bannerUrl: row.banner_url,
    thumbnailUrl: row.thumbnail_url ?? row.banner_url,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isFree: row.is_free,
    isFeatured: row.is_featured,
    minPricePaise: Number(row.min_price_paise),
    maxPricePaise: Number(row.max_price_paise),
    ticketsSold: Number(row.tickets_sold),
    totalCapacity: Number(row.total_capacity),
    ticketsAvailable: available,
    soldOut: Number(row.total_capacity) > 0 && available === 0,
    category: {
      id: row.category_id,
      name: row.category_name,
      slug: row.category_slug,
      color: row.category_color,
      icon: row.category_icon,
    },
    city: { id: row.city_id, name: row.city_name, slug: row.city_slug },
    venue: { id: row.venue_id, name: row.venue_name },
    organizer: { id: row.organizer_id, name: row.organizer_name, slug: row.organizer_slug },
    status: row.status,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ─────────────────────── public discovery ─────────────────────────── */

/**
 * Incremental WHERE-clause builder.
 *
 * Every value goes through `add()`, which returns a positional placeholder —
 * user input is never concatenated into SQL.
 */
class SqlFilters {
  readonly clauses: string[] = [];
  readonly params: unknown[] = [];

  add(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  where(clause: string): void {
    this.clauses.push(clause);
  }

  get sql(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }
}

export async function listPublicEvents(
  params: EventListQuery,
): Promise<{ items: EventCard[]; total: number }> {
  const filters = new SqlFilters();

  // Only approved, live listings are ever discoverable.
  filters.where(`e.status = 'published'`);

  // Events that already finished drop out of discovery, unless the caller
  // explicitly asked for a past date range.
  if (!params.from && !params.date && !params.when) {
    filters.where(`e.ends_at > now()`);
  }

  if (params.q) {
    const term = filters.add(params.q);
    // websearch_to_tsquery tolerates the quotes/OR/- syntax users actually type.
    // The ILIKE arm catches partial words that stemming misses ("jaz" → "jazz").
    filters.where(
      `(e.search_vector @@ websearch_to_tsquery('english', ${term})
        OR e.title ILIKE '%' || ${term} || '%'
        OR v.name  ILIKE '%' || ${term} || '%')`,
    );
  }

  if (params.city) {
    const value = filters.add(params.city);
    filters.where(isUuid(params.city) ? `ci.id = ${value}::uuid` : `ci.slug = ${value}`);
  }

  if (params.category) {
    const value = filters.add(params.category);
    filters.where(isUuid(params.category) ? `c.id = ${value}::uuid` : `c.slug = ${value}`);
  }

  if (params.organizer) {
    const value = filters.add(params.organizer);
    filters.where(isUuid(params.organizer) ? `o.id = ${value}::uuid` : `o.slug = ${value}`);
  }

  if (params.tag) {
    filters.where(`${filters.add(params.tag)} = ANY(e.tags)`);
  }

  // Date filters, in precedence order: explicit range > single date > quick filter.
  if (params.from || params.to) {
    if (params.from) filters.where(`e.starts_at >= ${filters.add(new Date(params.from))}`);
    if (params.to) filters.where(`e.starts_at <= ${filters.add(new Date(params.to))}`);
  } else if (params.date) {
    const window = dayWindow(params.date);
    if (window) {
      filters.where(`e.starts_at BETWEEN ${filters.add(window.from)} AND ${filters.add(window.to)}`);
    }
  } else if (params.when) {
    const window = resolveDateFilter(params.when);
    if (window) {
      filters.where(`e.starts_at BETWEEN ${filters.add(window.from)} AND ${filters.add(window.to)}`);
    }
  }

  if (params.price === 'free') filters.where(`e.is_free = true`);
  if (params.price === 'paid') filters.where(`e.is_free = false`);
  if (params.minPrice !== undefined) filters.where(`e.max_price_paise >= ${filters.add(rupeesToPaise(params.minPrice))}`);
  if (params.maxPrice !== undefined) filters.where(`e.min_price_paise <= ${filters.add(rupeesToPaise(params.maxPrice))}`);
  if (params.featured) filters.where(`e.is_featured = true`);

  const orderBy = buildOrderBy(params, filters);
  const offset = (params.page - 1) * params.limit;

  const listSql = `
    SELECT ${CARD_COLUMNS}
    ${CARD_JOINS}
    ${filters.sql}
    ORDER BY ${orderBy}
    LIMIT ${filters.add(params.limit)} OFFSET ${filters.add(offset)}`;

  const countSql = `SELECT count(*)::int AS total ${CARD_JOINS} ${filters.sql}`;
  // The count must not see the LIMIT/OFFSET placeholders appended above.
  const countParams = filters.params.slice(0, filters.params.length - 2);

  const [listResult, countResult] = await Promise.all([
    query(listSql, filters.params),
    query<{ total: number }>(countSql, countParams),
  ]);

  return {
    items: listResult.rows.map(mapCard),
    total: countResult.rows[0]?.total ?? 0,
  };
}

function buildOrderBy(params: EventListQuery, filters: SqlFilters): string {
  switch (params.sort) {
    case 'price_low':
      return 'e.min_price_paise ASC, e.starts_at ASC';
    case 'price_high':
      return 'e.max_price_paise DESC, e.starts_at ASC';
    case 'popular':
      return 'e.tickets_sold DESC, e.view_count DESC, e.starts_at ASC';
    case 'newest':
      return 'e.published_at DESC NULLS LAST, e.created_at DESC';
    case 'relevance':
      if (params.q) {
        // Reuse the already-bound search term rather than binding it twice.
        const index = filters.params.indexOf(params.q) + 1;
        if (index > 0) {
          return `ts_rank(e.search_vector, websearch_to_tsquery('english', $${index})) DESC, e.starts_at ASC`;
        }
      }
      return 'e.starts_at ASC';
    case 'date':
    default:
      return 'e.starts_at ASC';
  }
}

/* ─────────────────────── home page sections ───────────────────────── */

export async function getHomeSections(cityParam?: string): Promise<{
  trending: EventCard[];
  upcoming: EventCard[];
  featured: EventCard[];
  freeEvents: EventCard[];
}> {
  const cityClause = cityParam ? (isUuid(cityParam) ? 'AND ci.id = $1::uuid' : 'AND ci.slug = $1') : '';
  const args = cityParam ? [cityParam] : [];

  const base = `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
                WHERE e.status = 'published' AND e.ends_at > now() ${cityClause}`;

  const [trending, upcoming, featured, freeEvents] = await Promise.all([
    // "Trending" blends real sales with page views so a brand-new event with
    // strong interest can surface before it has sold out.
    query(`${base} ORDER BY (e.tickets_sold * 3 + e.view_count) DESC, e.starts_at ASC LIMIT 8`, args),
    query(`${base} ORDER BY e.starts_at ASC LIMIT 8`, args),
    query(`${base} AND e.is_featured = true ORDER BY e.starts_at ASC LIMIT 6`, args),
    query(`${base} AND e.is_free = true ORDER BY e.starts_at ASC LIMIT 6`, args),
  ]);

  return {
    trending: trending.rows.map(mapCard),
    upcoming: upcoming.rows.map(mapCard),
    featured: featured.rows.map(mapCard),
    freeEvents: freeEvents.rows.map(mapCard),
  };
}

/* ───────────────────────── event detail ───────────────────────────── */

export interface TicketTypeView {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  pricePaise: number;
  quantityTotal: number;
  available: number;
  minPerOrder: number;
  maxPerOrder: number;
  seatsPerTicket: number;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  isActive: boolean;
  onSale: boolean;
  saleStatus: 'on_sale' | 'not_started' | 'ended' | 'sold_out' | 'inactive';
}

export async function getEventBySlugOrId(identifier: string, viewer?: AuthenticatedUser) {
  const byId = isUuid(identifier);
  const row = await queryOne<Record<string, unknown>>(
    `SELECT e.*,
            c.name AS category_name, c.slug AS category_slug, c.color AS category_color, c.icon AS category_icon,
            ci.name AS city_name, ci.slug AS city_slug, ci.state AS city_state,
            v.name AS venue_name, v.address_line1, v.address_line2, v.landmark, v.postal_code,
            v.latitude, v.longitude, v.google_maps_url, v.capacity AS venue_capacity,
            o.display_name AS organizer_name, o.slug AS organizer_slug, o.logo_url AS organizer_logo,
            o.bio AS organizer_bio, o.support_email AS organizer_email, o.support_phone AS organizer_phone,
            o.website AS organizer_website, o.status AS organizer_status, o.user_id AS organizer_user_id
       FROM events e
       JOIN categories c  ON c.id  = e.category_id
       JOIN cities     ci ON ci.id = e.city_id
       JOIN venues     v  ON v.id  = e.venue_id
       JOIN organizers o  ON o.id  = e.organizer_id
      WHERE ${byId ? 'e.id = $1::uuid' : 'e.slug = $1'}`,
    [identifier],
  );

  if (!row) throw new NotFoundError('Event');

  // Unpublished events are visible only to their organizer and to admins.
  const isOwner = viewer?.organizerId === row.organizer_id;
  const isAdmin = viewer?.role === 'admin';
  if (row.status !== 'published' && !isOwner && !isAdmin) {
    throw new NotFoundError('Event');
  }

  const ticketTypes = await getTicketTypesForEvent(row.id as string);

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    bannerUrl: row.banner_url,
    thumbnailUrl: row.thumbnail_url ?? row.banner_url,
    gallery: row.gallery ?? [],
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    doorsOpenAt: row.doors_open_at,
    timezone: row.timezone,
    language: row.language,
    durationMinutes: row.duration_minutes,
    ageLimit: row.age_limit,
    status: row.status,
    isFeatured: row.is_featured,
    isFree: row.is_free,
    terms: row.terms,
    tags: row.tags ?? [],
    minPricePaise: Number(row.min_price_paise),
    maxPricePaise: Number(row.max_price_paise),
    totalCapacity: Number(row.total_capacity),
    ticketsSold: Number(row.tickets_sold),
    viewCount: Number(row.view_count),
    rejectionReason: row.rejection_reason,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    category: {
      id: row.category_id,
      name: row.category_name,
      slug: row.category_slug,
      color: row.category_color,
      icon: row.category_icon,
    },
    city: { id: row.city_id, name: row.city_name, slug: row.city_slug, state: row.city_state },
    venue: {
      id: row.venue_id,
      name: row.venue_name,
      addressLine1: row.address_line1,
      addressLine2: row.address_line2,
      landmark: row.landmark,
      postalCode: row.postal_code,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      googleMapsUrl: row.google_maps_url,
      capacity: row.venue_capacity,
    },
    organizer: {
      id: row.organizer_id,
      name: row.organizer_name,
      slug: row.organizer_slug,
      logoUrl: row.organizer_logo,
      bio: row.organizer_bio,
      email: row.organizer_email,
      phone: row.organizer_phone,
      website: row.organizer_website,
      status: row.organizer_status,
    },
    ticketTypes,
  };
}

/** Best-effort view counter; never blocks or fails the detail response. */
export async function incrementViewCount(eventId: string): Promise<void> {
  await query('UPDATE events SET view_count = view_count + 1 WHERE id = $1', [eventId]).catch(() => undefined);
}

export async function getTicketTypesForEvent(eventId: string): Promise<TicketTypeView[]> {
  const { rows } = await query<Record<string, unknown>>(
    `SELECT id, name, kind, description, price_paise, quantity_total, quantity_sold, quantity_held,
            min_per_order, max_per_order, seats_per_ticket, sale_starts_at, sale_ends_at, is_active
       FROM ticket_types
      WHERE event_id = $1
      ORDER BY display_order ASC, price_paise ASC`,
    [eventId],
  );

  const now = Date.now();
  return rows.map((row) => {
    const available = Math.max(
      0,
      Number(row.quantity_total) - Number(row.quantity_sold) - Number(row.quantity_held),
    );
    const startsAt = row.sale_starts_at as Date | null;
    const endsAt = row.sale_ends_at as Date | null;

    let saleStatus: TicketTypeView['saleStatus'] = 'on_sale';
    if (!row.is_active) saleStatus = 'inactive';
    else if (startsAt && startsAt.getTime() > now) saleStatus = 'not_started';
    else if (endsAt && endsAt.getTime() < now) saleStatus = 'ended';
    else if (available <= 0) saleStatus = 'sold_out';

    return {
      id: row.id as string,
      name: row.name as string,
      kind: row.kind as string,
      description: row.description as string | null,
      pricePaise: Number(row.price_paise),
      quantityTotal: Number(row.quantity_total),
      available,
      minPerOrder: Number(row.min_per_order),
      maxPerOrder: Number(row.max_per_order),
      seatsPerTicket: Number(row.seats_per_ticket),
      saleStartsAt: startsAt,
      saleEndsAt: endsAt,
      isActive: row.is_active as boolean,
      onSale: saleStatus === 'on_sale',
      saleStatus,
    };
  });
}

/* ──────────────────── organizer event lifecycle ───────────────────── */

async function resolveVenue(
  client: PoolClient,
  organizerId: string,
  input: CreateEventInput | UpdateEventInput,
): Promise<{ venueId: string; cityId: string } | null> {
  if (input.venueId) {
    const { rows } = await client.query<{ id: string; city_id: string; organizer_id: string | null }>(
      'SELECT id, city_id, organizer_id FROM venues WHERE id = $1',
      [input.venueId],
    );
    const venue = rows[0];
    if (!venue) throw new NotFoundError('Venue');
    // Shared venues (organizer_id IS NULL) are usable by anyone; a private one
    // belongs to the organizer that created it.
    if (venue.organizer_id && venue.organizer_id !== organizerId) {
      throw new ForbiddenError('That venue belongs to another organizer');
    }
    return { venueId: venue.id, cityId: venue.city_id };
  }

  if (input.venue) {
    const v = input.venue;
    const { rows } = await client.query<{ id: string; city_id: string }>(
      `INSERT INTO venues (organizer_id, name, address_line1, address_line2, city_id, state, postal_code,
                           landmark, latitude, longitude, capacity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, city_id`,
      [
        organizerId,
        v.name,
        v.addressLine1,
        v.addressLine2 ?? null,
        v.cityId,
        v.state ?? null,
        v.postalCode ?? null,
        v.landmark ?? null,
        v.latitude ?? null,
        v.longitude ?? null,
        v.capacity ?? null,
      ],
    );
    return { venueId: rows[0]!.id, cityId: rows[0]!.city_id };
  }

  return null;
}

export async function createEvent(organizerId: string, input: CreateEventInput): Promise<{ id: string; slug: string }> {
  return withTransaction(async (client) => {
    const venue = await resolveVenue(client, organizerId, input);
    if (!venue) throw new BadRequestError('A venue is required', 'VENUE_REQUIRED');

    const slug = uniqueSlug(input.title);
    const durationMinutes = Math.round(
      (new Date(input.endsAt).getTime() - new Date(input.startsAt).getTime()) / 60_000,
    );

    const { rows } = await client.query<{ id: string; slug: string }>(
      `INSERT INTO events (organizer_id, title, slug, subtitle, description, category_id, venue_id, city_id,
                           banner_url, thumbnail_url, gallery, starts_at, ends_at, doors_open_at, language,
                           duration_minutes, age_limit, terms, tags, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,'draft')
       RETURNING id, slug`,
      [
        organizerId,
        input.title,
        slug,
        input.subtitle ?? null,
        input.description ?? '',
        input.categoryId,
        venue.venueId,
        venue.cityId,
        input.bannerUrl ?? null,
        input.thumbnailUrl ?? null,
        JSON.stringify(input.gallery ?? []),
        new Date(input.startsAt),
        new Date(input.endsAt),
        input.doorsOpenAt ? new Date(input.doorsOpenAt) : null,
        input.language,
        durationMinutes,
        input.ageLimit ?? null,
        input.terms ?? null,
        input.tags ?? [],
      ],
    );
    const event = rows[0]!;

    for (const [index, ticketType] of (input.ticketTypes ?? []).entries()) {
      await insertTicketType(client, event.id, { ...ticketType, displayOrder: ticketType.displayOrder || index });
    }
    await recalculateEventAggregates(client, event.id);
    await client.query('UPDATE organizers SET total_events = total_events + 1 WHERE id = $1', [organizerId]);

    return event;
  });
}

/** Confirm the event belongs to the caller (admins bypass the ownership check). */
export async function assertEventOwnership(
  eventId: string,
  user: AuthenticatedUser,
): Promise<{ id: string; organizer_id: string; status: string; title: string; slug: string }> {
  const row = await queryOne<{ id: string; organizer_id: string; status: string; title: string; slug: string }>(
    'SELECT id, organizer_id, status, title, slug FROM events WHERE id = $1',
    [eventId],
  );
  if (!row) throw new NotFoundError('Event');
  if (user.role !== 'admin' && row.organizer_id !== user.organizerId) {
    throw new ForbiddenError('This event belongs to another organizer');
  }
  return row;
}

export async function updateEvent(eventId: string, organizerId: string, input: UpdateEventInput): Promise<void> {
  await withTransaction(async (client) => {
    const venue = await resolveVenue(client, organizerId, input);

    await client.query(
      `UPDATE events SET
         title         = COALESCE($2, title),
         subtitle      = COALESCE($3, subtitle),
         description   = COALESCE($4, description),
         category_id   = COALESCE($5, category_id),
         venue_id      = COALESCE($6, venue_id),
         city_id       = COALESCE($7, city_id),
         banner_url    = COALESCE($8, banner_url),
         thumbnail_url = COALESCE($9, thumbnail_url),
         gallery       = COALESCE($10::jsonb, gallery),
         starts_at     = COALESCE($11, starts_at),
         ends_at       = COALESCE($12, ends_at),
         doors_open_at = COALESCE($13, doors_open_at),
         language      = COALESCE($14, language),
         age_limit     = COALESCE($15, age_limit),
         terms         = COALESCE($16, terms),
         tags          = COALESCE($17, tags)
       WHERE id = $1`,
      [
        eventId,
        input.title ?? null,
        input.subtitle ?? null,
        input.description ?? null,
        input.categoryId ?? null,
        venue?.venueId ?? null,
        venue?.cityId ?? null,
        input.bannerUrl ?? null,
        input.thumbnailUrl ?? null,
        input.gallery ? JSON.stringify(input.gallery) : null,
        input.startsAt ? new Date(input.startsAt) : null,
        input.endsAt ? new Date(input.endsAt) : null,
        input.doorsOpenAt ? new Date(input.doorsOpenAt) : null,
        input.language ?? null,
        input.ageLimit ?? null,
        input.terms ?? null,
        input.tags ?? null,
      ],
    );

    await client.query(
      `UPDATE events SET duration_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60))
        WHERE id = $1`,
      [eventId],
    );
  });
}

/**
 * Submit a draft for admin review.
 *
 * When `auto_approve_events` is on the event publishes immediately — useful
 * for a trusted-organizer deployment where manual moderation is overhead.
 */
export async function submitForReview(eventId: string): Promise<{ status: string }> {
  const ticketTypes = await getTicketTypesForEvent(eventId);
  if (ticketTypes.length === 0) {
    throw new BadRequestError('Add at least one ticket type before submitting', 'NO_TICKET_TYPES');
  }

  const event = await queryOne<{ status: string; banner_url: string | null; starts_at: Date }>(
    'SELECT status, banner_url, starts_at FROM events WHERE id = $1',
    [eventId],
  );
  if (!event) throw new NotFoundError('Event');
  if (!['draft', 'rejected'].includes(event.status)) {
    throw new ConflictError(`An event with status "${event.status}" cannot be submitted`, 'INVALID_TRANSITION');
  }
  if (event.starts_at.getTime() < Date.now()) {
    throw new BadRequestError('The event start date is in the past', 'EVENT_IN_PAST');
  }

  const settings = await getSettings();
  if (settings.auto_approve_events) {
    await query(
      `UPDATE events SET status = 'published', submitted_at = now(), approved_at = now(), published_at = now(),
                         rejection_reason = NULL
        WHERE id = $1`,
      [eventId],
    );
    return { status: 'published' };
  }

  await query(
    `UPDATE events SET status = 'pending_review', submitted_at = now(), rejection_reason = NULL WHERE id = $1`,
    [eventId],
  );
  return { status: 'pending_review' };
}

/** Pause a live event (stops new bookings, keeps existing ones valid). */
export async function pauseEvent(eventId: string): Promise<void> {
  const { rowCount } = await query(
    `UPDATE events SET status = 'paused' WHERE id = $1 AND status = 'published'`,
    [eventId],
  );
  if (!rowCount) throw new ConflictError('Only a published event can be paused', 'INVALID_TRANSITION');
}

export async function resumeEvent(eventId: string): Promise<void> {
  const { rowCount } = await query(
    `UPDATE events SET status = 'published' WHERE id = $1 AND status = 'paused'`,
    [eventId],
  );
  if (!rowCount) throw new ConflictError('Only a paused event can be resumed', 'INVALID_TRANSITION');
}

/**
 * Delete an event.
 *
 * Refused once tickets have been sold — the booking history of paying
 * customers must survive. Organizers cancel such events instead.
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const sold = await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM bookings
      WHERE event_id = $1 AND status IN ('confirmed', 'refunded', 'partially_refunded')`,
    [eventId],
  );
  if ((sold?.count ?? 0) > 0) {
    throw new ConflictError(
      'This event has confirmed bookings and cannot be deleted. Cancel it instead.',
      'HAS_BOOKINGS',
    );
  }
  await query('DELETE FROM events WHERE id = $1', [eventId]);
}

export async function cancelEvent(eventId: string, reason: string): Promise<void> {
  await query(
    `UPDATE events SET status = 'cancelled', cancelled_at = now(), rejection_reason = $2 WHERE id = $1`,
    [eventId, reason],
  );
}

export async function listOrganizerEvents(
  organizerId: string,
  params: { status?: string; q?: string; page: number; limit: number },
): Promise<{ items: EventCard[]; total: number }> {
  const filters = new SqlFilters();
  filters.where(`e.organizer_id = ${filters.add(organizerId)}`);
  if (params.status) filters.where(`e.status = ${filters.add(params.status)}::event_status`);
  if (params.q) filters.where(`e.title ILIKE '%' || ${filters.add(params.q)} || '%'`);

  const offset = (params.page - 1) * params.limit;
  const listSql = `SELECT ${CARD_COLUMNS} ${CARD_JOINS} ${filters.sql}
                   ORDER BY e.created_at DESC
                   LIMIT ${filters.add(params.limit)} OFFSET ${filters.add(offset)}`;
  const countSql = `SELECT count(*)::int AS total ${CARD_JOINS} ${filters.sql}`;
  const countParams = filters.params.slice(0, filters.params.length - 2);

  const [list, count] = await Promise.all([
    query(listSql, filters.params),
    query<{ total: number }>(countSql, countParams),
  ]);

  return { items: list.rows.map(mapCard), total: count.rows[0]?.total ?? 0 };
}

/* ─────────────────────── ticket type CRUD ─────────────────────────── */

export async function insertTicketType(
  client: PoolClient,
  eventId: string,
  input: TicketTypeInput,
): Promise<{ id: string }> {
  if (input.maxPerOrder < input.minPerOrder) {
    throw new BadRequestError('Maximum per order cannot be lower than the minimum', 'INVALID_ORDER_RANGE');
  }
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ticket_types (event_id, name, kind, description, price_paise, quantity_total,
                               min_per_order, max_per_order, seats_per_ticket, sale_starts_at, sale_ends_at,
                               is_active, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      eventId,
      input.name,
      input.kind,
      input.description ?? null,
      rupeesToPaise(input.price),
      input.quantityTotal,
      input.minPerOrder,
      input.maxPerOrder,
      input.seatsPerTicket,
      input.saleStartsAt ? new Date(input.saleStartsAt) : null,
      input.saleEndsAt ? new Date(input.saleEndsAt) : null,
      input.isActive,
      input.displayOrder,
    ],
  );
  return rows[0]!;
}

export async function addTicketType(eventId: string, input: TicketTypeInput): Promise<{ id: string }> {
  return withTransaction(async (client) => {
    const created = await insertTicketType(client, eventId, input);
    await recalculateEventAggregates(client, eventId);
    return created;
  });
}

export async function updateTicketType(
  ticketTypeId: string,
  eventId: string,
  input: Partial<TicketTypeInput>,
): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ quantity_sold: number; quantity_held: number }>(
      'SELECT quantity_sold, quantity_held FROM ticket_types WHERE id = $1 AND event_id = $2 FOR UPDATE',
      [ticketTypeId, eventId],
    );
    const existing = rows[0];
    if (!existing) throw new NotFoundError('Ticket type');

    // Shrinking capacity below what is already committed would break the
    // not-oversold invariant, so it is rejected with a clear message.
    const committed = Number(existing.quantity_sold) + Number(existing.quantity_held);
    if (input.quantityTotal !== undefined && input.quantityTotal < committed) {
      throw new ConflictError(
        `Capacity cannot be reduced below the ${committed} ticket(s) already sold or held`,
        'CAPACITY_BELOW_SOLD',
      );
    }

    await client.query(
      `UPDATE ticket_types SET
         name             = COALESCE($3, name),
         kind             = COALESCE($4, kind),
         description      = COALESCE($5, description),
         price_paise      = COALESCE($6, price_paise),
         quantity_total   = COALESCE($7, quantity_total),
         min_per_order    = COALESCE($8, min_per_order),
         max_per_order    = COALESCE($9, max_per_order),
         seats_per_ticket = COALESCE($10, seats_per_ticket),
         sale_starts_at   = COALESCE($11, sale_starts_at),
         sale_ends_at     = COALESCE($12, sale_ends_at),
         is_active        = COALESCE($13, is_active),
         display_order    = COALESCE($14, display_order)
       WHERE id = $1 AND event_id = $2`,
      [
        ticketTypeId,
        eventId,
        input.name ?? null,
        input.kind ?? null,
        input.description ?? null,
        input.price !== undefined ? rupeesToPaise(input.price) : null,
        input.quantityTotal ?? null,
        input.minPerOrder ?? null,
        input.maxPerOrder ?? null,
        input.seatsPerTicket ?? null,
        input.saleStartsAt ? new Date(input.saleStartsAt) : null,
        input.saleEndsAt ? new Date(input.saleEndsAt) : null,
        input.isActive ?? null,
        input.displayOrder ?? null,
      ],
    );

    await recalculateEventAggregates(client, eventId);
  });
}

export async function deleteTicketType(ticketTypeId: string, eventId: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ quantity_sold: number; quantity_held: number }>(
      'SELECT quantity_sold, quantity_held FROM ticket_types WHERE id = $1 AND event_id = $2',
      [ticketTypeId, eventId],
    );
    const existing = rows[0];
    if (!existing) throw new NotFoundError('Ticket type');
    if (Number(existing.quantity_sold) > 0 || Number(existing.quantity_held) > 0) {
      throw new ConflictError(
        'Tickets of this type have already been sold. Deactivate it instead of deleting.',
        'TICKETS_SOLD',
      );
    }
    await client.query('DELETE FROM ticket_types WHERE id = $1', [ticketTypeId]);
    await recalculateEventAggregates(client, eventId);
  });
}

/**
 * Recompute the denormalised price/capacity columns on `events`.
 *
 * Called after any ticket-type mutation. Keeping these on the event row is
 * what lets discovery filter and sort by price without a join or subquery.
 */
export async function recalculateEventAggregates(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `UPDATE events e SET
       min_price_paise = COALESCE(agg.min_price, 0),
       max_price_paise = COALESCE(agg.max_price, 0),
       total_capacity  = COALESCE(agg.capacity, 0),
       tickets_sold    = COALESCE(agg.sold, 0),
       is_free         = COALESCE(agg.max_price, 0) = 0 AND COALESCE(agg.types, 0) > 0
     FROM (
       SELECT min(price_paise)      AS min_price,
              max(price_paise)      AS max_price,
              sum(quantity_total)   AS capacity,
              sum(quantity_sold)    AS sold,
              count(*)              AS types
         FROM ticket_types
        WHERE event_id = $1 AND is_active = true
     ) agg
     WHERE e.id = $1`,
    [eventId],
  );
}
