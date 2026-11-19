-- ============================================================================
-- Split the bill
--
-- A bill priced once (offers, coupon, the host's wallet) whose payable amount
-- is divided into shares. Each share is paid through its own link, by anyone
-- with a Tixit account; the bill becomes `paid` — and the ledger posts — only
-- when the last share lands. Until then the money sits in a split-collections
-- liability, so a split that never completes refunds cleanly.
-- ============================================================================

ALTER TABLE dining.bill_payments
  ADD COLUMN split_count SMALLINT NOT NULL DEFAULT 1 CHECK (split_count BETWEEN 1 AND 12),
  ADD COLUMN split_expires_at TIMESTAMPTZ,
  ADD CONSTRAINT bill_split_expiry CHECK ((split_count = 1) = (split_expires_at IS NULL));

CREATE TABLE dining.bill_shares (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_payment_id  UUID NOT NULL REFERENCES dining.bill_payments (id) ON DELETE CASCADE,
  share_no         SMALLINT NOT NULL CHECK (share_no >= 1),
  amount_paise     BIGINT NOT NULL CHECK (amount_paise > 0),
  -- The share link's secret. Unguessable; the share number alone is not enough.
  token            TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void', 'refunded')),
  -- Payment records outlive accounts (erasure anonymises users, never deletes them).
  payer_user_id    UUID REFERENCES users (id) ON DELETE RESTRICT,
  paid_at          TIMESTAMPTZ,
  refunded_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bill_payment_id, share_no),
  CHECK ((status IN ('paid', 'refunded')) = (paid_at IS NOT NULL AND payer_user_id IS NOT NULL))
);
CREATE INDEX bill_shares_bill_idx ON dining.bill_shares (bill_payment_id, share_no);

ALTER TABLE payments ADD COLUMN bill_share_id UUID REFERENCES dining.bill_shares (id) ON DELETE RESTRICT;
CREATE INDEX payments_bill_share_idx ON payments (bill_share_id) WHERE bill_share_id IS NOT NULL;
ALTER TABLE payments DROP CONSTRAINT payments_one_subject;
ALTER TABLE payments ADD CONSTRAINT payments_one_subject
  CHECK (num_nonnulls(booking_id, bill_payment_id, reservation_id, bill_share_id) = 1);

-- Who is paying. Shares are paid by friends, so the bill's owner is not
-- necessarily the payer; recorded per order, never inferred later.
ALTER TABLE payments ADD COLUMN payer_user_id UUID REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT payments_share_payer CHECK (bill_share_id IS NULL OR payer_user_id IS NOT NULL);
