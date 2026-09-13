-- ============================================================================
-- Content management system — its own accounts, separate from platform users.
--
-- The blog already had an editor inside the admin console, reachable by anyone
-- holding the `admin` role on the `users` table. That conflates two different
-- kinds of access: the person who approves payouts and suspends accounts is not
-- necessarily the person who should be writing articles, and a freelance writer
-- should never be handed a platform admin account to publish a post.
--
-- So CMS access is a separate credential space. A cms_users row is not a users
-- row, its sessions live in their own table, and its access tokens are signed
-- with a different secret and a different audience — a platform admin token
-- presented to a /cms endpoint fails signature verification outright rather
-- than relying on a role check to catch it. Revoking someone's CMS access is
-- then a single row, with no effect on whatever else they can do on the site.
--
-- There is deliberately no public sign-up. Accounts are created by an existing
-- CMS admin, or from the command line for the first one:
--
--   npm run cms:user -- --email you@example.com --name "Your Name" --role admin
-- ============================================================================

CREATE TYPE cms_user_role   AS ENUM ('admin', 'editor');
CREATE TYPE cms_user_status AS ENUM ('active', 'suspended');

-- ────────────────────────── cms accounts ──────────────────────────

CREATE TABLE cms_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     TEXT            NOT NULL,
  email         TEXT            NOT NULL,
  -- Always set: the CMS has password login only. No OTP, no Google, no
  -- password-less path — fewer ways in is the point of a separate system.
  password_hash TEXT            NOT NULL,
  -- admin  — everything an editor can do, plus managing CMS accounts.
  -- editor — create, edit, publish and delete content.
  role          cms_user_role   NOT NULL DEFAULT 'editor',
  status        cms_user_status NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  CONSTRAINT cms_users_email_format CHECK (position('@' IN email) > 1)
);

-- Matched case-insensitively at the app layer; enforced here as the source of
-- truth, the same way users.email is.
CREATE UNIQUE INDEX cms_users_email_key ON cms_users (lower(email));

CREATE TRIGGER cms_users_set_updated_at BEFORE UPDATE ON cms_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────── cms sessions ──────────────────────────
--
-- Structurally the same as refresh_tokens, kept separate on purpose: signing a
-- CMS account out of every device must not touch that person's shopper session,
-- and a leak of one table must not yield sessions for the other.

CREATE TABLE cms_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cms_user_id  UUID        NOT NULL REFERENCES cms_users (id) ON DELETE CASCADE,
  -- SHA-256 of an opaque random token; the plaintext is never stored, so a
  -- database leak cannot be replayed as a live session.
  token_hash   TEXT        NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  user_agent   TEXT,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cms_sessions_user_idx ON cms_sessions (cms_user_id) WHERE revoked_at IS NULL;

-- ────────────────────────── activity trail ──────────────────────────
--
-- audit_logs.actor_id is a foreign key into users, so a CMS actor cannot be
-- recorded there without either breaking the constraint or losing the identity.
-- This is the same idea scoped to the CMS, and it doubles as the activity feed
-- on the dashboard — "who changed this, and when" is the first question asked
-- when an article is not what someone expected.

CREATE TABLE cms_activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cms_user_id UUID        REFERENCES cms_users (id) ON DELETE SET NULL,
  -- Denormalised so the trail still reads correctly after an account is deleted.
  actor_email TEXT,
  action      TEXT        NOT NULL,
  entity_type TEXT        NOT NULL,
  entity_id   TEXT,
  summary     TEXT,
  metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cms_activity_recent_idx ON cms_activity (created_at DESC);
CREATE INDEX cms_activity_entity_idx ON cms_activity (entity_type, entity_id, created_at DESC);

-- ───────────────────── attribution on blog posts ─────────────────────
--
-- blog_posts.author_id points at users, which a CMS account is not. This
-- records which CMS account created the post without disturbing the existing
-- column or the admin-console path that still populates it. author_name stays
-- the byline — it is editorial copy and is frequently not the account name.

ALTER TABLE blog_posts
  ADD COLUMN cms_author_id UUID REFERENCES cms_users (id) ON DELETE SET NULL;
