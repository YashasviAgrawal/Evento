-- ============================================================================
-- Finance — a platform-wide double-entry ledger
--
-- A dine-in bill splits one payment four ways (restaurant, platform, bank,
-- tax). A single "payout" column cannot be reconciled against that, so every
-- money movement is posted as a balanced transaction instead.
--
--   amount_paise > 0  → debit      amount_paise < 0 → credit
--
-- Entries are append-only; a correction is a reversing transaction. The
-- deferred constraint trigger below guarantees every transaction sums to zero
-- at COMMIT, whatever the application code does.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS finance;

CREATE TYPE finance.account_kind AS ENUM ('asset', 'liability', 'revenue', 'expense');

CREATE TABLE finance.accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,          -- e.g. platform:gateway_clearing, restaurant:<uuid>:payable
  name        TEXT NOT NULL,
  kind        finance.account_kind NOT NULL,
  owner_type  TEXT NOT NULL CHECK (owner_type IN ('platform', 'restaurant', 'organizer', 'user', 'bank', 'tax')),
  owner_id    UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX accounts_owner_idx ON finance.accounts (owner_type, owner_id);

CREATE TABLE finance.transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT NOT NULL,           -- bill_paid, settlement, refund, …
  source_type      TEXT NOT NULL,
  source_id        UUID NOT NULL,
  idempotency_key  TEXT NOT NULL UNIQUE,    -- posting twice is a no-op
  memo             TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transactions_source_idx ON finance.transactions (source_type, source_id);

CREATE TABLE finance.entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES finance.transactions (id) ON DELETE RESTRICT,
  account_id      UUID NOT NULL REFERENCES finance.accounts (id) ON DELETE RESTRICT,
  amount_paise    BIGINT NOT NULL CHECK (amount_paise <> 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX entries_account_idx     ON finance.entries (account_id, created_at DESC);
CREATE INDEX entries_transaction_idx ON finance.entries (transaction_id);

CREATE OR REPLACE FUNCTION finance.assert_balanced() RETURNS TRIGGER AS $$
DECLARE
  total BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_paise), 0) INTO total
    FROM finance.entries WHERE transaction_id = NEW.transaction_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'Ledger transaction % does not balance (off by % paise)', NEW.transaction_id, total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER entries_balanced
  AFTER INSERT ON finance.entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance.assert_balanced();

-- Append-only: history is corrected by posting, never by editing.
CREATE OR REPLACE FUNCTION finance.forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'finance.entries is append-only; post a reversing transaction instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entries_append_only
  BEFORE UPDATE OR DELETE ON finance.entries
  FOR EACH ROW EXECUTE FUNCTION finance.forbid_mutation();

-- Settlements: a payout run pays a restaurant's payable balance.
CREATE TABLE finance.settlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       TEXT NOT NULL UNIQUE,
  restaurant_id   UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE RESTRICT,
  amount_paise    BIGINT NOT NULL CHECK (amount_paise > 0),
  utr             TEXT,
  status          TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('processing', 'paid', 'failed')),
  transaction_id  UUID REFERENCES finance.transactions (id),
  created_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX settlements_restaurant_idx ON finance.settlements (restaurant_id, created_at DESC);
