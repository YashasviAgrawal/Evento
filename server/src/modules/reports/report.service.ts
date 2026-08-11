import { query, queryOne } from '../../db/pool';

/**
 * Analytics for the organizer and admin dashboards.
 *
 * Revenue figures count only money that was actually collected — bookings in
 * `confirmed`, `refunded` or `partially_refunded` — with refunds subtracted.
 * Pending (unpaid) bookings are deliberately excluded so a dashboard never
 * shows revenue that may still evaporate when a hold expires.
 */

const EARNED_STATUSES = `('confirmed', 'refunded', 'partially_refunded')`;

export interface OrganizerSummary {
  totalEvents: number;
  publishedEvents: number;
  pendingEvents: number;
  ticketsSold: number;
  grossRevenuePaise: number;
  netRevenuePaise: number;
  commissionPaise: number;
  refundedPaise: number;
  totalBookings: number;
  attendanceRate: number;
  upcomingEvents: number;
}

export async function getOrganizerSummary(organizerId: string): Promise<OrganizerSummary> {
  const [events, bookings, attendance] = await Promise.all([
    queryOne<{
      total: number;
      published: number;
      pending: number;
      upcoming: number;
    }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'published')::int AS published,
              count(*) FILTER (WHERE status = 'pending_review')::int AS pending,
              count(*) FILTER (WHERE status = 'published' AND starts_at > now())::int AS upcoming
         FROM events WHERE organizer_id = $1`,
      [organizerId],
    ),
    queryOne<{
      bookings: number;
      tickets: number;
      gross: number;
      commission: number;
      payout: number;
      refunded: number;
    }>(
      `SELECT count(*)::int AS bookings,
              COALESCE(sum(quantity), 0)::int AS tickets,
              COALESCE(sum(total_paise), 0)::bigint AS gross,
              COALESCE(sum(commission_paise), 0)::bigint AS commission,
              COALESCE(sum(organizer_payout_paise), 0)::bigint AS payout,
              COALESCE(sum(refunded_paise), 0)::bigint AS refunded
         FROM bookings
        WHERE organizer_id = $1 AND status IN ${EARNED_STATUSES}`,
      [organizerId],
    ),
    queryOne<{ total: number; used: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE t.status = 'used')::int AS used
         FROM tickets t JOIN bookings b ON b.id = t.booking_id
        WHERE b.organizer_id = $1`,
      [organizerId],
    ),
  ]);

  const total = attendance?.total ?? 0;
  return {
    totalEvents: events?.total ?? 0,
    publishedEvents: events?.published ?? 0,
    pendingEvents: events?.pending ?? 0,
    upcomingEvents: events?.upcoming ?? 0,
    ticketsSold: bookings?.tickets ?? 0,
    totalBookings: bookings?.bookings ?? 0,
    grossRevenuePaise: Number(bookings?.gross ?? 0),
    commissionPaise: Number(bookings?.commission ?? 0),
    netRevenuePaise: Number(bookings?.payout ?? 0) - Number(bookings?.refunded ?? 0),
    refundedPaise: Number(bookings?.refunded ?? 0),
    attendanceRate: total > 0 ? Math.round(((attendance?.used ?? 0) / total) * 100) : 0,
  };
}

/** Daily sales for the last `days` days, zero-filled so charts have no gaps. */
export async function getOrganizerSalesSeries(
  organizerId: string,
  days = 30,
): Promise<Array<{ date: string; bookings: number; tickets: number; revenuePaise: number }>> {
  const { rows } = await query<{ date: string; bookings: number; tickets: number; revenue: number }>(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
            COALESCE(count(b.id), 0)::int AS bookings,
            COALESCE(sum(b.quantity), 0)::int AS tickets,
            COALESCE(sum(b.total_paise), 0)::bigint AS revenue
       FROM generate_series(
              date_trunc('day', now()) - make_interval(days => $2::int - 1),
              date_trunc('day', now()),
              '1 day'
            ) AS d(day)
       LEFT JOIN bookings b
         ON date_trunc('day', b.confirmed_at) = d.day
        AND b.organizer_id = $1
        AND b.status IN ${EARNED_STATUSES}
      GROUP BY d.day
      ORDER BY d.day ASC`,
    [organizerId, days],
  );

  return rows.map((row) => ({
    date: row.date,
    bookings: Number(row.bookings),
    tickets: Number(row.tickets),
    revenuePaise: Number(row.revenue),
  }));
}

export async function getOrganizerEventPerformance(organizerId: string, limit = 20) {
  const { rows } = await query(
    `SELECT e.id, e.title, e.slug, e.starts_at, e.status, e.total_capacity, e.tickets_sold,
            COALESCE(sum(b.total_paise) FILTER (WHERE b.status IN ${EARNED_STATUSES}), 0)::bigint AS revenue,
            COALESCE(sum(b.organizer_payout_paise) FILTER (WHERE b.status IN ${EARNED_STATUSES}), 0)::bigint AS payout,
            count(DISTINCT b.id) FILTER (WHERE b.status IN ${EARNED_STATUSES})::int AS bookings,
            (SELECT count(*)::int FROM tickets t WHERE t.event_id = e.id AND t.status = 'used') AS checked_in
       FROM events e
       LEFT JOIN bookings b ON b.event_id = e.id
      WHERE e.organizer_id = $1
      GROUP BY e.id
      ORDER BY e.starts_at DESC
      LIMIT $2`,
    [organizerId, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    startsAt: row.starts_at,
    status: row.status,
    capacity: Number(row.total_capacity),
    ticketsSold: Number(row.tickets_sold),
    bookings: Number(row.bookings),
    checkedIn: Number(row.checked_in),
    revenuePaise: Number(row.revenue),
    payoutPaise: Number(row.payout),
    sellThrough:
      Number(row.total_capacity) > 0 ? Math.round((Number(row.tickets_sold) / Number(row.total_capacity)) * 100) : 0,
  }));
}

/* ─────────────────────────── admin ─────────────────────────── */

export interface AdminSummary {
  totalUsers: number;
  totalCustomers: number;
  totalOrganizers: number;
  pendingOrganizers: number;
  totalEvents: number;
  publishedEvents: number;
  pendingEvents: number;
  totalBookings: number;
  ticketsSold: number;
  grossRevenuePaise: number;
  commissionEarnedPaise: number;
  refundedPaise: number;
  pendingRefunds: number;
  newUsersThisMonth: number;
}

export async function getAdminSummary(): Promise<AdminSummary> {
  const [users, events, bookings, refunds] = await Promise.all([
    queryOne<Record<string, number>>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE role = 'customer')::int AS customers,
              count(*) FILTER (WHERE role = 'organizer')::int AS organizers,
              count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_this_month
         FROM users WHERE status <> 'deleted'`,
    ),
    queryOne<Record<string, number>>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'published')::int AS published,
              count(*) FILTER (WHERE status = 'pending_review')::int AS pending
         FROM events`,
    ),
    queryOne<Record<string, number>>(
      `SELECT count(*)::int AS total,
              COALESCE(sum(quantity), 0)::int AS tickets,
              COALESCE(sum(total_paise), 0)::bigint AS gross,
              COALESCE(sum(commission_paise), 0)::bigint AS commission,
              COALESCE(sum(refunded_paise), 0)::bigint AS refunded
         FROM bookings WHERE status IN ${EARNED_STATUSES}`,
    ),
    queryOne<Record<string, number>>(
      `SELECT count(*) FILTER (WHERE status = 'requested')::int AS pending,
              (SELECT count(*)::int FROM organizers WHERE status = 'pending') AS pending_organizers
         FROM refunds`,
    ),
  ]);

  return {
    totalUsers: Number(users?.total ?? 0),
    totalCustomers: Number(users?.customers ?? 0),
    totalOrganizers: Number(users?.organizers ?? 0),
    newUsersThisMonth: Number(users?.new_this_month ?? 0),
    pendingOrganizers: Number(refunds?.pending_organizers ?? 0),
    totalEvents: Number(events?.total ?? 0),
    publishedEvents: Number(events?.published ?? 0),
    pendingEvents: Number(events?.pending ?? 0),
    totalBookings: Number(bookings?.total ?? 0),
    ticketsSold: Number(bookings?.tickets ?? 0),
    grossRevenuePaise: Number(bookings?.gross ?? 0),
    commissionEarnedPaise: Number(bookings?.commission ?? 0),
    refundedPaise: Number(bookings?.refunded ?? 0),
    pendingRefunds: Number(refunds?.pending ?? 0),
  };
}

export async function getAdminRevenueSeries(days = 30) {
  const { rows } = await query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
            COALESCE(sum(b.total_paise), 0)::bigint AS gross,
            COALESCE(sum(b.commission_paise), 0)::bigint AS commission,
            COALESCE(count(b.id), 0)::int AS bookings
       FROM generate_series(
              date_trunc('day', now()) - make_interval(days => $1::int - 1),
              date_trunc('day', now()),
              '1 day'
            ) AS d(day)
       LEFT JOIN bookings b
         ON date_trunc('day', b.confirmed_at) = d.day
        AND b.status IN ${EARNED_STATUSES}
      GROUP BY d.day
      ORDER BY d.day ASC`,
    [days],
  );

  return rows.map((row) => ({
    date: row.date,
    grossPaise: Number(row.gross),
    commissionPaise: Number(row.commission),
    bookings: Number(row.bookings),
  }));
}

export async function getTopEvents(limit = 10) {
  const { rows } = await query(
    `SELECT e.id, e.title, e.slug, e.starts_at, o.display_name AS organizer,
            COALESCE(sum(b.total_paise), 0)::bigint AS revenue,
            COALESCE(sum(b.quantity), 0)::int AS tickets
       FROM events e
       JOIN organizers o ON o.id = e.organizer_id
       LEFT JOIN bookings b ON b.event_id = e.id AND b.status IN ${EARNED_STATUSES}
      GROUP BY e.id, o.display_name
      HAVING COALESCE(sum(b.total_paise), 0) > 0
      ORDER BY revenue DESC
      LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    startsAt: row.starts_at,
    organizer: row.organizer,
    revenuePaise: Number(row.revenue),
    tickets: Number(row.tickets),
  }));
}

export async function getCategoryBreakdown() {
  const { rows } = await query(
    `SELECT c.name, c.slug, c.color,
            count(DISTINCT e.id)::int AS events,
            COALESCE(sum(b.quantity) FILTER (WHERE b.status IN ${EARNED_STATUSES}), 0)::int AS tickets,
            COALESCE(sum(b.total_paise) FILTER (WHERE b.status IN ${EARNED_STATUSES}), 0)::bigint AS revenue
       FROM categories c
       LEFT JOIN events e   ON e.category_id = c.id
       LEFT JOIN bookings b ON b.event_id = e.id
      GROUP BY c.id
      ORDER BY revenue DESC`,
  );

  return rows.map((row) => ({
    name: row.name,
    slug: row.slug,
    color: row.color,
    events: Number(row.events),
    tickets: Number(row.tickets),
    revenuePaise: Number(row.revenue),
  }));
}

/* ─────────────────── attendee / booking exports ─────────────────── */

export interface AttendeeRow {
  booking_code: string;
  ticket_code: string;
  attendee_name: string;
  customer_email: string;
  customer_phone: string;
  ticket_type: string;
  unit_price_paise: number;
  booking_status: string;
  ticket_status: string;
  checked_in_at: Date | null;
  booked_at: Date;
  event_title: string;
}

export async function getAttendees(filter: { eventId?: string; organizerId?: string }): Promise<AttendeeRow[]> {
  const conditions: string[] = [`b.status IN ('confirmed', 'refunded', 'partially_refunded')`];
  const values: unknown[] = [];

  if (filter.eventId) {
    values.push(filter.eventId);
    conditions.push(`t.event_id = $${values.length}`);
  }
  if (filter.organizerId) {
    values.push(filter.organizerId);
    conditions.push(`b.organizer_id = $${values.length}`);
  }

  const { rows } = await query<AttendeeRow>(
    `SELECT b.booking_code, t.ticket_code, t.attendee_name, b.customer_email, b.customer_phone,
            tt.name AS ticket_type, bi.unit_price_paise, b.status AS booking_status,
            t.status AS ticket_status, t.checked_in_at, b.created_at AS booked_at, e.title AS event_title
       FROM tickets t
       JOIN bookings b      ON b.id = t.booking_id
       JOIN booking_items bi ON bi.id = t.booking_item_id
       JOIN ticket_types tt ON tt.id = t.ticket_type_id
       JOIN events e        ON e.id = t.event_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.created_at DESC
      LIMIT 10000`,
    values,
  );
  return rows;
}
