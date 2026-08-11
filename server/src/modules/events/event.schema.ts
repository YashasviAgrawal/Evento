import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const eventListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  /** Quick filters from the PRD: Today / Tomorrow / This Weekend. */
  when: z.enum(['today', 'tomorrow', 'weekend', 'this_week', 'this_month']).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  price: z.enum(['free', 'paid']).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  featured: z.coerce.boolean().optional(),
  organizer: z.string().trim().max(120).optional(),
  tag: z.string().trim().max(60).optional(),
  sort: z.enum(['relevance', 'date', 'price_low', 'price_high', 'popular', 'newest']).default('date'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const ticketTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['regular', 'vip', 'early_bird', 'couple_pass', 'group_pass']).default('regular'),
  description: z.string().trim().max(500).optional().nullable(),
  /** Price is accepted in rupees for ergonomics and stored as paise. */
  price: z.coerce.number().min(0).max(10_000_000),
  quantityTotal: z.coerce.number().int().min(1).max(1_000_000),
  minPerOrder: z.coerce.number().int().min(1).max(100).default(1),
  maxPerOrder: z.coerce.number().int().min(1).max(100).default(10),
  seatsPerTicket: z.coerce.number().int().min(1).max(50).default(1),
  saleStartsAt: isoDate.optional().nullable(),
  saleEndsAt: isoDate.optional().nullable(),
  isActive: z.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).default(0),
});

/**
 * The plain object shape lives on its own so `updateEventSchema` can `.omit()`
 * and `.partial()` it. Refinements are applied afterwards — once a schema is
 * wrapped in a ZodEffects by `.refine()`, those object methods are gone.
 */
export const eventFieldsSchema = z
  .object({
    title: z.string().trim().min(3, 'Give your event a title').max(160),
    subtitle: z.string().trim().max(200).optional().nullable(),
    description: z.string().trim().max(20_000).default(''),
    categoryId: z.string().uuid('Choose a category'),
    venueId: z.string().uuid().optional(),
    venue: z
      .object({
        name: z.string().trim().min(2).max(160),
        addressLine1: z.string().trim().min(3).max(240),
        addressLine2: z.string().trim().max(240).optional().nullable(),
        cityId: z.string().uuid(),
        state: z.string().trim().max(80).optional().nullable(),
        postalCode: z.string().trim().max(12).optional().nullable(),
        landmark: z.string().trim().max(160).optional().nullable(),
        latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
        longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
        capacity: z.coerce.number().int().min(1).optional().nullable(),
      })
      .optional(),
    bannerUrl: z.string().url().max(600).optional().nullable(),
    thumbnailUrl: z.string().url().max(600).optional().nullable(),
    gallery: z.array(z.string().url().max(600)).max(12).default([]),
    startsAt: isoDate,
    endsAt: isoDate,
    doorsOpenAt: isoDate.optional().nullable(),
    language: z.string().trim().max(60).default('English'),
    ageLimit: z.coerce.number().int().min(0).max(100).optional().nullable(),
    terms: z.string().trim().max(10_000).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
    ticketTypes: z.array(ticketTypeInputSchema).max(12).default([]),
  });

export const createEventSchema = eventFieldsSchema
  // An event needs a venue: either an existing one or a new one to create.
  .refine((data) => Boolean(data.venueId) || Boolean(data.venue), {
    message: 'Select an existing venue or provide venue details',
    path: ['venueId'],
  })
  .refine((data) => new Date(data.endsAt) > new Date(data.startsAt), {
    message: 'The event must end after it starts',
    path: ['endsAt'],
  });

export const updateEventSchema = eventFieldsSchema
  .omit({ ticketTypes: true })
  .partial()
  .refine((data) => !data.startsAt || !data.endsAt || new Date(data.endsAt) > new Date(data.startsAt), {
    message: 'The event must end after it starts',
    path: ['endsAt'],
  });

export const organizerEventListSchema = z.object({
  status: z.enum(['draft', 'pending_review', 'published', 'rejected', 'paused', 'completed', 'cancelled']).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const eventIdParam = z.object({ id: z.string().uuid() });
export const eventSlugParam = z.object({ slug: z.string().trim().min(1).max(120) });

export const venueInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  addressLine1: z.string().trim().min(3).max(240),
  addressLine2: z.string().trim().max(240).optional().nullable(),
  cityId: z.string().uuid(),
  state: z.string().trim().max(80).optional().nullable(),
  postalCode: z.string().trim().max(12).optional().nullable(),
  landmark: z.string().trim().max(160).optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  capacity: z.coerce.number().int().min(1).optional().nullable(),
  googleMapsUrl: z.string().url().max(600).optional().nullable(),
});

export type EventListQuery = z.infer<typeof eventListQuerySchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type TicketTypeInput = z.infer<typeof ticketTypeInputSchema>;
export type VenueInput = z.infer<typeof venueInputSchema>;
