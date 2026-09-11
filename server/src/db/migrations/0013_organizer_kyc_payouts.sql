-- ============================================================================
-- Organizer KYC and the payout ledger.
--
-- Two concerns, deliberately kept in their own tables rather than bolted onto
-- `organizers`:
--
--   organizer_kyc      The identity and bank details an organizer must submit
--                      before any money can be sent to them, plus the admin
--                      review that clears them. One row per organizer; the
--                      absence of a row is "not submitted yet", which is why
--                      kyc_status has no 'not_submitted' member.
--
--   organizer_payouts  Every transfer the finance team actually makes, entered
--                      by hand. Payouts are settled against a running balance
--                      (lifetime earnings minus what has already been sent)
--                      rather than against individual bookings, because a bank
--                      transfer covers a period, not an order.
--
-- Bank details are snapshotted onto each payout at the moment it is recorded,
-- so a later change of account never rewrites the history of where money was
-- sent — the same reasoning as freezing commission_percent on a booking.
-- ============================================================================

CREATE TYPE kyc_status    AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE payout_method AS ENUM ('bank_transfer', 'upi', 'cheque', 'cash', 'other');
CREATE TYPE payout_status AS ENUM ('pending', 'processing', 'paid', 'failed', 'cancelled');

-- ───────────────────────── organizer KYC ──────────────────────────

CREATE TABLE organizer_kyc (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id        UUID NOT NULL UNIQUE REFERENCES organizers (id) ON DELETE CASCADE,

  -- Identity, as printed on the PAN card.
  legal_name          TEXT NOT NULL,
  pan                 TEXT NOT NULL,

  -- Business. GSTIN is optional: an organizer under the registration
  -- threshold legitimately does not have one.
  business_name       TEXT NOT NULL,
  gstin               TEXT,
  business_address    TEXT NOT NULL,

  -- Where the money goes.
  account_holder_name TEXT NOT NULL,
  account_number      TEXT NOT NULL,
  ifsc                TEXT NOT NULL,
  bank_name           TEXT,

  status              kyc_status NOT NULL DEFAULT 'pending',
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         UUID REFERENCES users (id) ON DELETE SET NULL,
  rejection_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Format checks live here as well as in the API so that a seed, an import or
  -- a hand-written UPDATE cannot park an unpayable account number in the table.
  CONSTRAINT organizer_kyc_pan_format   CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CONSTRAINT organizer_kyc_gstin_format CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2}[0-9A-Z]$'),
  CONSTRAINT organizer_kyc_ifsc_format  CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  CONSTRAINT organizer_kyc_account_format CHECK (account_number ~ '^[0-9]{9,18}$')
);

CREATE INDEX organizer_kyc_status_idx ON organizer_kyc (status, submitted_at DESC);

CREATE TRIGGER organizer_kyc_set_updated_at BEFORE UPDATE ON organizer_kyc
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────── organizer payouts ────────────────────────

CREATE TABLE organizer_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       TEXT NOT NULL UNIQUE,           -- human-facing, e.g. PAY-8FK2M4
  organizer_id    UUID NOT NULL REFERENCES organizers (id) ON DELETE CASCADE,

  -- Gross settled, and what was withheld from it. The organizer receives
  -- amount_paise - tds_paise - fee_paise.
  amount_paise    BIGINT NOT NULL CHECK (amount_paise > 0),
  tds_paise       BIGINT NOT NULL DEFAULT 0 CHECK (tds_paise >= 0),
  fee_paise       BIGINT NOT NULL DEFAULT 0 CHECK (fee_paise >= 0),

  method          payout_method NOT NULL DEFAULT 'bank_transfer',
  status          payout_status NOT NULL DEFAULT 'pending',
  utr             TEXT,                           -- bank UTR / UPI reference

  -- The settlement window this transfer covers. Optional: an ad-hoc advance
  -- has no period.
  period_start    DATE,
  period_end      DATE,

  -- Snapshot of the destination at the time of payment, taken from the KYC
  -- record. Free text because a cheque or a cash payment has no IFSC.
  destination     TEXT,

  notes           TEXT,
  paid_at         TIMESTAMPTZ,
  created_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT organizer_payouts_deductions_fit CHECK (tds_paise + fee_paise <= amount_paise),
  CONSTRAINT organizer_payouts_period_order   CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end)
);

CREATE INDEX organizer_payouts_organizer_idx ON organizer_payouts (organizer_id, created_at DESC);
CREATE INDEX organizer_payouts_status_idx    ON organizer_payouts (status, created_at DESC);

CREATE TRIGGER organizer_payouts_set_updated_at BEFORE UPDATE ON organizer_payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
