/**
 * Seed the database with a realistic demo dataset:
 * an admin, three organizers, customers, venues across cities, ~14 events in
 * varied lifecycle states, ticket tiers, coupons, and a spread of historical
 * bookings so the dashboards and reports have something meaningful to show.
 *
 *   npm run seed          (idempotent — clears demo rows first)
 */
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { closePool, query, queryOne, withTransaction } from './pool';
import { generateBookingCode, slugify } from '../utils/ids';
import { signTicket, generateTicketCodeUnique } from './seed.helpers';
import { rupeesToPaise } from '../utils/money';
import { calculatePricing } from '../modules/bookings/pricing';

const PASSWORD = 'Password123';

interface SeedEvent {
  title: string;
  subtitle: string;
  categorySlug: string;
  citySlug: string;
  organizerIndex: number;
  daysFromNow: number;
  durationHours: number;
  banner: string;
  description: string;
  tags: string[];
  featured?: boolean;
  status?: 'draft' | 'pending_review' | 'published' | 'rejected' | 'paused';
  tiers: Array<{ name: string; kind: string; price: number; qty: number; max?: number; seats?: number }>;
}

const EVENTS: SeedEvent[] = [
  {
    title: 'Sunburn Arena ft. Alan Walker',
    subtitle: 'India tour 2026 — the biggest EDM night of the year',
    categorySlug: 'music',
    citySlug: 'mumbai',
    organizerIndex: 0,
    daysFromNow: 21,
    durationHours: 5,
    banner: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1600&q=80',
    description:
      'The world-famous Sunburn Arena returns to Mumbai with Alan Walker headlining a five-hour set. Expect a full 360° stage, pyrotechnics, and support from three of India’s finest DJs.\n\nGates open two hours before the first set. Food trucks, merchandise stalls and a licensed bar operate through the night.',
    tags: ['edm', 'concert', 'festival', 'nightlife'],
    featured: true,
    tiers: [
      { name: 'Early Bird', kind: 'early_bird', price: 1499, qty: 300, max: 4 },
      { name: 'Regular', kind: 'regular', price: 2499, qty: 1200, max: 6 },
      { name: 'VIP Lounge', kind: 'vip', price: 6999, qty: 150, max: 4 },
      { name: 'Couple Pass', kind: 'couple_pass', price: 4299, qty: 200, max: 2, seats: 2 },
    ],
  },
  {
    title: 'Zakir Khan — Papa Yaar Live',
    subtitle: 'An evening of storytelling and stand-up',
    categorySlug: 'comedy',
    citySlug: 'delhi',
    organizerIndex: 1,
    daysFromNow: 12,
    durationHours: 2,
    banner: 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=1600&q=80',
    description:
      'Sakht Launda is back with an all-new hour of material about family, growing up in Indore, and the quiet comedy of everyday life.\n\nStrictly no recording. Doors close 15 minutes after the show begins.',
    tags: ['standup', 'hindi', 'comedy'],
    featured: true,
    tiers: [
      { name: 'Silver', kind: 'regular', price: 799, qty: 400, max: 6 },
      { name: 'Gold', kind: 'regular', price: 1299, qty: 250, max: 6 },
      { name: 'Front Row VIP', kind: 'vip', price: 2499, qty: 60, max: 4 },
    ],
  },
  {
    title: 'Full-Stack AI Engineering Bootcamp',
    subtitle: 'Two days, hands-on, ship a production RAG app',
    categorySlug: 'workshop',
    citySlug: 'bengaluru',
    organizerIndex: 2,
    daysFromNow: 30,
    durationHours: 16,
    banner: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=1600&q=80',
    description:
      'A practical, code-along weekend for working engineers. Day one covers retrieval, embeddings and evaluation; day two covers agents, tool use and deploying to production.\n\nBring a laptop. All attendees receive the course repository and six months of office hours.',
    tags: ['ai', 'engineering', 'bootcamp', 'tech'],
    tiers: [
      { name: 'Early Bird', kind: 'early_bird', price: 4999, qty: 40, max: 2 },
      { name: 'Regular', kind: 'regular', price: 7999, qty: 80, max: 3 },
      { name: 'Team of 3', kind: 'group_pass', price: 19999, qty: 15, max: 2, seats: 3 },
    ],
  },
  {
    title: 'Mumbai Indians vs Chennai Super Kings',
    subtitle: 'T20 League 2026 — Match 34',
    categorySlug: 'sports',
    citySlug: 'mumbai',
    organizerIndex: 0,
    daysFromNow: 40,
    durationHours: 4,
    banner: 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=1600&q=80',
    description:
      'The rivalry that defines the league. Wankhede under lights, 33,000 fans, and two sides separated by a single point on the table.',
    tags: ['cricket', 't20', 'sports'],
    featured: true,
    tiers: [
      { name: 'North Stand', kind: 'regular', price: 1200, qty: 2000, max: 6 },
      { name: 'Grand Stand', kind: 'regular', price: 3500, qty: 1500, max: 6 },
      { name: 'Corporate Box', kind: 'vip', price: 15000, qty: 40, max: 2 },
    ],
  },
  {
    title: 'The Kite Runner — Stage Adaptation',
    subtitle: 'Khaled Hosseini’s novel, reimagined for the stage',
    categorySlug: 'theatre',
    citySlug: 'pune',
    organizerIndex: 1,
    daysFromNow: 8,
    durationHours: 3,
    banner: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=1600&q=80',
    description:
      'A haunting two-act production following Amir and Hassan from Kabul to California. English with Dari passages, surtitled throughout.',
    tags: ['theatre', 'drama', 'adaptation'],
    tiers: [
      { name: 'Balcony', kind: 'regular', price: 599, qty: 200, max: 6 },
      { name: 'Orchestra', kind: 'regular', price: 1199, qty: 300, max: 6 },
    ],
  },
  {
    title: 'Goa Sunset Sessions',
    subtitle: 'Beachfront house and downtempo, six hours',
    categorySlug: 'nightlife',
    citySlug: 'goa',
    organizerIndex: 0,
    daysFromNow: 5,
    durationHours: 6,
    banner: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1600&q=80',
    description:
      'Vagator cliffside, four back-to-back sets, and the best sunset on the west coast. Limited capacity, sand under your feet.',
    tags: ['house', 'beach', 'sunset', 'goa'],
    tiers: [
      { name: 'General', kind: 'regular', price: 999, qty: 400, max: 6 },
      { name: 'Cabana (4 pax)', kind: 'group_pass', price: 8999, qty: 20, max: 1, seats: 4 },
    ],
  },
  {
    title: 'India Design Summit 2026',
    subtitle: 'Two days on craft, systems and the future of product',
    categorySlug: 'conference',
    citySlug: 'bengaluru',
    organizerIndex: 2,
    daysFromNow: 55,
    durationHours: 18,
    banner: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1600&q=80',
    description:
      'Thirty speakers across two stages, plus workshops on design systems, research operations and AI-assisted tooling.',
    tags: ['design', 'conference', 'product'],
    tiers: [
      { name: 'Early Bird', kind: 'early_bird', price: 3499, qty: 150, max: 3 },
      { name: 'Regular', kind: 'regular', price: 5499, qty: 400, max: 5 },
      { name: 'VIP + Workshops', kind: 'vip', price: 11999, qty: 60, max: 2 },
    ],
  },
  {
    title: 'Hyderabad Street Food Carnival',
    subtitle: 'Forty stalls, one very good weekend',
    categorySlug: 'food-drink',
    citySlug: 'hyderabad',
    organizerIndex: 1,
    daysFromNow: 3,
    durationHours: 10,
    banner: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1600&q=80',
    description:
      'From Irani chai and Osmania biscuits to Korean corn dogs — forty vendors, live music, and a chilli-eating contest at 6pm sharp.',
    tags: ['food', 'family', 'weekend'],
    tiers: [
      { name: 'Entry Pass', kind: 'regular', price: 299, qty: 1500, max: 10 },
      { name: 'Tasting Trail (10 stalls)', kind: 'vip', price: 1499, qty: 200, max: 4 },
    ],
  },
  {
    title: 'Open Mic Night — Free Entry',
    subtitle: 'Poetry, music and comedy. Anyone can sign up.',
    categorySlug: 'comedy',
    citySlug: 'bengaluru',
    organizerIndex: 2,
    daysFromNow: 2,
    durationHours: 3,
    banner: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=1600&q=80',
    description:
      'Every Thursday. Five minutes on stage, no judging, no cover charge. Sign-ups open at 7pm on a first-come basis.',
    tags: ['openmic', 'free', 'community'],
    tiers: [{ name: 'Free Entry', kind: 'regular', price: 0, qty: 120, max: 4 }],
  },
  {
    title: 'Contemporary Art Biennale',
    subtitle: 'Forty artists across three floors',
    categorySlug: 'exhibition',
    citySlug: 'kolkata',
    organizerIndex: 1,
    daysFromNow: 17,
    durationHours: 9,
    banner: 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=1600&q=80',
    description:
      'A month-long survey of contemporary practice from South Asia, with daily curator-led walkthroughs at 11am and 4pm.',
    tags: ['art', 'exhibition', 'culture'],
    tiers: [
      { name: 'Day Pass', kind: 'regular', price: 349, qty: 800, max: 8 },
      { name: 'Season Pass', kind: 'vip', price: 1299, qty: 150, max: 4 },
    ],
  },
  {
    title: 'Half Marathon 2026',
    subtitle: '21K, 10K and 5K along the seafront',
    categorySlug: 'sports',
    citySlug: 'chennai',
    organizerIndex: 0,
    daysFromNow: 34,
    durationHours: 6,
    banner: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=1600&q=80',
    description:
      'Chip-timed, AIMS-certified route starting at Marina Beach. Finisher medal, tee and post-race breakfast included.',
    tags: ['running', 'marathon', 'fitness'],
    tiers: [
      { name: '5K Fun Run', kind: 'regular', price: 599, qty: 1000, max: 5 },
      { name: '10K', kind: 'regular', price: 999, qty: 800, max: 5 },
      { name: '21K Half Marathon', kind: 'regular', price: 1499, qty: 600, max: 5 },
    ],
  },
  {
    title: 'Kids Science Carnival',
    subtitle: 'Hands-on experiments for ages 6–14',
    categorySlug: 'family',
    citySlug: 'ahmedabad',
    organizerIndex: 2,
    daysFromNow: 26,
    durationHours: 7,
    banner: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=1600&q=80',
    description:
      'Rockets, slime, liquid nitrogen ice cream and a planetarium dome. Every child leaves with a take-home experiment kit.',
    tags: ['kids', 'science', 'family', 'workshop'],
    tiers: [
      { name: 'Child Entry', kind: 'regular', price: 449, qty: 500, max: 6 },
      { name: 'Family Pack (2+2)', kind: 'group_pass', price: 1399, qty: 150, max: 2, seats: 4 },
    ],
  },
  // Non-published events, so the organizer and admin dashboards have work to show.
  {
    title: 'Indie Rock Revival Night',
    subtitle: 'Four bands, one stage',
    categorySlug: 'music',
    citySlug: 'pune',
    organizerIndex: 1,
    daysFromNow: 45,
    durationHours: 4,
    banner: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1600&q=80',
    description: 'A celebration of the Indian indie scene with four of the most exciting bands touring right now.',
    tags: ['indie', 'rock', 'live'],
    status: 'pending_review',
    tiers: [
      { name: 'Regular', kind: 'regular', price: 899, qty: 350, max: 6 },
      { name: 'VIP', kind: 'vip', price: 1899, qty: 80, max: 4 },
    ],
  },
  {
    title: 'Jazz & Wine Evening',
    subtitle: 'An intimate quartet session',
    categorySlug: 'music',
    citySlug: 'delhi',
    organizerIndex: 0,
    daysFromNow: 60,
    durationHours: 3,
    banner: 'https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=1600&q=80',
    description: 'Eighty seats, one quartet, and a curated wine flight from three Indian vineyards.',
    tags: ['jazz', 'wine', 'intimate'],
    status: 'draft',
    tiers: [{ name: 'Seated', kind: 'regular', price: 2200, qty: 80, max: 4 }],
  },
];

const VENUES: Record<string, { name: string; address: string; lat: number; lng: number; capacity: number }> = {
  mumbai: { name: 'Jio World Garden, BKC', address: 'G Block, Bandra Kurla Complex', lat: 19.0662, lng: 72.8664, capacity: 20000 },
  delhi: { name: 'Siri Fort Auditorium', address: 'August Kranti Marg, Siri Fort', lat: 28.5503, lng: 77.2196, capacity: 1800 },
  bengaluru: { name: 'Manpho Convention Centre', address: '65/2 Bagalur Cross, Hebbal', lat: 13.0498, lng: 77.6205, capacity: 5000 },
  pune: { name: 'The Base — Yerwada', address: 'Airport Road, Yerwada', lat: 18.5626, lng: 73.8797, capacity: 900 },
  goa: { name: 'Vagator Cliffside Grounds', address: 'Ozran Beach Road, Vagator', lat: 15.5991, lng: 73.7402, capacity: 3000 },
  hyderabad: { name: 'Hitex Exhibition Centre', address: 'Izzat Nagar, Kothaguda', lat: 17.4787, lng: 78.3762, capacity: 8000 },
  kolkata: { name: 'Victoria Memorial Lawns', address: '1 Queens Way, Maidan', lat: 22.5448, lng: 88.3426, capacity: 4000 },
  chennai: { name: 'Marina Beach Promenade', address: 'Kamarajar Salai, Marina', lat: 13.0500, lng: 80.2824, capacity: 10000 },
  ahmedabad: { name: 'Science City Auditorium', address: 'Sola–Santej Road, Hebatpur', lat: 23.0742, lng: 72.5079, capacity: 2500 },
};

async function clearDemoData(): Promise<void> {
  logger.info('Clearing existing demo data');
  // Order matters only where ON DELETE CASCADE is absent; TRUNCATE ... CASCADE
  // handles the graph in one statement.
  await query(`
    TRUNCATE TABLE
      coupon_redemptions, payment_events, payments, refunds, tickets, booking_items, bookings,
      ticket_types, events, venues, coupons, notifications, audit_logs, otp_codes, refresh_tokens, organizers
    RESTART IDENTITY CASCADE
  `);
  await query(`DELETE FROM users WHERE email LIKE '%@evento.test' OR email LIKE '%@example.com'`);
}

async function seed(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, env.auth.bcryptRounds);

  await clearDemoData();

  /* ── users ── */
  const admin = await queryOne<{ id: string }>(
    `INSERT INTO users (full_name, email, phone, password_hash, role, email_verified_at)
     VALUES ('Platform Admin', 'admin@evento.test', '9800000001', $1, 'admin', now())
     RETURNING id`,
    [passwordHash],
  );

  const organizerSpecs = [
    { name: 'Yashasvi Agrawal', email: 'organizer@evento.test', brand: 'Nova Live Entertainment', phone: '9800000002', bio: 'India’s leading live-music promoter. 400+ shows since 2015 across 22 cities.', status: 'verified' },
    { name: 'Priya Nair', email: 'priya@evento.test', brand: 'Curtain Call Productions', phone: '9800000003', bio: 'Theatre, comedy and cultural programming with a focus on regional talent.', status: 'verified' },
    { name: 'Rahul Mehta', email: 'rahul@evento.test', brand: 'Learnscape Collective', phone: '9800000004', bio: 'Workshops, bootcamps and conferences for builders and creatives.', status: 'verified' },
    { name: 'Sana Kapoor', email: 'sana@evento.test', brand: 'Pulse Events Co.', phone: '9800000005', bio: 'Newly registered organizer awaiting verification.', status: 'pending' },
  ];

  const organizers: Array<{ id: string; userId: string; brand: string }> = [];
  for (const spec of organizerSpecs) {
    const user = await queryOne<{ id: string }>(
      `INSERT INTO users (full_name, email, phone, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, $4, 'organizer', now()) RETURNING id`,
      [spec.name, spec.email, spec.phone, passwordHash],
    );
    const org = await queryOne<{ id: string }>(
      `INSERT INTO organizers (user_id, display_name, slug, bio, support_email, support_phone, status,
                               verified_at, verified_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::organizer_status, $8, $9)
       RETURNING id`,
      [
        user!.id,
        spec.brand,
        slugify(spec.brand),
        spec.bio,
        spec.email,
        spec.phone,
        spec.status,
        spec.status === 'verified' ? new Date() : null,
        spec.status === 'verified' ? admin!.id : null,
      ],
    );
    organizers.push({ id: org!.id, userId: user!.id, brand: spec.brand });
  }

  const customerSpecs = [
    ['Aarav Sharma', 'customer@evento.test', '9900000001'],
    ['Diya Patel', 'diya@example.com', '9900000002'],
    ['Kabir Singh', 'kabir@example.com', '9900000003'],
    ['Meera Iyer', 'meera@example.com', '9900000004'],
    ['Arjun Reddy', 'arjun@example.com', '9900000005'],
    ['Ananya Bose', 'ananya@example.com', '9900000006'],
  ];
  const customers: string[] = [];
  for (const [name, email, phone] of customerSpecs) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO users (full_name, email, phone, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, $4, 'customer', now()) RETURNING id`,
      [name, email, phone, passwordHash],
    );
    customers.push(row!.id);
  }

  /* ── lookups ── */
  const { rows: cityRows } = await query<{ id: string; slug: string }>('SELECT id, slug FROM cities');
  const cityBySlug = new Map(cityRows.map((row) => [row.slug, row.id]));
  const { rows: categoryRows } = await query<{ id: string; slug: string }>('SELECT id, slug FROM categories');
  const categoryBySlug = new Map(categoryRows.map((row) => [row.slug, row.id]));

  /* ── venues ── */
  const venueByCity = new Map<string, string>();
  for (const [citySlug, venue] of Object.entries(VENUES)) {
    const cityId = cityBySlug.get(citySlug);
    if (!cityId) continue;
    const row = await queryOne<{ id: string }>(
      `INSERT INTO venues (organizer_id, name, address_line1, city_id, latitude, longitude, capacity, google_maps_url)
       VALUES (NULL, $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        venue.name,
        venue.address,
        cityId,
        venue.lat,
        venue.lng,
        venue.capacity,
        `https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lng}`,
      ],
    );
    venueByCity.set(citySlug, row!.id);
  }

  /* ── events + ticket types ── */
  const createdEvents: Array<{ id: string; organizerId: string; status: string; tiers: string[] }> = [];

  for (const spec of EVENTS) {
    const startsAt = new Date(Date.now() + spec.daysFromNow * 86_400_000);
    startsAt.setHours(19, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + spec.durationHours * 3_600_000);
    const status = spec.status ?? 'published';

    const event = await queryOne<{ id: string }>(
      `INSERT INTO events (organizer_id, title, slug, subtitle, description, category_id, venue_id, city_id,
                           banner_url, thumbnail_url, starts_at, ends_at, doors_open_at, duration_minutes,
                           status, is_featured, terms, tags, submitted_at, approved_at, published_at, approved_by,
                           view_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14::event_status,$15,$16,$17,$18,$19,$19,$20,$21)
       RETURNING id`,
      [
        organizers[spec.organizerIndex]!.id,
        spec.title,
        slugify(spec.title),
        spec.subtitle,
        spec.description,
        categoryBySlug.get(spec.categorySlug),
        venueByCity.get(spec.citySlug),
        cityBySlug.get(spec.citySlug),
        spec.banner,
        startsAt,
        endsAt,
        new Date(startsAt.getTime() - 3_600_000),
        spec.durationHours * 60,
        status,
        spec.featured ?? false,
        'Tickets are non-transferable. Carry a valid photo ID. Outside food and beverages are not permitted. The organizer reserves the right of admission.',
        spec.tags,
        status === 'draft' ? null : new Date(Date.now() - 5 * 86_400_000),
        status === 'published' ? new Date(Date.now() - 4 * 86_400_000) : null,
        status === 'published' ? admin!.id : null,
        Math.floor(Math.random() * 4000) + 200,
      ],
    );

    const tierIds: string[] = [];
    for (const [index, tier] of spec.tiers.entries()) {
      const row = await queryOne<{ id: string }>(
        `INSERT INTO ticket_types (event_id, name, kind, price_paise, quantity_total, min_per_order,
                                   max_per_order, seats_per_ticket, display_order, sale_ends_at, description)
         VALUES ($1,$2,$3::ticket_kind,$4,$5,1,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          event!.id,
          tier.name,
          tier.kind,
          rupeesToPaise(tier.price),
          tier.qty,
          tier.max ?? 10,
          tier.seats ?? 1,
          index,
          endsAt,
          tier.seats && tier.seats > 1 ? `Admits ${tier.seats} people` : null,
        ],
      );
      tierIds.push(row!.id);
    }

    await withTransaction(async (client) => {
      const { recalculateEventAggregates } = await import('../modules/events/event.service');
      await recalculateEventAggregates(client, event!.id);
    });

    createdEvents.push({
      id: event!.id,
      organizerId: organizers[spec.organizerIndex]!.id,
      status,
      tiers: tierIds,
    });
  }

  /* ── coupons ── */
  await query(
    `INSERT INTO coupons (code, description, type, value, max_discount_paise, min_order_paise,
                          usage_limit_total, usage_limit_per_user, valid_until, created_by, is_active)
     VALUES
       ('WELCOME10', '10% off your first booking',        'percent', 10, $1, $2, 1000, 1, now() + INTERVAL '90 days', $5, true),
       ('FLAT200',   E'\\u20B9200 off orders above \\u20B91000', 'flat', $3, NULL, $4, 500, 2, now() + INTERVAL '60 days', $5, true),
       ('EVENTO25',  '25% off, up to \\u20B9500',          'percent', 25, $6, $2, 200, 1, now() + INTERVAL '30 days', $5, true),
       ('EXPIRED50', 'Expired test coupon',                'percent', 50, NULL, 0, 100, 1, now() - INTERVAL '1 day',  $5, true)`,
    [
      rupeesToPaise(1000),
      rupeesToPaise(500),
      rupeesToPaise(200),
      rupeesToPaise(1000),
      admin!.id,
      rupeesToPaise(500),
    ],
  );

  /* ── historical bookings ── */
  const publishedEvents = createdEvents.filter((event) => event.status === 'published');
  let bookingCount = 0;

  for (const event of publishedEvents) {
    // A varying number of bookings per event so charts and "trending" differ.
    const bookings = 3 + Math.floor(Math.random() * 8);

    for (let i = 0; i < bookings; i += 1) {
      const customerId = customers[Math.floor(Math.random() * customers.length)]!;
      const tierId = event.tiers[Math.floor(Math.random() * event.tiers.length)]!;
      const quantity = 1 + Math.floor(Math.random() * 3);
      const daysAgo = Math.floor(Math.random() * 28);

      await withTransaction(async (client) => {
        const { rows: tierRows } = await client.query<{
          id: string;
          name: string;
          price_paise: number;
          quantity_total: number;
          quantity_sold: number;
          max_per_order: number;
        }>(
          'SELECT id, name, price_paise, quantity_total, quantity_sold, max_per_order FROM ticket_types WHERE id = $1 FOR UPDATE',
          [tierId],
        );
        const tier = tierRows[0]!;
        if (Number(tier.quantity_sold) + quantity > Number(tier.quantity_total)) return;

        const breakdown = calculatePricing(
          [
            {
              ticketTypeId: tier.id,
              name: tier.name,
              unitPricePaise: Number(tier.price_paise),
              quantity,
              subtotalPaise: Number(tier.price_paise) * quantity,
            },
          ],
          0,
          { taxPercent: 18, convenienceFeePercent: 2, commissionPercent: 10 },
        );

        const confirmedAt = new Date(Date.now() - daysAgo * 86_400_000);
        const { rows: bookingRows } = await client.query<{ id: string }>(
          `INSERT INTO bookings (booking_code, user_id, event_id, organizer_id, status, quantity,
                                 subtotal_paise, discount_paise, tax_paise, convenience_fee_paise, total_paise,
                                 commission_percent, commission_paise, organizer_payout_paise,
                                 customer_name, customer_email, customer_phone, confirmed_at, created_at)
           SELECT $1, $2, $3, $4, 'confirmed', $5, $6, 0, $7, $8, $9, 10, $10, $11,
                  u.full_name, u.email, COALESCE(u.phone, '9900000000'), $12, $12
             FROM users u WHERE u.id = $2
           RETURNING id`,
          [
            generateBookingCode(),
            customerId,
            event.id,
            event.organizerId,
            quantity,
            breakdown.subtotalPaise,
            breakdown.taxPaise,
            breakdown.convenienceFeePaise,
            breakdown.totalPaise,
            breakdown.commissionPaise,
            breakdown.organizerPayoutPaise,
            confirmedAt,
          ],
        );
        const bookingId = bookingRows[0]!.id;

        const { rows: itemRows } = await client.query<{ id: string }>(
          `INSERT INTO booking_items (booking_id, ticket_type_id, ticket_type_name, unit_price_paise, quantity, subtotal_paise)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [bookingId, tier.id, tier.name, tier.price_paise, quantity, Number(tier.price_paise) * quantity],
        );

        await client.query('UPDATE ticket_types SET quantity_sold = quantity_sold + $2 WHERE id = $1', [
          tier.id,
          quantity,
        ]);
        await client.query('UPDATE events SET tickets_sold = tickets_sold + $2 WHERE id = $1', [event.id, quantity]);

        // Issue the tickets; check a share of them in so attendance reports
        // are not uniformly zero.
        for (let t = 0; t < quantity; t += 1) {
          const ticketCode = generateTicketCodeUnique();
          const checkedIn = Math.random() < 0.35;
          await client.query(
            `INSERT INTO tickets (ticket_code, booking_id, booking_item_id, event_id, ticket_type_id,
                                  attendee_name, seat_label, qr_signature, status, checked_in_at)
             SELECT $1, $2, $3, $4, $5, u.full_name, $6, $7, $8::ticket_status, $9
               FROM users u WHERE u.id = $10`,
            [
              ticketCode,
              bookingId,
              itemRows[0]!.id,
              event.id,
              tier.id,
              tier.name,
              signTicket(ticketCode, event.id),
              checkedIn ? 'used' : 'valid',
              checkedIn ? confirmedAt : null,
              customerId,
            ],
          );
        }

        await client.query(
          `INSERT INTO payments (booking_id, provider, provider_order_id, provider_payment_id, amount_paise,
                                 status, method, captured_at, created_at)
           VALUES ($1, 'razorpay', $2, $3, $4, 'success', $5::payment_method, $6, $6)`,
          [
            bookingId,
            `order_seed_${bookingId.slice(0, 12)}`,
            `pay_seed_${bookingId.slice(0, 12)}`,
            breakdown.totalPaise,
            ['upi', 'credit_card', 'debit_card', 'netbanking'][Math.floor(Math.random() * 4)],
            confirmedAt,
          ],
        );

        bookingCount += 1;
      });
    }
  }

  /* ── a pending refund so the admin queue is not empty ── */
  const refundTarget = await queryOne<{ id: string; total_paise: number; user_id: string }>(
    `SELECT b.id, b.total_paise, b.user_id FROM bookings b WHERE b.status = 'confirmed' ORDER BY b.created_at DESC LIMIT 1`,
  );
  if (refundTarget) {
    const payment = await queryOne<{ id: string }>('SELECT id FROM payments WHERE booking_id = $1 LIMIT 1', [
      refundTarget.id,
    ]);
    await query(
      `INSERT INTO refunds (booking_id, payment_id, requested_by, amount_paise, reason, status)
       VALUES ($1, $2, $3, $4, 'Unable to attend due to a schedule conflict', 'requested')`,
      [refundTarget.id, payment?.id ?? null, refundTarget.user_id, refundTarget.total_paise],
    );
  }

  logger.info(
    {
      admins: 1,
      organizers: organizers.length,
      customers: customers.length,
      events: createdEvents.length,
      bookings: bookingCount,
    },
    'Seed complete',
  );

  process.stdout.write(`
┌──────────────────────────────────────────────────────────────┐
│  Evento demo accounts — password for all: ${PASSWORD}      │
├──────────────────────────────────────────────────────────────┤
│  Admin      admin@evento.test                                │
│  Organizer  organizer@evento.test   (verified)               │
│             priya@evento.test       (verified)               │
│             rahul@evento.test       (verified)               │
│             sana@evento.test        (pending verification)   │
│  Customer   customer@evento.test                             │
│             diya@example.com                                 │
├──────────────────────────────────────────────────────────────┤
│  Coupons    WELCOME10 · FLAT200 · EVENTO25                   │
└──────────────────────────────────────────────────────────────┘
`);
}

if (require.main === module) {
  seed()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (err) => {
      logger.error({ err }, 'Seeding failed');
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}

export { seed };
