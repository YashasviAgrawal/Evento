/**
 * Local-time helpers for dining.
 *
 * Restaurants open, close and run offers on the clock on their wall, not in
 * UTC. Tixit Dine-in operates in India only, so every outlet shares one zone;
 * keeping it in one constant means a multi-country launch is one change here.
 */
export const DINING_TZ = 'Asia/Kolkata';

export interface LocalMoment {
  /** 0 = Sunday … 6 = Saturday, matching PostgreSQL's EXTRACT(DOW). */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
  /** YYYY-MM-DD in local time. */
  date: string;
  instant: Date;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DINING_TZ,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function toLocalMoment(instant: Date): LocalMoment {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    weekday: WEEKDAYS[parts.weekday!] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    instant,
  };
}

/** "19:30:00" → 1170 */
export function timeToMinutes(value: string): number {
  const [h = '0', m = '0'] = value.split(':');
  return Number(h) * 60 + Number(m);
}

/** Today's date in the dining zone, YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  return toLocalMoment(now).date;
}
