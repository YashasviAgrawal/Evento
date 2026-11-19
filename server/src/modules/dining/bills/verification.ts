import crypto from 'node:crypto';

/**
 * The rotating code on a diner's payment pass.
 *
 * TOTP construction (RFC 6238 dynamic truncation over HMAC-SHA256): a fresh
 * 6-digit code every 30 seconds from a per-bill secret that never leaves the
 * server. Staff compare the code on the diner's phone with the one on their
 * own screen, so a screenshot of yesterday's — or a minute-old — payment does
 * not verify.
 */
export const STEP_SECONDS = 30;

export function newVerifySecret(): string {
  return crypto.randomBytes(20).toString('hex');
}

export function codeAt(secret: string, at: Date = new Date()): { code: string; stepEndsAt: Date } {
  const step = Math.floor(at.getTime() / 1000 / STEP_SECONDS);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return {
    code: binary.toString().padStart(6, '0'),
    stepEndsAt: new Date((step + 1) * STEP_SECONDS * 1000),
  };
}
