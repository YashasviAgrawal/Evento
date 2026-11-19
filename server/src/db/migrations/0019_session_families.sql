-- ============================================================================
-- Session families for cross-app SSO (www.tixit.in ↔ dinein.tixit.in)
--
-- Every refresh token now belongs to a *family*: the chain of tokens produced
-- by rotating the one issued at sign-in. Two things depend on it:
--
--   * Grace window. Two tabs, or the events app and the dine-in app, can wake
--     at the same instant and both present the same refresh token. The loser
--     of that race must not be signed out, so a token rotated in the last few
--     seconds may be presented again and yields a sibling in the same family.
--
--   * Reuse detection. A rotated token presented *after* the grace window is a
--     replay of a stolen credential; the whole family is revoked, which signs
--     out the thief and the victim alike and surfaces the compromise.
-- ============================================================================

ALTER TABLE refresh_tokens
  ADD COLUMN family_id     UUID,
  ADD COLUMN replaced_by   UUID REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  ADD COLUMN revoke_reason TEXT;

-- Existing tokens each become a family of one.
UPDATE refresh_tokens SET family_id = id WHERE family_id IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN family_id SET NOT NULL;

ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_revoke_reason_check
  CHECK (revoke_reason IS NULL OR revoke_reason IN ('rotated', 'logout', 'reuse', 'password_change', 'admin', 'expired'));

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id) WHERE revoked_at IS NULL;
