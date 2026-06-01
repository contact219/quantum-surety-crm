CREATE TABLE IF NOT EXISTS tdlr_licenses (
  id              SERIAL PRIMARY KEY,
  license_type    TEXT NOT NULL,
  license_number  TEXT NOT NULL,
  business_county TEXT,
  business_name   TEXT,
  business_address TEXT,
  business_city   TEXT,
  business_state  TEXT DEFAULT 'TX',
  business_zip    TEXT,
  business_phone  TEXT,
  expire_date     DATE,
  owner_name      TEXT,
  owner_phone     TEXT,
  license_subtype TEXT,
  updated_at      TIMESTAMP DEFAULT NOW(),
  CONSTRAINT tdlr_licenses_license_number_key UNIQUE (license_number)
);

CREATE INDEX IF NOT EXISTS idx_tdlr_expire ON tdlr_licenses (expire_date);
CREATE INDEX IF NOT EXISTS idx_tdlr_license_type ON tdlr_licenses (license_type);
CREATE INDEX IF NOT EXISTS idx_tdlr_county ON tdlr_licenses (business_county);
CREATE INDEX IF NOT EXISTS idx_tdlr_business_name ON tdlr_licenses (business_name);
