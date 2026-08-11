import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool';
import { authenticate, currentOrganizerId, requireOrganizer } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
import { isUuid } from '../../utils/ids';
import { dayWindow, resolveDateFilter } from '../../utils/dates';
import { venueInputSchema } from '../events/event.schema';

/**
 * Reference data (cities, categories) and venue management.
 * These lists change rarely and are safe to cache aggressively at the edge.
 */
const router = Router();

router.get(
  '/cities',
  asyncHandler(async (req, res) => {
    const popularOnly = req.query.popular === 'true';

    // Optional filter params — when provided, the event_count subquery only
    // counts events matching ALL of these, keeping counts consistent with the
    // events listing page.
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : undefined;
    const price = typeof req.query.price === 'string' ? req.query.price.trim() : undefined;
    const when = typeof req.query.when === 'string' ? req.query.when.trim() : undefined;
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
    const organizer = typeof req.query.organizer === 'string' ? req.query.organizer.trim() : undefined;
    const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : undefined;
    const featured = req.query.featured === 'true' ? true : undefined;

    // Build the extra WHERE clauses and positional params for the count subquery.
    const extraClauses: string[] = [];
    const extraParams: unknown[] = [];
    let paramIndex = 0;

    // We need JOINs in the subquery only when filtering by category, organizer, or full-text search.
    let needCategoryJoin = false;
    let needOrganizerJoin = false;
    let needVenueJoin = false;

    if (category) {
      needCategoryJoin = true;
      paramIndex++;
      if (isUuid(category)) {
        extraClauses.push(`cat.id = $${paramIndex}::uuid`);
      } else {
        extraClauses.push(`cat.slug = $${paramIndex}`);
      }
      extraParams.push(category);
    }

    if (organizer) {
      needOrganizerJoin = true;
      paramIndex++;
      if (isUuid(organizer)) {
        extraClauses.push(`org.id = $${paramIndex}::uuid`);
      } else {
        extraClauses.push(`org.slug = $${paramIndex}`);
      }
      extraParams.push(organizer);
    }

    if (price === 'free') extraClauses.push(`e.is_free = true`);
    if (price === 'paid') extraClauses.push(`e.is_free = false`);
    if (featured) extraClauses.push(`e.is_featured = true`);

    if (tag) {
      paramIndex++;
      extraClauses.push(`$${paramIndex} = ANY(e.tags)`);
      extraParams.push(tag);
    }

    if (q) {
      needVenueJoin = true;
      paramIndex++;
      extraClauses.push(
        `(e.search_vector @@ websearch_to_tsquery('english', $${paramIndex})
          OR e.title ILIKE '%' || $${paramIndex} || '%'
          OR v.name  ILIKE '%' || $${paramIndex} || '%')`,
      );
      extraParams.push(q);
    }

    // Date filters (same precedence as listPublicEvents: date > when)
    if (date) {
      const window = dayWindow(date);
      if (window) {
        paramIndex++;
        extraClauses.push(`e.starts_at >= $${paramIndex}`);
        extraParams.push(window.from);
        paramIndex++;
        extraClauses.push(`e.starts_at <= $${paramIndex}`);
        extraParams.push(window.to);
      }
    } else if (when) {
      const window = resolveDateFilter(when);
      if (window) {
        paramIndex++;
        extraClauses.push(`e.starts_at >= $${paramIndex}`);
        extraParams.push(window.from);
        paramIndex++;
        extraClauses.push(`e.starts_at <= $${paramIndex}`);
        extraParams.push(window.to);
      }
    }

    const joinParts = [
      needCategoryJoin ? 'JOIN categories cat ON cat.id = e.category_id' : '',
      needOrganizerJoin ? 'JOIN organizers org ON org.id = e.organizer_id' : '',
      needVenueJoin ? 'JOIN venues v ON v.id = e.venue_id' : '',
    ].filter(Boolean).join(' ');

    const extraWhere = extraClauses.length > 0 ? `AND ${extraClauses.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT c.id, c.name, c.slug, c.state, c.image_url, c.is_popular,
              (SELECT count(*)::int FROM events e
                ${joinParts}
                WHERE e.city_id = c.id AND e.status = 'published' AND e.ends_at > now()
                ${extraWhere}) AS event_count
         FROM cities c
        ${popularOnly ? 'WHERE c.is_popular = true' : ''}
        ORDER BY c.display_order ASC, c.name ASC`,
      extraParams,
    );
    // Cache less aggressively when filters are applied since counts are context-dependent.
    const cacheMaxAge = extraParams.length > 0 ? 15 : 300;
    res.setHeader('Cache-Control', `public, max-age=${cacheMaxAge}`);
    return ok(
      res,
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        state: row.state,
        imageUrl: row.image_url,
        isPopular: row.is_popular,
        eventCount: row.event_count,
      })),
    );
  }),
);

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT c.id, c.name, c.slug, c.icon, c.color, c.description,
              (SELECT count(*)::int FROM events e
                WHERE e.category_id = c.id AND e.status = 'published' AND e.ends_at > now()) AS event_count
         FROM categories c
        WHERE c.is_active = true
        ORDER BY c.display_order ASC`,
    );
    res.setHeader('Cache-Control', 'public, max-age=300');
    return ok(
      res,
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        icon: row.icon,
        color: row.color,
        description: row.description,
        eventCount: row.event_count,
      })),
    );
  }),
);

/* ───────────────────────── venues ───────────────────────── */

router.get(
  '/venues',
  authenticate,
  requireOrganizer,
  asyncHandler(async (req, res) => {
    const organizerId = req.user?.organizerId ?? null;
    // Shared venues (organizer_id IS NULL) plus the caller's own.
    const { rows } = await query(
      `SELECT v.id, v.name, v.address_line1, v.address_line2, v.landmark, v.postal_code,
              v.latitude, v.longitude, v.capacity, v.organizer_id,
              ci.id AS city_id, ci.name AS city_name, ci.slug AS city_slug
         FROM venues v
         JOIN cities ci ON ci.id = v.city_id
        WHERE v.organizer_id IS NULL OR v.organizer_id = $1
        ORDER BY v.name ASC
        LIMIT 200`,
      [organizerId],
    );
    return ok(
      res,
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        addressLine1: row.address_line1,
        addressLine2: row.address_line2,
        landmark: row.landmark,
        postalCode: row.postal_code,
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
        capacity: row.capacity,
        isShared: row.organizer_id === null,
        city: { id: row.city_id, name: row.city_name, slug: row.city_slug },
      })),
    );
  }),
);

router.post(
  '/venues',
  authenticate,
  requireOrganizer,
  validate({ body: venueInputSchema }),
  asyncHandler(async (req, res) => {
    const organizerId = currentOrganizerId(req);
    const v = req.body as z.infer<typeof venueInputSchema>;
    const { rows } = await query<{ id: string }>(
      `INSERT INTO venues (organizer_id, name, address_line1, address_line2, city_id, state, postal_code,
                           landmark, latitude, longitude, capacity, google_maps_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
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
        v.googleMapsUrl ?? null,
      ],
    );
    return ok(res, rows[0], 201);
  }),
);

export default router;
