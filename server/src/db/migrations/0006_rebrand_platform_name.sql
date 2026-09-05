-- Rebrand: the platform is Tixit, not Evento.
--
-- 0002 seeds the `settings` table with ON CONFLICT (key) DO NOTHING, so any
-- environment created before the rename keeps the original Evento values and
-- re-running 0002 will never correct them. (`support_email` was already changed
-- to the Tixit address in 0002's source, but that edit only ever reached fresh
-- databases — existing rows still read support@evento.test.) Update in place
-- rather than editing applied history.
--
-- Both updates are guarded on the old value so an admin who has already set a
-- custom name or support address in the settings console is not overwritten.
UPDATE settings
   SET value = '"Tixit"'::jsonb,
       updated_at = now()
 WHERE key = 'platform_name'
   AND value = '"Evento"'::jsonb;

UPDATE settings
   SET value = '"support@tixit.in"'::jsonb,
       updated_at = now()
 WHERE key = 'support_email'
   AND value = '"support@evento.test"'::jsonb;
