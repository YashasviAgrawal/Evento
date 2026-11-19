-- ============================================================================
-- Tixit Dine-in, phase 3: outbox, wallet & cashback, cover charges, bank
-- offers, phone sign-in support and Razorpay Route payouts.
-- ============================================================================

-- ───────────────────────────── outbox ─────────────────────────────
-- Side effects (emails, cashback) are written in the same transaction as the
-- change that causes them and dispatched afterwards, so a crash between
-- "committed" and "emailed" can never lose one. Rows are claimed with
-- FOR UPDATE SKIP LOCKED, so any number of API instances can dispatch.
CREATE TABLE outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic         TEXT NOT NULL,
  payload       JSONB NOT NULL,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  processed_at  TIMESTAMPTZ,
  dead_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at) WHERE processed_at IS NULL AND dead_at IS NULL;

-- ───────────────────────── wallet & cashback ─────────────────────────
-- Cashback is held as *lots*: each has its own release and expiry date, and
-- redemptions draw from the soonest-expiring lot first. Balances are derived,
-- never stored, so they cannot drift.
CREATE TYPE finance.wallet_credit_status AS ENUM ('pending', 'available', 'expired', 'clawed_back');

CREATE TABLE finance.wallet_credits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source_type      TEXT NOT NULL,                -- dining.bill_payment, adjustment, …
  source_id        UUID NOT NULL,
  amount_paise     BIGINT NOT NULL CHECK (amount_paise > 0),
  remaining_paise  BIGINT NOT NULL CHECK (remaining_paise >= 0),
  status           finance.wallet_credit_status NOT NULL DEFAULT 'pending',
  available_at     TIMESTAMPTZ NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id),
  CHECK (remaining_paise <= amount_paise)
);
CREATE INDEX wallet_credits_user_idx ON finance.wallet_credits (user_id, status, expires_at);
CREATE TRIGGER wallet_credits_set_updated_at BEFORE UPDATE ON finance.wallet_credits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE finance.wallet_redemptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id        UUID NOT NULL REFERENCES finance.wallet_credits (id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  bill_payment_id  UUID NOT NULL REFERENCES dining.bill_payments (id) ON DELETE CASCADE,
  amount_paise     BIGINT NOT NULL CHECK (amount_paise > 0),
  -- held while the bill is unpaid; captured on payment; released if abandoned.
  status           TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'captured', 'released')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wallet_redemptions_bill_idx ON finance.wallet_redemptions (bill_payment_id);

ALTER TABLE dining.bill_payments
  ADD COLUMN wallet_used_paise  BIGINT NOT NULL DEFAULT 0 CHECK (wallet_used_paise >= 0),
  ADD COLUMN cover_credit_paise BIGINT NOT NULL DEFAULT 0 CHECK (cover_credit_paise >= 0),
  ADD COLUMN bank_discount_paise BIGINT NOT NULL DEFAULT 0 CHECK (bank_discount_paise >= 0),
  ADD COLUMN bank_offer_id      UUID REFERENCES dining.offers (id) ON DELETE SET NULL;

-- ─────────────────────────── cover charges ───────────────────────────
-- A per-guest deposit some restaurants ask for at peak times. It is paid at
-- booking, held as a liability, and credited against the bill paid on Tixit.
-- Cancel 24 h+ ahead → refunded; later, or a no-show → kept by the restaurant.
ALTER TABLE dining.restaurants ADD COLUMN cover_charge_paise BIGINT NOT NULL DEFAULT 0 CHECK (cover_charge_paise >= 0);

CREATE TYPE dining.cover_status AS ENUM ('none', 'pending', 'paid', 'credited', 'refunded', 'forfeited');
ALTER TABLE dining.reservations
  ADD COLUMN cover_paise     BIGINT NOT NULL DEFAULT 0 CHECK (cover_paise >= 0),
  ADD COLUMN cover_status    dining.cover_status NOT NULL DEFAULT 'none',
  ADD COLUMN hold_expires_at TIMESTAMPTZ;
CREATE INDEX reservations_hold_idx ON dining.reservations (hold_expires_at) WHERE status = 'pending_payment';

-- Payments gain a third typed subject.
ALTER TABLE payments ADD COLUMN reservation_id UUID REFERENCES dining.reservations (id) ON DELETE CASCADE;
ALTER TABLE payments DROP CONSTRAINT payments_one_subject;
ALTER TABLE payments ADD CONSTRAINT payments_one_subject CHECK (num_nonnulls(booking_id, bill_payment_id, reservation_id) = 1);
CREATE INDEX payments_reservation_idx ON payments (reservation_id) WHERE reservation_id IS NOT NULL;

-- ──────────────────────────── bank offers ────────────────────────────
-- Instant discounts funded by a bank on its cards/UPI. Chosen by the diner at
-- checkout; the captured payment's instrument is checked against them.
ALTER TABLE dining.offers
  ADD COLUMN bank_name       TEXT,
  ADD COLUMN payment_methods TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE dining.offers DROP CONSTRAINT offers_check2;
ALTER TABLE dining.offers ADD CONSTRAINT offers_code_or_automatic
  CHECK (owner IN ('restaurant', 'membership') OR (owner = 'bank' AND bank_name IS NOT NULL) OR code IS NOT NULL);

-- ─────────────────────────── Razorpay Route ───────────────────────────
ALTER TABLE dining.restaurants ADD COLUMN razorpay_account_id TEXT;
ALTER TABLE finance.settlements
  ADD COLUMN method               TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'route')),
  ADD COLUMN razorpay_transfer_id TEXT UNIQUE,
  ADD COLUMN failure_reason       TEXT;

-- ───────────────────────────── settings ─────────────────────────────
INSERT INTO settings (key, value, description) VALUES
  ('dining_cashback_percent', '5', 'Cashback on dine-in bills, % of what the diner paid (excl. fee, tip, service charge)'),
  ('dining_cashback_max_paise', '15000', 'Most cashback one bill can earn (paise)'),
  ('dining_cashback_release_hours', '24', 'Cashback becomes spendable this long after a verified payment'),
  ('dining_cashback_expiry_days', '90', 'Unspent cashback expires after this many days'),
  ('dining_wallet_max_redeem_percent', '50', 'At most this % of a bill (before fee) can be paid from the Tixit Wallet')
ON CONFLICT (key) DO NOTHING;
