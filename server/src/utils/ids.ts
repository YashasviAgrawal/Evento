import crypto from 'node:crypto';

/**
 * Human-facing codes deliberately avoid the characters 0/O/1/I/L so that a
 * customer reading a booking code off a phone screen to a gate attendant is
 * not a source of errors.
 */
const READABLE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function readableCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += READABLE_ALPHABET[bytes[i]! % READABLE_ALPHABET.length];
  }
  return out;
}

/** e.g. EVT-8FK2M4 */
export function generateBookingCode(): string {
  return `EVT-${readableCode(6)}`;
}

/** e.g. TKT-9QP4X7R2 */
export function generateTicketCode(): string {
  return `TKT-${readableCode(8)}`;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Numeric OTP with a leading digit that is never zero. */
export function generateOtp(digits = 6): string {
  let otp = String(crypto.randomInt(1, 10));
  for (let i = 1; i < digits; i += 1) otp += String(crypto.randomInt(0, 10));
  return otp;
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Append a short random suffix to keep slugs unique without a lookup loop. */
export function uniqueSlug(input: string): string {
  const base = slugify(input) || 'item';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
