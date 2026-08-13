-- ============================================================================
-- Organizer-created coupons, gated behind admin approval.
--
-- Until now only admins could create coupons. Organizers running a promotion
-- on their own event had to ask the platform team to do it for them, which
-- does not scale. This lets them create their own, but nothing goes live
-- until an admin reviews it.
--
-- Existing coupons default to 'approved' so the migration cannot silently
-- switch off promotions that are already running.
-- ============================================================================

CREATE TYPE coupon_approval AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE coupons
  ADD COLUMN approval_status coupon_approval NOT NULL DEFAULT 'approved',
  -- Who authored it. NULL means an admin created it, which needs no review.
  ADD COLUMN created_by_organizer UUID REFERENCES organizers (id) ON DELETE CASCADE,
  ADD COLUMN review_note TEXT,
  ADD COLUMN reviewed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at TIMESTAMPTZ;

-- An organizer-authored coupon must be scoped to that organizer, so it can
-- never apply to somebody else's event. Enforced here rather than only in the
-- service layer, because this is a money rule.
ALTER TABLE coupons
  ADD CONSTRAINT coupons_organizer_scope
  CHECK (created_by_organizer IS NULL OR organizer_id = created_by_organizer);

-- Drives the admin review queue.
CREATE INDEX coupons_pending_idx
  ON coupons (approval_status, created_at DESC)
  WHERE approval_status = 'pending';

-- Drives the organizer's own coupon list.
CREATE INDEX coupons_organizer_idx
  ON coupons (created_by_organizer, created_at DESC)
  WHERE created_by_organizer IS NOT NULL;
