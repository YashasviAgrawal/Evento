-- Two-hour reminders for dine-in tables. The timestamp is the sent-log: the
-- reminder job claims a row with a guarded UPDATE, so a reservation can never
-- be reminded twice even with more than one API instance running the job.
ALTER TABLE dining.reservations ADD COLUMN reminded_at TIMESTAMPTZ;
CREATE INDEX reservations_reminder_idx ON dining.reservations (starts_at)
  WHERE reminded_at IS NULL AND status IN ('placed', 'confirmed');
