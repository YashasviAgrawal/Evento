import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * Compare two strings without leaking length or content through timing.
 * Used for every signature/secret comparison in the codebase.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function hmacSha256(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * QR ticket signature.
 *
 * The QR encodes `code.signature`. A scanner can therefore reject a forged or
 * tampered ticket by signature alone, before any database round trip, and the
 * signature is bound to the specific event so a valid ticket for event A can
 * never be replayed at event B.
 */
export function signTicket(ticketCode: string, eventId: string): string {
  return hmacSha256(`${ticketCode}:${eventId}`, env.qr.secret).slice(0, 32);
}

export function verifyTicketSignature(ticketCode: string, eventId: string, signature: string): boolean {
  return safeEqual(signTicket(ticketCode, eventId), signature);
}

/** Payload embedded in the QR image and expected back from the scanner. */
export function buildQrPayload(ticketCode: string, eventId: string): string {
  return `${ticketCode}.${signTicket(ticketCode, eventId)}`;
}

export function parseQrPayload(payload: string): { ticketCode: string; signature: string } | null {
  const trimmed = payload.trim();
  const separator = trimmed.lastIndexOf('.');
  if (separator <= 0 || separator === trimmed.length - 1) return null;
  return { ticketCode: trimmed.slice(0, separator), signature: trimmed.slice(separator + 1) };
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
