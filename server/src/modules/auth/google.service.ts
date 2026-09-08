import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { UnauthorizedError, ServiceUnavailableError } from '../../utils/errors';

/**
 * Verification of the ID token that Google Identity Services hands the browser.
 *
 * The token is a JWT signed by Google. `verifyIdToken` checks the signature
 * against Google's published keys (cached by the library), the expiry, the
 * issuer, and — the part that matters most — that `aud` is our own client ID.
 * Without the audience check anyone could present a token minted for a
 * different site and sign in as its owner, so the client ID is not optional.
 */
const client = env.google.enabled ? new OAuth2Client(env.google.clientId) : null;

export interface GoogleProfile {
  /** Google's permanent subject id. Stable across email changes. */
  googleId: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
  avatarUrl: string | null;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!client || !env.google.clientId) {
    throw new ServiceUnavailableError(
      'Google sign-in is not configured on this server',
      'GOOGLE_NOT_CONFIGURED',
    );
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.google.clientId });
    payload = ticket.getPayload();
  } catch {
    // Expired, tampered with, or issued for another audience — all of which
    // are the same thing to the caller: this token cannot sign anyone in.
    throw new UnauthorizedError('Could not verify your Google sign-in', 'GOOGLE_TOKEN_INVALID');
  }

  if (!payload?.sub || !payload.email) {
    throw new UnauthorizedError('Google did not return an email address', 'GOOGLE_TOKEN_INVALID');
  }

  // An unverified Google address proves nothing about who owns the mailbox, and
  // this flow matches accounts by email. Accepting one would let someone claim
  // an existing Tixit account by attaching its address to a fresh Google
  // account they never confirmed.
  if (!payload.email_verified) {
    throw new UnauthorizedError(
      'Your Google account email is not verified. Verify it with Google and try again.',
      'GOOGLE_EMAIL_UNVERIFIED',
    );
  }

  return {
    googleId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    fullName: payload.name?.trim() || payload.email.split('@')[0],
    avatarUrl: payload.picture ?? null,
  };
}
