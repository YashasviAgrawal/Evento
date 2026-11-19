-- ============================================================================
-- Tixit Dine-in — catalog, availability, reservations, offers, bill payments
--
-- Lives in its own `dining` schema: a bounded context with a visible border.
-- Same conventions as the events schema — UUID keys, integer paise in BIGINT,
-- PostgreSQL enums, trigger-maintained updated_at — so nothing here needs a
-- second mental model.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS dining;

CREATE TYPE dining.restaurant_status  AS ENUM ('draft', 'pending_review', 'live', 'paused', 'delisted');
CREATE TYPE dining.member_role        AS ENUM ('owner', 'manager', 'host', 'cashier');
CREATE TYPE dining.reservation_status AS ENUM (
  'pending_payment', 'placed', 'confirmed', 'seated', 'completed',
  'cancelled_by_diner', 'cancelled_by_restaurant', 'no_show', 'expired'
);
CREATE TYPE dining.offer_owner        AS ENUM ('restaurant', 'platform', 'bank', 'membership');
CREATE TYPE dining.offer_kind         AS ENUM ('percent', 'flat');
CREATE TYPE dining.offer_applies      AS ENUM ('prebook', 'walkin', 'both');
CREATE TYPE dining.offer_status       AS ENUM ('draft', 'active', 'paused', 'archived');
CREATE TYPE dining.bill_status        AS ENUM (
  'pending_payment', 'paid', 'verified', 'disputed', 'failed', 'cancelled', 'refunded'
);

-- ─────────────────────────── catalog ───────────────────────────
CREATE TABLE dining.restaurants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  brand_name            TEXT,
  description           TEXT,
  city_id               UUID NOT NULL REFERENCES cities (id) ON DELETE RESTRICT,
  locality              TEXT NOT NULL,
  address               TEXT NOT NULL,
  lat                   NUMERIC(9, 6) NOT NULL,
  lng                   NUMERIC(9, 6) NOT NULL,
  phone                 TEXT,
  cost_for_two_paise    BIGINT NOT NULL CHECK (cost_for_two_paise >= 0),
  cuisines              TEXT[] NOT NULL DEFAULT '{}',
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  -- { "0": [["12:00","15:30"],["19:00","23:30"]], ... } keyed by ISO-less weekday 0=Sun.
  hours                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  cover_url             TEXT,
  logo_url              TEXT,
  status                dining.restaurant_status NOT NULL DEFAULT 'draft',
  pay_bill_enabled      BOOLEAN NOT NULL DEFAULT true,
  booking_enabled       BOOLEAN NOT NULL DEFAULT true,
  auto_accept           BOOLEAN NOT NULL DEFAULT true,
  -- Optional, opt-out, never discounted (CCPA guidelines / Delhi HC 2025).
  service_charge_percent NUMERIC(4, 2) NOT NULL DEFAULT 0 CHECK (service_charge_percent BETWEEN 0 AND 20),
  -- Commission in basis points of net sales (600 = 6%). Per outlet: commercials
  -- are negotiated per contract.
  commission_bps        INTEGER NOT NULL DEFAULT 600 CHECK (commission_bps BETWEEN 0 AND 3000),
  gstin                 TEXT,
  fssai                 TEXT,
  rating_avg            NUMERIC(2, 1) NOT NULL DEFAULT 0,
  rating_count          INTEGER NOT NULL DEFAULT 0,
  is_featured           BOOLEAN NOT NULL DEFAULT false,
  search_vector         TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', evento_tags_to_text(cuisines)), 'B') ||
    setweight(to_tsvector('simple', coalesce(locality, '') || ' ' || evento_tags_to_text(tags)), 'C') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'D')
  ) STORED,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX restaurants_city_status_idx ON dining.restaurants (city_id, status);
CREATE INDEX restaurants_geo_idx         ON dining.restaurants (city_id, lat, lng) WHERE status = 'live';
CREATE INDEX restaurants_search_idx      ON dining.restaurants USING GIN (search_vector);
CREATE INDEX restaurants_cuisines_idx    ON dining.restaurants USING GIN (cuisines);
CREATE INDEX restaurants_tags_idx        ON dining.restaurants USING GIN (tags);
CREATE TRIGGER restaurants_set_updated_at BEFORE UPDATE ON dining.restaurants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dining.restaurant_media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('cover', 'ambience', 'food', 'menu')),
  url           TEXT NOT NULL,
  caption       TEXT,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX restaurant_media_idx ON dining.restaurant_media (restaurant_id, kind, sort);

-- Partner access is a membership, not a user role: one person can be a diner,
-- an event organizer and a restaurant owner at the same time.
CREATE TABLE dining.restaurant_members (
  restaurant_id UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          dining.member_role NOT NULL,
  invited_by    UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, user_id)
);
CREATE INDEX restaurant_members_user_idx ON dining.restaurant_members (user_id);

CREATE TABLE dining.collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  city_id     UUID REFERENCES cities (id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  subtitle    TEXT,
  cover_url   TEXT,
  -- Rule-based membership: restaurants carrying ANY of these tags.
  match_tags  TEXT[] NOT NULL DEFAULT '{}',
  sort        INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER collections_set_updated_at BEFORE UPDATE ON dining.collections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ───────────────────────── availability ────────────────────────
-- Rules are what a restaurant edits; slots are what a diner books. Slots are
-- materialised from the rules on demand (idempotently), so the booking path
-- always locks a real row.
CREATE TABLE dining.inventory_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE CASCADE,
  weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  slot_minutes    SMALLINT NOT NULL DEFAULT 30 CHECK (slot_minutes IN (15, 30, 45, 60)),
  covers_per_slot SMALLINT NOT NULL CHECK (covers_per_slot > 0),
  max_party       SMALLINT NOT NULL DEFAULT 10 CHECK (max_party BETWEEN 1 AND 50),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX inventory_rules_idx ON dining.inventory_rules (restaurant_id, weekday);
CREATE TRIGGER inventory_rules_set_updated_at BEFORE UPDATE ON dining.inventory_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dining.slots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE CASCADE,
  starts_at     TIMESTAMPTZ NOT NULL,
  capacity      SMALLINT NOT NULL CHECK (capacity >= 0),
  held          SMALLINT NOT NULL DEFAULT 0 CHECK (held >= 0),
  booked        SMALLINT NOT NULL DEFAULT 0 CHECK (booked >= 0),
  max_party     SMALLINT NOT NULL DEFAULT 10,
  is_blocked    BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (restaurant_id, starts_at),
  -- The last line of defence against overbooking, whatever the code above does.
  CONSTRAINT slots_not_overbooked CHECK (held + booked <= capacity)
);

-- ─────────────────────────── offers ────────────────────────────
CREATE TABLE dining.offers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner                  dining.offer_owner NOT NULL,
  restaurant_id          UUID REFERENCES dining.restaurants (id) ON DELETE CASCADE,
  -- Set for code-redeemed offers (platform coupons); NULL for automatic ones.
  code                   TEXT,
  title                  TEXT NOT NULL,
  description            TEXT,
  kind                   dining.offer_kind NOT NULL,
  percent_off            NUMERIC(5, 2),
  flat_off_paise         BIGINT,
  max_discount_paise     BIGINT,
  min_bill_paise         BIGINT NOT NULL DEFAULT 0,
  applies_to             dining.offer_applies NOT NULL DEFAULT 'both',
  -- Local-time validity: weekdays (0=Sun) and a daily window.
  days                   SMALLINT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  start_time             TIME NOT NULL DEFAULT '00:00',
  end_time               TIME NOT NULL DEFAULT '23:59:59',
  valid_from             TIMESTAMPTZ,
  valid_until            TIMESTAMPTZ,
  per_user_limit         INTEGER CHECK (per_user_limit IS NULL OR per_user_limit > 0),
  -- Share of each rupee of discount the restaurant funds; the platform funds the rest.
  restaurant_funded_pct  SMALLINT NOT NULL DEFAULT 100 CHECK (restaurant_funded_pct BETWEEN 0 AND 100),
  terms                  TEXT,
  status                 dining.offer_status NOT NULL DEFAULT 'active',
  created_by             UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'percent' AND percent_off > 0 AND percent_off <= 100 AND flat_off_paise IS NULL)
      OR (kind = 'flat' AND flat_off_paise > 0 AND percent_off IS NULL)),
  CHECK (owner <> 'restaurant' OR restaurant_id IS NOT NULL),
  CHECK (owner = 'restaurant' OR code IS NOT NULL OR owner = 'membership'),
  CHECK (end_time > start_time)
);
CREATE UNIQUE INDEX offers_code_key ON dining.offers (upper(code)) WHERE code IS NOT NULL AND status <> 'archived';
CREATE INDEX offers_restaurant_idx  ON dining.offers (restaurant_id, status);
CREATE TRIGGER offers_set_updated_at BEFORE UPDATE ON dining.offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ───────────────────────── reservations ────────────────────────
CREATE TABLE dining.reservations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  restaurant_id   UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE RESTRICT,
  slot_id         UUID NOT NULL REFERENCES dining.slots (id) ON DELETE RESTRICT,
  starts_at       TIMESTAMPTZ NOT NULL,
  party_size      SMALLINT NOT NULL CHECK (party_size BETWEEN 1 AND 50),
  status          dining.reservation_status NOT NULL,
  -- The pre-book offer promised at booking time; honoured even if edited later.
  offer_id        UUID REFERENCES dining.offers (id) ON DELETE SET NULL,
  offer_snapshot  JSONB,
  occasion        TEXT,
  notes           TEXT,
  guest_name      TEXT NOT NULL,
  guest_phone     TEXT,
  source          TEXT NOT NULL DEFAULT 'dinein_web',
  accepted_at     TIMESTAMPTZ,
  seated_at       TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reservations_user_idx       ON dining.reservations (user_id, starts_at DESC);
CREATE INDEX reservations_restaurant_idx ON dining.reservations (restaurant_id, starts_at);
CREATE TRIGGER reservations_set_updated_at BEFORE UPDATE ON dining.reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ───────────────────────── bill payments ───────────────────────
CREATE TABLE dining.bill_payments (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                       TEXT NOT NULL UNIQUE,
  user_id                    UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  restaurant_id              UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE RESTRICT,
  reservation_id             UUID REFERENCES dining.reservations (id) ON DELETE SET NULL,
  status                     dining.bill_status NOT NULL DEFAULT 'pending_payment',
  idempotency_key            TEXT,
  -- What the diner entered.
  bill_total_paise           BIGINT NOT NULL CHECK (bill_total_paise > 0),
  non_discountable_paise     BIGINT NOT NULL DEFAULT 0 CHECK (non_discountable_paise >= 0),
  service_charge_paise       BIGINT NOT NULL DEFAULT 0 CHECK (service_charge_paise >= 0),
  tip_paise                  BIGINT NOT NULL DEFAULT 0 CHECK (tip_paise >= 0),
  -- Engine output, frozen when the bill is created.
  pricing                    JSONB NOT NULL,
  restaurant_discount_paise  BIGINT NOT NULL DEFAULT 0,
  platform_discount_paise    BIGINT NOT NULL DEFAULT 0,
  convenience_fee_paise      BIGINT NOT NULL DEFAULT 0,
  amount_payable_paise       BIGINT NOT NULL CHECK (amount_payable_paise >= 0),
  commission_base_paise      BIGINT NOT NULL DEFAULT 0,
  commission_paise           BIGINT NOT NULL DEFAULT 0,
  commission_gst_paise       BIGINT NOT NULL DEFAULT 0,
  restaurant_payout_paise    BIGINT NOT NULL DEFAULT 0,
  -- Verification at the table.
  verify_secret              TEXT NOT NULL,
  verified_by                UUID REFERENCES users (id) ON DELETE SET NULL,
  verified_at                TIMESTAMPTZ,
  verification_method        TEXT CHECK (verification_method IN ('staff', 'auto', 'pos')),
  dispute_reason             TEXT,
  paid_at                    TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (non_discountable_paise <= bill_total_paise)
);
CREATE UNIQUE INDEX bill_payments_idem_key ON dining.bill_payments (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX bill_payments_user_idx       ON dining.bill_payments (user_id, created_at DESC);
CREATE INDEX bill_payments_restaurant_idx ON dining.bill_payments (restaurant_id, paid_at DESC);
CREATE TRIGGER bill_payments_set_updated_at BEFORE UPDATE ON dining.bill_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dining.offer_redemptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id         UUID NOT NULL REFERENCES dining.offers (id) ON DELETE RESTRICT,
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  bill_payment_id  UUID NOT NULL REFERENCES dining.bill_payments (id) ON DELETE CASCADE,
  discount_paise   BIGINT NOT NULL CHECK (discount_paise >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (offer_id, bill_payment_id)
);
CREATE INDEX offer_redemptions_user_idx ON dining.offer_redemptions (offer_id, user_id);

-- One review per paid visit, which is what makes "verified diner" true.
CREATE TABLE dining.reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_payment_id  UUID NOT NULL UNIQUE REFERENCES dining.bill_payments (id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  restaurant_id    UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE CASCADE,
  rating           SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body             TEXT,
  reply            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reviews_restaurant_idx ON dining.reviews (restaurant_id, created_at DESC);

-- ─────────────────── payments: typed subjects ──────────────────
-- One payments table for every product, with a real foreign key per subject
-- instead of a polymorphic id, and a CHECK that exactly one is set.
ALTER TABLE payments ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE payments ADD COLUMN bill_payment_id UUID REFERENCES dining.bill_payments (id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_one_subject CHECK (num_nonnulls(booking_id, bill_payment_id) = 1);
CREATE INDEX payments_bill_idx ON payments (bill_payment_id, created_at DESC) WHERE bill_payment_id IS NOT NULL;

-- ─────────────────────────── settings ──────────────────────────
INSERT INTO settings (key, value, description) VALUES
  ('dining_convenience_fee_paise', '1000', 'Flat platform fee per dine-in bill, GST inclusive (paise)'),
  ('dining_auto_verify_hours', '6', 'Paid bills not disputed within this many hours are auto-verified'),
  ('dining_slot_horizon_days', '14', 'How many days ahead diners can book a table')
ON CONFLICT (key) DO NOTHING;
