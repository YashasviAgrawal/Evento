import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool';
import { authenticate, currentOrganizerId, requireOrganizer } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler, ok } from '../../utils/http';
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
    const { rows } = await query(
      `SELECT c.id, c.name, c.slug, c.state, c.image_url, c.is_popular,
              (SELECT count(*)::int FROM events e
                WHERE e.city_id = c.id AND e.status = 'published' AND e.ends_at > now()) AS event_count
         FROM cities c
        ${popularOnly ? 'WHERE c.is_popular = true' : ''}
        ORDER BY c.display_order ASC, c.name ASC`,
    );
    res.setHeader('Cache-Control', 'public, max-age=300');
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
