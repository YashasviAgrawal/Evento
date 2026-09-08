-- ============================================================================
-- "Continue with Google" sign-in.
--
-- Google's stable subject claim (`sub`) is stored rather than the email,
-- because a Google account keeps its subject for life while its address can be
-- changed by the owner. Matching on the subject is what makes a returning user
-- the same account after a rename.
--
-- `password_hash` was already nullable, so an account created through Google
-- simply has none: it signs in with Google or, after a password reset, with a
-- password too. Both routes end at the same users row.
-- ============================================================================

ALTER TABLE users ADD COLUMN google_id TEXT;

-- One Google account cannot be split across two users rows. Partial so the
-- many rows with no Google link do not collide with each other on NULL.
CREATE UNIQUE INDEX users_google_id_key ON users (google_id) WHERE google_id IS NOT NULL;
