import { addDays, format, formatDistanceToNowStrict, isPast, isSameDay, parseISO } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Money always arrives as integer paise; rupees exist only for display. */
export function formatMoney(paise: number, options: { compact?: boolean; withDecimals?: boolean } = {}): string {
  const rupees = paise / 100;
  if (options.compact && rupees >= 100000) {
    return `₹${(rupees / 100000).toFixed(rupees >= 1000000 ? 0 : 1)}L`;
  }
  if (options.compact && rupees >= 1000) {
    return `₹${(rupees / 1000).toFixed(rupees >= 10000 ? 0 : 1)}K`;
  }
  // Never hide paise: rounding ₹3.75 to ₹4 makes the rows disagree with the total.
  const showDecimals = options.withDecimals || paise % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(rupees);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

/** India Standard Time, UTC+5:30 with no daylight saving. */
const IST_OFFSET_MINUTES = 330;

/**
 * Shift an instant so date-fns `format`, which reads the runtime's local
 * timezone, prints IST wall-clock time. Without this a server rendering in
 * UTC shows a 6:30 PM event as 1:00 PM. Use only for display, never for
 * comparing instants.
 */
function toIst(value: string | Date): Date {
  const date = toDate(value);
  return new Date(date.getTime() + (IST_OFFSET_MINUTES + date.getTimezoneOffset()) * 60_000);
}

export function formatEventDate(value: string | Date): string {
  return format(toIst(value), 'EEE, d MMM yyyy');
}

export function formatEventTime(value: string | Date): string {
  return format(toIst(value), 'h:mm a');
}

export function formatEventDateTime(value: string | Date): string {
  return format(toIst(value), "EEE, d MMM yyyy 'at' h:mm a");
}

export function formatShortDate(value: string | Date): string {
  return format(toIst(value), 'd MMM');
}

export function formatDateTime(value: string | Date): string {
  return format(toIst(value), 'd MMM yyyy, h:mm a');
}

/** "Today", "Tomorrow", or a short date — what a listing card should show. */
export function friendlyDate(value: string | Date): string {
  const date = toIst(value);
  const today = toIst(new Date());
  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, addDays(today, 1))) return 'Tomorrow';
  return format(date, 'EEE, d MMM');
}

export function timeUntil(value: string | Date): string {
  const date = toDate(value);
  if (isPast(date)) return 'Started';
  return `in ${formatDistanceToNowStrict(date)}`;
}

export function isEventPast(value: string | Date): boolean {
  return isPast(toDate(value));
}

/** Price label for an event card: "Free", "₹500", or "₹500 onwards". */
export function priceLabel(minPaise: number, maxPaise: number, isFree: boolean): string {
  if (isFree || maxPaise === 0) return 'Free';
  if (minPaise === maxPaise) return formatMoney(minPaise);
  return `${formatMoney(minPaise)} onwards`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-ink-100 text-ink-700 ring-ink-200',
  pending_review: 'bg-amber-50 text-amber-700 ring-amber-200',
  published: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
  paused: 'bg-orange-50 text-orange-700 ring-orange-200',
  completed: 'bg-sky-50 text-sky-700 ring-sky-200',
  cancelled: 'bg-ink-100 text-ink-600 ring-ink-200',
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  expired: 'bg-ink-100 text-ink-600 ring-ink-200',
  refunded: 'bg-violet-50 text-violet-700 ring-violet-200',
  partially_refunded: 'bg-violet-50 text-violet-700 ring-violet-200',
  verified: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  suspended: 'bg-rose-50 text-rose-700 ring-rose-200',
  requested: 'bg-amber-50 text-amber-700 ring-amber-200',
  approved: 'bg-sky-50 text-sky-700 ring-sky-200',
  processed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  valid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  used: 'bg-sky-50 text-sky-700 ring-sky-200',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  archived: 'bg-ink-100 text-ink-600 ring-ink-200',
  // Payouts and KYC
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  processing: 'bg-sky-50 text-sky-700 ring-sky-200',
  failed: 'bg-rose-50 text-rose-700 ring-rose-200',
  not_submitted: 'bg-ink-100 text-ink-600 ring-ink-200',
};

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
