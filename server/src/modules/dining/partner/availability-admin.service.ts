/**
 * Partner-side availability: weekly seating rules, closing a date, and the
 * switches that decide how bookings and payments behave.
 *
 * Changing rules never disturbs a diner who already holds a table: future
 * slots nobody has booked are dropped and re-materialised from the new rules
 * on next read; slots with bookings keep their time and only take the new
 * capacity if it still fits the covers already booked.
 */
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../../db/pool';
import { BadRequestError, NotFoundError } from '../../../utils/errors';
import { DINING_TZ } from '../time';
import { materializeSlots } from '../reservations/availability.service';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const rulesInput = z.object({
  rules: z
    .array(
      z
        .object({
          weekday: z.number().int().min(0).max(6),
          startTime: time,
          endTime: time,
          slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).default(30),
          coversPerSlot: z.number().int().min(1).max(500),
          maxParty: z.number().int().min(1).max(50).default(10),
        })
        .refine((rule) => rule.endTime > rule.startTime, { message: 'Last seating must be after the first', path: ['endTime'] }),
    )
    .max(28),
});
export type RulesInput = z.infer<typeof rulesInput>;

export const settingsInput = z.object({
  /** Per-guest table deposit in rupees; 0 means free bookings. */
  coverChargePerGuest: z.coerce.number().min(0).max(5000).optional(),
  autoAccept: z.boolean().optional(),
  bookingEnabled: z.boolean().optional(),
  payBillEnabled: z.boolean().optional(),
});

interface RuleRow {
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  covers_per_slot: number;
  max_party: number;
}

export async function getAvailability(restaurantId: string) {
  const restaurant = await queryOne<{ auto_accept: boolean; booking_enabled: boolean; pay_bill_enabled: boolean; cover_charge_paise: number }>(
    'SELECT auto_accept, booking_enabled, pay_bill_enabled, cover_charge_paise FROM dining.restaurants WHERE id = $1',
    [restaurantId],
  );
  if (!restaurant) throw new NotFoundError('Restaurant');
  const { rows } = await query<RuleRow>(
    `SELECT weekday, start_time::text AS start_time, end_time::text AS end_time, slot_minutes, covers_per_slot, max_party
       FROM dining.inventory_rules WHERE restaurant_id = $1 ORDER BY weekday, start_time`,
    [restaurantId],
  );
  const { rows: closed } = await query<{ day: string }>(
    `SELECT DISTINCT to_char((starts_at AT TIME ZONE '${DINING_TZ}')::date, 'YYYY-MM-DD') AS day
       FROM dining.slots
      WHERE restaurant_id = $1 AND is_blocked AND starts_at > now()
      ORDER BY day`,
    [restaurantId],
  );
  return {
    settings: {
      autoAccept: restaurant.auto_accept,
      bookingEnabled: restaurant.booking_enabled,
      payBillEnabled: restaurant.pay_bill_enabled,
      coverChargePerGuestPaise: Number(restaurant.cover_charge_paise),
    },
    rules: rows.map((row) => ({
      weekday: row.weekday,
      startTime: row.start_time.slice(0, 5),
      endTime: row.end_time.slice(0, 5),
      slotMinutes: row.slot_minutes,
      coversPerSlot: row.covers_per_slot,
      maxParty: row.max_party,
    })),
    closedDates: closed.map((row) => row.day),
  };
}

export async function replaceRules(restaurantId: string, input: RulesInput) {
  // Overlapping shifts on one day would generate the same slot twice.
  for (let day = 0; day < 7; day += 1) {
    const shifts = input.rules.filter((rule) => rule.weekday === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < shifts.length; i += 1) {
      if (shifts[i]!.startTime <= shifts[i - 1]!.endTime) {
        throw new BadRequestError('Two seating windows overlap on the same day', 'RULES_OVERLAP');
      }
    }
  }

  await withTransaction(async (client) => {
    await client.query('SELECT 1 FROM dining.restaurants WHERE id = $1 FOR UPDATE', [restaurantId]);
    await client.query('DELETE FROM dining.inventory_rules WHERE restaurant_id = $1', [restaurantId]);
    for (const rule of input.rules) {
      await client.query(
        `INSERT INTO dining.inventory_rules (restaurant_id, weekday, start_time, end_time, slot_minutes, covers_per_slot, max_party)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [restaurantId, rule.weekday, rule.startTime, rule.endTime, rule.slotMinutes, rule.coversPerSlot, rule.maxParty],
      );
    }
    // Untouched future slots are rebuilt from the new rules on the next read.
    // A slot any reservation points at — even a cancelled one — is history and stays.
    await client.query(
      `DELETE FROM dining.slots s
        WHERE s.restaurant_id = $1 AND s.starts_at > now() AND s.held = 0 AND s.booked = 0 AND NOT s.is_blocked
          AND NOT EXISTS (SELECT 1 FROM dining.reservations v WHERE v.slot_id = s.id)`,
      [restaurantId],
    );
    // Every surviving future slot follows the new rules: a slot on a seating
    // boundary takes the new covers (never below what is already booked); a
    // slot the rules no longer produce keeps its bookings but takes no more.
    await client.query(
      `UPDATE dining.slots s SET
         capacity = GREATEST(COALESCE(m.covers_per_slot, 0), s.booked + s.held),
         max_party = COALESCE(m.max_party, s.max_party)
         FROM dining.slots s2
         LEFT JOIN LATERAL (
           SELECT r.covers_per_slot, r.max_party FROM dining.inventory_rules r
            WHERE r.restaurant_id = s2.restaurant_id
              AND r.weekday = EXTRACT(DOW FROM s2.starts_at AT TIME ZONE '${DINING_TZ}')
              AND (s2.starts_at AT TIME ZONE '${DINING_TZ}')::time BETWEEN r.start_time AND r.end_time
              AND (EXTRACT(EPOCH FROM ((s2.starts_at AT TIME ZONE '${DINING_TZ}')::time - r.start_time)) / 60)::int
                  % r.slot_minutes = 0
            LIMIT 1
         ) m ON true
        WHERE s.id = s2.id AND s.restaurant_id = $1 AND s.starts_at > now()`,
      [restaurantId],
    );
  });
  return getAvailability(restaurantId);
}

/**
 * Close (or reopen) a whole date — a private event, a holiday. Existing
 * bookings are not cancelled here: the console lists them so staff can call.
 */
export async function setDateClosed(restaurantId: string, date: string, closed: boolean) {
  await materializeSlots([restaurantId], date);
  await query(
    `UPDATE dining.slots SET is_blocked = $3
      WHERE restaurant_id = $1 AND (starts_at AT TIME ZONE '${DINING_TZ}')::date = $2::date`,
    [restaurantId, date, closed],
  );
  const { rows } = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM dining.reservations
      WHERE restaurant_id = $1 AND status IN ('placed', 'confirmed')
        AND (starts_at AT TIME ZONE '${DINING_TZ}')::date = $2::date`,
    [restaurantId, date],
  );
  return { date, closed, existingBookings: rows[0]?.count ?? 0 };
}

export async function updateSettings(restaurantId: string, input: z.infer<typeof settingsInput>) {
  await query(
    `UPDATE dining.restaurants SET
       auto_accept = COALESCE($2, auto_accept),
       booking_enabled = COALESCE($3, booking_enabled),
       pay_bill_enabled = COALESCE($4, pay_bill_enabled),
       cover_charge_paise = COALESCE($5, cover_charge_paise)
     WHERE id = $1`,
    [
      restaurantId,
      input.autoAccept ?? null,
      input.bookingEnabled ?? null,
      input.payBillEnabled ?? null,
      input.coverChargePerGuest === undefined ? null : Math.round(input.coverChargePerGuest * 100),
    ],
  );
  return getAvailability(restaurantId);
}
