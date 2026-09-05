import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/http';
import { queryOne } from '../../db/pool';
import { NotFoundError } from '../../utils/errors';
import { getTicketsForBooking } from './ticket.service';
import { renderTicketsPdf } from './ticket.pdf';

const router = Router();
router.use(authenticate);

/** Downloadable PDF of every ticket on a booking. */
router.get(
  '/booking/:bookingId/download',
  validate({ params: z.object({ bookingId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const viewer = currentUser(req);
    const tickets = await getTicketsForBooking(req.params.bookingId, viewer);
    if (tickets.length === 0) throw new NotFoundError('Tickets', 'NO_TICKETS');

    const booking = await queryOne<{ booking_code: string; customer_name: string; total_paise: number }>(
      'SELECT booking_code, customer_name, total_paise FROM bookings WHERE id = $1',
      [req.params.bookingId],
    );
    if (!booking) throw new NotFoundError('Booking');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="tixit-${booking.booking_code}.pdf"`);

    const stream = renderTicketsPdf(tickets, {
      bookingCode: booking.booking_code,
      customerName: booking.customer_name,
      totalPaise: Number(booking.total_paise),
    });
    stream.pipe(res);
  }),
);

export default router;
