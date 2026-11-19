/**
 * Authentication is shared across Tixit apps (www, dine-in) through
 * `@tixit/session`: one account, one session, signed in everywhere at once.
 */
export { AuthProvider, useAuth, type VerifyPurpose } from '@tixit/session';
