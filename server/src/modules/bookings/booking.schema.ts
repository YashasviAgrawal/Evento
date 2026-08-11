import { z } from 'zod';

export const createBookingSchema = z.object({
  eventId: z.string().uuid('Choose an event'),
  items: z
    .array(
      z.object({
        ticketTypeId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(100),
      }),
    )
    .min(1, 'Select at least one ticket')
    .max(10, 'Too many ticket types in one order'),
  couponCode: z.string().trim().min(2).max(40).optional(),
  customerName: z.string().trim().min(2, 'Enter the attendee name').max(120),
  customerEmail: z.string().trim().toLowerCase().email('Enter a valid email'),
  customerPhone: z.string().trim().regex(/^(\+?\d{1,3}[- ]?)?\d{10}$/, 'Enter a valid 10-digit phone number'),
  notes: z.string().trim().max(500).optional(),
});

export const quoteSchema = z.object({
  eventId: z.string().uuid(),
  items: z
    .array(z.object({ ticketTypeId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(100) }))
    .min(1)
    .max(10),
  couponCode: z.string().trim().min(2).max(40).optional(),
});

export const bookingListSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'cancelled', 'expired', 'refunded', 'partially_refunded']).optional(),
  scope: z.enum(['upcoming', 'past', 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(3, 'Tell us why you are cancelling').max(500),
});

export const bookingIdParam = z.object({ id: z.string().uuid() });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type QuoteInput = z.infer<typeof quoteSchema>;
export type BookingListQuery = z.infer<typeof bookingListSchema>;
