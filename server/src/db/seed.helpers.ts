import crypto from 'node:crypto';
import { generateTicketCode } from '../utils/ids';

export { signTicket } from '../utils/signing';

/**
 * Ticket codes in the seed are generated in a tight loop, so the birthday
 * bound on a 8-character random code is worth guarding against — a duplicate
 * would abort the whole seed on the UNIQUE constraint. A monotonic suffix
 * makes collisions impossible within a run.
 */
let counter = 0;

export function generateTicketCodeUnique(): string {
  counter += 1;
  const base = generateTicketCode();
  const suffix = counter.toString(36).toUpperCase().padStart(3, '0');
  return `${base}${suffix}`;
}

export function randomChoice<T>(items: readonly T[]): T {
  return items[crypto.randomInt(0, items.length)]!;
}
