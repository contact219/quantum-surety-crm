import express from 'express';
import { pool } from '../db.js';
import { sendEmail } from '../mailer.js';

export const bookkeepingRouter = express.Router();

const FROM = 'Quantum Surety <nice.shotwell-sparks@quantumsurety.bond>';

// ─── CARRIERS ─────────────────────────────────────────────────────────────────

bookkeepingRouter.get('/carriers', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        COALESCE(json_agg(r ORDER BY r.bond_type) FILTER (WHERE r.id IS NOT NULL), '[]') as rates
      FROM bk_carriers c
      LEFT JOIN bk_carrier_rates r ON r.carrier_id = c.id
      GROUP BY c.id ORDER BY c.name
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.post('/carriers', async (req, res) => {
  const { name, naic_code, contact_name, contact_email, contact_phone, remittance_schedule, remittance_day } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO bk_carriers (name, naic_code, contact_name, contact_email, contact_phone, remittance_schedule, remittance_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, naic_code, contact_name, contact_email, contact_phone, remittance_schedule || 'monthly', remittance_day || 15]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.put('/carriers/:id', async (req, res) => {
  const { name, naic_code, contact_name, contact_email, contact_phone, remittance_schedule, remittance_day, active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE bk_carriers SET name=$1, naic_code=$2, contact_name=$3, contact_email=$4, contact_phone=$5,
       remittance_schedule=$6, remittance_day=$7, active=$8 WHERE id=$9 RETURNING *`,
      [name, naic_code, contact_name, contact_email, contact_phone, remittance_schedule, remittance_day, active, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.post('/carriers/:id/rates', async (req, res) => {
  const { bond_type, commission_pct, min_premium } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO bk_carrier_rates (carrier_id, bond_type, commission_pct, min_premium)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (carrier_id, bond_type) DO UPDATE SET commission_pct=$3, min_premium=$4
       RETURNING *`,
      [req.params.id, bond_type, commission_pct, min_premium]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.get('/carriers/:id/rate', async (req, res) => {
  const { bond_type } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT commission_pct FROM bk_carrier_rates WHERE carrier_id=$1 AND bond_type=$2`,
      [req.params.id, bond_type]
    );
    res.json(rows[0] || { commission_pct: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── BONDS ────────────────────────────────────────────────────────────────────

bookkeepingRouter.get('/bonds', async (req, res) => {
  const { carrier_id, bond_type, status, month, q } = req.query;
  const wheres = [];
  const params = [];
  let p = 1;
  if (carrier_id) { wheres.push(`b.carrier_id = $${p++}`); params.push(carrier_id); }
  if (bond_type)  { wheres.push(`b.bond_type = $${p++}`); params.push(bond_type); }
  if (status)     { wheres.push(`b.status = $${p++}`); params.push(status); }
  if (month)      { wheres.push(`to_char(b.effective_date,'YYYY-MM') = $${p++}`); params.push(month); }
  if (q)          { wheres.push(`(b.insured_name ILIKE $${p} OR b.bond_number ILIKE $${p})`); params.push(`%${q}%`); p++; }
  const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
  try {
    const { rows } = await pool.query(`
      SELECT b.*, c.name as carrier_name,
        (SELECT json_agg(py ORDER BY py.created_at DESC) FROM bk_bond_payments py WHERE py.bond_id = b.id) as payments
      FROM bk_bonds b
      JOIN bk_carriers c ON c.id = b.carrier_id
      ${where}
      ORDER BY b.created_at DESC
      LIMIT 500
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.get('/bonds/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.*, c.name as carrier_name,
        (SELECT json_agg(py ORDER BY py.created_at) FROM bk_bond_payments py WHERE py.bond_id = b.id) as payments
      FROM bk_bonds b JOIN bk_carriers c ON c.id = b.carrier_id WHERE b.id=$1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.post('/bonds', async (req, res) => {
  const {
    bond_number, lead_id, carrier_id, insured_name, insured_email, insured_phone,
    bond_type, bond_amount, premium, commission_rate, effective_date, expiration_date,
    status, policy_doc_url, notes, source
  } = req.body;
  try {
    const { rows } = await pool.query(`
      INSERT INTO bk_bonds (bond_number, lead_id, carrier_id, insured_name, insured_email, insured_phone,
        bond_type, bond_amount, premium, commission_rate, effective_date, expiration_date,
        status, policy_doc_url, notes, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `, [bond_number||null, lead_id||null, carrier_id, insured_name, insured_email||null, insured_phone||null,
        bond_type, bond_amount, premium, commission_rate, effective_date, expiration_date,
        status||'issued', policy_doc_url||null, notes||null, source||'manual']);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.put('/bonds/:id', async (req, res) => {
  const {
    bond_number, carrier_id, insured_name, insured_email, insured_phone,
    bond_type, bond_amount, premium, commission_rate, effective_date, expiration_date,
    status, policy_doc_url, notes
  } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE bk_bonds SET bond_number=$1, carrier_id=$2, insured_name=$3, insured_email=$4,
        insured_phone=$5, bond_type=$6, bond_amount=$7, premium=$8, commission_rate=$9,
        effective_date=$10, expiration_date=$11, status=$12, policy_doc_url=$13, notes=$14,
        updated_at=NOW()
      WHERE id=$15 RETURNING *
    `, [bond_number||null, carrier_id, insured_name, insured_email||null, insured_phone||null,
        bond_type, bond_amount, premium, commission_rate, effective_date, expiration_date,
        status, policy_doc_url||null, notes||null, req.params.id]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PAYMENTS ─────────────────────────────────────────────────────────────────

bookkeepingRouter.get('/payments', async (req, res) => {
  const { status, month } = req.query;
  const wheres = [];
  const params = [];
  let p = 1;
  if (status) { wheres.push(`py.status = $${p++}`); params.push(status); }
  if (month)  { wheres.push(`to_char(py.created_at,'YYYY-MM') = $${p++}`); params.push(month); }
  const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
  try {
    const { rows } = await pool.query(`
      SELECT py.*, b.insured_name, b.bond_type, b.bond_number, c.name as carrier_name
      FROM bk_bond_payments py
      JOIN bk_bonds b ON b.id = py.bond_id
      JOIN bk_carriers c ON c.id = b.carrier_id
      ${where} ORDER BY py.created_at DESC LIMIT 200
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.post('/payments', async (req, res) => {
  const { bond_id, amount, payment_method, payment_date, notes } = req.body;
  try {
    const { rows } = await pool.query(`
      INSERT INTO bk_bond_payments (bond_id, amount, payment_method, payment_date, notes)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [bond_id, amount, payment_method||'card', payment_date||null, notes||null]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.put('/payments/:id/collect', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: pRows } = await client.query(
      `UPDATE bk_bond_payments SET status='collected', collected_at=NOW()
       WHERE id=$1 AND status='pending' RETURNING *`,
      [req.params.id]
    );
    if (!pRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment not found or already collected' });
    }
    const payment = pRows[0];

    const { rows: bRows } = await client.query(`SELECT * FROM bk_bonds WHERE id=$1`, [payment.bond_id]);
    const bond = bRows[0];

    const { rows: balRows } = await client.query(
      `SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1`
    );
    const prevBalance = balRows.length ? parseFloat(balRows[0].running_balance) : 0;
    const premiumAmt = parseFloat(payment.amount);
    const commAmt    = parseFloat(bond.commission_amt);

    const balAfterPremium = +(prevBalance + premiumAmt).toFixed(2);
    await client.query(`
      INSERT INTO bk_trust_account (bond_id, entry_type, amount, running_balance, description, entry_date)
      VALUES ($1,'premium_in',$2,$3,$4,CURRENT_DATE)
    `, [bond.id, premiumAmt, balAfterPremium, `Premium collected — ${bond.insured_name}`]);

    const balAfterComm = +(balAfterPremium - commAmt).toFixed(2);
    await client.query(`
      INSERT INTO bk_trust_account (bond_id, entry_type, amount, running_balance, description, entry_date)
      VALUES ($1,'commission_out',$2,$3,$4,CURRENT_DATE)
    `, [bond.id, -commAmt, balAfterComm, `Commission earned — ${bond.insured_name}`]);

    await client.query(`
      INSERT INTO bk_commission_ledger (bond_id, payment_id, amount, entry_date)
      VALUES ($1,$2,$3,CURRENT_DATE)
    `, [bond.id, payment.id, commAmt]);

    await client.query('COMMIT');
    res.json({ ok: true, trust_balance: balAfterComm, commission: commAmt });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ─── REMITTANCES ──────────────────────────────────────────────────────────────

bookkeepingRouter.get('/remittances', async (req, res) => {
  const { carrier_id, status } = req.query;
  const wheres = [];
  const params = [];
  let p = 1;
  if (carrier_id) { wheres.push(`r.carrier_id = $${p++}`); params.push(carrier_id); }
  if (status)     { wheres.push(`r.status = $${p++}`); params.push(status); }
  const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
  try {
    const { rows } = await pool.query(`
      SELECT r.*, c.name as carrier_name FROM bk_carrier_remittances r
      JOIN bk_carriers c ON c.id = r.carrier_id ${where}
      ORDER BY r.created_at DESC LIMIT 100
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.get('/remittances/:id/bonds', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.* FROM bk_remittance_bonds rb
      JOIN bk_bonds b ON b.id = rb.bond_id WHERE rb.remittance_id=$1
    `, [req.params.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.post('/remittances/generate', async (req, res) => {
  const { carrier_id, period_start, period_end } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: bonds } = await client.query(`
      SELECT b.id, b.premium, b.commission_amt, b.carrier_remit_amt
      FROM bk_bonds b
      WHERE b.carrier_id=$1
        AND b.effective_date BETWEEN $2 AND $3
        AND b.status='issued'
        AND NOT EXISTS (
          SELECT 1 FROM bk_remittance_bonds rb
          JOIN bk_carrier_remittances r ON r.id = rb.remittance_id
          WHERE rb.bond_id = b.id AND r.carrier_id = b.carrier_id AND r.status != 'pending'
        )
    `, [carrier_id, period_start, period_end]);

    if (!bonds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No eligible bonds for this period' });
    }

    const totalPremium    = bonds.reduce((s, b) => s + parseFloat(b.premium), 0);
    const totalCommission = bonds.reduce((s, b) => s + parseFloat(b.commission_amt), 0);
    const totalRemitted   = bonds.reduce((s, b) => s + parseFloat(b.carrier_remit_amt), 0);

    const { rows: rRows } = await client.query(`
      INSERT INTO bk_carrier_remittances
        (carrier_id, period_start, period_end, bond_count, total_premium, total_commission, total_remitted)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [carrier_id, period_start, period_end, bonds.length,
        totalPremium.toFixed(2), totalCommission.toFixed(2), totalRemitted.toFixed(2)]);

    const remittance = rRows[0];
    for (const b of bonds) {
      await client.query(`INSERT INTO bk_remittance_bonds (remittance_id, bond_id) VALUES ($1,$2)`,
        [remittance.id, b.id]);
    }

    await client.query('COMMIT');
    res.json(remittance);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

bookkeepingRouter.put('/remittances/:id/status', async (req, res) => {
  const { status, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE bk_carrier_remittances SET status=$1, notes=$2,
       sent_at = CASE WHEN $1='sent' THEN NOW() ELSE sent_at END,
       confirmed_at = CASE WHEN $1='confirmed' THEN NOW() ELSE confirmed_at END
       WHERE id=$3 RETURNING *`,
      [status, notes||null, req.params.id]
    );
    const rem = rows[0];

    if (status === 'sent') {
      const { rows: balRows } = await client.query(
        `SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1`
      );
      const prevBalance = balRows.length ? parseFloat(balRows[0].running_balance) : 0;
      const newBalance = +(prevBalance - parseFloat(rem.total_remitted)).toFixed(2);

      await client.query(`
        INSERT INTO bk_trust_account (remittance_id, entry_type, amount, running_balance, description, entry_date)
        VALUES ($1,'remittance_out',$2,$3,$4,CURRENT_DATE)
      `, [rem.id, -parseFloat(rem.total_remitted), newBalance,
          `Remittance to carrier #${rem.carrier_id} for ${rem.period_start} to ${rem.period_end}`]);

      const { rows: cRows } = await client.query(`SELECT * FROM bk_carriers WHERE id=$1`, [rem.carrier_id]);
      const carrier = cRows[0];
      if (carrier?.contact_email) {
        await sendEmail({
          from: FROM,
          to: carrier.contact_email,
          subject: `Remittance Statement — Quantum Surety (${rem.period_start} to ${rem.period_end})`,
          html: `<p>Please find enclosed your remittance for the period ${rem.period_start} to ${rem.period_end}.</p>
<p><strong>Bond Count:</strong> ${rem.bond_count}<br>
<strong>Total Premium:</strong> $${parseFloat(rem.total_premium).toFixed(2)}<br>
<strong>Commission (retained):</strong> $${parseFloat(rem.total_commission).toFixed(2)}<br>
<strong>Net Remittance:</strong> $${parseFloat(rem.total_remitted).toFixed(2)}</p>
<p>Payment is being processed.</p><p>— Quantum Surety LLC</p>`,
        });
      }
    }

    await client.query('COMMIT');
    res.json(rem);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ─── TRUST ACCOUNT ────────────────────────────────────────────────────────────

bookkeepingRouter.get('/trust', async (req, res) => {
  const { from, to } = req.query;
  const wheres = [];
  const params = [];
  let p = 1;
  if (from) { wheres.push(`t.entry_date >= $${p++}`); params.push(from); }
  if (to)   { wheres.push(`t.entry_date <= $${p++}`); params.push(to); }
  const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT t.*, b.insured_name, b.bond_type FROM bk_trust_account t
       LEFT JOIN bk_bonds b ON b.id = t.bond_id ${where} ORDER BY t.id DESC LIMIT 500`,
      params
    );
    const { rows: balRows } = await pool.query(
      `SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1`
    );
    res.json({ entries: rows, current_balance: balRows[0]?.running_balance || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

bookkeepingRouter.get('/dashboard', async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  try {
    const [kpi, trustBal, recentBonds, trend, byCarrier] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN to_char(b.effective_date,'YYYY-MM')=$1 AND b.status='issued'
            THEN b.premium END), 0) as premiums_collected,
          COALESCE(SUM(CASE WHEN to_char(b.effective_date,'YYYY-MM')=$1 AND b.status='issued'
            THEN b.commission_amt END), 0) as commission_earned,
          COALESCE((SELECT SUM(total_remitted) FROM bk_carrier_remittances
            WHERE status='sent' AND to_char(sent_at,'YYYY-MM')=$1), 0) as remittances_sent,
          COUNT(DISTINCT CASE WHEN to_char(b.effective_date,'YYYY-MM')=$1 AND b.status='issued' THEN b.id END) as bonds_issued,
          COUNT(DISTINCT CASE WHEN b.status='issued'
            AND b.expiration_date < NOW() - INTERVAL '7 days' THEN b.id END) as overdue_payments,
          COUNT(DISTINCT CASE WHEN b.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE+45
            AND b.status='issued'
            AND NOT EXISTS (SELECT 1 FROM bk_renewal_alerts ra WHERE ra.bond_id=b.id AND ra.status='renewed')
            THEN b.id END) as renewals_due
        FROM bk_bonds b
      `, [month]),
      pool.query(`SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1`),
      pool.query(`
        SELECT b.*, c.name as carrier_name FROM bk_bonds b
        JOIN bk_carriers c ON c.id = b.carrier_id ORDER BY b.created_at DESC LIMIT 10
      `),
      pool.query(`
        SELECT to_char(b.effective_date,'YYYY-MM') as month,
          SUM(b.premium) as premium, SUM(b.commission_amt) as commission, COUNT(*) as count
        FROM bk_bonds b
        WHERE b.effective_date >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY 1 ORDER BY 1
      `),
      pool.query(`
        SELECT c.name as carrier_name,
          COUNT(b.id) as bond_count, SUM(b.premium) as total_premium,
          SUM(b.commission_amt) as total_commission
        FROM bk_bonds b JOIN bk_carriers c ON c.id = b.carrier_id
        WHERE to_char(b.effective_date,'YYYY-MM') = $1
        GROUP BY c.id, c.name ORDER BY total_premium DESC
      `, [month]),
    ]);

    res.json({
      ...kpi.rows[0],
      trust_balance: trustBal.rows[0]?.running_balance || 0,
      recent_bonds: recentBonds.rows,
      trend: trend.rows,
      by_carrier: byCarrier.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ALERTS ───────────────────────────────────────────────────────────────────

bookkeepingRouter.get('/alerts', async (req, res) => {
  try {
    const [renewals, payments, scraper] = await Promise.all([
      pool.query(`
        SELECT ra.*, b.insured_name, b.bond_type, b.expiration_date, b.insured_email
        FROM bk_renewal_alerts ra JOIN bk_bonds b ON b.id = ra.bond_id
        WHERE ra.status IN ('pending','sent') ORDER BY b.expiration_date LIMIT 50
      `),
      pool.query(`
        SELECT pa.*, b.insured_name, b.bond_type, b.premium, b.insured_email
        FROM bk_payment_alerts pa JOIN bk_bonds b ON b.id = pa.bond_id
        WHERE pa.status IN ('pending','contacted') ORDER BY pa.overdue_days DESC LIMIT 50
      `),
      pool.query(`
        SELECT sr.*, b.insured_name FROM bk_scraper_recon sr
        LEFT JOIN bk_bonds b ON b.id = sr.bond_id WHERE sr.resolved=false LIMIT 20
      `),
    ]);
    res.json({ renewals: renewals.rows, payments: payments.rows, scraper: scraper.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.put('/alerts/renewal/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE bk_renewal_alerts SET status=$1, sent_at=CASE WHEN $1='sent' THEN NOW() ELSE sent_at END
       WHERE id=$2 RETURNING *`,
      [req.body.status, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.put('/alerts/payment/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE bk_payment_alerts SET status=$1 WHERE id=$2 RETURNING *`,
      [req.body.status, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── UPSERT FROM SCRAPER ──────────────────────────────────────────────────────

bookkeepingRouter.post('/bonds/upsert-from-scraper', async (req, res) => {
  const bonds = Array.isArray(req.body) ? req.body : [req.body];
  let upserted = 0, flagged = 0;
  for (const b of bonds) {
    try {
      await pool.query(`
        INSERT INTO bk_bonds (bond_number, carrier_id, insured_name, insured_email, bond_type,
          bond_amount, premium, commission_rate, effective_date, expiration_date, status, source, auto_generated)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'scraper',true)
        ON CONFLICT (bond_number) DO UPDATE SET
          insured_name=EXCLUDED.insured_name, expiration_date=EXCLUDED.expiration_date,
          premium=EXCLUDED.premium, commission_rate=EXCLUDED.commission_rate,
          status=EXCLUDED.status,
          updated_at=NOW()
      `, [b.bond_number, b.carrier_id, b.insured_name, b.insured_email||null,
          b.bond_type, b.bond_amount, b.premium, b.commission_rate||0.20,
          b.effective_date, b.expiration_date, b.status||'issued']);
      upserted++;
    } catch (e) {
      await pool.query(`
        INSERT INTO bk_scraper_recon (external_id, scraper_source, flag)
        VALUES ($1,$2,'import_error') ON CONFLICT DO NOTHING
      `, [b.bond_number||null, b.source||'scraper']);
      flagged++;
    }
  }
  res.json({ upserted, flagged });
});

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

bookkeepingRouter.get('/export/bonds', async (req, res) => {
  const { month } = req.query;
  try {
    const params = [];
    let where = '';
    if (month) { where = `WHERE to_char(b.effective_date,'YYYY-MM') = $1`; params.push(month); }
    const { rows } = await pool.query(`
      SELECT b.bond_number, b.insured_name, b.insured_email, b.bond_type, b.bond_amount,
        b.premium, b.commission_amt, b.carrier_remit_amt, b.commission_rate,
        b.effective_date, b.expiration_date, b.status, c.name as carrier
      FROM bk_bonds b JOIN bk_carriers c ON c.id = b.carrier_id ${where}
      ORDER BY b.effective_date DESC
    `, params);
    const headers = ['Bond #','Insured','Email','Type','Bond Amount','Premium','Commission','Carrier Net','Rate %','Effective','Expiration','Status','Carrier'];
    const csv = [headers.join(','), ...rows.map(r =>
      [r.bond_number,r.insured_name,r.insured_email,r.bond_type,r.bond_amount,
       r.premium,r.commission_amt,r.carrier_remit_amt,(parseFloat(r.commission_rate||0)*100).toFixed(1)+'%',
       r.effective_date,r.expiration_date,r.status,r.carrier]
      .map(v => `"${String(v||'').replace(/"/g,'""')}"`)
      .join(',')
    )].join('\n');
    res.setHeader('Content-Disposition', `attachment; filename="bonds_${month||'all'}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.get('/export/remittances', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.id, c.name as carrier, r.period_start, r.period_end,
        r.bond_count, r.total_premium, r.total_commission, r.total_remitted, r.status, r.sent_at
      FROM bk_carrier_remittances r JOIN bk_carriers c ON c.id = r.carrier_id
      ORDER BY r.created_at DESC
    `);
    const headers = ['ID','Carrier','Period Start','Period End','Bonds','Total Premium','Commission','Net Remitted','Status','Sent At'];
    const csv = [headers.join(','), ...rows.map(r =>
      [r.id,r.carrier,r.period_start,r.period_end,r.bond_count,
       r.total_premium,r.total_commission,r.total_remitted,r.status,r.sent_at||'']
      .map(v => `"${String(v||'').replace(/"/g,'""')}"`)
      .join(',')
    )].join('\n');
    res.setHeader('Content-Disposition', 'attachment; filename="remittances.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.get('/export/commission', async (req, res) => {
  const { month } = req.query;
  try {
    const params = [];
    let where = '';
    if (month) { where = `AND to_char(cl.entry_date,'YYYY-MM')=$1`; params.push(month); }
    const { rows } = await pool.query(`
      SELECT cl.entry_date, b.bond_number, b.insured_name, b.bond_type,
        b.premium, cl.amount as commission, b.carrier_remit_amt, c.name as carrier
      FROM bk_commission_ledger cl
      JOIN bk_bonds b ON b.id = cl.bond_id
      JOIN bk_carriers c ON c.id = b.carrier_id
      WHERE 1=1 ${where} ORDER BY cl.entry_date DESC
    `, params);
    const headers = ['Date','Bond #','Insured','Type','Premium','Commission','Carrier Net','Carrier'];
    const csv = [headers.join(','), ...rows.map(r =>
      [r.entry_date,r.bond_number,r.insured_name,r.bond_type,
       r.premium,r.commission,r.carrier_remit_amt,r.carrier]
      .map(v => `"${String(v||'').replace(/"/g,'""')}"`)
      .join(',')
    )].join('\n');
    res.setHeader('Content-Disposition', `attachment; filename="commission_${month||'all'}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.get('/export/trust', async (req, res) => {
  const { from, to } = req.query;
  try {
    const wheres = ['1=1'];
    const params = [];
    let p = 1;
    if (from) { wheres.push(`t.entry_date >= $${p++}`); params.push(from); }
    if (to)   { wheres.push(`t.entry_date <= $${p++}`); params.push(to); }
    const { rows } = await pool.query(`
      SELECT t.entry_date, t.entry_type, t.amount, t.running_balance, t.description,
        b.insured_name, b.bond_type
      FROM bk_trust_account t LEFT JOIN bk_bonds b ON b.id = t.bond_id
      WHERE ${wheres.join(' AND ')} ORDER BY t.id
    `, params);
    const headers = ['Date','Type','Amount','Balance','Description','Insured','Bond Type'];
    const csv = [headers.join(','), ...rows.map(r =>
      [r.entry_date,r.entry_type,r.amount,r.running_balance,r.description,r.insured_name||'',r.bond_type||'']
      .map(v => `"${String(v||'').replace(/"/g,'""')}"`)
      .join(',')
    )].join('\n');
    res.setHeader('Content-Disposition', 'attachment; filename="trust_ledger.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── JOBS ─────────────────────────────────────────────────────────────────────

async function runRenewalScan() {
  const { rows: bonds } = await pool.query(`
    SELECT b.id FROM bk_bonds b
    WHERE b.status='issued'
      AND b.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '45 days'
      AND NOT EXISTS (SELECT 1 FROM bk_renewal_alerts ra WHERE ra.bond_id=b.id)
  `);
  let count = 0;
  for (const b of bonds) {
    await pool.query(
      `INSERT INTO bk_renewal_alerts (bond_id, alert_date) VALUES ($1, CURRENT_DATE) ON CONFLICT DO NOTHING`,
      [b.id]
    );
    count++;
  }
  return { count };
}

async function runPaymentOverdueScan() {
  const { rows: bonds } = await pool.query(`
    SELECT b.id, (CURRENT_DATE - b.effective_date::date) as overdue_days
    FROM bk_bonds b
    WHERE b.status='issued'
      AND b.effective_date < CURRENT_DATE - INTERVAL '30 days'
      AND NOT EXISTS (SELECT 1 FROM bk_bond_payments py WHERE py.bond_id=b.id AND py.status='collected')
      AND NOT EXISTS (SELECT 1 FROM bk_payment_alerts pa WHERE pa.bond_id=b.id)
  `);
  let count = 0;
  for (const b of bonds) {
    await pool.query(
      `INSERT INTO bk_payment_alerts (bond_id, overdue_days) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [b.id, b.overdue_days]
    );
    count++;
  }
  return { count };
}

async function runAutoRemittance() {
  const today = new Date();
  const dayOfMonth = today.getDate();
  const { rows: carriers } = await pool.query(
    `SELECT * FROM bk_carriers WHERE active=true AND remittance_day=$1`, [dayOfMonth]
  );
  const generated = [];
  for (const carrier of carriers) {
    const periodStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0,10);
    const periodEnd   = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0,10);
    const { rows: bonds } = await pool.query(`
      SELECT b.id FROM bk_bonds b
      WHERE b.carrier_id=$1 AND b.effective_date BETWEEN $2 AND $3 AND b.status='issued'
        AND NOT EXISTS (
          SELECT 1 FROM bk_remittance_bonds rb
          JOIN bk_carrier_remittances r ON r.id=rb.remittance_id
          WHERE rb.bond_id=b.id AND r.carrier_id=b.carrier_id AND r.status != 'pending'
        )
    `, [carrier.id, periodStart, periodEnd]);
    if (!bonds.length) continue;
    const bondIds = bonds.map(b => b.id);
    const { rows: totals } = await pool.query(
      `SELECT SUM(premium) as tp, SUM(commission_amt) as tc, SUM(carrier_remit_amt) as tr
       FROM bk_bonds WHERE id = ANY($1)`, [bondIds]
    );
    const t = totals[0];
    const { rows: rRows } = await pool.query(`
      INSERT INTO bk_carrier_remittances
        (carrier_id, period_start, period_end, bond_count, total_premium, total_commission, total_remitted, auto_generated)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *
    `, [carrier.id, periodStart, periodEnd, bondIds.length,
        parseFloat(t.tp||0).toFixed(2), parseFloat(t.tc||0).toFixed(2), parseFloat(t.tr||0).toFixed(2)]);
    for (const id of bondIds) {
      await pool.query(`INSERT INTO bk_remittance_bonds (remittance_id, bond_id) VALUES ($1,$2)`, [rRows[0].id, id]);
    }
    generated.push({ carrier: carrier.name, remittance_id: rRows[0].id, bond_count: bondIds.length });
  }
  return { generated };
}

bookkeepingRouter.post('/jobs/renewal-scan', async (req, res) => {
  try { res.json(await runRenewalScan()); } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.post('/jobs/payment-overdue-scan', async (req, res) => {
  try { res.json(await runPaymentOverdueScan()); } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.post('/jobs/auto-remittance', async (req, res) => {
  try { res.json(await runAutoRemittance()); } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.post('/jobs/run-all', async (req, res) => {
  try {
    const [renewal, payment, remit] = await Promise.all([
      runRenewalScan(), runPaymentOverdueScan(), runAutoRemittance()
    ]);
    res.json({ renewal, payment, remit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// P&L endpoint
bookkeepingRouter.get('/pl', async (req, res) => {
  const { from, to } = req.query;
  try {
    const conds = ['1=1'];
    const params = [];
    let p = 1;
    if (from) { conds.push(`effective_date >= $${p++}`); params.push(from); }
    if (to)   { conds.push(`effective_date <= $${p++}`); params.push(to); }

    const { rows: revRows } = await pool.query(
      `SELECT bond_type, ROUND(SUM(premium * commission_rate),2) AS commission
       FROM bk_bonds WHERE ${conds.join(' AND ')} AND status='issued'
       GROUP BY bond_type ORDER BY commission DESC`,
      params
    );
    const revenue = revRows.reduce((s,r) => s + parseFloat(r.commission), 0);

    const expConds = ['1=1'];
    const expParams = [];
    let ep = 1;
    if (from) { expConds.push(`e.expense_date >= $${ep++}`); expParams.push(from); }
    if (to)   { expConds.push(`e.expense_date <= $${ep++}`); expParams.push(to); }

    const { rows: expRows } = await pool.query(
      `SELECT COALESCE(pc.name, c.name, 'Uncategorized') AS category, ROUND(SUM(e.amount),2) AS total
       FROM bk_expenses e
       LEFT JOIN bk_expense_categories c ON c.id = e.category_id
       LEFT JOIN bk_expense_categories pc ON pc.id = c.parent_id
       WHERE ${expConds.join(' AND ')}
       GROUP BY 1 ORDER BY total DESC`,
      expParams
    );
    const total_expenses = expRows.reduce((s,r) => s + parseFloat(r.total), 0);

    res.json({ revenue, total_expenses, revenue_by_type: revRows, expenses_by_category: expRows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
