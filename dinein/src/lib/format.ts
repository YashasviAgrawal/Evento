export { cn } from '@tixit/ui';

const TZ = 'Asia/Kolkata';

/** ₹1,840 — paise in, rupees out, no decimals unless there are paise to show. */
export function rupees(paise: number, options: { decimals?: boolean } = {}): string {
  const value = paise / 100;
  const hasPaise = options.decimals ?? !Number.isInteger(value);
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  })}`;
}

/** "19:30" → "7:30 PM" */
export function clock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Compact slot label: "7:30" with the meridiem dropped where context makes it obvious. */
export function shortClock(hhmm: string): string {
  return clock(hhmm).replace(/\s?(AM|PM)$/, '');
}

export function localDate(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days, 12));
  return date.toISOString().slice(0, 10);
}

/** Pill labels for a day strip: { top: 'Today' | 'Fri', day: '20' } */
export function dayPill(isoDate: string, today = localDate()) {
  const date = new Date(`${isoDate}T12:00:00+05:30`);
  const top =
    isoDate === today
      ? 'Today'
      : isoDate === addDays(today, 1)
        ? 'Tmrw'
        : date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: TZ });
  return { top, day: date.toLocaleDateString('en-IN', { day: 'numeric', timeZone: TZ }), month: date.toLocaleDateString('en-IN', { month: 'short', timeZone: TZ }) };
}

/** "Thu, 19 Nov · 7:30 PM" */
export function dateTime(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
  const time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
  return `${day} · ${time.toUpperCase()}`;
}

export function timeOnly(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ })
    .toUpperCase();
}

/** "Today", "Tomorrow", "Sat 21 Nov" */
export function relativeDay(iso: string): string {
  const day = localDate(new Date(iso));
  const today = localDate();
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
}

export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return relativeDay(iso);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "rooftop" → "Rooftop", "date-night" → "Date night" */
export function humanTag(tag: string): string {
  const words = tag.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "340 m" under a kilometre, "2.4 km" beyond, "12 km" once precision stops mattering. */
export function distanceLabel(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round(km * 100) * 10)} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** Minutes since local midnight in restaurant time. */
function localMinutes(now: Date): number {
  const [h = 0, m = 0] = now
    .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
    .split(':')
    .map(Number);
  return (h % 24) * 60 + m;
}

const toMinutes = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * What a diner needs at a glance: "Open now", "Closes in 25 min",
 * "Opens in 28 min", "Opens at 1:00 PM" or "Closed now".
 */
export function openStatus(
  card: { openNow: boolean; closesAt: string | null; opensAt: string | null },
  now = new Date(),
): { label: string; tone: 'open' | 'soon' | 'closed' } {
  const current = localMinutes(now);
  if (card.openNow) {
    if (card.closesAt) {
      let left = toMinutes(card.closesAt) - current;
      if (left < 0) left += 24 * 60; // closes past midnight
      if (left <= 45) return { label: `Closes in ${left} min`, tone: 'soon' };
    }
    return { label: 'Open now', tone: 'open' };
  }
  if (card.opensAt) {
    const wait = toMinutes(card.opensAt) - current;
    if (wait > 0 && wait <= 60) return { label: `Opens in ${wait} min`, tone: 'soon' };
    return { label: `Opens at ${clock(card.opensAt)}`, tone: 'closed' };
  }
  return { label: 'Closed now', tone: 'closed' };
}

/** ₹950 · ₹12k · ₹1.4L — for chart labels and tight tiles. */
export function compactRupees(paise: number): string {
  const value = paise / 100;
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(value >= 1_000_000 ? 0 : 1)}L`;
  if (value >= 1000) return `₹${Math.round(value / 1000)}k`;
  return `₹${Math.round(value)}`;
}
