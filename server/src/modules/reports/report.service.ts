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
  pendingCoupons: number;
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
              (SELECT count(*)::int FROM organizers WHERE status = 'pending') AS pending_organizers,
              (SELECT count(*)::int FROM coupons WHERE approval_status = 'pending') AS pending_coupons
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
    pendingCoupons: Number(refunds?.pending_coupons ?? 0),
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

/* ───────────────── admin ▸ per-organizer analytics ───────────────── */

export type OrganizerSort = 'revenue' | 'commission' | 'tickets' | 'events' | 'attendance' | 'newest' | 'name';

/** Whitelisted sort expressions — the query string never reaches the SQL. */
const ORGANIZER_SORTS: Record<OrganizerSort, string> = {
  revenue: 'bk.gross DESC',
  commission: 'bk.commission DESC',
  tickets: 'bk.tickets DESC',
  events: 'ev.total_events DESC',
  attendance: '(CASE WHEN tk.issued > 0 THEN tk.used::numeric / tk.issued ELSE 0 END) DESC',
  newest: 'o.created_at DESC',
  name: 'o.display_name ASC',
};

export interface OrganizerAnalyticsRow {
  id: string;
  displayName: string;
  slug: string;
  status: string;
  logoUrl: string | null;
  commissionPercent: number | null;
  joinedAt: Date;
  verifiedAt: Date | null;
  contact: { fullName: string; email: string; phone: string | null };
  totalEvents: number;
  publishedEvents: number;
  pendingEvents: number;
  upcomingEvents: number;
  nextEventAt: Date | null;
  lastEventAt: Date | null;
  totalBookings: number;
  ticketsSold: number;
  grossRevenuePaise: number;
  commissionPaise: number;
  payoutPaise: number;
  refundedPaise: number;
  ticketsIssued: number;
  ticketsCheckedIn: number;
  attendanceRate: number;
  lastBookingAt: Date | null;
}

export interface OrganizerAnalyticsTotals {
  organizers: number;
  verified: number;
  pending: number;
  suspended: number;
  selling: number;
  grossRevenuePaise: number;
  commissionPaise: number;
  payoutPaise: number;
  refundedPaise: number;
  ticketsSold: number;
}

/**
 * The admin's organizer leaderboard: one row per organizer with the numbers
 * that decide whether to promote, chase or suspend them. Aggregates are
 * lateral-joined so a single page of organizers costs one query, and the
 * matching totals come back with it so the page header never re-derives them
 * from a truncated page.
 */
export async function getOrganizerAnalytics(filters: {
  status?: string;
  q?: string;
  sort?: OrganizerSort;
  page?: number;
  limit?: number;
}): Promise<{ organizers: OrganizerAnalyticsRow[]; totals: OrganizerAnalyticsTotals; total: number }> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`o.status = $${values.length}::organizer_status`);
  }
  if (filters.q) {
    values.push(filters.q);
    conditions.push(
      `(o.display_name ILIKE '%' || $${values.length} || '%' OR u.email ILIKE '%' || $${values.length} || '%')`,
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = ORGANIZER_SORTS[filters.sort ?? 'revenue'];
  const listValues = [...values, limit, (page - 1) * limit];

  const [list, totals] = await Promise.all([
    query(
      `SELECT o.id, o.display_name, o.slug, o.status, o.logo_url, o.commission_percent,
              o.created_at, o.verified_at,
              u.full_name, u.email, u.phone,
              ev.total_events, ev.published_events, ev.pending_events, ev.upcoming_events,
              ev.next_event_at, ev.last_event_at,
              bk.bookings, bk.tickets, bk.gross, bk.commission, bk.payout, bk.refunded, bk.last_booking_at,
              tk.issued, tk.used
         FROM organizers o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS total_events,
                  count(*) FILTER (WHERE e.status = 'published')::int AS published_events,
                  count(*) FILTER (WHERE e.status = 'pending_review')::int AS pending_events,
                  count(*) FILTER (WHERE e.status = 'published' AND e.starts_at > now())::int AS upcoming_events,
                  min(e.starts_at) FILTER (WHERE e.starts_at > now()) AS next_event_at,
                  max(e.starts_at) AS last_event_at
             FROM events e WHERE e.organizer_id = o.id
         ) ev ON TRUE
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS bookings,
                  COALESCE(sum(b.quantity), 0)::int AS tickets,
                  COALESCE(sum(b.total_paise), 0)::bigint AS gross,
                  COALESCE(sum(b.commission_paise), 0)::bigint AS commission,
                  COALESCE(sum(b.organizer_payout_paise), 0)::bigint AS payout,
                  COALESCE(sum(b.refunded_paise), 0)::bigint AS refunded,
                  max(b.confirmed_at) AS last_booking_at
             FROM bookings b WHERE b.organizer_id = o.id AND b.status IN ${EARNED_STATUSES}
         ) bk ON TRUE
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS issued, count(*) FILTER (WHERE t.status = 'used')::int AS used
             FROM tickets t JOIN bookings b2 ON b2.id = t.booking_id
            WHERE b2.organizer_id = o.id
         ) tk ON TRUE
         ${where}
         ORDER BY ${orderBy}, o.display_name ASC
         LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    ),
    queryOne<Record<string, number>>(
      `SELECT count(DISTINCT o.id)::int AS organizers,
              count(DISTINCT o.id) FILTER (WHERE o.status = 'verified')::int AS verified,
              count(DISTINCT o.id) FILTER (WHERE o.status = 'pending')::int AS pending,
              count(DISTINCT o.id) FILTER (WHERE o.status = 'suspended')::int AS suspended,
              count(DISTINCT o.id) FILTER (WHERE b.id IS NOT NULL)::int AS selling,
              COALESCE(sum(b.total_paise), 0)::bigint AS gross,
              COALESCE(sum(b.commission_paise), 0)::bigint AS commission,
              COALESCE(sum(b.organizer_payout_paise), 0)::bigint AS payout,
              COALESCE(sum(b.refunded_paise), 0)::bigint AS refunded,
              COALESCE(sum(b.quantity), 0)::int AS tickets
         FROM organizers o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN bookings b ON b.organizer_id = o.id AND b.status IN ${EARNED_STATUSES}
         ${where}`,
      values,
    ),
  ]);

  const organizers = list.rows.map((row): OrganizerAnalyticsRow => {
    const issued = Number(row.issued ?? 0);
    return {
      id: row.id,
      displayName: row.display_name,
      slug: row.slug,
      status: row.status,
      logoUrl: row.logo_url,
      commissionPercent: row.commission_percent === null ? null : Number(row.commission_percent),
      joinedAt: row.created_at,
      verifiedAt: row.verified_at,
      contact: { fullName: row.full_name, email: row.email, phone: row.phone },
      totalEvents: Number(row.total_events ?? 0),
      publishedEvents: Number(row.published_events ?? 0),
      pendingEvents: Number(row.pending_events ?? 0),
      upcomingEvents: Number(row.upcoming_events ?? 0),
      nextEventAt: row.next_event_at,
      lastEventAt: row.last_event_at,
      totalBookings: Number(row.bookings ?? 0),
      ticketsSold: Number(row.tickets ?? 0),
      grossRevenuePaise: Number(row.gross ?? 0),
      commissionPaise: Number(row.commission ?? 0),
      payoutPaise: Number(row.payout ?? 0),
      refundedPaise: Number(row.refunded ?? 0),
      ticketsIssued: issued,
      ticketsCheckedIn: Number(row.used ?? 0),
      attendanceRate: issued > 0 ? Math.round((Number(row.used ?? 0) / issued) * 100) : 0,
      lastBookingAt: row.last_booking_at,
    };
  });

  return {
    organizers,
    totals: {
      organizers: Number(totals?.organizers ?? 0),
      verified: Number(totals?.verified ?? 0),
      pending: Number(totals?.pending ?? 0),
      suspended: Number(totals?.suspended ?? 0),
      selling: Number(totals?.selling ?? 0),
      grossRevenuePaise: Number(totals?.gross ?? 0),
      commissionPaise: Number(totals?.commission ?? 0),
      payoutPaise: Number(totals?.payout ?? 0),
      refundedPaise: Number(totals?.refunded ?? 0),
      ticketsSold: Number(totals?.tickets ?? 0),
    },
    total: Number(totals?.organizers ?? 0),
  };
}

/** Revenue split across the categories one organizer actually sells in. */
async function getOrganizerCategoryBreakdown(organizerId: string) {
  const { rows } = await query(
    `SELECT c.name, c.slug, c.color,
            count(DISTINCT e.id)::int AS events,
            COALESCE(sum(b.quantity) FILTER (WHERE b.status IN ${EARNED_STATUSES}), 0)::int AS tickets,
            COALESCE(sum(b.total_paise) FILTER (WHERE b.status IN ${EARNED_STATUSES}), 0)::bigint AS revenue
       FROM events e
       JOIN categories c    ON c.id = e.category_id
       LEFT JOIN bookings b ON b.event_id = e.id
      WHERE e.organizer_id = $1
      GROUP BY c.id
      ORDER BY revenue DESC`,
    [organizerId],
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

/**
 * Everything an admin needs about one organizer on a single screen: who they
 * are, what they have sold, how their events performed and what support load
 * (refunds, coupons) they generate.
 */
export async function getOrganizerAdminReport(organizerId: string, days = 30) {
  const profile = await queryOne(
    `SELECT o.id, o.display_name, o.slug, o.bio, o.logo_url, o.website, o.support_email, o.support_phone,
            o.gstin, o.pan, o.address, o.status, o.commission_percent, o.created_at, o.verified_at,
            o.rejection_reason,
            u.id AS user_id, u.full_name, u.email, u.phone, u.status AS user_status, u.last_login_at,
            ci.name AS city_name, ci.state AS city_state
       FROM organizers o
       JOIN users u       ON u.id = o.user_id
       LEFT JOIN cities ci ON ci.id = o.city_id
      WHERE o.id = $1`,
    [organizerId],
  );
  if (!profile) return null;

  const [summary, salesSeries, events, categories, bookings, refunds, coupons] = await Promise.all([
    getOrganizerSummary(organizerId),
    getOrganizerSalesSeries(organizerId, days),
    getOrganizerEventPerformance(organizerId, 50),
    getOrganizerCategoryBreakdown(organizerId),
    query(
      `SELECT b.id, b.booking_code, b.status, b.quantity, b.total_paise, b.organizer_payout_paise,
              b.customer_name, b.customer_email, b.created_at, b.confirmed_at, e.title AS event_title
         FROM bookings b JOIN events e ON e.id = b.event_id
        WHERE b.organizer_id = $1
        ORDER BY b.created_at DESC
        LIMIT 10`,
      [organizerId],
    ),
    queryOne<Record<string, number>>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE r.status = 'requested')::int AS pending,
              count(*) FILTER (WHERE r.status = 'processed')::int AS processed,
              count(*) FILTER (WHERE r.status = 'rejected')::int AS rejected,
              COALESCE(sum(r.amount_paise) FILTER (WHERE r.status = 'processed'), 0)::bigint AS amount
         FROM refunds r JOIN bookings b ON b.id = r.booking_id
        WHERE b.organizer_id = $1`,
      [organizerId],
    ),
    queryOne<Record<string, number>>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE approval_status = 'pending')::int AS pending,
              count(*) FILTER (WHERE approval_status = 'approved')::int AS approved,
              COALESCE(sum(used_count), 0)::int AS redemptions,
              (SELECT COALESCE(sum(b.discount_paise), 0)::bigint
                 FROM bookings b
                WHERE b.organizer_id = $1 AND b.status IN ${EARNED_STATUSES}) AS discount
         FROM coupons WHERE organizer_id = $1`,
      [organizerId],
    ),
  ]);

  return {
    organizer: {
      id: profile.id,
      displayName: profile.display_name,
      slug: profile.slug,
      bio: profile.bio,
      logoUrl: profile.logo_url,
      website: profile.website,
      supportEmail: profile.support_email,
      supportPhone: profile.support_phone,
      gstin: profile.gstin,
      pan: profile.pan,
      address: profile.address,
      status: profile.status,
      commissionPercent: profile.commission_percent === null ? null : Number(profile.commission_percent),
      createdAt: profile.created_at,
      verifiedAt: profile.verified_at,
      rejectionReason: profile.rejection_reason,
      city: profile.city_name ? `${profile.city_name}, ${profile.city_state}` : null,
      user: {
        id: profile.user_id,
        fullName: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        status: profile.user_status,
        lastLoginAt: profile.last_login_at,
      },
    },
    summary,
    salesSeries,
    events,
    categories,
    recentBookings: bookings.rows.map((row) => ({
      id: row.id,
      bookingCode: row.booking_code,
      status: row.status,
      quantity: Number(row.quantity),
      totalPaise: Number(row.total_paise),
      payoutPaise: Number(row.organizer_payout_paise),
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      eventTitle: row.event_title,
    })),
    refunds: {
      total: Number(refunds?.total ?? 0),
      pending: Number(refunds?.pending ?? 0),
      processed: Number(refunds?.processed ?? 0),
      rejected: Number(refunds?.rejected ?? 0),
      amountPaise: Number(refunds?.amount ?? 0),
    },
    coupons: {
      total: Number(coupons?.total ?? 0),
      pending: Number(coupons?.pending ?? 0),
      approved: Number(coupons?.approved ?? 0),
      redemptions: Number(coupons?.redemptions ?? 0),
      discountPaise: Number(coupons?.discount ?? 0),
    },
  };
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
