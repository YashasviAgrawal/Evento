import { asyncHandler, buildPageMeta, ok, paginated } from '../../utils/http';
import { currentOrganizerId, currentUser } from '../../middleware/auth';
import { audit } from '../../services/audit.service';
import { query } from '../../db/pool';
import * as eventService from './event.service';

/* ─────────────────────────── public ───────────────────────────── */

export const listEvents = asyncHandler(async (req, res) => {
  const params = req.query as unknown as import('./event.schema').EventListQuery;
  const { items, total } = await eventService.listPublicEvents(params);
  return paginated(res, items, buildPageMeta(params.page, params.limit, total));
});

export const homeFeed = asyncHandler(async (req, res) => {
  const city = typeof req.query.city === 'string' ? req.query.city : undefined;
  const [sections, cities, categories] = await Promise.all([
    eventService.getHomeSections(city),
    query(
      `SELECT id, name, slug, state, image_url, is_popular FROM cities
        WHERE is_popular = true ORDER BY display_order ASC LIMIT 10`,
    ),
    query(
      `SELECT c.id, c.name, c.slug, c.icon, c.color,
              (SELECT count(*)::int FROM events e
                WHERE e.category_id = c.id AND e.status = 'published' AND e.ends_at > now()) AS event_count
         FROM categories c
        WHERE c.is_active = true
        ORDER BY c.display_order ASC`,
    ),
  ]);

  return ok(res, {
    ...sections,
    popularCities: cities.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      state: row.state,
      imageUrl: row.image_url,
    })),
    categories: categories.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      icon: row.icon,
      color: row.color,
      eventCount: row.event_count,
    })),
  });
});

export const getEvent = asyncHandler(async (req, res) => {
  const event = await eventService.getEventBySlugOrId(req.params.slug, req.user);
  if (event.status === 'published') void eventService.incrementViewCount(event.id as string);
  return ok(res, event);
});

/** Lightweight endpoint the checkout page polls for live availability. */
export const getEventAvailability = asyncHandler(async (req, res) => {
  const types = await eventService.getTicketTypesForEvent(req.params.id);
  return ok(res, { ticketTypes: types });
});

/* ────────────────────────── organizer ─────────────────────────── */

export const createEvent = asyncHandler(async (req, res) => {
  const organizerId = currentOrganizerId(req);
  const created = await eventService.createEvent(organizerId, req.body);
  await audit({
    actorId: currentUser(req).id,
    actorRole: currentUser(req).role,
    action: 'event.created',
    entityType: 'event',
    entityId: created.id,
    metadata: { title: req.body.title },
  });
  return ok(res, created, 201);
});

export const listMyEvents = asyncHandler(async (req, res) => {
  const organizerId = currentOrganizerId(req);
  const params = req.query as unknown as { status?: string; q?: string; page: number; limit: number };
  const { items, total } = await eventService.listOrganizerEvents(organizerId, params);
  return paginated(res, items, buildPageMeta(params.page, params.limit, total));
});

export const getMyEvent = asyncHandler(async (req, res) => {
  await eventService.assertEventOwnership(req.params.id, currentUser(req));
  const event = await eventService.getEventBySlugOrId(req.params.id, currentUser(req));
  return ok(res, event);
});

export const updateEvent = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const event = await eventService.assertEventOwnership(req.params.id, user);
  await eventService.updateEvent(req.params.id, event.organizer_id, req.body);
  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: 'event.updated',
    entityType: 'event',
    entityId: req.params.id,
  });
  return ok(res, { id: req.params.id, message: 'Event updated' });
});

export const submitEvent = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  await eventService.assertEventOwnership(req.params.id, user);
  const result = await eventService.submitForReview(req.params.id);
  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: 'event.submitted',
    entityType: 'event',
    entityId: req.params.id,
    metadata: result,
  });
  return ok(res, result);
});

export const pauseEvent = asyncHandler(async (req, res) => {
  await eventService.assertEventOwnership(req.params.id, currentUser(req));
  await eventService.pauseEvent(req.params.id);
  return ok(res, { status: 'paused' });
});

export const resumeEvent = asyncHandler(async (req, res) => {
  await eventService.assertEventOwnership(req.params.id, currentUser(req));
  await eventService.resumeEvent(req.params.id);
  return ok(res, { status: 'published' });
});

export const deleteEvent = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  await eventService.assertEventOwnership(req.params.id, user);
  await eventService.deleteEvent(req.params.id);
  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: 'event.deleted',
    entityType: 'event',
    entityId: req.params.id,
  });
  return ok(res, { message: 'Event deleted' });
});

/* ───────────────────────── ticket types ───────────────────────── */

export const listTicketTypes = asyncHandler(async (req, res) => {
  await eventService.assertEventOwnership(req.params.id, currentUser(req));
  const types = await eventService.getTicketTypesForEvent(req.params.id);
  return ok(res, types);
});

export const addTicketType = asyncHandler(async (req, res) => {
  await eventService.assertEventOwnership(req.params.id, currentUser(req));
  const created = await eventService.addTicketType(req.params.id, req.body);
  return ok(res, created, 201);
});

export const updateTicketType = asyncHandler(async (req, res) => {
  await eventService.assertEventOwnership(req.params.id, currentUser(req));
  await eventService.updateTicketType(req.params.ticketTypeId, req.params.id, req.body);
  return ok(res, { message: 'Ticket type updated' });
});

export const deleteTicketType = asyncHandler(async (req, res) => {
  await eventService.assertEventOwnership(req.params.id, currentUser(req));
  await eventService.deleteTicketType(req.params.ticketTypeId, req.params.id);
  return ok(res, { message: 'Ticket type deleted' });
});
