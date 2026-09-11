-- ============================================================================
-- Merge KYC review into organizer verification.
--
-- 0013 gave the KYC submission a review status of its own, which meant an
-- organizer had two independent approvals: `organizers.status` decided whether
-- they could sell, and `organizer_kyc.status` decided whether they could be
-- paid. Two queues, two emails, and two states that could disagree — an
-- organizer verified with no bank details on file, or approved bank details
-- against an account still awaiting review.
--
-- There is now one decision. The admin approves the KYC submission and that
-- *is* the verification, so `organizers.status` is the only status: the KYC row
-- is just the evidence that was reviewed. The state the UI shows is derived —
-- no submission is "not submitted", a submission against a pending organizer is
-- "under review", and verified/rejected follow the organizer's own status.
--
-- A separate migration rather than an edit to 0013, because 0013 has already
-- been applied and the runner checksums migrations specifically to catch
-- history being rewritten underneath a deployed database.
-- ============================================================================

-- Carry any decision already recorded against a KYC row onto the organizer, so
-- nothing that was reviewed under the old two-status model is silently undone.
UPDATE organizers o
   SET status      = 'verified',
       verified_at = COALESCE(o.verified_at, k.reviewed_at, now()),
       verified_by = COALESCE(o.verified_by, k.reviewed_by),
       rejection_reason = NULL
  FROM organizer_kyc k
 WHERE k.organizer_id = o.id
   AND k.status = 'approved'
   AND o.status = 'pending';

UPDATE organizers o
   SET status           = 'rejected',
       rejection_reason = COALESCE(o.rejection_reason, k.rejection_reason)
  FROM organizer_kyc k
 WHERE k.organizer_id = o.id
   AND k.status = 'rejected'
   AND o.status = 'pending';

-- Dropping the column takes organizer_kyc_status_idx with it.
ALTER TABLE organizer_kyc
  DROP COLUMN status,
  DROP COLUMN reviewed_at,
  DROP COLUMN reviewed_by,
  DROP COLUMN rejection_reason;

DROP TYPE kyc_status;

-- The review queue is now "submitted, and the organizer is still pending",
-- ordered oldest first, so the index that matters is on submission time.
CREATE INDEX organizer_kyc_submitted_idx ON organizer_kyc (submitted_at DESC);
