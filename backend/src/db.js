import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export const db = drizzle(pool);
export { pool };
export const contractors = pgTable('contractors', {
  id: serial('id').primaryKey(),
  company_name: text('company_name').notNull(),
  address: text('address'), address2: text('address2'),
  city: text('city'), state: text('state').notNull(),
  zip: text('zip'), phone: text('phone'), fax: text('fax'),
  email: text('email'), website: text('website'),
  certification_type: text('certification_type'),
  certification_number: text('certification_number'),
  naics_codes: text('naics_codes'), source_id: text('source_id'),
  created_at: timestamp('created_at').default(sql`now()`),
});
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_contacts (
      id SERIAL PRIMARY KEY, contractor_id INTEGER REFERENCES contractors(id),
      contact_name TEXT, contact_email TEXT, contact_phone TEXT,
      status TEXT DEFAULT 'new', notes TEXT, tags TEXT,
      last_contacted TIMESTAMP, created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now(),
      UNIQUE(contractor_id)
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL,
      body TEXT NOT NULL, from_name TEXT DEFAULT 'Quantum Surety',
      from_email TEXT DEFAULT 'info@quantumsurety.bond',
      status TEXT DEFAULT 'draft', sent_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT now(), sent_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS campaign_sends (
      id SERIAL PRIMARY KEY, campaign_id INTEGER REFERENCES campaigns(id),
      contractor_id INTEGER REFERENCES contractors(id),
      email TEXT, status TEXT DEFAULT 'pending', sent_at TIMESTAMP, error TEXT
    );
    CREATE TABLE IF NOT EXISTS notary_campaign_sends (
      id SERIAL PRIMARY KEY,
      notary_id INTEGER,
      email TEXT,
      campaign_name TEXT,
      subject TEXT,
      status TEXT DEFAULT 'sent',
      error TEXT,
      is_auto BOOLEAN DEFAULT false,
      drip_id INTEGER,
      sent_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS notary_campaign_sends_notary_id ON notary_campaign_sends(notary_id);
    CREATE INDEX IF NOT EXISTS notary_campaign_sends_email ON notary_campaign_sends(email);

    CREATE TABLE IF NOT EXISTS auto_dealers (
      id SERIAL PRIMARY KEY,
      business_name TEXT NOT NULL,
      dba_name TEXT,
      license_number TEXT,
      license_category TEXT,
      license_type TEXT,
      license_status TEXT DEFAULT 'Active',
      license_expiration DATE,
      address1 TEXT, address2 TEXT,
      city TEXT, state TEXT DEFAULT 'TX', zip TEXT,
      phone TEXT, fax TEXT, email TEXT, county TEXT,
      created_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS auto_dealers_email ON auto_dealers(email);
    CREATE INDEX IF NOT EXISTS auto_dealers_city ON auto_dealers(city);
    CREATE INDEX IF NOT EXISTS auto_dealers_county ON auto_dealers(county);
    CREATE INDEX IF NOT EXISTS auto_dealers_expiration ON auto_dealers(license_expiration);

    CREATE TABLE IF NOT EXISTS dealer_campaign_sends (
      id SERIAL PRIMARY KEY,
      dealer_id INTEGER,
      email TEXT,
      campaign_name TEXT,
      subject TEXT,
      status TEXT DEFAULT 'sent',
      error TEXT,
      is_auto BOOLEAN DEFAULT false,
      drip_id INTEGER,
      sent_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS dealer_campaign_sends_dealer_id ON dealer_campaign_sends(dealer_id);
    CREATE INDEX IF NOT EXISTS dealer_campaign_sends_email ON dealer_campaign_sends(email);
  `);

  // ─── BOOKKEEPING TABLES ──────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_carriers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      naic_code TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      remittance_schedule TEXT DEFAULT 'monthly',
      remittance_day INTEGER DEFAULT 15,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_carrier_rates (
      id SERIAL PRIMARY KEY,
      carrier_id INTEGER NOT NULL REFERENCES bk_carriers(id) ON DELETE CASCADE,
      bond_type TEXT NOT NULL,
      commission_pct NUMERIC(5,4) NOT NULL,
      min_premium NUMERIC(10,2),
      UNIQUE(carrier_id, bond_type)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_bonds (
      id SERIAL PRIMARY KEY,
      bond_number TEXT UNIQUE,
      lead_id INTEGER,
      carrier_id INTEGER NOT NULL REFERENCES bk_carriers(id),
      insured_name TEXT NOT NULL,
      insured_email TEXT,
      insured_phone TEXT,
      bond_type TEXT NOT NULL,
      bond_amount NUMERIC(10,2) NOT NULL,
      premium NUMERIC(10,2) NOT NULL,
      commission_rate NUMERIC(5,4) NOT NULL,
      commission_amt NUMERIC(10,2) GENERATED ALWAYS AS (ROUND(premium * commission_rate, 2)) STORED,
      carrier_remit_amt NUMERIC(10,2) GENERATED ALWAYS AS (ROUND(premium * (1 - commission_rate), 2)) STORED,
      effective_date DATE NOT NULL,
      expiration_date DATE NOT NULL,
      status TEXT DEFAULT 'issued',
      policy_doc_url TEXT,
      notes TEXT,
      source TEXT DEFAULT 'manual',
      auto_generated BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_bond_payments (
      id SERIAL PRIMARY KEY,
      bond_id INTEGER NOT NULL REFERENCES bk_bonds(id) ON DELETE CASCADE,
      amount NUMERIC(10,2) NOT NULL,
      payment_method TEXT DEFAULT 'card',
      payment_date DATE,
      collected_at TIMESTAMPTZ,
      status TEXT DEFAULT 'pending',
      stripe_payment_intent TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_carrier_remittances (
      id SERIAL PRIMARY KEY,
      carrier_id INTEGER NOT NULL REFERENCES bk_carriers(id),
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      bond_count INTEGER DEFAULT 0,
      total_premium NUMERIC(10,2) DEFAULT 0,
      total_commission NUMERIC(10,2) DEFAULT 0,
      total_remitted NUMERIC(10,2) DEFAULT 0,
      status TEXT DEFAULT 'pending',
      sent_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      notes TEXT,
      auto_generated BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_remittance_bonds (
      remittance_id INTEGER NOT NULL REFERENCES bk_carrier_remittances(id) ON DELETE CASCADE,
      bond_id INTEGER NOT NULL REFERENCES bk_bonds(id),
      PRIMARY KEY (remittance_id, bond_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_trust_account (
      id SERIAL PRIMARY KEY,
      bond_id INTEGER REFERENCES bk_bonds(id),
      remittance_id INTEGER REFERENCES bk_carrier_remittances(id),
      entry_type TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      running_balance NUMERIC(10,2) NOT NULL,
      description TEXT,
      entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_commission_ledger (
      id SERIAL PRIMARY KEY,
      bond_id INTEGER NOT NULL REFERENCES bk_bonds(id),
      payment_id INTEGER REFERENCES bk_bond_payments(id),
      amount NUMERIC(10,2) NOT NULL,
      entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_renewal_alerts (
      id SERIAL PRIMARY KEY,
      bond_id INTEGER NOT NULL REFERENCES bk_bonds(id) ON DELETE CASCADE,
      alert_date DATE NOT NULL,
      status TEXT DEFAULT 'pending',
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(bond_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_payment_alerts (
      id SERIAL PRIMARY KEY,
      bond_id INTEGER NOT NULL REFERENCES bk_bonds(id) ON DELETE CASCADE,
      overdue_days INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(bond_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_scraper_recon (
      id SERIAL PRIMARY KEY,
      bond_id INTEGER REFERENCES bk_bonds(id),
      scraper_source TEXT,
      external_id TEXT,
      flag TEXT,
      resolved BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS bk_bonds_carrier_idx ON bk_bonds(carrier_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bk_bonds_status_idx ON bk_bonds(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bk_bonds_expiration_idx ON bk_bonds(expiration_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bk_payments_bond_idx ON bk_bond_payments(bond_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bk_remittances_carrier_idx ON bk_carrier_remittances(carrier_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bk_trust_date_idx ON bk_trust_account(entry_date)`);

  await pool.query(`
    INSERT INTO bk_carriers (name, naic_code, contact_email, remittance_schedule, remittance_day)
    SELECT 'Markel Insurance', '38970', 'remittance@markel.com', 'monthly', 15
    WHERE NOT EXISTS (SELECT 1 FROM bk_carriers WHERE name = 'Markel Insurance')
  `);
  await pool.query(`
    INSERT INTO bk_carriers (name, naic_code, contact_email, remittance_schedule, remittance_day)
    SELECT 'SureTec Insurance', '36234', 'accounting@suretec.com', 'monthly', 15
    WHERE NOT EXISTS (SELECT 1 FROM bk_carriers WHERE name = 'SureTec Insurance')
  `);
  await pool.query(`
    INSERT INTO bk_carriers (name, naic_code, contact_email, remittance_schedule, remittance_day)
    SELECT 'HCC Surety Group', '31925', 'bonds@hccsurety.com', 'monthly', 15
    WHERE NOT EXISTS (SELECT 1 FROM bk_carriers WHERE name = 'HCC Surety Group')
  `);
  await pool.query(`
    INSERT INTO bk_carrier_rates (carrier_id, bond_type, commission_pct)
    SELECT c.id, 'dealer_gdn', 0.2000 FROM bk_carriers c WHERE c.name = 'Markel Insurance'
    ON CONFLICT (carrier_id, bond_type) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO bk_carrier_rates (carrier_id, bond_type, commission_pct)
    SELECT c.id, 'notary', 0.2500 FROM bk_carriers c WHERE c.name = 'Markel Insurance'
    ON CONFLICT (carrier_id, bond_type) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO bk_carrier_rates (carrier_id, bond_type, commission_pct)
    SELECT c.id, 'contractor', 0.2000 FROM bk_carriers c WHERE c.name = 'Markel Insurance'
    ON CONFLICT (carrier_id, bond_type) DO NOTHING
  `);
  // ─── END BOOKKEEPING TABLES ──────────────────────────────────────────────────

  console.log('CRM tables ready');
}
initDb().catch(console.error);
