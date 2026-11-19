/**
 * Tixit Dine-in demo data: Jaipur outlets with weekly hours, availability,
 * pre-book and walk-in offers, collections, platform coupons, a partner team,
 * and a little paid-bill and review history so every screen has something
 * real to show. Called from `seed.ts`; safe to run on a freshly cleared DB.
 */
import { query, queryOne, withTransaction } from './pool';
import { readableCode } from '../utils/ids';
import { priceBill } from '../modules/dining/offers/engine';
import { toEngineOffer, activeRestaurantOffers } from '../modules/dining/offers/offer.service';
import { newVerifySecret } from '../modules/dining/bills/verification';
import { markBillPaid } from '../modules/dining/bills/bill.service';
import { toLocalMoment } from '../modules/dining/time';
import { seedMenus } from './seed-menus';
import { PLATFORM, post } from '../modules/finance/ledger';

const img = (id: string, w = 1200) => `https://images.unsplash.com/${id}?w=${w}&q=75&auto=format&fit=crop`;

const INTERIORS = [
  'photo-1517248135467-4c7edcad34c4',
  'photo-1414235077428-338989a2e8c0',
  'photo-1555396273-367ea4eb4db5',
  'photo-1552566626-52f8b828add9',
  'photo-1559339352-11d035aa65de',
  'photo-1514933651103-005eec06c04b',
  'photo-1424847651672-bf20a4b0982b',
  'photo-1550966871-3ed3cdb5ed0c',
  'photo-1466978913421-dad2ebd01d17',
];
const FOOD = [
  'photo-1585937421612-70a008356fbe',
  'photo-1565557623262-b51c2513a641',
  'photo-1504674900247-0877df9cc836',
  'photo-1546069901-ba9599a7e63c',
  'photo-1540189549336-e6e99c3679fe',
  'photo-1482049016688-2d3e1b311543',
  'photo-1529042410759-befb1204b468',
  'photo-1600891964599-f61ba0e24092',
  'photo-1567620905732-2d1ec7ab7445',
];

type Shift = [string, string];
const LUNCH_DINNER: Shift[] = [['12:00', '15:30'], ['19:00', '23:30']];
const ALL_DAY: Shift[] = [['08:00', '23:00']];
const EVENINGS: Shift[] = [['17:00', '01:00']];

interface OfferSeed {
  title: string;
  percent?: number;
  flat?: number;
  appliesTo: 'prebook' | 'walkin' | 'both';
  days?: number[];
  start?: string;
  end?: string;
  minBill?: number;
  maxDiscount?: number;
  terms?: string;
}

interface RestaurantSeed {
  name: string;
  locality: string;
  address: string;
  lat: number;
  lng: number;
  cost: number;
  cuisines: string[];
  tags: string[];
  description: string;
  hours: Shift[];
  serviceCharge?: number;
  featured?: boolean;
  autoAccept?: boolean;
  rating: [number, number];
  offers: OfferSeed[];
}

const RESTAURANTS: RestaurantSeed[] = [
  {
    name: 'Ember & Oak',
    locality: 'C-Scheme',
    address: 'Plot 14, Prithviraj Road, C-Scheme, Jaipur 302001',
    lat: 26.9086,
    lng: 75.8017,
    cost: 1800,
    cuisines: ['Modern Indian', 'Grill', 'Cocktails'],
    tags: ['date-night', 'bar', 'fine-dine', 'live-music'],
    description:
      'Wood-fired Indian plates and a cocktail list built around Rajasthani spice. Low lights, an open kitchen, and a jazz trio on Fridays.',
    hours: [['12:30', '15:30'], ['19:00', '01:00']],
    serviceCharge: 5,
    featured: true,
    rating: [4.6, 2140],
    offers: [
      { title: 'Flat 30% off when you pre-book', percent: 30, appliesTo: 'prebook', days: [1, 2, 3, 4], terms: 'Valid on food and soft beverages.' },
      { title: '20% off on weekends before 8 PM', percent: 20, appliesTo: 'prebook', days: [0, 5, 6], start: '12:00', end: '20:00' },
      { title: '15% off the bill', percent: 15, appliesTo: 'walkin', terms: 'Not valid on alcohol.' },
    ],
  },
  {
    name: 'Terrace at Nahargarh View',
    locality: 'Amer Road',
    address: '22 Amer Road, opposite Jal Mahal, Jaipur 302002',
    lat: 26.9533,
    lng: 75.8463,
    cost: 2400,
    cuisines: ['North Indian', 'Rajasthani', 'Continental'],
    tags: ['rooftop', 'date-night', 'view', 'fine-dine'],
    description: 'An open-air terrace facing the Aravallis and the lit-up fort. Laal maas, ghewar sundaes and sunsets you will photograph.',
    hours: [['17:00', '23:59']],
    serviceCharge: 5,
    featured: true,
    rating: [4.7, 3310],
    offers: [
      { title: 'Sunset table: 25% off', percent: 25, appliesTo: 'prebook', start: '17:00', end: '19:30' },
      { title: '10% off the bill', percent: 10, appliesTo: 'walkin' },
    ],
  },
  {
    name: 'Saffron Courtyard',
    locality: 'Civil Lines',
    address: 'Haveli 7, Jacob Road, Civil Lines, Jaipur 302006',
    lat: 26.9058,
    lng: 75.7873,
    cost: 1600,
    cuisines: ['Rajasthani', 'North Indian', 'Thali'],
    tags: ['heritage', 'pure-veg', 'family'],
    description: 'A restored 1920s haveli courtyard serving royal Rajasthani thalis, dal baati churma and folk music at dinner.',
    hours: LUNCH_DINNER,
    featured: true,
    rating: [4.5, 1876],
    offers: [
      { title: 'Flat 25% off on pre-booked tables', percent: 25, appliesTo: 'prebook' },
      { title: '₹200 off on bills over ₹1,500', flat: 200, minBill: 1500, appliesTo: 'walkin' },
    ],
  },
  {
    name: 'The Indigo Room',
    locality: 'MI Road',
    address: '57 Mirza Ismail Road, Jaipur 302001',
    lat: 26.9157,
    lng: 75.8055,
    cost: 2000,
    cuisines: ['Pan-Asian', 'Sushi', 'Cocktails'],
    tags: ['bar', 'date-night', 'late-night'],
    description: 'Dim indigo booths, a sushi counter and a twelve-seat whisky bar. The miso black cod has a following.',
    hours: EVENINGS,
    serviceCharge: 7.5,
    rating: [4.4, 1290],
    offers: [
      { title: '20% off before 9 PM', percent: 20, appliesTo: 'both', start: '17:00', end: '21:00' },
    ],
  },
  {
    name: 'Kesar Kitchen',
    locality: 'Malviya Nagar',
    address: 'D-12, Malviya Nagar Main Road, Jaipur 302017',
    lat: 26.8528,
    lng: 75.8155,
    cost: 900,
    cuisines: ['North Indian', 'Mughlai', 'Biryani'],
    tags: ['family', 'casual'],
    description: 'A neighbourhood favourite for slow-cooked nihari, Lucknowi biryani and the city’s best rumali roti.',
    hours: LUNCH_DINNER,
    autoAccept: false,
    rating: [4.3, 2650],
    offers: [
      { title: 'Flat 20% off', percent: 20, appliesTo: 'both' },
    ],
  },
  {
    name: 'Brew Theory',
    locality: 'Vaishali Nagar',
    address: 'Amrapali Circle, Vaishali Nagar, Jaipur 302021',
    lat: 26.9116,
    lng: 75.7414,
    cost: 1400,
    cuisines: ['Brewpub', 'Continental', 'Finger Food'],
    tags: ['bar', 'live-music', 'late-night', 'sports'],
    description: 'Six house-brewed beers on tap, a big-screen for match nights, and wood-fired pizzas till late.',
    hours: [['12:00', '01:00']],
    rating: [4.2, 3120],
    offers: [
      { title: 'Happy hours: 30% off till 7 PM', percent: 30, appliesTo: 'both', start: '12:00', end: '19:00' },
      { title: '15% off the bill', percent: 15, appliesTo: 'walkin' },
    ],
  },
  {
    name: 'Lotus & Leaf',
    locality: 'C-Scheme',
    address: '3 Ashok Marg, C-Scheme, Jaipur 302001',
    lat: 26.9071,
    lng: 75.7989,
    cost: 1200,
    cuisines: ['Healthy', 'Cafe', 'Vegan'],
    tags: ['pure-veg', 'cafe', 'brunch', 'outdoor'],
    description: 'Sunlit garden café: grain bowls, cold brews, sourdough and an all-day brunch menu that is entirely plant-forward.',
    hours: ALL_DAY,
    rating: [4.5, 980],
    offers: [
      { title: 'Weekday brunch: 20% off', percent: 20, appliesTo: 'both', days: [1, 2, 3, 4, 5], start: '08:00', end: '13:00' },
      { title: '10% off the bill', percent: 10, appliesTo: 'walkin' },
    ],
  },
  {
    name: 'Coastal Curry Co.',
    locality: 'Tonk Road',
    address: '112 Tonk Road, near Gandhi Nagar, Jaipur 302015',
    lat: 26.8873,
    lng: 75.8073,
    cost: 1300,
    cuisines: ['South Indian', 'Seafood', 'Kerala'],
    tags: ['casual', 'family'],
    description: 'Malabar parottas, meen pollichathu and appams with stew — the Kerala coast, a long way inland.',
    hours: LUNCH_DINNER,
    rating: [4.3, 1430],
    offers: [
      { title: 'Flat 25% off on pre-booking', percent: 25, appliesTo: 'prebook' },
      { title: '15% off the bill', percent: 15, appliesTo: 'walkin', maxDiscount: 500 },
    ],
  },
  {
    name: 'Fig & Fennel',
    locality: 'Jawahar Circle',
    address: 'Pink Square Lane, Jawahar Circle, Jaipur 302017',
    lat: 26.8418,
    lng: 75.8031,
    cost: 2200,
    cuisines: ['Mediterranean', 'Italian', 'Wine Bar'],
    tags: ['date-night', 'outdoor', 'fine-dine', 'bar'],
    description: 'Handmade pastas, mezze platters and a quiet wine garden lit by string lights.',
    hours: [['12:30', '16:00'], ['19:00', '00:00']],
    serviceCharge: 5,
    rating: [4.6, 760],
    offers: [
      { title: '20% off on pre-booked dinners', percent: 20, appliesTo: 'prebook', start: '19:00', end: '23:59' },
    ],
  },
  {
    name: 'Chai Adda Social',
    locality: 'Raja Park',
    address: '45 Raja Park Main Market, Jaipur 302004',
    lat: 26.8984,
    lng: 75.8302,
    cost: 600,
    cuisines: ['Cafe', 'Street Food', 'Snacks'],
    tags: ['cafe', 'casual', 'budget'],
    description: 'Kulhad chai, bun maska and the crispiest pyaaz kachori this side of Johari Bazaar.',
    hours: ALL_DAY,
    rating: [4.1, 4020],
    offers: [
      { title: '₹75 off on bills over ₹400', flat: 75, minBill: 400, appliesTo: 'both' },
    ],
  },
  {
    name: 'Smokehouse 1727',
    locality: 'Bani Park',
    address: '8 Shiv Marg, Bani Park, Jaipur 302016',
    lat: 26.9286,
    lng: 75.7936,
    cost: 1700,
    cuisines: ['BBQ', 'American', 'Steakhouse'],
    tags: ['bar', 'sports', 'family'],
    description: 'Twelve-hour brisket, smoked jackfruit for the vegetarians and a bourbon list longer than the menu.',
    hours: LUNCH_DINNER,
    rating: [4.4, 1650],
    offers: [
      { title: 'Flat 30% off pre-booked lunches', percent: 30, appliesTo: 'prebook', start: '12:00', end: '15:30' },
      { title: '10% off the bill', percent: 10, appliesTo: 'walkin' },
    ],
  },
  {
    name: 'Mehfil Rooftop',
    locality: 'Old City',
    address: 'Above Hawa Mahal Bazaar, Badi Choupad, Jaipur 302002',
    lat: 26.9239,
    lng: 75.8267,
    cost: 1500,
    cuisines: ['Rajasthani', 'Mughlai', 'Kebabs'],
    tags: ['rooftop', 'heritage', 'view', 'live-music'],
    description: 'Kebabs off the sigri with Hawa Mahal glowing pink across the street, and ghazals every evening.',
    hours: [['16:00', '23:30']],
    rating: [4.5, 2210],
    offers: [
      { title: 'Golden hour: 25% off', percent: 25, appliesTo: 'both', start: '16:00', end: '19:00' },
      { title: '15% off pre-booked dinners', percent: 15, appliesTo: 'prebook', start: '19:00', end: '23:30' },
    ],
  },
];

const COLLECTIONS = [
  { slug: 'rooftops-of-jaipur', title: 'Rooftops of Jaipur', subtitle: 'Forts, sunsets and the Pink City lit up below', tags: ['rooftop', 'view'], cover: INTERIORS[4]! },
  { slug: 'date-night', title: 'Date-night tables', subtitle: 'Low lights, good wine, no rush', tags: ['date-night'], cover: INTERIORS[1]! },
  { slug: 'heritage-havelis', title: 'Heritage havelis', subtitle: 'Dine where the maharajas did', tags: ['heritage'], cover: INTERIORS[2]! },
  { slug: 'live-music', title: 'Live music tonight', subtitle: 'Jazz, ghazals and Friday-night bands', tags: ['live-music'], cover: INTERIORS[5]! },
  { slug: 'pure-veg', title: 'Pure veg favourites', subtitle: 'Thalis, bowls and the best of the garden', tags: ['pure-veg'], cover: FOOD[3]! },
  { slug: 'bars-and-brewpubs', title: 'Bars & brewpubs', subtitle: 'Taps, cocktails and late kitchens', tags: ['bar'], cover: INTERIORS[3]! },
];

export async function seedDining(users: { adminId: string; customerIds: string[]; passwordHash: string }): Promise<void> {
  const city = await queryOne<{ id: string }>(`SELECT id FROM cities WHERE slug = 'jaipur'`);
  if (!city) throw new Error('Jaipur missing from reference data');

  /* ── partner team (ordinary Tixit accounts — memberships grant access) ── */
  const partner = await queryOne<{ id: string }>(
    `INSERT INTO users (full_name, email, phone, password_hash, role, email_verified_at)
     VALUES ('Kabir Malhotra', 'partner@tixit.test', '9800000101', $1, 'customer', now()) RETURNING id`,
    [users.passwordHash],
  );
  const cashier = await queryOne<{ id: string }>(
    `INSERT INTO users (full_name, email, phone, password_hash, role, email_verified_at)
     VALUES ('Meera Joshi', 'cashier@tixit.test', '9800000102', $1, 'customer', now()) RETURNING id`,
    [users.passwordHash],
  );

  const restaurantIds: string[] = [];
  for (const [index, seed] of RESTAURANTS.entries()) {
    const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((day) => [String(day), seed.hours]));
    const slug = seed.name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const row = await queryOne<{ id: string }>(
      `INSERT INTO dining.restaurants (slug, name, description, city_id, locality, address, lat, lng, phone,
         cost_for_two_paise, cuisines, tags, hours, cover_url, logo_url, status, auto_accept, service_charge_percent,
         commission_bps, rating_avg, rating_count, is_featured, gstin, fssai)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'live', $16, $17, 600, $18, $19, $20,
               $21, $22)
       RETURNING id`,
      [
        `${slug}-${seed.locality.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        seed.name,
        seed.description,
        city.id,
        seed.locality,
        seed.address,
        seed.lat,
        seed.lng,
        `+91 141 ${String(4000000 + index * 7919).slice(0, 7)}`,
        seed.cost * 100,
        seed.cuisines,
        seed.tags,
        JSON.stringify(hours),
        img(INTERIORS[index % INTERIORS.length]!),
        img(FOOD[index % FOOD.length]!, 200),
        seed.autoAccept ?? true,
        seed.serviceCharge ?? 0,
        seed.rating[0],
        seed.rating[1],
        seed.featured ?? false,
        `08AABCE${String(1000 + index)}F1Z${index % 10}`,
        `1222101900${String(1000 + index)}`,
      ],
    );
    const restaurantId = row!.id;
    restaurantIds.push(restaurantId);

    const gallery = [
      img(INTERIORS[index % INTERIORS.length]!),
      img(FOOD[(index + 1) % FOOD.length]!),
      img(INTERIORS[(index + 3) % INTERIORS.length]!),
      img(FOOD[(index + 4) % FOOD.length]!),
      img(FOOD[(index + 6) % FOOD.length]!),
    ];
    for (const [sort, url] of gallery.entries()) {
      await query(
        `INSERT INTO dining.restaurant_media (restaurant_id, kind, url, sort) VALUES ($1, $2, $3, $4)`,
        [restaurantId, sort % 2 === 0 ? 'ambience' : 'food', url, sort],
      );
    }

    // Availability follows the opening hours, seating until 60–90 min before close.
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (const [open, close] of seed.hours) {
        const lastSeating = close <= open || close >= '23:30' ? '22:30' : shiftBack(close, 60);
        await query(
          `INSERT INTO dining.inventory_rules (restaurant_id, weekday, start_time, end_time, slot_minutes, covers_per_slot, max_party)
           VALUES ($1, $2, $3, $4, 30, $5, 12)`,
          [restaurantId, weekday, open, lastSeating, 16 + (index % 4) * 4],
        );
      }
    }

    for (const offer of seed.offers) {
      await query(
        `INSERT INTO dining.offers (owner, restaurant_id, title, kind, percent_off, flat_off_paise, max_discount_paise,
                                    min_bill_paise, applies_to, days, start_time, end_time, terms)
         VALUES ('restaurant', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          restaurantId,
          offer.title,
          offer.percent ? 'percent' : 'flat',
          offer.percent ?? null,
          offer.flat ? offer.flat * 100 : null,
          offer.maxDiscount ? offer.maxDiscount * 100 : null,
          (offer.minBill ?? 0) * 100,
          offer.appliesTo,
          offer.days ?? [0, 1, 2, 3, 4, 5, 6],
          offer.start ?? '00:00',
          offer.end ?? '23:59:59',
          offer.terms ?? null,
        ],
      );
    }
  }

  // The partner owns the two flagship outlets; the cashier works at one.
  await query(
    `INSERT INTO dining.restaurant_members (restaurant_id, user_id, role, invited_by) VALUES
       ($1, $3, 'owner', $5), ($2, $3, 'owner', $5), ($1, $4, 'cashier', $3)`,
    [restaurantIds[0], restaurantIds[1], partner!.id, cashier!.id, users.adminId],
  );

  for (const [sort, collection] of COLLECTIONS.entries()) {
    await query(
      `INSERT INTO dining.collections (slug, city_id, title, subtitle, cover_url, match_tags, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [collection.slug, city.id, collection.title, collection.subtitle, img(collection.cover, 900), collection.tags, sort],
    );
  }

  // Platform-funded coupons.
  await query(
    `INSERT INTO dining.offers (owner, code, title, kind, percent_off, flat_off_paise, max_discount_paise, min_bill_paise,
                                applies_to, per_user_limit, restaurant_funded_pct, terms)
     VALUES ('platform', 'TIXITDINE', '₹100 off your bill', 'flat', NULL, 10000, NULL, 80000, 'both', 3, 0,
             'On bills of ₹800 or more. Three uses per diner.'),
            ('platform', 'FIRSTBITE', '10% off your first Pay Bill', 'percent', 10, NULL, 25000, 0, 'both', 1, 0,
             'Up to ₹250 off. Once per diner.')`,
  );

  // Bank instant discounts, funded by the bank on its own cards and UPI.
  await query(
    `INSERT INTO dining.offers (owner, bank_name, payment_methods, title, kind, percent_off, flat_off_paise, max_discount_paise,
                                min_bill_paise, applies_to, per_user_limit, restaurant_funded_pct, terms)
     VALUES ('bank', 'HDFC Bank', '{credit_card}', 'HDFC credit cards: 10% off', 'percent', 10, NULL, 20000, 100000, 'both', 2, 0,
             'Up to ₹200 on bills of ₹1,000 or more. Twice a month per card.'),
            ('bank', 'ICICI Bank', '{upi,debit_card}', 'ICICI UPI & debit: ₹125 off', 'flat', NULL, 12500, NULL, 120000, 'both', NULL, 0,
             'On bills of ₹1,200 or more.')`,
  );

  // A peak-time table deposit at the rooftop: ₹250 a guest, credited to the bill.
  await query(`UPDATE dining.restaurants SET cover_charge_paise = 25000 WHERE id = $1`, [restaurantIds[1]]);

  await seedMenus(restaurantIds.map((id, i) => ({ id, cuisines: RESTAURANTS[i]!.cuisines })));
  await seedHistory(restaurantIds.slice(0, 6), users.customerIds);

  // A little spendable cashback for the demo diner, through the real ledger.
  const diner = await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = 'diya@example.com'`);
  if (diner) {
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO finance.wallet_credits (user_id, source_type, source_id, amount_paise, remaining_paise, status, available_at, expires_at)
         VALUES ($1, 'adjustment', gen_random_uuid(), 15000, 15000, 'available', now(), now() + interval '60 days') RETURNING id`,
        [diner.id],
      );
      await post(client, {
        kind: 'cashback_released',
        sourceType: 'finance.wallet_credit',
        sourceId: rows[0]!.id,
        idempotencyKey: `cashback_released:${rows[0]!.id}`,
        memo: 'Welcome cashback',
        entries: [
          { account: PLATFORM.cashbackExpense, amountPaise: 15000 },
          { account: PLATFORM.walletLiability, amountPaise: -15000 },
        ],
      });
    });
  }
}

/** "23:00" minus 60 minutes → "22:00" */
function shiftBack(time: string, minutes: number): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const total = Math.max(0, h * 60 + m - minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * A few weeks of paid, verified bills and reviews, created through the real
 * pricing engine and ledger posting so the demo balances like production.
 */
async function seedHistory(restaurantIds: string[], customerIds: string[]): Promise<void> {
  const reviews = [
    [5, 'The 30% pre-book offer applied without any fuss — paid at the table in ten seconds.'],
    [5, 'Sunset table was worth it. Staff checked the pass and we were done.'],
    [4, 'Loved the food. Service charge was optional and clearly shown, which I appreciated.'],
    [5, 'Booked at 6, seated at 8, paid on Tixit. Easiest dinner of the year.'],
    [4, 'Great cocktails. A bit loud on Friday but that is the point.'],
  ] as const;

  let n = 0;
  for (const restaurantId of restaurantIds) {
    const offers = (await activeRestaurantOffers(restaurantId)).map(toEngineOffer);
    for (let i = 0; i < 4; i += 1) {
      const userId = customerIds[(n + i) % customerIds.length]!;
      const bill = 120_000 + ((n * 37_000 + i * 21_000) % 380_000);
      // Spread over about six weeks so last month has history to invoice.
      const paidAt = new Date(Date.now() - (2 + n * 3 + i * 9) * 86_400_000);
      const pricing = priceBill({
        billTotalPaise: bill,
        nonDiscountablePaise: 0,
        keepServiceCharge: false,
        serviceChargePercent: 0,
        tipPaise: 0,
        mode: 'walkin',
        at: toLocalMoment(paidAt),
        restaurantOffers: offers,
        convenienceFeePaise: 1000,
        commissionBps: 600,
      });

      const id = await withTransaction(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO dining.bill_payments (code, user_id, restaurant_id, status, bill_total_paise, pricing,
             restaurant_discount_paise, platform_discount_paise, convenience_fee_paise, amount_payable_paise,
             commission_base_paise, commission_paise, commission_gst_paise, restaurant_payout_paise, verify_secret, created_at)
           VALUES ($1, $2, $3, 'pending_payment', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
          [
            `BIL-${readableCode(6)}`,
            userId,
            restaurantId,
            bill,
            JSON.stringify(pricing),
            pricing.restaurantFundedDiscountPaise,
            pricing.platformFundedDiscountPaise,
            pricing.convenienceFeePaise,
            pricing.amountPayablePaise,
            pricing.commissionBasePaise,
            pricing.commissionPaise,
            pricing.commissionGstPaise,
            pricing.restaurantPayoutPaise,
            newVerifySecret(),
            paidAt,
          ],
        );
        await client.query(
          `INSERT INTO payments (bill_payment_id, provider, provider_order_id, provider_payment_id, amount_paise, status, method, captured_at)
           VALUES ($1, 'mock', $2, $3, $4, 'success', 'upi', $5)`,
          [rows[0]!.id, `order_seed_${readableCode(10)}`, `pay_seed_${readableCode(10)}`, pricing.amountPayablePaise, paidAt],
        );
        return rows[0]!.id;
      });

      await markBillPaid(id, { method: 'upi', paymentId: 'seed' }, { notify: false });
      await query(
        `UPDATE dining.bill_payments SET paid_at = $2, status = 'verified', verified_at = $2, verification_method = 'staff'
          WHERE id = $1`,
        [id, paidAt],
      );
      if (i < 2) {
        const [rating, body] = reviews[(n + i) % reviews.length]!;
        const review = await queryOne<{ id: string }>(
          `INSERT INTO dining.reviews (bill_payment_id, user_id, restaurant_id, rating, body, created_at, reply, replied_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE $6::timestamptz + interval '1 day' END)
           RETURNING id`,
          [id, userId, restaurantId, rating, body, paidAt, i === 0 ? 'Thank you — see you again soon!' : null],
        );
        // Diner photos on the first review of each restaurant. The 'seed'
        // public id matches no stored file, so deleting one removes nothing.
        if (i === 0) {
          for (const photo of [FOOD[n % FOOD.length]!, FOOD[(n + 3) % FOOD.length]!]) {
            await query(
              `INSERT INTO dining.review_photos (review_id, restaurant_id, user_id, url, public_id, provider, created_at)
               VALUES ($1, $2, $3, $4, 'seed', 'local', $5)`,
              [review!.id, restaurantId, userId, img(photo, 800), paidAt],
            );
          }
        }
      }
    }
    n += 1;
  }
}
