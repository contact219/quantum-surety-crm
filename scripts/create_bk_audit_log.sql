-- Money-mutation audit log for the Bookkeeping module.
-- Records payment collections and carrier-remittance status changes.
CREATE TABLE IF NOT EXISTS bk_audit_log (
  id          SERIAL PRIMARY KEY,
  action      TEXT NOT NULL,           -- e.g. payment.collect, remittance.sent
  entity      TEXT,                    -- payment | remittance
  entity_id   INTEGER,
  actor       TEXT DEFAULT 'system',
  amount      NUMERIC(12,2),
  detail      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bk_audit_created ON bk_audit_log(created_at DESC);
