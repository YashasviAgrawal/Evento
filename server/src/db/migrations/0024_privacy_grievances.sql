-- ============================================================================
-- Privacy (DPDP Act 2023 / Rules 2025) and grievance redressal
--
-- Consent is an append-only log: the current state of a purpose is its latest
-- row, and history is never rewritten — which is what lets us show *when* and
-- *how* someone agreed or withdrew. Data-principal requests (access,
-- correction, erasure) and grievances are tracked with due dates, because the
-- rules give a deadline to answer.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS privacy;

CREATE TABLE privacy.consents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('marketing_email', 'marketing_messages', 'personalisation', 'analytics')),
  granted     BOOLEAN NOT NULL,
  notice_version TEXT NOT NULL,
  source      TEXT NOT NULL,             -- dinein_web, www, signup, …
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX consents_user_purpose_idx ON privacy.consents (user_id, purpose, created_at DESC);

CREATE TABLE privacy.requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference    TEXT NOT NULL UNIQUE,
  user_id      UUID REFERENCES users (id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('access', 'correction', 'erasure', 'nominate')),
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'rejected')),
  resolution   TEXT,
  due_at       TIMESTAMPTZ NOT NULL,
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX privacy_requests_open_idx ON privacy.requests (status, due_at);

CREATE TABLE privacy.grievances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     TEXT NOT NULL UNIQUE,
  user_id       UUID REFERENCES users (id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  category      TEXT NOT NULL CHECK (category IN ('payment', 'booking', 'restaurant', 'privacy', 'account', 'other')),
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  order_ref     TEXT,                   -- BIL-…, DIN-…, EVT-…
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  response      TEXT,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at        TIMESTAMPTZ NOT NULL,
  responded_at  TIMESTAMPTZ,
  responded_by  UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX grievances_open_idx ON privacy.grievances (status, due_at);
