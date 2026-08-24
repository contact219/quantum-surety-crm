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

  // Daily KPI snapshot cache read by GET /api/bookkeeping/kpi. Written by the
  // nightly sync job; columns mirror the live-compute response shape.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_kpi_cache (
      id SERIAL PRIMARY KEY,
      snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
      active_bonds INTEGER DEFAULT 0,
      mtd_commission NUMERIC(12,2) DEFAULT 0,
      ytd_commission NUMERIC(12,2) DEFAULT 0,
      mtd_premium NUMERIC(12,2) DEFAULT 0,
      mtd_bonds INTEGER DEFAULT 0,
      ytd_bonds INTEGER DEFAULT 0,
      expiring_30d INTEGER DEFAULT 0,
      unpaid_bills NUMERIC(12,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS bk_kpi_cache_date_idx ON bk_kpi_cache(snapshot_date DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_recurring_expenses (
      id SERIAL PRIMARY KEY,
      category_id INTEGER,
      vendor TEXT NOT NULL,
      description TEXT DEFAULT '',
      amount NUMERIC(10,2) NOT NULL,
      frequency TEXT NOT NULL,
      start_date DATE,
      next_due DATE,
      payment_method TEXT DEFAULT 'card',
      notes TEXT DEFAULT '',
      active BOOLEAN DEFAULT true,
      run_count INTEGER DEFAULT 0,
      last_run DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_budgets (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      budget_amount NUMERIC(12,2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(category_id, month)
    )
  `);

  // Money-mutation audit log (mirrors scripts/create_bk_audit_log.sql).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_audit_log (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id INTEGER,
      actor TEXT DEFAULT 'system',
      amount NUMERIC(12,2),
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bk_audit_created ON bk_audit_log(created_at DESC)`);

  // Reinstatement re-posts (cancelled → issued, see repostCommissionOnReinstate
  // in bookkeeping.js): a reinstated bond legitimately carries a SECOND
  // positive ledger row after its reversal. Rows flagged reinstatement=true
  // are exempt from the once-per-bond positive-post unique index below (which
  // continues to guard ORIGINAL posts) and from the duplicate-post dedupe.
  await pool.query(`ALTER TABLE bk_commission_ledger ADD COLUMN IF NOT EXISTS reinstatement BOOLEAN NOT NULL DEFAULT false`);

  // Optional scraper-supplied bond fields (additive).
  await pool.query(`ALTER TABLE bk_bonds ADD COLUMN IF NOT EXISTS status_detail TEXT`);
  await pool.query(`ALTER TABLE bk_bonds ADD COLUMN IF NOT EXISTS submission_no TEXT`);
  await pool.query(`ALTER TABLE bk_bonds ADD COLUMN IF NOT EXISTS principal_address TEXT`);

  // Cancellation date (additive): the journal views date cancellation
  // reversals from this column instead of updated_at, which the nightly
  // scraper sync bumps on EVERY run — without it, closed-month accrual P&L
  // and past-period exports silently re-dated every night for scraper-synced
  // cancelled bonds. Set by both cancellation paths (PUT /bonds/:id and the
  // scraper transition); the backfill below freezes a date for rows cancelled
  // before the column existed (updated_at is the best approximation we have)
  // and only ever fills NULLs, so it is safe to re-run.
  await pool.query(`ALTER TABLE bk_bonds ADD COLUMN IF NOT EXISTS cancelled_at DATE`);
  await pool.query(`
    UPDATE bk_bonds SET cancelled_at = updated_at::date
    WHERE status = 'cancelled' AND cancelled_at IS NULL
  `);

  // Optional per-bond payment due date; A/R aging falls back to
  // effective_date + 30 (net-30) when NULL.
  await pool.query(`ALTER TABLE bk_bonds ADD COLUMN IF NOT EXISTS due_date DATE`);

  // Direct-bill carriers (e.g. RLI): the carrier bills the insured and pays
  // our commission directly — premium never passes through trust and no
  // bk_bond_payments / remittances exist. The journal views, A/R aging and
  // the scraper commission auto-post key off this flag instead of assuming
  // "scraper == direct-bill". One-time backfill (only when the column is
  // first created, so a manual un-flag survives restarts): flag carriers
  // that already have scraper-sourced bonds — the book the scraper has been
  // auto-posting commission for.
  {
    const { rows: hadCol } = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'bk_carriers' AND column_name = 'direct_bill'
    `);
    await pool.query(`ALTER TABLE bk_carriers ADD COLUMN IF NOT EXISTS direct_bill BOOLEAN DEFAULT false`);
    if (!hadCol.length) {
      await pool.query(`
        UPDATE bk_carriers SET direct_bill = true
        WHERE EXISTS (SELECT 1 FROM bk_bonds b WHERE b.carrier_id = bk_carriers.id AND b.source = 'scraper')
      `);
    }
  }

  // Per-row import error detail for scraper reconciliation, then dedupe
  // (keeping the earliest row) so a real UNIQUE partial index can back
  // ON CONFLICT (external_id, flag) upserts.
  await pool.query(`ALTER TABLE bk_scraper_recon ADD COLUMN IF NOT EXISTS error TEXT`);
  // Dedupe is scoped to flag IS NOT NULL to match exactly what the partial
  // unique index below can enforce: the index treats NULL flags as distinct,
  // so deleting NULL-flag "duplicates" here would claim an invariant the
  // index does not actually hold going forward.
  await pool.query(`
    DELETE FROM bk_scraper_recon a
    USING bk_scraper_recon b
    WHERE a.external_id IS NOT NULL
      AND a.flag IS NOT NULL
      AND a.external_id = b.external_id
      AND a.flag IS NOT DISTINCT FROM b.flag
      AND a.id > b.id
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS bk_scraper_recon_ext_flag_uidx
    ON bk_scraper_recon(external_id, flag) WHERE external_id IS NOT NULL
  `);

  // Commission is posted at most ONCE per bond (rows with amount > 0 are
  // posts; negative rows are cancellation reversals, and stray $0 rows are
  // inert — they neither claim the slot nor block a real post). Existing
  // double-posts from partial-payment collections are deduped first, keeping
  // the earliest row per bond. Safety rails (this runs against the LIVE
  // money DB):
  //  * only rows whose amount EQUALS the kept earlier row's amount are
  //    treated as duplicates — prorated/adjusted second postings are NOT
  //    deleted, only logged, and the unique index is skipped until a human
  //    resolves them;
  //  * every deleted row is archived to bk_commission_ledger_dedup_backup;
  //  * duplicate collect-path posts also withdrew trust twice
  //    ('commission_out'), so a compensating 'commission_reversal' trust
  //    entry is inserted per removed duplicate that has a surplus
  //    commission_out, and running balances are rebuilt;
  //  * the whole dedupe runs in ONE transaction.
  {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock order: bk_trust_account FIRST, then bk_commission_ledger — the
      // runtime money paths (collect / cancel-reversal / reinstate) lock
      // bk_trust_account before touching the ledger, so acquiring in the same
      // order here can never deadlock against a concurrent request.
      await client.query('LOCK TABLE bk_trust_account IN EXCLUSIVE MODE');
      await client.query('LOCK TABLE bk_commission_ledger IN EXCLUSIVE MODE');
      // Columns named explicitly (not AS SELECT *) so the backup's shape is
      // stable even as bk_commission_ledger gains columns over time.
      await client.query(`
        CREATE TABLE IF NOT EXISTS bk_commission_ledger_dedup_backup (
          id INTEGER,
          bond_id INTEGER,
          payment_id INTEGER,
          amount NUMERIC(10,2),
          entry_date DATE,
          notes TEXT,
          created_at TIMESTAMPTZ,
          archived_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`ALTER TABLE bk_commission_ledger_dedup_backup ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NOW()`);

      // Doomed = later positive row with an earlier positive row of the SAME
      // amount on the same bond. Reinstatement rows are excluded on BOTH
      // sides: a re-post after a cancellation reversal legitimately equals
      // the original post's amount and must never be deduped away.
      const { rows: doomed } = await client.query(`
        SELECT a.id, a.bond_id, a.amount FROM bk_commission_ledger a
        WHERE a.amount > 0 AND NOT a.reinstatement AND EXISTS (
          SELECT 1 FROM bk_commission_ledger b
          WHERE b.bond_id = a.bond_id AND b.amount = a.amount AND b.amount > 0
            AND NOT b.reinstatement AND b.id < a.id
        )
        ORDER BY a.bond_id, a.id
      `);

      if (doomed.length) {
        const ids = doomed.map(r => r.id);
        await client.query(`
          INSERT INTO bk_commission_ledger_dedup_backup
            (id, bond_id, payment_id, amount, entry_date, notes, created_at, archived_at)
          SELECT l.id, l.bond_id, l.payment_id, l.amount, l.entry_date, l.notes, l.created_at, NOW()
          FROM bk_commission_ledger l
          WHERE l.id = ANY($1)
            AND NOT EXISTS (SELECT 1 FROM bk_commission_ledger_dedup_backup x WHERE x.id = l.id)
        `, [ids]);
        await client.query(`DELETE FROM bk_commission_ledger WHERE id = ANY($1)`, [ids]);

        // Compensate surplus trust withdrawals: for each affected bond,
        // surplus = commission_out entries minus remaining positive posts
        // (scraper direct-bill posts never touched trust, so surplus is 0
        // there and nothing is fabricated). One reversal per surplus, sized
        // by the deleted duplicate's amount.
        let compensated = 0;
        const byBond = new Map();
        for (const d of doomed) {
          if (!byBond.has(d.bond_id)) byBond.set(d.bond_id, []);
          byBond.get(d.bond_id).push(d);
        }
        for (const [bondId, dups] of byBond) {
          const { rows: cnt } = await client.query(`
            SELECT
              (SELECT COUNT(*) FROM bk_trust_account t WHERE t.bond_id = $1 AND t.entry_type = 'commission_out') AS outs,
              (SELECT COUNT(*) FROM bk_trust_account t WHERE t.bond_id = $1 AND t.entry_type = 'commission_reversal') AS reversals,
              (SELECT COUNT(*) FROM bk_commission_ledger l WHERE l.bond_id = $1 AND l.amount > 0) AS posts
          `, [bondId]);
          let surplus = parseInt(cnt[0].outs) - parseInt(cnt[0].reversals) - parseInt(cnt[0].posts);
          for (const d of dups) {
            if (surplus <= 0) break;
            await client.query(`
              INSERT INTO bk_trust_account (bond_id, entry_type, amount, running_balance, description, entry_date)
              SELECT $1, 'commission_reversal', $2,
                COALESCE((SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1), 0) + $2,
                $3, CURRENT_DATE
            `, [bondId, parseFloat(d.amount),
                `Dedupe compensation — duplicate commission withdrawal reversed (archived ledger row #${d.id})`]);
            surplus--; compensated++;
          }
        }
        if (compensated) {
          // Rebuild running balances so the compensations slot in cleanly.
          await client.query(`
            WITH ordered AS (
              SELECT id, SUM(amount) OVER (ORDER BY id) AS correct FROM bk_trust_account
            )
            UPDATE bk_trust_account t SET running_balance = ROUND(o.correct, 2)
            FROM ordered o
            WHERE o.id = t.id AND t.running_balance IS DISTINCT FROM ROUND(o.correct, 2)
          `);
        }
        console.log(`[db] commission-ledger dedupe: archived+deleted ${doomed.length} duplicate row(s), compensated ${compensated} trust withdrawal(s)`);
      }

      // Unequal-amount multiples survive; the index cannot be created over
      // them, so warn instead of destroying money records.
      const { rows: leftovers } = await client.query(`
        SELECT bond_id, COUNT(*) AS n FROM bk_commission_ledger
        WHERE amount > 0 AND NOT reinstatement GROUP BY bond_id HAVING COUNT(*) > 1
      `);
      // The previously-shipped index predicate was amount >= 0; replace it so
      // $0 rows stop occupying the once-per-bond slot. The old index is only
      // dropped when the replacement can actually be created — dropping it
      // while unequal-amount leftovers block recreation would remove the
      // DB-level double-post backstop for ALL bonds (leaving only the
      // race-prone app-level NOT EXISTS guards) until a human resolved the
      // flagged ones.
      if (!leftovers.length) {
        await client.query(`DROP INDEX IF EXISTS bk_commission_ledger_bond_post_uidx`);
        await client.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS bk_commission_ledger_bond_post_uidx
          ON bk_commission_ledger(bond_id) WHERE amount > 0 AND NOT reinstatement
        `);
      } else {
        console.warn(`[db] commission-ledger unique index SKIPPED — bonds with multiple unequal positive posts need manual review: ${leftovers.map(l => l.bond_id).join(', ')}`);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[db] commission-ledger dedupe migration failed:', e.message);
    } finally { client.release(); }
  }

  // Tracking attribution insurance — production may predate this column.
  await pool.query(`ALTER TABLE IF EXISTS email_events ADD COLUMN IF NOT EXISTS contact_type TEXT`);

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
