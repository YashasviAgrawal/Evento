-- ============================================================================
-- Commission tax invoices
--
-- Tixit's commission is a taxable supply to each restaurant, invoiced monthly.
-- Invoice numbers are consecutive within a financial year (CGST Rule 46), and
-- every invoice snapshots both parties' tax details, its lines and its totals,
-- so editing a restaurant later never changes what was issued.
-- ============================================================================

ALTER TABLE dining.restaurants
  ADD COLUMN legal_name TEXT,
  ADD COLUMN billing_address TEXT;

-- New writes must carry a well-formed GSTIN; existing rows are left as they are.
ALTER TABLE dining.restaurants
  ADD CONSTRAINT restaurants_gstin_format
  CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2}[0-9A-Z]$') NOT VALID;

CREATE TABLE finance.invoice_sequences (
  fy        TEXT PRIMARY KEY,               -- '2026-27'
  last_seq  INTEGER NOT NULL CHECK (last_seq >= 0)
);

CREATE TABLE finance.invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           TEXT NOT NULL UNIQUE CHECK (char_length(number) <= 16),
  fy               TEXT NOT NULL,
  seq              INTEGER NOT NULL,
  -- A tax invoice needs the supplier's GSTIN; without one the document is a
  -- commission statement and says so.
  kind             TEXT NOT NULL CHECK (kind IN ('tax_invoice', 'statement')),
  restaurant_id    UUID NOT NULL REFERENCES dining.restaurants (id) ON DELETE RESTRICT,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  supplier         JSONB NOT NULL,
  recipient        JSONB NOT NULL,
  place_of_supply  TEXT NOT NULL,           -- GST state code, e.g. '08'
  sac              TEXT NOT NULL,
  lines            JSONB NOT NULL,
  taxable_paise    BIGINT NOT NULL CHECK (taxable_paise > 0),
  cgst_paise       BIGINT NOT NULL CHECK (cgst_paise >= 0),
  sgst_paise       BIGINT NOT NULL CHECK (sgst_paise >= 0),
  igst_paise       BIGINT NOT NULL CHECK (igst_paise >= 0),
  total_paise      BIGINT NOT NULL,
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fy, seq),
  UNIQUE (restaurant_id, period_start),
  CHECK (period_end >= period_start),
  CHECK (total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise),
  CHECK (igst_paise = 0 OR (cgst_paise = 0 AND sgst_paise = 0))
);
CREATE INDEX invoices_restaurant_idx ON finance.invoices (restaurant_id, period_start DESC);
