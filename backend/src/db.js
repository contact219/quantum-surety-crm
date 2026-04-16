import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export const db = drizzle(pool);
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
  `);
  console.log('CRM tables ready');
}
initDb().catch(console.error);
