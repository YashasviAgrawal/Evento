-- ============================================================================
-- Archived events.
--
-- An admin can archive an event to take it off the platform without deleting
-- it: it disappears from every public listing (which only show 'published')
-- but its bookings, payouts and history stay intact. `archived_from` keeps the
-- status it had so a restore puts it back exactly where it was.
-- ============================================================================

ALTER TYPE event_status ADD VALUE IF NOT EXISTS 'archived';

ALTER TABLE events ADD COLUMN IF NOT EXISTS archived_from event_status;
