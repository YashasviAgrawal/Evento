import { logger } from '../config/logger';
import { pool, query } from '../db/pool';
import { env } from '../config/env';
import { expireStaleBookings } from '../modules/bookings/booking.service';
import { purgeExpiredOtps } from '../modules/auth/otp.service';
import { purgeExpiredRegistrations } from '../modules/auth/auth.service';
import { sendMail } from '../services/mail.service';
import { formatEventDate } from '../utils/dates';
import { autoVerifyStaleBills, cancelAbandonedBills } from '../modules/dining/bills/bill.service';
import { expireSplits } from '../modules/dining/bills/split.service';
import { invoicePreviousMonth } from '../modules/dining/invoices/invoice.service';
import { sendReservationReminders } from '../modules/dining/notifications';
import { dispatchOutbox } from '../modules/platform/outbox';
import { expireUnpaidHolds } from '../modules/dining/reservations/reservation.service';
import { expireCredits, releaseCashback } from '../modules/finance/wallet';

/**
 * In-process background jobs.
 *
 * Deliberately setInterval plus PostgreSQL rather than a separate queue
 * service: every job holds an advisory lock while it runs (see `every`), and
 * cross-module side effects go through the transactional outbox, so any
 * number of API instances can run this scheduler safely with no Redis.
 */

const timers: NodeJS.Timeout[] = [];

/**
 * Run `task` every `intervalMs`, at most once at a time across *all* API
 * instances: each run takes a PostgreSQL advisory lock named after the job and
 * skips if another instance holds it. That is what lets the API scale out
 * without reminders or settlements firing twice.
 */
function every(label: string, intervalMs: number, task: () => Promise<unknown>): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    const client = await pool.connect().catch(() => null);
    if (!client) {
      running = false;
      return;
    }
    let locked = false;
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('tixit-job:' || $1)) AS locked",
        [label],
      );
      locked = Boolean(rows[0]?.locked);
      if (locked) await task();
    } catch (err) {
      logger.error({ err, job: label }, 'Scheduled job failed');
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('tixit-job:' || $1))", [label]).catch(() => undefined);
      client.release();
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  // Do not keep the event loop alive purely for a timer.
  timer.unref();
  timers.push(timer);
}

/** Release inventory from checkouts that were never paid for. */
async function releaseExpiredHolds(): Promise<void> {
  const released = await expireStaleBookings();
  if (released > 0) logger.info({ released }, 'Expired stale bookings');
}

/** Mark events as completed once they have finished. */
async function completeFinishedEvents(): Promise<void> {
  const { rowCount } = await query(
    `UPDATE events SET status = 'completed'
      WHERE status IN ('published', 'paused') AND ends_at < now() - INTERVAL '2 hours'`,
  );
  if (rowCount) logger.info({ count: rowCount }, 'Marked finished events as completed');
}

/**
 * Email a reminder ~24h before an event.
 *
 * The `notifications` table doubles as the sent-log: the NOT EXISTS clause is
 * what stops a customer receiving the same reminder on every tick.
 */
async function sendEventReminders(): Promise<void> {
  const { rows } = await query<{
    booking_id: string;
    user_id: string;
    customer_name: string;
    customer_email: string;
    booking_code: string;
    title: string;
    starts_at: Date;
    timezone: string;
    venue_name: string;
    event_id: string;
  }>(
    `SELECT b.id AS booking_id, b.user_id, b.customer_name, b.customer_email, b.booking_code,
            e.id AS event_id, e.title, e.starts_at, e.timezone, v.name AS venue_name
       FROM bookings b
       JOIN events e ON e.id = b.event_id
       JOIN venues v ON v.id = e.venue_id
      WHERE b.status = 'confirmed'
        AND e.status = 'published'
        AND e.starts_at BETWEEN now() AND now() + INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM notifications n
           WHERE n.booking_id = b.id AND n.template = 'event_reminder' AND n.status <> 'failed'
        )
      LIMIT 200`,
  );

  for (const row of rows) {
    await sendMail({
      to: row.customer_email,
      template: 'event_reminder',
      data: {
        name: row.customer_name,
        eventTitle: row.title,
        eventDate: formatEventDate(row.starts_at, row.timezone),
        venue: row.venue_name,
        bookingCode: row.booking_code,
        ticketUrl: `${env.webBaseUrl}/account/bookings/${row.booking_id}`,
      },
      userId: row.user_id,
      bookingId: row.booking_id,
      eventId: row.event_id,
    });
  }

  if (rows.length > 0) logger.info({ count: rows.length }, 'Sent event reminders');
}

export function startScheduler(): void {
  if (env.isTest) return;

  every('release-expired-holds', 60_000, releaseExpiredHolds);
  every('complete-finished-events', 15 * 60_000, completeFinishedEvents);
  every('event-reminders', 30 * 60_000, sendEventReminders);
  every('purge-otps', 6 * 60 * 60_000, purgeExpiredOtps);
  every('purge-pending-registrations', 6 * 60 * 60_000, purgeExpiredRegistrations);
  every('dining-auto-verify-bills', 10 * 60_000, async () => {
    const count = await autoVerifyStaleBills();
    if (count) logger.info({ count }, 'Auto-verified paid dine-in bills');
  });
  every('dining-cancel-abandoned-bills', 15 * 60_000, cancelAbandonedBills);
  every('dining-expire-splits', 60_000, expireSplits);
  // Idempotent; runs through the first days of a month so a missed day is caught up.
  every('dining-commission-invoices', 6 * 60 * 60_000, invoicePreviousMonth);
  every('outbox-dispatch', 5_000, dispatchOutbox);
  every('dining-expire-deposit-holds', 60_000, expireUnpaidHolds);
  every('wallet-release-cashback', 10 * 60_000, releaseCashback);
  every('wallet-expire-credits', 60 * 60_000, expireCredits);
  every('dining-reservation-reminders', 5 * 60_000, async () => {
    const count = await sendReservationReminders();
    if (count) logger.info({ count }, 'Sent dine-in table reminders');
  });

  // Kick off one immediate pass so a restart does not wait a full interval.
  void releaseExpiredHolds().catch(() => undefined);

  logger.info('Background scheduler started');
}

export function stopScheduler(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}
