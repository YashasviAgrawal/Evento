import { Router } from 'express';
import { z } from 'zod';
import { authenticate, optionalAuth, requireOrganizer, requireVerifiedOrganizer } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as controller from './event.controller';
import {
  createEventSchema,
  eventIdParam,
  eventListQuerySchema,
  eventSlugParam,
  organizerEventListSchema,
  ticketTypeInputSchema,
  updateEventSchema,
} from './event.schema';

/* Public discovery — mounted at /api/v1/events */
export const publicEventRoutes = Router();

publicEventRoutes.get('/', validate({ query: eventListQuerySchema }), controller.listEvents);
publicEventRoutes.get('/home', controller.homeFeed);
publicEventRoutes.get('/:id/availability', validate({ params: eventIdParam }), controller.getEventAvailability);
// Registered last so it cannot shadow the literal routes above.
publicEventRoutes.get('/:slug', validate({ params: eventSlugParam }), optionalAuth, controller.getEvent);

/* Organizer-owned management — mounted at /api/v1/organizer/events */
export const organizerEventRoutes = Router();

organizerEventRoutes.use(authenticate, requireOrganizer);

organizerEventRoutes.get('/', validate({ query: organizerEventListSchema }), controller.listMyEvents);
organizerEventRoutes.post(
  '/',
  requireVerifiedOrganizer,
  validate({ body: createEventSchema }),
  controller.createEvent,
);
organizerEventRoutes.get('/:id', validate({ params: eventIdParam }), controller.getMyEvent);
organizerEventRoutes.patch(
  '/:id',
  validate({ params: eventIdParam, body: updateEventSchema }),
  controller.updateEvent,
);
organizerEventRoutes.delete('/:id', validate({ params: eventIdParam }), controller.deleteEvent);

organizerEventRoutes.post(
  '/:id/submit',
  requireVerifiedOrganizer,
  validate({ params: eventIdParam }),
  controller.submitEvent,
);
organizerEventRoutes.post('/:id/pause', validate({ params: eventIdParam }), controller.pauseEvent);
organizerEventRoutes.post('/:id/resume', validate({ params: eventIdParam }), controller.resumeEvent);

organizerEventRoutes.get('/:id/ticket-types', validate({ params: eventIdParam }), controller.listTicketTypes);
organizerEventRoutes.post(
  '/:id/ticket-types',
  validate({ params: eventIdParam, body: ticketTypeInputSchema }),
  controller.addTicketType,
);
organizerEventRoutes.patch(
  '/:id/ticket-types/:ticketTypeId',
  validate({
    params: z.object({ id: z.string().uuid(), ticketTypeId: z.string().uuid() }),
    body: ticketTypeInputSchema.partial(),
  }),
  controller.updateTicketType,
);
organizerEventRoutes.delete(
  '/:id/ticket-types/:ticketTypeId',
  validate({ params: z.object({ id: z.string().uuid(), ticketTypeId: z.string().uuid() }) }),
  controller.deleteTicketType,
);
