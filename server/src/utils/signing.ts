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

/** A signature is always the first 32 hex characters of the HMAC. */
const QR_SIGNATURE = /^[0-9a-f]{32}$/i;

/** The 8 characters after `TKT-`, drawn from the unambiguous alphabet in ids.ts. */
const TICKET_CODE_BODY = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

/**
 * Turn what a gate attendant typed into the canonical stored ticket code.
 *
 * People read these codes off a phone screen or a printed PDF, so accept the
 * forms they actually type — lower case, missing prefix, stray spaces or
 * hyphens — and return `null` for anything that cannot be a ticket code.
 */
export function normaliseTicketCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = cleaned.startsWith('TKT') ? cleaned.slice(3) : cleaned;
  return TICKET_CODE_BODY.test(body) ? `TKT-${body}` : null;
}

export interface TicketInput {
  ticketCode: string;
  /** Present only for a scanned QR; a typed code carries no signature. */
  signature: string | null;
  source: 'qr' | 'manual';
}

/**
 * Accept either input the check-in endpoint can receive: the signed payload a
 * camera decodes (`TKT-XXXXXXXX.<signature>`) or the bare ticket code printed
 * on the ticket, which the manual-entry fallback sends.
 */
export function parseTicketInput(raw: string): TicketInput | null {
  const parsed = parseQrPayload(raw);
  if (parsed && QR_SIGNATURE.test(parsed.signature)) {
    return { ticketCode: parsed.ticketCode.trim(), signature: parsed.signature, source: 'qr' };
  }

  const code = normaliseTicketCode(raw);
  return code ? { ticketCode: code, signature: null, source: 'manual' } : null;
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
