-- ============================================================================
-- KYC documents: the PAN card and the GST registration certificate.
--
-- Typed numbers alone prove nothing — anyone can type a well-formed PAN. The
-- document is the evidence the admin compares them against before approving.
--
-- These are identity documents, so they are never stored at a public URL.
-- `storage_key` is a Cloudinary *private* asset id (or a filename in a private
-- local directory in development); the bytes are only ever served through the
-- API, to the organizer who uploaded them and to admins.
-- ============================================================================

CREATE TABLE kyc_documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id   UUID NOT NULL REFERENCES organizers (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('pan', 'gst')),
  storage        TEXT NOT NULL CHECK (storage IN ('cloudinary', 'local')),
  storage_key    TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL CHECK (size_bytes > 0),
  original_name  TEXT,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX kyc_documents_organizer_idx ON kyc_documents (organizer_id);

ALTER TABLE organizer_kyc
  ADD COLUMN pan_document_id UUID REFERENCES kyc_documents (id) ON DELETE SET NULL,
  ADD COLUMN gst_document_id UUID REFERENCES kyc_documents (id) ON DELETE SET NULL;

-- One PAN, one organizer account. Stops the same identity being reused to open
-- a second account after the first is suspended or declined.
CREATE UNIQUE INDEX organizer_kyc_pan_unique ON organizer_kyc (pan);
