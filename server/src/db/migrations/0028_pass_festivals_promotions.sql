-- ============================================================================
-- Tixit Pass, food festivals and promoted listings
-- ============================================================================

-- ─────────────────────────── Tixit Pass ───────────────────────────
-- An account-wide membership. A purchase while a pass is running starts when
-- the current one ends, so renewing early never loses days. Whether someone
-- is a member is always "an active row covering now" — no expiry job needed.
CREATE TABLE memberships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  plan         TEXT NOT NULL CHECK (plan IN ('tixit_pass')),
  status       TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'active', 'cancelled')),
  price_paise  BIGINT NOT NULL CHECK (price_paise > 0),
  gst_paise    BIGINT NOT NULL CHECK (gst_paise >= 0 AND gst_paise < price_paise),
  days         INTEGER NOT NULL CHECK (days > 0),
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'active' OR (starts_at IS NOT NULL AND ends_at > starts_at AND paid_at IS NOT NULL))
);
CREATE INDEX memberships_user_idx ON memberships (user_id, status, ends_at DESC);

ALTER TABLE payments ADD COLUMN membership_id UUID REFERENCES memberships (id) ON DELETE RESTRICT;
CREATE INDEX payments_membership_idx ON payments (membership_id) WHERE membership_id IS NOT NULL;
ALTER TABLE payments DROP CONSTRAINT payments_one_subject;
ALTER TABLE payments ADD CONSTRAINT payments_one_subject
  CHECK (num_nonnulls(booking_id, bill_payment_id, reservation_id, bill_share_id, membership_id) = 1);

-- What the pass saved on a bill (the waived fee), for "your pass has paid for itself".
ALTER TABLE dining.bill_payments ADD COLUMN pass_savings_paise BIGINT NOT NULL DEFAULT 0 CHECK (pass_savings_paise >= 0);

-- ─────────────────────────── festivals ───────────────────────────
-- A dated, city-wide campaign. Each participating restaurant's festival deal
-- is an ordinary automatic offer, valid for the festival's dates, so pricing,
-- funding splits and the ledger work exactly as for any other offer.
CREATE TABLE dining.festivals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  city_id      UUID NOT NULL REFERENCES cities (id) ON DELETE RESTRICT,
  title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  tagline      TEXT CHECK (char_length(tagline) <= 140),
  description  TEXT,
  cover_url    TEXT,
  starts_on    DATE NOT NULL,
  ends_on      DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX festivals_city_idx ON dining.festivals (city_id, status, ends_on);

CREATE TABLE dining.festival_restaurants (
  festival_id    UUID NOT NULL REFERENCES dining.festivals (id) ON DELETE CASCADE,
  restaurant_id  UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE CASCADE,
  offer_id       UUID NOT NULL REFERENCES dining.offers (id) ON DELETE RESTRICT,
  highlight      TEXT CHECK (char_length(highlight) <= 120),   -- e.g. "Five-course tasting menu"
  sort           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (festival_id, restaurant_id),
  UNIQUE (offer_id)
);

-- ─────────────────────────── promoted listings ───────────────────────────
-- A restaurant pays to sit at the top of search in its city for a date range.
-- Charged up front against its payouts (posted to the ledger), invoiced with
-- the month's commission, and always labelled "Sponsored" to diners.
CREATE TABLE dining.promotions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE RESTRICT,
  starts_on          DATE NOT NULL,
  ends_on            DATE NOT NULL,
  daily_price_paise  BIGINT NOT NULL CHECK (daily_price_paise > 0),
  net_paise          BIGINT NOT NULL CHECK (net_paise > 0),
  gst_paise          BIGINT NOT NULL CHECK (gst_paise >= 0),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by         UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at       TIMESTAMPTZ,
  CHECK (ends_on >= starts_on),
  CHECK (net_paise = daily_price_paise * (ends_on - starts_on + 1))
);
CREATE INDEX promotions_live_idx ON dining.promotions (status, starts_on, ends_on);
