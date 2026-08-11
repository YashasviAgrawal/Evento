import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/** The platform is India-first; discovery filters are evaluated in IST. */
export const DEFAULT_TZ = 'Asia/Kolkata';

export interface DateWindow {
  from: Date;
  to: Date;
}

/**
 * Resolve the PRD's quick date filters (Today / Tomorrow / This Weekend) into
 * absolute UTC instants. These must be computed in the venue timezone: "today"
 * for a customer in Mumbai is not "today" in UTC after 18:30 IST.
 */
export function resolveDateFilter(filter: string, tz: string = DEFAULT_TZ): DateWindow | null {
  const now = dayjs().tz(tz);

  switch (filter) {
    case 'today':
      return { from: now.startOf('day').toDate(), to: now.endOf('day').toDate() };

    case 'tomorrow': {
      const tomorrow = now.add(1, 'day');
      return { from: tomorrow.startOf('day').toDate(), to: tomorrow.endOf('day').toDate() };
    }

    case 'weekend': {
      // Saturday 00:00 → Sunday 23:59 of the current week. On a Saturday or
      // Sunday this returns the weekend already in progress, not the next one.
      const dayOfWeek = now.day(); // 0 = Sunday … 6 = Saturday
      const daysUntilSaturday = dayOfWeek === 0 ? -1 : 6 - dayOfWeek;
      const saturday = now.add(daysUntilSaturday, 'day').startOf('day');
      return { from: saturday.toDate(), to: saturday.add(1, 'day').endOf('day').toDate() };
    }

    case 'this_week':
      return { from: now.startOf('day').toDate(), to: now.add(7, 'day').endOf('day').toDate() };

    case 'this_month':
      return { from: now.startOf('day').toDate(), to: now.endOf('month').toDate() };

    default:
      return null;
  }
}

/** Expand a single calendar date (YYYY-MM-DD) into a full day in `tz`. */
export function dayWindow(date: string, tz: string = DEFAULT_TZ): DateWindow | null {
  const parsed = dayjs.tz(date, tz);
  if (!parsed.isValid()) return null;
  return { from: parsed.startOf('day').toDate(), to: parsed.endOf('day').toDate() };
}

export function minutesFromNow(minutes: number): Date {
  return dayjs().add(minutes, 'minute').toDate();
}

export function hoursFromNow(hours: number): Date {
  return dayjs().add(hours, 'hour').toDate();
}

export function formatEventDate(value: Date | string, tz: string = DEFAULT_TZ): string {
  return dayjs(value).tz(tz).format('ddd, D MMM YYYY · h:mm A');
}

export function isPast(value: Date | string): boolean {
  return dayjs(value).isBefore(dayjs());
}

export { dayjs };
