-- ============================================================================
-- Email verification becomes mandatory at signup.
--
-- A registration is now parked here rather than in `users` until the emailed
-- code is confirmed. An address that was never verified therefore has no
-- account at all: it cannot sign in, cannot appear in admin, and does not
-- occupy the users email/phone unique indexes. Creating the account is the
-- side effect of verifying, not of submitting the form.
--
-- Rows are short-lived. They expire on their own and the background purge job
-- deletes them, so an abandoned signup never permanently reserves an address.
-- ============================================================================

CREATE TABLE pending_registrations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      TEXT        NOT NULL,
  email          TEXT        NOT NULL,
  phone          TEXT,
  -- Already bcrypt-hashed by the app: a pending row is not a safer place to
  -- keep a plaintext password than the users table would be.
  password_hash  TEXT        NOT NULL,
  role           user_role   NOT NULL DEFAULT 'customer',
  organizer_name TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pending_registrations_email_format CHECK (position('@' IN email) > 1),
  -- Self-service signup can never mint an admin, whatever the request body says.
  CONSTRAINT pending_registrations_role_check CHECK (role <> 'admin')
);

-- One pending signup per address. Registering again before verifying replaces
-- the earlier attempt rather than leaving several rows, any of which could
-- later be claimed by a code issued for a different one.
CREATE UNIQUE INDEX pending_registrations_email_key ON pending_registrations (lower(email));
CREATE INDEX pending_registrations_expires_idx ON pending_registrations (expires_at);

CREATE TRIGGER pending_registrations_set_updated_at BEFORE UPDATE ON pending_registrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
