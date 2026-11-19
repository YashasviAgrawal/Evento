import { query, queryOne } from './pool';
import { addParticipant, createFestival, setFestivalStatus } from '../modules/dining/festivals/festival.service';
import { createPromotion } from '../modules/dining/promotions/promotion.service';
import { activatePass } from '../modules/pass/pass.service';
import { readableCode } from '../utils/ids';
import { DINING_TZ } from '../modules/dining/time';

/**
 * A festival that is on right now, a sponsored listing that is live today,
 * and one Tixit Pass member — all created through the real services, so the
 * offers, ledger postings and invoices behave exactly as in production.
 */
export async function seedCampaigns(adminId: string): Promise<void> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: DINING_TZ });
  const shift = (days: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const festival = await createFestival(adminId, {
    title: 'Jaipur Winter Food Week',
    citySlug: 'jaipur',
    tagline: 'Ten days, the city’s best kitchens, festival-only prices',
    description:
      'Every restaurant in the festival has a deal you can only get these ten days — pre-book or walk in, then pay the bill on Tixit and it applies itself. Tixit is chipping in on every festival discount.',
    coverUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1600&q=75&auto=format&fit=crop',
    startsOn: shift(-2),
    endsOn: shift(7),
  });
  const participants: Array<[string, number, string]> = [
    ['Saffron Courtyard', 35, 'Royal Rajasthani thali for two'],
    ['Smokehouse 1727', 30, '12-hour brisket platter'],
    ['Lotus & Leaf', 25, 'Winter greens tasting menu'],
    ['Kesar Kitchen', 30, 'Festival biryani handi'],
  ];
  for (const [name, percent, highlight] of participants) {
    const restaurant = await queryOne<{ id: string }>('SELECT id FROM dining.restaurants WHERE name = $1', [name]);
    if (!restaurant) continue;
    await addParticipant(adminId, festival.id, {
      restaurantId: restaurant.id,
      highlight,
      kind: 'percent',
      percentOff: percent,
      appliesTo: 'both',
      // Tixit co-funds festival deals: the restaurant gives 60%, Tixit 40%.
      restaurantFundedPct: 60,
    });
  }
  await setFestivalStatus(festival.id, 'published');

  const sponsored = await queryOne<{ id: string }>(`SELECT id FROM dining.restaurants WHERE name = 'Brew Theory'`);
  if (sponsored) await createPromotion(adminId, { restaurantId: sponsored.id, startsOn: today, endsOn: shift(13), dailyPrice: 499 });

  // Aarav (customer@tixit.test) bought Tixit Pass, through the real activation path.
  const member = await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = 'customer@tixit.test'`);
  if (member) {
    const pass = await queryOne<{ id: string }>(
      `INSERT INTO memberships (code, user_id, plan, price_paise, gst_paise, days)
       VALUES ($1, $2, 'tixit_pass', 19900, 3036, 90) RETURNING id`,
      [`PASS-${readableCode(6)}`, member.id],
    );
    await query(
      `INSERT INTO payments (membership_id, provider, provider_order_id, provider_payment_id, amount_paise, status, method, captured_at)
       VALUES ($1, 'mock', $2, $3, 19900, 'success', 'upi', now())`,
      [pass!.id, `order_seed_${readableCode(10)}`, `pay_seed_${readableCode(10)}`],
    );
    await activatePass(pass!.id);
  }
}
