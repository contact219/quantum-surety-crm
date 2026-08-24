import express from 'express';
import { pool } from '../db.js';
import { sendEmail } from '../mailer.js';

export const bookkeepingRouter = express.Router();

const FROM = 'Quantum Surety <nice.shotwell-sparks@quantumsurety.bond>';

// Append a row to the money-mutation audit log. Best-effort: never blocks the
// primary transaction. Pass an existing client to enroll in its transaction,
// or omit to write on the shared pool.
export async function logAudit(db, { action, entity, entity_id, actor, amount, detail }) {
  try {
    await (db || pool).query(
      `INSERT INTO bk_audit_log (action, entity, entity_id, actor, amount, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [action, entity, entity_id || null, actor || 'system', amount ?? null, detail || null]
    );
  } catch (e) { console.error('[bk audit]', e.message); }
}

// Audit actor from the verified JWT payload (set by requireAuth in index.js).
// Requests that bypassed JWT did so with X-Cron-Secret, so attribute to cron.
export function actorOf(req) {
  return req.user?.username || req.user?.email || 'cron';
}

// ─── CLOSE-THE-BOOKS GUARD ────────────────────────────────────────────────────
// Effective closing date = MAX(closing_date) FROM bk_closed_periods. The table
// DDL and the close/reopen endpoints live in bk_reports.js. getClosingDate is
// duplicated here (per the shared contract) instead of imported from
// bk_reports.js because bk_reports.js already imports from this module —
// importing back would create a circular dependency.
const isoDay = d => d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d).slice(0, 10);

export async function getClosingDate(db) {
  try {
    const { rows } = await (db || pool).query(
      `SELECT MAX(closing_date) AS closing_date FROM bk_closed_periods`
    );
    return rows[0]?.closing_date ? isoDay(rows[0].closing_date) : null;
  } catch (e) {
    if (e.code === '42P01') return null; // table not created yet (bk_reports.js owns the DDL)
    throw e;
  }
}

// Closed-period guard for money-mutating endpoints. `dates` are the
// money-effective dates the mutation touches (nullish/empty entries ignored;
// Date objects and 'YYYY-MM-DD' strings both accepted). If any falls on or
// before the closing date the request is rejected 409 — unless the
// x-allow-closed-period: true header is present, in which case an
// action='closed-period-override' bk_audit_log row is written and the
// mutation proceeds. Sends the 409 itself and returns false when blocked;
// returns true when the caller may proceed. ALWAYS reads via the pool (never
// a client mid-transaction) so a missing bk_closed_periods table can't poison
// the caller's transaction.
export async function guardClosedPeriod(req, res, dates, { entity, entity_id = null, detail = '' } = {}) {
  const ds = (dates || []).filter(d => d != null && d !== '').map(isoDay);
  if (!ds.length) return true;
  const closing = await getClosingDate(pool);
  if (!closing || !ds.some(d => d <= closing)) return true;
  if (String(req.headers['x-allow-closed-period'] || '').toLowerCase() !== 'true') {
    res.status(409).json({ error: `period closed through ${closing}` });
    return false;
  }
  await logAudit(null, {
    action: 'closed-period-override', entity, entity_id, actor: actorOf(req),
    detail: `${detail || 'Closed-period mutation overridden'} (period closed through ${closing})`,
  });
  return true;
}

// A bond's premium / commission_rate are POSTED (frozen) once commission has
// hit the ledger or the bond sits inside a sent/confirmed remittance —
// commission_amt is a generated column, so editing either would silently
// re-derive money out from under figures already booked or paid out.
// Overridable per request via x-allow-posted-edit: true (audited).
export async function bondMoneyPosted(db, bondId) {
  const { rows } = await (db || pool).query(`
    SELECT 1 FROM bk_bonds b WHERE b.id = $1 AND (
      EXISTS (SELECT 1 FROM bk_commission_ledger cl WHERE cl.bond_id = b.id AND cl.amount > 0)
      OR EXISTS (
        SELECT 1 FROM bk_remittance_bonds rb
        JOIN bk_carrier_remittances r ON r.id = rb.remittance_id
        WHERE rb.bond_id = b.id AND r.status IN ('sent','confirmed'))
    )`, [bondId]);
  return rows.length > 0;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────
// Quotes commas/quotes/newlines and neutralizes spreadsheet formula injection:
// cells starting with = + - @ are prefixed with a single quote — EXCEPT plain
// numbers (e.g. -123.45), which must stay numeric for sums/imports to work.
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(headers, rows) {
  return [headers.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n');
}

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
  const { name, naic_code, contact_name, contact_email, contact_phone, remittance_schedule, remittance_day, direct_bill } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO bk_carriers (name, naic_code, contact_name, contact_email, contact_phone, remittance_schedule, remittance_day, direct_bill)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, naic_code, contact_name, contact_email, contact_phone, remittance_schedule || 'monthly', remittance_day || 15, direct_bill === true]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bookkeepingRouter.put('/carriers/:id', async (req, res) => {
  const { name, naic_code, contact_name, contact_email, contact_phone, remittance_schedule, remittance_day, active, direct_bill } = req.body;
  try {
    // direct_bill only changes when the client sends a boolean — older
    // frontends that omit it must not silently reset the flag.
    const { rows } = await pool.query(
      `UPDATE bk_carriers SET name=$1, naic_code=$2, contact_name=$3, contact_email=$4, contact_phone=$5,
       remittance_schedule=$6, remittance_day=$7, active=$8,
       direct_bill=COALESCE($9::boolean, direct_bill)
       WHERE id=$10 RETURNING *`,
      [name, naic_code, contact_name, contact_email, contact_phone, remittance_schedule, remittance_day, active,
       typeof direct_bill === 'boolean' ? direct_bill : null, req.params.id]
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
  // Optional pagination: passing limit and/or offset returns {rows, total, limit, offset};
  // without them the response stays a plain array capped at 500 (legacy shape).
  const paginated = req.query.limit !== undefined || req.query.offset !== undefined;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 500);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  try {
    const { rows } = await pool.query(`
      SELECT b.*, c.name as carrier_name,
        (SELECT json_agg(py ORDER BY py.created_at DESC) FROM bk_bond_payments py WHERE py.bond_id = b.id) as payments
      FROM bk_bonds b
      JOIN bk_carriers c ON c.id = b.carrier_id
      ${where}
      ORDER BY b.created_at DESC
      LIMIT $${p++} OFFSET $${p++}
    `, [...params, limit, offset]);
    if (!paginated) return res.json(rows);
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*) AS total FROM bk_bonds b JOIN bk_carriers c ON c.id = b.carrier_id ${where}`,
      params
    );
    res.json({ rows, total: parseInt(cnt[0].total), limit, offset });
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
    if (!(await guardClosedPeriod(req, res, [effective_date],
      { entity: 'bond', detail: `Bond create — ${insured_name}` }))) return;
    const { rows } = await pool.query(`
      INSERT INTO bk_bonds (bond_number, lead_id, carrier_id, insured_name, insured_email, insured_phone,
        bond_type, bond_amount, premium, commission_rate, effective_date, expiration_date,
        status, policy_doc_url, notes, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `, [bond_number||null, lead_id||null, carrier_id, insured_name, insured_email||null, insured_phone||null,
        bond_type, bond_amount, premium, commission_rate, effective_date, expiration_date,
        status||'issued', policy_doc_url||null, notes||null, source||'manual']);
    await logAudit(null, {
      action: 'bond.create', entity: 'bond', entity_id: rows[0].id, actor: actorOf(req),
      amount: parseFloat(premium) || null,
      detail: `Created bond ${rows[0].bond_number || rows[0].id} — ${insured_name}`,
    });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Shared cancellation-reversal logic (used by PUT /bonds/:id AND scraper
// status transitions). Reverses a previously posted positive commission with
// one offsetting negative ledger row. The matching trust adjustment is posted
// ONLY when a 'commission_out' trust entry exists for the bond — RLI
// direct-bill commissions are posted to the ledger by the scraper with no
// trust movement (premium never touches trust), so reversing those must not
// fabricate a trust deposit. Idempotent: reverses the NEWEST positive post not
// already followed by a reversal row, so repeated status flips never
// double-reverse — and a cancel AFTER a reinstatement re-post correctly
// reverses the re-post (the cancel/reinstate cycle stays balanced).
// Caller owns the transaction; client must be inside BEGIN.
export async function reverseCommissionOnCancel(client, bond, actor) {
  await client.query('LOCK TABLE bk_trust_account IN EXCLUSIVE MODE');
  const { rows: revRows } = await client.query(`
    INSERT INTO bk_commission_ledger (bond_id, amount, entry_date, notes)
    SELECT cl.bond_id, -cl.amount, CURRENT_DATE, 'Reversal — bond cancelled'
    FROM bk_commission_ledger cl
    WHERE cl.bond_id = $1 AND cl.amount > 0
      AND NOT EXISTS (SELECT 1 FROM bk_commission_ledger r WHERE r.bond_id = $1 AND r.amount < 0 AND r.id > cl.id)
    ORDER BY cl.id DESC LIMIT 1
    RETURNING amount
  `, [bond.id]);
  if (!revRows.length) return 0;
  const reversed = -parseFloat(revRows[0].amount); // positive: money back into trust
  const { rowCount: trustPosted } = await client.query(`
    INSERT INTO bk_trust_account (bond_id, entry_type, amount, running_balance, description, entry_date)
    SELECT $1, 'commission_reversal', $2,
      COALESCE((SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1), 0) + $2,
      $3, CURRENT_DATE
    WHERE EXISTS (SELECT 1 FROM bk_trust_account t WHERE t.bond_id = $1 AND t.entry_type = 'commission_out')
  `, [bond.id, reversed, `Commission reversed — bond cancelled (${bond.insured_name})`]);
  await logAudit(client, {
    action: 'bond.cancel_reversal', entity: 'bond', entity_id: bond.id, actor,
    amount: reversed,
    detail: `Reversed commission $${reversed.toFixed(2)} on cancellation of bond ${bond.bond_number || bond.id}` +
      (trustPosted ? '' : ' (ledger only — no trust movement existed)'),
  });
  return reversed;
}

// Shared reinstatement logic (used by PUT /bonds/:id AND scraper status
// transitions). A cancelled → issued transition on a bond whose commission
// was reversed left the ledger netted to zero — the commission is earned
// again but stranded. Post a fresh positive re-instatement row
// (reinstatement=true, exempt from the once-per-bond positive-post unique
// index, which continues to guard ORIGINAL posts) and sweep the commission
// back out of trust — but only when the cancellation actually put it back
// (commission_reversal count >= commission_out count; direct-bill bonds have
// neither, so no trust movement is fabricated). Idempotent: skips when a
// positive row newer than the newest negative row already exists. Caller owns
// the transaction; client must be inside BEGIN.
export async function repostCommissionOnReinstate(client, bond, actor) {
  await client.query('LOCK TABLE bk_trust_account IN EXCLUSIVE MODE');
  const { rows: reRows } = await client.query(`
    INSERT INTO bk_commission_ledger (bond_id, amount, entry_date, notes, reinstatement)
    SELECT n.bond_id, -n.amount, CURRENT_DATE, 'Re-instatement — bond reinstated after cancellation', true
    FROM bk_commission_ledger n
    WHERE n.bond_id = $1 AND n.amount < 0
      AND NOT EXISTS (SELECT 1 FROM bk_commission_ledger p
                      WHERE p.bond_id = $1 AND p.amount > 0 AND p.id > n.id)
    ORDER BY n.id DESC LIMIT 1
    RETURNING amount
  `, [bond.id]);
  if (!reRows.length) return 0;
  const reposted = -parseFloat(reRows[0].amount); // positive: commission re-earned
  const { rowCount: trustPosted } = await client.query(`
    INSERT INTO bk_trust_account (bond_id, entry_type, amount, running_balance, description, entry_date)
    SELECT $1, 'commission_out', $2,
      COALESCE((SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1), 0) + $2,
      $3, CURRENT_DATE
    WHERE EXISTS (SELECT 1 FROM bk_trust_account t WHERE t.bond_id = $1 AND t.entry_type = 'commission_reversal')
      AND (SELECT COUNT(*) FROM bk_trust_account t WHERE t.bond_id = $1 AND t.entry_type = 'commission_reversal')
       >= (SELECT COUNT(*) FROM bk_trust_account t WHERE t.bond_id = $1 AND t.entry_type = 'commission_out')
  `, [bond.id, -reposted, `Commission re-earned — bond reinstated (${bond.insured_name})`]);
  await logAudit(client, {
    action: 'bond.reinstate_repost', entity: 'bond', entity_id: bond.id, actor,
    amount: reposted,
    detail: `Re-posted commission $${reposted.toFixed(2)} on reinstatement of bond ${bond.bond_number || bond.id}` +
      (trustPosted ? '' : ' (ledger only — no trust sweep: commission was never returned to trust)'),
  });
  return reposted;
}

bookkeepingRouter.put('/bonds/:id', async (req, res) => {
  const {
    bond_number, carrier_id, insured_name, insured_email, insured_phone,
    bond_type, bond_amount, premium, commission_rate, effective_date, expiration_date,
    status, policy_doc_url, notes
  } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: prevRows } = await client.query(
      `SELECT id, status, insured_name, effective_date, premium, commission_rate
       FROM bk_bonds WHERE id=$1 FOR UPDATE`, [req.params.id]
    );
    if (!prevRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const prev = prevRows[0];

    // Closed-period guard: both the bond's current effective date and the new
    // one are money-effective dates of this edit.
    if (!(await guardClosedPeriod(req, res, [prev.effective_date, effective_date],
      { entity: 'bond', entity_id: prev.id, detail: `Bond edit #${prev.id}` }))) {
      await client.query('ROLLBACK');
      return;
    }

    // Posted-money freeze: premium / commission_rate cannot change once
    // commission is posted or the bond is in a sent/confirmed remittance.
    const premiumChanged = premium != null && premium !== '' &&
      Math.abs(parseFloat(premium) - parseFloat(prev.premium)) > 0.005;
    const rateChanged = commission_rate != null && commission_rate !== '' &&
      Math.abs(parseFloat(commission_rate) - parseFloat(prev.commission_rate)) > 0.000005;
    if ((premiumChanged || rateChanged) && await bondMoneyPosted(client, prev.id)) {
      if (String(req.headers['x-allow-posted-edit'] || '').toLowerCase() !== 'true') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'premium/commission_rate are locked: commission is already posted to the ledger or the bond is in a sent/confirmed remittance. Pass header x-allow-posted-edit: true to override (audited).',
        });
      }
      await logAudit(client, {
        action: 'posted-edit-override', entity: 'bond', entity_id: prev.id, actor: actorOf(req),
        detail: `Premium/rate edit on posted bond #${prev.id}: premium ${prev.premium} → ${premium}, rate ${prev.commission_rate} → ${commission_rate}`,
      });
    }

    const { rows } = await client.query(`
      UPDATE bk_bonds SET bond_number=$1, carrier_id=$2, insured_name=$3, insured_email=$4,
        insured_phone=$5, bond_type=$6, bond_amount=$7, premium=$8, commission_rate=$9,
        effective_date=$10, expiration_date=$11, status=$12, policy_doc_url=$13, notes=$14,
        cancelled_at = CASE WHEN $12::text = 'cancelled' THEN COALESCE(cancelled_at, CURRENT_DATE) ELSE NULL END,
        updated_at=NOW()
      WHERE id=$15 RETURNING *
    `, [bond_number||null, carrier_id, insured_name, insured_email||null, insured_phone||null,
        bond_type, bond_amount, premium, commission_rate, effective_date, expiration_date,
        status, policy_doc_url||null, notes||null, req.params.id]);
    const bond = rows[0];

    // On transition to cancelled, reverse a previously posted commission
    // (ledger row always; trust adjustment only when trust actually moved).
    if (prev.status !== 'cancelled' && bond.status === 'cancelled') {
      await reverseCommissionOnCancel(client, bond, actorOf(req));
    } else if (prev.status === 'cancelled' && bond.status === 'issued') {
      // Reinstatement: re-post the reversed commission (and its trust sweep)
      // in the SAME transaction so it can't be stranded at net zero.
      await repostCommissionOnReinstate(client, bond, actorOf(req));
    }

    await logAudit(client, {
      action: prev.status !== bond.status ? 'bond.status_change' : 'bond.update',
      entity: 'bond', entity_id: bond.id, actor: actorOf(req),
      amount: parseFloat(bond.premium) || null,
      detail: prev.status !== bond.status
        ? `Bond ${bond.bond_number || bond.id} status ${prev.status} → ${bond.status}`
        : `Edited bond ${bond.bond_number || bond.id}`,
    });

    await client.query('COMMIT');
    res.json(bond);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {}); // connection may already be dead
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ─── PAYMENTS ─────────────────────────────────────────────────────────────────

bookkeepingRouter.get('/payments', async (req, res) => {
  const { status, month } = req.query;
  const wheres = [];
  const params = [];
  let p = 1;
  if (status) { wheres.push(`py.status = $${p++}`); params.push(status); }
  if (month)  { wheres.push(`to_char(COALESCE(py.payment_date, py.created_at::date),'YYYY-MM') = $${p++}`); params.push(month); }
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
    // Direct-bill bonds (same predicate as the journal views' dbb CTE:
    // source='scraper' AND carrier.direct_bill): the insured pays the carrier
    // directly — recording an agency payment here would eventually book
    // premium into trust that this agency never holds.
    const { rows: dbbRows } = await pool.query(`
      SELECT 1 FROM bk_bonds b JOIN bk_carriers c ON c.id = b.carrier_id
      WHERE b.id = $1 AND b.source = 'scraper' AND c.direct_bill
    `, [bond_id]);
    if (dbbRows.length) {
      return res.status(400).json({
        error: 'This is a direct-bill bond: the insured pays the carrier directly and premium never passes through this agency, so payments cannot be recorded here. Commission arrives via the carrier feed.',
      });
    }
    if (!(await guardClosedPeriod(req, res, [payment_date || new Date()],
      { entity: 'payment', detail: `Payment create for bond #${bond_id}` }))) return;
    const { rows } = await pool.query(`
      INSERT INTO bk_bond_payments (bond_id, amount, payment_method, payment_date, notes)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [bond_id, amount, payment_method||'card', payment_date||null, notes||null]);
    await logAudit(null, {
      action: 'payment.create', entity: 'payment', entity_id: rows[0].id, actor: actorOf(req),
      amount: parseFloat(amount) || null,
      detail: `Recorded $${parseFloat(amount||0).toFixed(2)} ${payment_method||'card'} payment for bond #${bond_id}`,
    });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// COMMISSION POSTING RULE: commission is posted to bk_commission_ledger (and
// drawn out of trust) exactly ONCE per bond, when the bond first becomes fully
// collected (SUM of collected payments >= premium). Partial payments only book
// premium into trust; the commission moves when the last payment lands. A
// partial unique index (bond_id WHERE amount > 0) enforces the once-per-bond
// invariant at the database level (amount > 0 so a stray historical $0 row
// can neither claim the slot nor block the real post).
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

    // Lock the bond row BEFORE the trust table lock (same order as the
    // cancellation path in PUT /bonds/:id, so the two can never deadlock) and
    // refuse collection on a cancelled bond: posting here would book premium
    // into trust and (if it completed the premium) sweep commission out with
    // NO reversal path ever reachable again — the cancel transition already
    // fired, so both the UI and scraper reversal gates have passed. Revenue
    // would be permanently overstated and the insured's refund under-funded.
    const { rows: bRows } = await client.query(`SELECT * FROM bk_bonds WHERE id=$1 FOR UPDATE`, [payment.bond_id]);
    const bond = bRows[0];
    if (bond.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Bond is cancelled — payment cannot be collected. Record any refund owed to the insured instead.' });
    }

    // Direct-bill bonds (same predicate as the journal views' dbb CTE):
    // collecting here would book premium into trust the agency never holds
    // and double-post commission the scraper feed already posts.
    if (bond.source === 'scraper') {
      const { rows: dbbRows } = await client.query(
        `SELECT 1 FROM bk_carriers c WHERE c.id = $1 AND c.direct_bill`, [bond.carrier_id]);
      if (dbbRows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'This is a direct-bill bond: the insured pays the carrier directly, so premium cannot be collected here. Commission arrives via the carrier feed.',
        });
      }
    }

    // Closed-period guard: trust entries post at CURRENT_DATE; the payment's
    // own payment_date is also money-effective. (Reads via pool internally —
    // safe inside this transaction.)
    if (!(await guardClosedPeriod(req, res, [payment.payment_date, new Date()],
      { entity: 'payment', entity_id: payment.id, detail: `Payment collect #${payment.id}` }))) {
      await client.query('ROLLBACK');
      return;
    }

    // Serialize trust writes so running_balance is computed against the true
    // latest row (read-then-insert in JS was race-corruptible).
    await client.query('LOCK TABLE bk_trust_account IN EXCLUSIVE MODE');
    const premiumAmt = parseFloat(payment.amount);
    const commAmt    = parseFloat(bond.commission_amt);

    await client.query(`
      INSERT INTO bk_trust_account (bond_id, entry_type, amount, running_balance, description, entry_date)
      SELECT $1, 'premium_in', $2,
        COALESCE((SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1), 0) + $2,
        $3, CURRENT_DATE
    `, [bond.id, premiumAmt, `Premium collected — ${bond.insured_name}`]);

    // Post commission only once the bond is fully collected, and only if no
    // post exists yet for this bond (partial payments must not double-post).
    const { rows: collRows } = await client.query(
      `SELECT COALESCE(SUM(amount),0) AS collected FROM bk_bond_payments WHERE bond_id=$1 AND status='collected'`,
      [bond.id]
    );
    const fullyPaid = parseFloat(collRows[0].collected) >= parseFloat(bond.premium) - 0.005;
    let commissionPosted = 0;
    if (fullyPaid && commAmt > 0) {
      const { rows: ledRows } = await client.query(`
        INSERT INTO bk_commission_ledger (bond_id, payment_id, amount, entry_date)
        SELECT $1, $2, $3, CURRENT_DATE
        WHERE NOT EXISTS (SELECT 1 FROM bk_commission_ledger cl WHERE cl.bond_id = $1 AND cl.amount > 0)
        RETURNING id
      `, [bond.id, payment.id, commAmt]);
      if (ledRows.length) {
        commissionPosted = commAmt;
        await client.query(`
          INSERT INTO bk_trust_account (bond_id, entry_type, amount, running_balance, description, entry_date)
          SELECT $1, 'commission_out', $2,
            COALESCE((SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1), 0) + $2,
            $3, CURRENT_DATE
        `, [bond.id, -commAmt, `Commission earned — ${bond.insured_name}`]);
      }
    }

    const { rows: balRows } = await client.query(
      `SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1`
    );
    const trustBalance = parseFloat(balRows[0]?.running_balance || 0);

    await logAudit(client, {
      action: 'payment.collect', entity: 'payment', entity_id: payment.id,
      actor: actorOf(req), amount: premiumAmt,
      detail: `Collected $${premiumAmt.toFixed(2)} for ${bond.insured_name} (bond ${bond.bond_number || bond.id}); commission posted $${commissionPosted.toFixed(2)}`,
    });

    await client.query('COMMIT');
    res.json({ ok: true, trust_balance: trustBalance, commission: commissionPosted, fully_paid: fullyPaid });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {}); // connection may already be dead
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

// Eligibility rule: a bond enters a remittance only when its premium is fully
// collected (SUM of collected payments >= premium) — pass include_uncollected:
// true to override — and only if it is not already attached to ANY remittance
// that isn't cancelled (pending ones count: a bond queued for remittance must
// not be picked up twice).
bookkeepingRouter.post('/remittances/generate', async (req, res) => {
  const { carrier_id, period_start, period_end, include_uncollected } = req.body;
  // Closed-period guard: the remittance's journal/trust entries are dated at
  // SEND time (not the covered period), so generating a statement FOR a
  // closed month remains the normal close-then-remit workflow — only a
  // closing date at/after today blocks new money entries.
  try {
    if (!(await guardClosedPeriod(req, res, [new Date()],
      { entity: 'remittance', detail: `Remittance generate carrier #${carrier_id} ${period_start}–${period_end}` }))) return;
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize ALL remittance generation (manual + cron auto-remit): the
    // NOT-EXISTS eligibility snapshot is race-unsafe under READ COMMITTED —
    // two concurrent generates would both see a bond as free and both include
    // it, paying the carrier twice. The xact-scoped advisory lock is released
    // automatically at COMMIT/ROLLBACK.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bk_remittance_generate'))`);

    const collectedCond = include_uncollected === true ? '' : `
        AND (SELECT COALESCE(SUM(py.amount),0) FROM bk_bond_payments py
             WHERE py.bond_id = b.id AND py.status='collected') >= b.premium`;
    // status IN ('issued','expired'): matches the shared revenue rule. A bond
    // whose premium was fully collected but that expired before a remittance
    // was generated must NOT become permanently unremittable — the carrier's
    // share would sit in trust forever and journal 2000 would never clear.
    const { rows: bonds } = await client.query(`
      SELECT b.id, b.premium, b.commission_amt
      FROM bk_bonds b
      WHERE b.carrier_id=$1
        AND b.effective_date BETWEEN $2 AND $3
        AND b.status IN ('issued','expired')
        ${collectedCond}
        AND NOT EXISTS (
          SELECT 1 FROM bk_remittance_bonds rb
          JOIN bk_carrier_remittances r ON r.id = rb.remittance_id
          WHERE rb.bond_id = b.id AND r.status != 'cancelled'
        )
    `, [carrier_id, period_start, period_end]);

    if (!bonds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No eligible bonds for this period' });
    }

    const totalPremium    = bonds.reduce((s, b) => s + parseFloat(b.premium), 0);
    const totalCommission = bonds.reduce((s, b) => s + parseFloat(b.commission_amt), 0);
    // Carrier share = premium − commission_amt per bond — NOT the generated
    // carrier_remit_amt, which rounds independently and can exceed
    // premium − commission by a cent when both halves round up (premium
    // 100.10 at 55%: 55.06 + 45.05 = 100.11). Using one figure keeps the
    // trust remittance_out, the 2000 payable clear, and the journal views on
    // exactly the same number, so trust can tie to the bank statement.
    const totalRemitted   = bonds.reduce((s, b) => s + (parseFloat(b.premium) - parseFloat(b.commission_amt)), 0);

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

    await logAudit(client, {
      action: 'remittance.generate', entity: 'remittance', entity_id: remittance.id,
      actor: actorOf(req), amount: parseFloat(remittance.total_remitted),
      detail: `Generated remittance #${remittance.id} (carrier #${carrier_id}, ${period_start}–${period_end}, ${bonds.length} bonds)`,
    });

    await client.query('COMMIT');
    res.json(remittance);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {}); // connection may already be dead
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// State machine: pending → sent → confirmed (pending → cancelled allowed).
// Re-PUT of the current status is a no-op; any other transition is rejected.
// Trust remittance_out posts exactly once, on the pending → sent transition.
// The carrier email goes out AFTER COMMIT. It is sent by DEFAULT on 'sent'
// (matching the pre-existing behavior the frontend relies on); pass
// send_email: false to explicitly suppress it.
const REMIT_TRANSITIONS = {
  pending:   ['sent', 'cancelled'],
  sent:      ['confirmed'],
  confirmed: [],
  cancelled: [],
};

bookkeepingRouter.put('/remittances/:id/status', async (req, res) => {
  const { status, notes } = req.body;
  const client = await pool.connect();
  let emailPayload = null;
  try {
    await client.query('BEGIN');

    const { rows: curRows } = await client.query(
      `SELECT * FROM bk_carrier_remittances WHERE id=$1 FOR UPDATE`, [req.params.id]
    );
    if (!curRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const current = curRows[0];

    if (status === current.status) {
      // Idempotent no-op: never re-post trust entries or re-email.
      await client.query('ROLLBACK');
      return res.json(current);
    }
    if (!(REMIT_TRANSITIONS[current.status] || []).includes(status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Invalid transition ${current.status} → ${status}` });
    }

    // Closed-period guard: trust remittance_out and the journal remittance
    // entry are dated today (sent_at) — see the generate endpoint's note.
    if (!(await guardClosedPeriod(req, res, [new Date()],
      { entity: 'remittance', entity_id: current.id, detail: `Remittance #${current.id} → ${status}` }))) {
      await client.query('ROLLBACK');
      return;
    }

    const { rows } = await client.query(
      `UPDATE bk_carrier_remittances SET status=$1, notes=COALESCE($2, notes),
       sent_at = CASE WHEN $1='sent' THEN NOW() ELSE sent_at END,
       confirmed_at = CASE WHEN $1='confirmed' THEN NOW() ELSE confirmed_at END
       WHERE id=$3 RETURNING *`,
      [status, notes||null, req.params.id]
    );
    const rem = rows[0];

    if (status === 'sent') {
      await client.query('LOCK TABLE bk_trust_account IN EXCLUSIVE MODE');
      // Trust only pays out money it actually holds. Per linked bond the
      // trust-funded carrier share is LEAST(premium_in collected into trust,
      // premium − commission): include_uncollected / direct-bill remittances
      // can contain bonds whose premium never touched trust, and posting the
      // full total_remitted for those would debit the trust ledger for money
      // it never held and drive running_balance negative. Legacy remittances
      // with no link rows fall back to total_remitted (pre-link behavior).
      const { rows: fundRows } = await client.query(`
        SELECT COUNT(*) AS links,
               COALESCE(ROUND(SUM(LEAST(f.funded, b.premium - b.commission_amt)), 2), 0) AS trust_funded
        FROM bk_remittance_bonds rb
        JOIN bk_bonds b ON b.id = rb.bond_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(t.amount), 0) AS funded
          FROM bk_trust_account t
          WHERE t.bond_id = b.id AND t.entry_type = 'premium_in'
        ) f ON true
        WHERE rb.remittance_id = $1
      `, [rem.id]);
      const totalRemitted = parseFloat(rem.total_remitted);
      const trustOut = parseInt(fundRows[0].links) === 0
        ? totalRemitted
        : Math.min(Math.max(parseFloat(fundRows[0].trust_funded), 0), totalRemitted);
      if (trustOut > 0) {
        const partialNote = trustOut < totalRemitted - 0.005
          ? ` (trust-funded $${trustOut.toFixed(2)} of $${totalRemitted.toFixed(2)} — remainder is direct-bill/uncollected, paid outside trust)`
          : '';
        await client.query(`
          INSERT INTO bk_trust_account (remittance_id, entry_type, amount, running_balance, description, entry_date)
          SELECT $1, 'remittance_out', $2,
            COALESCE((SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1), 0) + $2,
            $3, CURRENT_DATE
        `, [rem.id, -trustOut,
            `Remittance to carrier #${rem.carrier_id} for ${rem.period_start} to ${rem.period_end}${partialNote}`]);
      }

      if (req.body.send_email !== false) {
        const { rows: cRows } = await client.query(`SELECT * FROM bk_carriers WHERE id=$1`, [rem.carrier_id]);
        const carrier = cRows[0];
        if (carrier?.contact_email) {
          emailPayload = {
            from: FROM,
            to: carrier.contact_email,
            subject: `Remittance Statement — Quantum Surety (${rem.period_start} to ${rem.period_end})`,
            html: `<p>Please find enclosed your remittance for the period ${rem.period_start} to ${rem.period_end}.</p>
<p><strong>Bond Count:</strong> ${rem.bond_count}<br>
<strong>Total Premium:</strong> $${parseFloat(rem.total_premium).toFixed(2)}<br>
<strong>Commission (retained):</strong> $${parseFloat(rem.total_commission).toFixed(2)}<br>
<strong>Net Remittance:</strong> $${parseFloat(rem.total_remitted).toFixed(2)}</p>
<p>Payment is being processed.</p><p>— Quantum Surety LLC</p>`,
          };
        }
      }
    }

    await logAudit(client, {
      action: `remittance.${status}`, entity: 'remittance', entity_id: rem.id,
      actor: actorOf(req),
      amount: status === 'sent' ? parseFloat(rem.total_remitted) : null,
      detail: `Remittance #${rem.id} → ${status} (carrier #${rem.carrier_id}, ${rem.period_start}–${rem.period_end})`,
    });

    await client.query('COMMIT');

    // Email only after the transaction is durable, so a rollback can never
    // leave the carrier holding a statement for a transition that didn't land.
    if (emailPayload) {
      try { await sendEmail(emailPayload); }
      catch (e) { console.error('[bk remittance email]', e.message); }
    }

    res.json(rem);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {}); // connection may already be dead
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

// Trust reconciliation: current trust balance vs. what is actually owed to
// carriers (collected premium not yet remitted, minus commission retained).
bookkeepingRouter.get('/trust/reconciliation', async (req, res) => {
  try {
    const [bal, owed, pendingRem] = await Promise.all([
      pool.query(`SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1`),
      // Premium collected but not yet covered by a sent remittance, net of
      // commission. Aggregated at BOND grain: payments are summed per bond and
      // commission_amt is subtracted ONCE per bond (and only when the bond is
      // fully collected, because that is when the commission sweep leaves
      // trust). Remittance membership comes from bk_remittance_bonds — the
      // actual link table — not a same-carrier timing heuristic.
      // Cancelled bonds are split out: their collected premium is not owed to
      // the carrier — it is owed BACK to the insured as a refund (the
      // commission reversal restores the swept commission to trust on
      // cancellation, so trust holds the full collected amount). Lumping them
      // into net_owed_carriers made the reconciliation show a permanent
      // unexplained variance for every cancelled-after-collection bond.
      pool.query(`
        WITH per_bond AS (
          SELECT b.id, b.status, b.premium, b.commission_amt,
                 COALESCE(SUM(py.amount), 0) AS collected,
                 COUNT(py.id)                AS payment_count
          FROM bk_bonds b
          JOIN bk_bond_payments py ON py.bond_id = b.id AND py.status = 'collected'
          WHERE NOT EXISTS (
            SELECT 1 FROM bk_remittance_bonds rb
            JOIN bk_carrier_remittances r ON r.id = rb.remittance_id
            WHERE rb.bond_id = b.id AND r.status IN ('sent','confirmed')
          )
          GROUP BY b.id
        )
        SELECT
          COALESCE(SUM(collected) FILTER (WHERE status <> 'cancelled'), 0) AS premium_collected,
          COALESCE(SUM(CASE WHEN status <> 'cancelled' AND collected >= premium - 0.005 THEN commission_amt ELSE 0 END), 0) AS commission_retained,
          COALESCE(SUM(CASE WHEN status <> 'cancelled'
            THEN collected - CASE WHEN collected >= premium - 0.005 THEN commission_amt ELSE 0 END
            ELSE 0 END), 0) AS net_owed_carriers,
          COALESCE(SUM(collected) FILTER (WHERE status = 'cancelled'), 0) AS refunds_payable,
          COALESCE(SUM(payment_count), 0) AS payment_count
        FROM per_bond
      `),
      pool.query(`
        SELECT COALESCE(SUM(total_remitted),0) AS amount, COUNT(*) AS count
        FROM bk_carrier_remittances WHERE status='pending'
      `),
    ]);
    const trustBalance = parseFloat(bal.rows[0]?.running_balance || 0);
    const netOwed = parseFloat(owed.rows[0]?.net_owed_carriers || 0);
    const refundsPayable = parseFloat(owed.rows[0]?.refunds_payable || 0);
    const pendingAmt = parseFloat(pendingRem.rows[0]?.amount || 0);
    const totalObligations = netOwed + refundsPayable;
    res.json({
      trust_balance: trustBalance,
      premium_collected_unremitted: parseFloat(owed.rows[0]?.premium_collected || 0),
      commission_retained: parseFloat(owed.rows[0]?.commission_retained || 0),
      net_owed_carriers: netOwed,
      // Collected premium on cancelled bonds still sitting in trust — owed
      // back to the insured, not to the carrier.
      refunds_payable: refundsPayable,
      pending_remittances: pendingAmt,
      pending_remittance_count: parseInt(pendingRem.rows[0]?.count || 0),
      // Positive variance = trust holds more than is owed (healthy buffer);
      // negative = shortfall (trust under-funded vs. obligations).
      variance: +(trustBalance - totalObligations).toFixed(2),
      reconciled: Math.abs(trustBalance - totalObligations) < 0.01,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: rebuild every running_balance from the ordered cumulative SUM of
// amounts (by id), reporting drift before/after. Fixes any historical
// corruption from the old read-then-insert balance computation.
// POST (not GET): this mutates every row and writes an audit entry — it must
// never be reachable by a prefetching proxy or link scanner.
// ID-STABILITY INVARIANT: this rebuild only UPDATEs running_balance — it must
// NEVER delete/reinsert bk_trust_account rows or touch id/amount/entry_type.
// Bank reconciliation stores cleared journal lines keyed
// bk_trust_account:<id>:<line_no> (see bk_reports.js); changing ids or
// amounts would orphan cleared lines inside COMPLETED reconciliations.
bookkeepingRouter.post('/trust/rebuild', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE bk_trust_account IN EXCLUSIVE MODE');

    const { rows: driftRows } = await client.query(`
      WITH ordered AS (
        SELECT id, running_balance, SUM(amount) OVER (ORDER BY id) AS correct
        FROM bk_trust_account
      )
      SELECT COUNT(*) FILTER (WHERE running_balance IS DISTINCT FROM ROUND(correct,2)) AS drifted,
             COUNT(*) AS total,
             COALESCE(MAX(ABS(running_balance - ROUND(correct,2))),0) AS max_drift
      FROM ordered
    `);
    const before = driftRows[0];

    const { rowCount: updated } = await client.query(`
      WITH ordered AS (
        SELECT id, SUM(amount) OVER (ORDER BY id) AS correct
        FROM bk_trust_account
      )
      UPDATE bk_trust_account t
      SET running_balance = ROUND(o.correct, 2)
      FROM ordered o
      WHERE o.id = t.id AND t.running_balance IS DISTINCT FROM ROUND(o.correct, 2)
    `);

    const { rows: afterRows } = await client.query(
      `SELECT running_balance FROM bk_trust_account ORDER BY id DESC LIMIT 1`
    );

    await logAudit(client, {
      action: 'trust.rebuild', entity: 'trust', actor: actorOf(req),
      detail: `Rebuilt trust running balances: ${updated} of ${before.total} rows corrected (max drift $${parseFloat(before.max_drift).toFixed(2)})`,
    });

    await client.query('COMMIT');
    res.json({
      ok: true,
      rows_total: parseInt(before.total),
      rows_drifted: parseInt(before.drifted),
      max_drift: parseFloat(before.max_drift),
      rows_corrected: updated,
      current_balance: parseFloat(afterRows[0]?.running_balance || 0),
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {}); // connection may already be dead
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// Payment aging: pending (uncollected) payments bucketed by days outstanding.
bookkeepingRouter.get('/payments/aging', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH aged AS (
        SELECT py.id, py.amount,
          GREATEST(0, EXTRACT(DAY FROM NOW() - COALESCE(py.payment_date::timestamp, py.created_at))) AS days
        FROM bk_bond_payments py
        WHERE py.status = 'pending'
      )
      SELECT
        CASE
          WHEN days <= 30 THEN '0-30'
          WHEN days <= 60 THEN '31-60'
          WHEN days <= 90 THEN '61-90'
          ELSE '90+'
        END AS bucket,
        COUNT(*) AS count,
        COALESCE(SUM(amount),0) AS total
      FROM aged GROUP BY 1
    `);
    const order = ['0-30','31-60','61-90','90+'];
    const map = Object.fromEntries(rows.map(r => [r.bucket, r]));
    res.json(order.map(b => ({
      bucket: b,
      count: parseInt(map[b]?.count || 0),
      total: parseFloat(map[b]?.total || 0),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Money-mutation audit log (most recent first).
bookkeepingRouter.get('/audit', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM bk_audit_log ORDER BY id DESC LIMIT $1`, [limit]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

bookkeepingRouter.get('/dashboard', async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  try {
    const [kpi, trustBal, recentBonds, trend, byCarrier, byStatus] = await Promise.all([
      // KPI naming is accounting-accurate: premiums_written /
      // commission_written are WRITTEN figures by effective month (accrued at
      // issuance, regardless of collection) — not cash collected.
      // overdue_payments counts bonds with genuinely uncollected premium
      // 30+ days past effective date (the same rule as the payment-overdue
      // scan), not bonds aged by expiration date.
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN to_char(b.effective_date,'YYYY-MM')=$1 AND b.status IN ('issued','expired')
            THEN b.premium END), 0) as premiums_written,
          COALESCE(SUM(CASE WHEN to_char(b.effective_date,'YYYY-MM')=$1 AND b.status IN ('issued','expired')
            THEN b.commission_amt END), 0) as commission_written,
          COALESCE((SELECT SUM(total_remitted) FROM bk_carrier_remittances
            WHERE status='sent' AND to_char(sent_at,'YYYY-MM')=$1), 0) as remittances_sent,
          COUNT(DISTINCT CASE WHEN to_char(b.effective_date,'YYYY-MM')=$1 AND b.status IN ('issued','expired') THEN b.id END) as bonds_issued,
          COUNT(DISTINCT CASE WHEN b.status='issued'
            AND b.effective_date < CURRENT_DATE - 30
            AND NOT EXISTS (SELECT 1 FROM bk_bond_payments py WHERE py.bond_id=b.id AND py.status='collected')
            AND NOT (b.source='scraper' AND EXISTS (SELECT 1 FROM bk_carriers dc WHERE dc.id=b.carrier_id AND dc.direct_bill))
            THEN b.id END) as overdue_payments,
          COUNT(DISTINCT CASE WHEN b.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE+45
            AND b.status='issued'
            AND NOT EXISTS (SELECT 1 FROM bk_renewal_alerts ra WHERE ra.bond_id=b.id AND ra.status='renewed')
            THEN b.id END) as renewals_due,
          COALESCE(SUM(CASE WHEN b.status='saved' THEN b.premium END), 0) as pipeline_premium,
          COALESCE(SUM(CASE WHEN b.status='saved' THEN b.commission_amt END), 0) as pipeline_commission,
          COUNT(DISTINCT CASE WHEN b.status='saved' THEN b.id END) as pipeline_count
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
          AND b.status IN ('issued','expired')
        GROUP BY 1 ORDER BY 1
      `),
      pool.query(`
        SELECT c.name as carrier_name,
          COUNT(b.id) as bond_count, SUM(b.premium) as total_premium,
          SUM(b.commission_amt) as total_commission
        FROM bk_bonds b JOIN bk_carriers c ON c.id = b.carrier_id
        WHERE to_char(b.effective_date,'YYYY-MM') = $1
          AND b.status IN ('issued','expired')
        GROUP BY c.id, c.name ORDER BY total_premium DESC
      `, [month]),
      pool.query(`
        SELECT status, COUNT(*) AS count,
          COALESCE(SUM(premium),0) AS total_premium,
          COALESCE(SUM(commission_amt),0) AS total_commission
        FROM bk_bonds GROUP BY status ORDER BY count DESC
      `),
    ]);

    res.json({
      ...kpi.rows[0],
      trust_balance: trustBal.rows[0]?.running_balance || 0,
      recent_bonds: recentBonds.rows,
      trend: trend.rows,
      by_carrier: byCarrier.rows,
      by_status: byStatus.rows,
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

// Scraper rows are validated before touching bk_bonds; invalid rows are flagged
// into bk_scraper_recon with the specific reason instead of fabricating data.
const EMPTYISH = v => v == null || String(v).trim() === '' || String(v).trim() === '—';
const validNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
const validDate = v => !EMPTYISH(v) && !isNaN(Date.parse(v));

async function flagScraperRow(b, reason) {
  try {
    await pool.query(`
      INSERT INTO bk_scraper_recon (external_id, scraper_source, flag, error)
      VALUES ($1,$2,'import_error',$3)
      ON CONFLICT (external_id, flag) WHERE external_id IS NOT NULL
      DO UPDATE SET error = EXCLUDED.error, resolved = false
    `, [EMPTYISH(b?.bond_number) ? null : String(b.bond_number).trim(), b?.source || 'scraper', reason]);
  } catch (e) { console.error('[bk scraper recon]', e.message); }
}

bookkeepingRouter.post('/bonds/upsert-from-scraper', async (req, res) => {
  const bonds = Array.isArray(req.body) ? req.body : [req.body];
  let upserted = 0, flagged = 0;
  for (const b of bonds) {
    // ── validation ──
    if (typeof b?.bond_number !== 'string' || !b.bond_number.trim()) {
      await flagScraperRow(b, 'missing or empty bond_number'); flagged++; continue;
    }
    if (b.premium != null && b.premium !== '' && !validNum(b.premium)) {
      await flagScraperRow(b, `invalid premium: ${b.premium}`); flagged++; continue;
    }
    if (b.bond_amount != null && b.bond_amount !== '' && !validNum(b.bond_amount)) {
      await flagScraperRow(b, `invalid bond_amount: ${b.bond_amount}`); flagged++; continue;
    }
    if (b.effective_date != null && b.effective_date !== '' && !validDate(b.effective_date)) {
      await flagScraperRow(b, `invalid effective_date: ${b.effective_date}`); flagged++; continue;
    }
    if (b.expiration_date != null && b.expiration_date !== '' && !validDate(b.expiration_date)) {
      await flagScraperRow(b, `invalid expiration_date: ${b.expiration_date}`); flagged++; continue;
    }
    try {
      const bondNumber = b.bond_number.trim();
      // A field the scraper omits is bound as NULL so the ON CONFLICT
      // COALESCE genuinely preserves the existing value — the old code bound
      // `b.commission_rate || 0.20` / `b.status || 'issued'`, which made
      // EXCLUDED never-NULL and silently reset manually-set commission rates
      // (regenerating commission_amt out from under the posted ledger) and
      // resurrected cancelled bonds on every sync. The 0.20 / 'issued'
      // defaults now apply ONLY on first insert, via COALESCE in VALUES
      // (referencing the raw parameters, not EXCLUDED, in DO UPDATE).
      // validNum accepts 0, so a legitimate rate of 0 stays 0.
      let rateParam     = validNum(b.commission_rate) ? b.commission_rate : null;
      let premiumParam  = validNum(b.premium) ? b.premium : null;
      const statusParam = EMPTYISH(b.status) ? null : String(b.status).trim();

      // Capture the pre-upsert status so a scraper-driven transition to
      // 'cancelled' can run the same commission-reversal logic as the UI path
      // (premium/commission_rate feed the posted-money freeze below).
      const { rows: prevRows } = await pool.query(
        `SELECT id, status, premium, commission_rate FROM bk_bonds WHERE bond_number = $1`, [bondNumber]
      );
      const prevStatus = prevRows[0]?.status || null;

      // Posted-money freeze (mirrors PUT /bonds/:id): once commission is
      // posted to the ledger or the bond is in a sent/confirmed remittance,
      // a diverging premium / commission_rate from the feed must NOT rewrite
      // those two columns (commission_amt is generated from them and money is
      // already booked). Keep the new values out and flag the divergence in
      // bk_scraper_recon so the operator sees it. Header x-allow-posted-edit:
      // true lets the values through, audited.
      if (prevRows.length) {
        const prevB = prevRows[0];
        const premiumDiverges = premiumParam != null &&
          Math.abs(parseFloat(premiumParam) - parseFloat(prevB.premium)) > 0.005;
        const rateDiverges = rateParam != null &&
          Math.abs(parseFloat(rateParam) - parseFloat(prevB.commission_rate)) > 0.000005;
        if ((premiumDiverges || rateDiverges) && await bondMoneyPosted(pool, prevB.id)) {
          if (String(req.headers['x-allow-posted-edit'] || '').toLowerCase() === 'true') {
            await logAudit(null, {
              action: 'posted-edit-override', entity: 'bond', entity_id: prevB.id, actor: actorOf(req),
              detail: `Scraper override on posted bond ${bondNumber}: premium ${prevB.premium} → ${premiumDiverges ? premiumParam : 'unchanged'}, rate ${prevB.commission_rate} → ${rateDiverges ? rateParam : 'unchanged'}`,
            });
          } else {
            const diffDetail = [
              premiumDiverges ? `premium ${prevB.premium} → ${premiumParam}` : null,
              rateDiverges ? `commission_rate ${prevB.commission_rate} → ${rateParam}` : null,
            ].filter(Boolean).join('; ');
            try {
              await pool.query(`
                INSERT INTO bk_scraper_recon (bond_id, external_id, scraper_source, flag, error)
                VALUES ($1,$2,$3,'posted_divergence',$4)
                ON CONFLICT (external_id, flag) WHERE external_id IS NOT NULL
                DO UPDATE SET error = EXCLUDED.error, resolved = false, bond_id = EXCLUDED.bond_id
              `, [prevB.id, bondNumber, b.source || 'scraper',
                  `Feed diverges from posted bond: ${diffDetail} — new value NOT applied (commission already posted/remitted)`]);
            } catch (e) { console.error('[bk scraper recon]', e.message); }
            if (premiumDiverges) premiumParam = null; // COALESCE keeps the existing value
            if (rateDiverges)    rateParam = null;
          }
        }
      }

      // COALESCE keeps existing values when the scraper omits a field, and
      // insured_name is never downgraded to empty or the '—' placeholder.
      await pool.query(`
        INSERT INTO bk_bonds (bond_number, carrier_id, insured_name, insured_email, insured_phone, bond_type,
          bond_amount, premium, commission_rate, effective_date, expiration_date, status,
          status_detail, submission_no, principal_address, source, auto_generated, cancelled_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::numeric, 0.20),$10,$11,COALESCE($12::text, 'issued'),$13,$14,$15,'scraper',true,
          CASE WHEN COALESCE($12::text, 'issued') = 'cancelled' THEN CURRENT_DATE END)
        ON CONFLICT (bond_number) DO UPDATE SET
          insured_name = CASE
            WHEN EXCLUDED.insured_name IS NULL OR btrim(EXCLUDED.insured_name) IN ('', '—')
            THEN bk_bonds.insured_name ELSE EXCLUDED.insured_name END,
          insured_email     = COALESCE(EXCLUDED.insured_email, bk_bonds.insured_email),
          insured_phone     = COALESCE(EXCLUDED.insured_phone, bk_bonds.insured_phone),
          bond_type         = COALESCE(EXCLUDED.bond_type, bk_bonds.bond_type),
          bond_amount       = COALESCE(EXCLUDED.bond_amount, bk_bonds.bond_amount),
          effective_date    = COALESCE(EXCLUDED.effective_date, bk_bonds.effective_date),
          expiration_date   = COALESCE(EXCLUDED.expiration_date, bk_bonds.expiration_date),
          premium           = COALESCE(EXCLUDED.premium, bk_bonds.premium),
          commission_rate   = COALESCE($9::numeric, bk_bonds.commission_rate),
          status            = COALESCE($12::text, bk_bonds.status),
          status_detail     = COALESCE(EXCLUDED.status_detail, bk_bonds.status_detail),
          submission_no     = COALESCE(EXCLUDED.submission_no, bk_bonds.submission_no),
          principal_address = COALESCE(EXCLUDED.principal_address, bk_bonds.principal_address),
          -- cancelled_at FREEZES at first observation of the cancelled state
          -- (COALESCE keeps the existing date on later syncs). The journal
          -- views date cancellation reversals from it, so closed-period
          -- reports no longer re-date every night with updated_at.
          cancelled_at      = CASE WHEN COALESCE($12::text, bk_bonds.status) = 'cancelled'
                                   THEN COALESCE(bk_bonds.cancelled_at, CURRENT_DATE) ELSE NULL END,
          updated_at = NOW()
      `, [bondNumber, b.carrier_id,
          EMPTYISH(b.insured_name) ? '—' : String(b.insured_name).trim(),
          b.insured_email || null, b.insured_phone || null,
          b.bond_type || null,
          validNum(b.bond_amount) ? b.bond_amount : null,
          premiumParam,
          rateParam,
          validDate(b.effective_date) ? b.effective_date : null,
          validDate(b.expiration_date) ? b.expiration_date : null,
          statusParam,
          b.status_detail || null, b.submission_no || null, b.principal_address || null]);
      // Direct-bill bonds never pass through payment collection, so post
      // commission to the ledger here the first time a bond shows as issued.
      // Gated on BOTH source='scraper' (an agency bond that also appears in a
      // scraper feed keeps source='manual' and must earn its commission via
      // the collect path, or the collect path's NOT EXISTS would suppress the
      // trust sweep and strand the commission in trust) AND the carrier's
      // direct_bill flag (nothing in the payload guarantees a scraper bond is
      // direct-bill). amount > 0 excludes cancellation reversals AND stray $0
      // rows from the once-only check.
      if (statusParam === 'issued' || statusParam === null) {
        await pool.query(`
          INSERT INTO bk_commission_ledger (bond_id, amount, entry_date, notes)
          SELECT id, commission_amt, COALESCE(effective_date, CURRENT_DATE),
                 'RLI direct-bill commission (auto-posted from scraper sync)'
          FROM bk_bonds
          WHERE bond_number = $1 AND status = 'issued' AND commission_amt IS NOT NULL AND commission_amt > 0
            AND source = 'scraper'
            AND EXISTS (SELECT 1 FROM bk_carriers c WHERE c.id = bk_bonds.carrier_id AND c.direct_bill)
            AND NOT EXISTS (SELECT 1 FROM bk_commission_ledger cl WHERE cl.bond_id = bk_bonds.id AND cl.amount > 0)
        `, [bondNumber]);
      }
      // Scraper-driven cancellation goes through the SAME reversal path as
      // the UI (PUT /bonds/:id). The condition is STATE-based, not
      // transition-based: if a prior sync's reversal transaction failed after
      // the status='cancelled' upsert committed, every later sync would see
      // prevStatus='cancelled' and a transition gate would skip the retry
      // forever. Instead, on every sync of a cancelled bond, reverse iff an
      // unreversed positive post still exists (cheap pre-check; the reversal
      // itself is idempotent).
      const nowCancelled = statusParam === 'cancelled' || (statusParam === null && prevStatus === 'cancelled');
      if (nowCancelled) {
        const { rows: pending } = await pool.query(`
          SELECT b.id FROM bk_bonds b
          WHERE b.bond_number = $1 AND b.status = 'cancelled'
            AND EXISTS (
              SELECT 1 FROM bk_commission_ledger cl
              WHERE cl.bond_id = b.id AND cl.amount > 0
                AND NOT EXISTS (SELECT 1 FROM bk_commission_ledger r
                                WHERE r.bond_id = b.id AND r.amount < 0 AND r.id > cl.id))
        `, [bondNumber]);
        if (pending.length) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const { rows: bondRows } = await client.query(
              `SELECT id, bond_number, insured_name, status FROM bk_bonds WHERE bond_number = $1 FOR UPDATE`, [bondNumber]
            );
            if (bondRows.length && bondRows[0].status === 'cancelled') {
              await reverseCommissionOnCancel(client, bondRows[0], 'scraper');
            }
            await client.query('COMMIT');
          } catch (e2) {
            await client.query('ROLLBACK').catch(() => {});
            // Safe to only log: the state-based condition above retries the
            // reversal on the next sync of this cancelled bond.
            console.error('[bk scraper cancel reversal]', e2.message);
          } finally { client.release(); }
        }
      }
      // Scraper-driven cancelled → issued reinstatement goes through the SAME
      // re-post path as the UI (PUT /bonds/:id). State-based like the cancel
      // block above: re-post iff the newest negative (reversal) row is not
      // yet followed by a positive row, so a failed re-post transaction
      // retries on the next sync instead of stranding commission at net zero.
      const nowIssued = statusParam === 'issued' || (statusParam === null && prevStatus === 'issued');
      if (nowIssued) {
        const { rows: pendingRe } = await pool.query(`
          SELECT b.id FROM bk_bonds b
          WHERE b.bond_number = $1 AND b.status = 'issued'
            AND EXISTS (
              SELECT 1 FROM bk_commission_ledger n
              WHERE n.bond_id = b.id AND n.amount < 0
                AND NOT EXISTS (SELECT 1 FROM bk_commission_ledger p
                                WHERE p.bond_id = b.id AND p.amount > 0 AND p.id > n.id))
        `, [bondNumber]);
        if (pendingRe.length) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const { rows: bondRows } = await client.query(
              `SELECT id, bond_number, insured_name, status FROM bk_bonds WHERE bond_number = $1 FOR UPDATE`, [bondNumber]
            );
            if (bondRows.length && bondRows[0].status === 'issued') {
              await repostCommissionOnReinstate(client, bondRows[0], 'scraper');
            }
            await client.query('COMMIT');
          } catch (e2) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('[bk scraper reinstate repost]', e2.message);
          } finally { client.release(); }
        }
      }
      upserted++;
    } catch (e) {
      await flagScraperRow(b, e.message);
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
    const csv = toCsv(
      ['Bond #','Insured','Email','Type','Bond Amount','Premium','Commission','Carrier Net','Rate %','Effective','Expiration','Status','Carrier'],
      rows.map(r =>
        [r.bond_number,r.insured_name,r.insured_email,r.bond_type,r.bond_amount,
         r.premium,r.commission_amt,r.carrier_remit_amt,(parseFloat(r.commission_rate||0)*100).toFixed(1)+'%',
         r.effective_date,r.expiration_date,r.status,r.carrier])
    );
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
    const csv = toCsv(
      ['ID','Carrier','Period Start','Period End','Bonds','Total Premium','Commission','Net Remitted','Status','Sent At'],
      rows.map(r =>
        [r.id,r.carrier,r.period_start,r.period_end,r.bond_count,
         r.total_premium,r.total_commission,r.total_remitted,r.status,r.sent_at||''])
    );
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
    const csv = toCsv(
      ['Date','Bond #','Insured','Type','Premium','Commission','Carrier Net','Carrier'],
      rows.map(r =>
        [r.entry_date,r.bond_number,r.insured_name,r.bond_type,
         r.premium,r.commission,r.carrier_remit_amt,r.carrier])
    );
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
    const csv = toCsv(
      ['Date','Type','Amount','Balance','Description','Insured','Bond Type'],
      rows.map(r =>
        [r.entry_date,r.entry_type,r.amount,r.running_balance,r.description,r.insured_name||'',r.bond_type||''])
    );
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
  // Direct-bill bonds are excluded: the insured pays the carrier directly,
  // so "no collected payment" is their normal state, not an overdue premium.
  const { rows: bonds } = await pool.query(`
    SELECT b.id, (CURRENT_DATE - b.effective_date::date) as overdue_days
    FROM bk_bonds b
    WHERE b.status='issued'
      AND b.effective_date < CURRENT_DATE - INTERVAL '30 days'
      AND NOT EXISTS (SELECT 1 FROM bk_bond_payments py WHERE py.bond_id=b.id AND py.status='collected')
      AND NOT (b.source='scraper' AND EXISTS (SELECT 1 FROM bk_carriers dc WHERE dc.id=b.carrier_id AND dc.direct_bill))
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
  // Day-of-month clamp: a carrier with remittance_day 29–31 must still fire
  // in months lacking that day — the effective day is
  // LEAST(remittance_day, last day of the current month), so a day-31 carrier
  // fires on Feb 28/29, Apr 30, etc.
  const { rows: carriers } = await pool.query(`
    SELECT * FROM bk_carriers
    WHERE active = true
      AND LEAST(remittance_day,
                EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day'))::int)
          = EXTRACT(DAY FROM CURRENT_DATE)::int
  `);
  const generated = [];
  for (const carrier of carriers) {
    const periodStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().slice(0,10);
    const periodEnd   = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0,10);
    // One transaction per carrier: header + link rows land together or not at
    // all (the old non-transactional loop could crash mid-way, leaving a
    // remittance whose totals included never-linked bonds that then got
    // counted again next run). The advisory xact lock serializes against
    // POST /remittances/generate so a concurrent manual generate can't grab
    // the same bonds.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('bk_remittance_generate'))`);
      // Same eligibility rule as POST /remittances/generate: fully collected,
      // and not already in any non-cancelled remittance.
      // status IN ('issued','expired') matches POST /remittances/generate: a
      // fully collected bond that expires before remittance must still remit.
      const { rows: bonds } = await client.query(`
        SELECT b.id FROM bk_bonds b
        WHERE b.carrier_id=$1 AND b.effective_date BETWEEN $2 AND $3 AND b.status IN ('issued','expired')
          AND (SELECT COALESCE(SUM(py.amount),0) FROM bk_bond_payments py
               WHERE py.bond_id = b.id AND py.status='collected') >= b.premium
          AND NOT EXISTS (
            SELECT 1 FROM bk_remittance_bonds rb
            JOIN bk_carrier_remittances r ON r.id=rb.remittance_id
            WHERE rb.bond_id=b.id AND r.status != 'cancelled'
          )
      `, [carrier.id, periodStart, periodEnd]);
      if (!bonds.length) { await client.query('ROLLBACK'); continue; }
      const bondIds = bonds.map(b => b.id);
      // tr = SUM(premium − commission_amt), NOT the generated carrier_remit_amt
      // (which can round a cent high) — one figure for trust, payable, journal.
      const { rows: totals } = await client.query(
        `SELECT SUM(premium) as tp, SUM(commission_amt) as tc, SUM(premium - commission_amt) as tr
         FROM bk_bonds WHERE id = ANY($1)`, [bondIds]
      );
      const t = totals[0];
      const { rows: rRows } = await client.query(`
        INSERT INTO bk_carrier_remittances
          (carrier_id, period_start, period_end, bond_count, total_premium, total_commission, total_remitted, auto_generated)
        VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *
      `, [carrier.id, periodStart, periodEnd, bondIds.length,
          parseFloat(t.tp||0).toFixed(2), parseFloat(t.tc||0).toFixed(2), parseFloat(t.tr||0).toFixed(2)]);
      for (const id of bondIds) {
        await client.query(`INSERT INTO bk_remittance_bonds (remittance_id, bond_id) VALUES ($1,$2)`, [rRows[0].id, id]);
      }
      await client.query('COMMIT');
      generated.push({ carrier: carrier.name, remittance_id: rRows[0].id, bond_count: bondIds.length });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[bk auto-remittance]', carrier.name, e.message);
    } finally { client.release(); }
  }
  return { generated };
}

// Write today's KPI snapshot into bk_kpi_cache (read by GET /kpi). Same
// computation as the /kpi live path; run daily via /jobs/run-all so the cache
// path actually serves (previously nothing ever wrote this table).
async function runKpiSnapshot() {
  const year = new Date().getFullYear().toString();
  const month = new Date().toISOString().slice(0, 7);
  const [mtd, ytd, active, expiring, bills] = await Promise.all([
    pool.query("SELECT COUNT(*) AS bonds, COALESCE(SUM(commission_amt),0) AS commission, COALESCE(SUM(premium),0) AS premium FROM bk_bonds WHERE to_char(effective_date,'YYYY-MM')=$1 AND status IN ('issued','expired')", [month]),
    pool.query("SELECT COUNT(*) AS bonds, COALESCE(SUM(commission_amt),0) AS commission FROM bk_bonds WHERE EXTRACT(YEAR FROM effective_date)=$1 AND status IN ('issued','expired')", [year]),
    pool.query('SELECT COUNT(*) AS count FROM bk_bonds WHERE status=$1', ['issued']),
    pool.query('SELECT COUNT(*) AS count FROM bk_bonds WHERE status=$1 AND expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE+30', ['issued']),
    pool.query('SELECT COALESCE(SUM(amount),0) AS total FROM bk_bills WHERE status=$1', ['unpaid']),
  ]);
  // Refresh today's snapshot in place (delete-then-insert; /kpi reads the
  // newest row for today so a re-run just supersedes the earlier one).
  await pool.query('DELETE FROM bk_kpi_cache WHERE snapshot_date = CURRENT_DATE');
  await pool.query(`
    INSERT INTO bk_kpi_cache
      (snapshot_date, active_bonds, mtd_commission, ytd_commission, mtd_premium, mtd_bonds, ytd_bonds, expiring_30d, unpaid_bills)
    VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8)
  `, [parseInt(active.rows[0].count), mtd.rows[0].commission, ytd.rows[0].commission,
      mtd.rows[0].premium, parseInt(mtd.rows[0].bonds), parseInt(ytd.rows[0].bonds),
      parseInt(expiring.rows[0].count), bills.rows[0].total]);
  return { snapshot_date: new Date().toISOString().slice(0, 10) };
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
    const [renewal, payment, remit, kpi] = await Promise.all([
      runRenewalScan(), runPaymentOverdueScan(), runAutoRemittance(), runKpiSnapshot()
    ]);
    res.json({ renewal, payment, remit, kpi });
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

    // Revenue rule (shared with /dashboard and /kpi): bonds with status IN
    // ('issued','expired') — an issued bond that later expires stays revenue.
    // SUM(commission_amt) — the stored generated column — is THE revenue
    // figure everywhere (dashboard, kpi, journal views, tax packet); never
    // recompute premium*rate, whose rounding differs per aggregation order.
    // NOTE: this endpoint (like /dashboard and /kpi) EXCLUDES cancelled bonds
    // retroactively, while the accrual journal (/reports/pnl) books issuance
    // revenue in the issue period and a reversal in the cancellation period —
    // period-level figures legitimately differ for cancelled bonds.
    const { rows: revRows } = await pool.query(
      `SELECT bond_type, SUM(commission_amt) AS commission
       FROM bk_bonds WHERE ${conds.join(' AND ')} AND status IN ('issued','expired')
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

// ─── RECURRING EXPENSES ────────────────────────────────────────────────────
bookkeepingRouter.get('/expenses/recurring', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT r.*, c.name AS category_name FROM bk_recurring_expenses r LEFT JOIN bk_expense_categories c ON c.id=r.category_id ORDER BY r.next_due`);
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});
bookkeepingRouter.post('/expenses/recurring', async (req, res) => {
  const { category_id, vendor, description, amount, frequency, start_date, payment_method, notes } = req.body;
  if (!vendor||!amount||!frequency) return res.status(400).json({error:'vendor, amount, frequency required'});
  try {
    const { rows } = await pool.query(
      `INSERT INTO bk_recurring_expenses (category_id,vendor,description,amount,frequency,start_date,next_due,payment_method,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8) RETURNING *`,
      [category_id||null,vendor,description||'',amount,frequency,start_date||new Date().toISOString().slice(0,10),payment_method||'card',notes||'']
    );
    await logAudit(null, { action:'recurring.create', entity:'recurring_expense', entity_id:rows[0].id,
      actor:actorOf(req), amount:parseFloat(amount)||null, detail:`Recurring ${frequency} expense — ${vendor}` });
    res.json(rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});
bookkeepingRouter.delete('/expenses/recurring/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM bk_recurring_expenses WHERE id=$1',[req.params.id]);
    await logAudit(null, { action:'recurring.delete', entity:'recurring_expense', entity_id:parseInt(req.params.id),
      actor:actorOf(req), detail:`Deleted recurring expense #${req.params.id}` });
    res.json({ok:true});
  }
  catch(e){ res.status(500).json({error:e.message}); }
});
bookkeepingRouter.post('/expenses/recurring/:id/run', async (req, res) => {
  try {
    // Expense lands at CURRENT_DATE — only blocked when books are closed
    // through today or later.
    if (!(await guardClosedPeriod(req, res, [new Date()],
      { entity: 'recurring_expense', entity_id: parseInt(req.params.id), detail: 'Recurring expense manual run' }))) return;
    const { rows:rr } = await pool.query('SELECT * FROM bk_recurring_expenses WHERE id=$1',[req.params.id]);
    if (!rr.length) return res.status(404).json({error:'not found'});
    const r = rr[0];
    const { rows:exp } = await pool.query(
      `INSERT INTO bk_expenses (category_id,vendor,description,amount,expense_date,payment_method,notes)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6) RETURNING *`,
      [r.category_id,r.vendor,r.description,r.amount,r.payment_method,`Auto-created from recurring: ${r.notes||''}`]
    );
    // advance next_due
    const freq = r.frequency;
    const interval = freq==='weekly'?'7 days':freq==='monthly'?'1 month':freq==='quarterly'?'3 months':'1 year';
    await pool.query(`UPDATE bk_recurring_expenses SET next_due=next_due+INTERVAL '${interval}', run_count=run_count+1, last_run=CURRENT_DATE WHERE id=$1`,[r.id]);
    res.json({ok:true,expense:exp[0]});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── 1099 VENDOR TRACKER ───────────────────────────────────────────────────
bookkeepingRouter.get('/vendors/1099', async (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  try {
    const { rows } = await pool.query(`
      SELECT vendor,
        SUM(amount) AS total_paid,
        COUNT(*) AS payment_count,
        MIN(expense_date) AS first_payment,
        MAX(expense_date) AS last_payment,
        CASE WHEN SUM(amount) >= 600 THEN true ELSE false END AS needs_1099
      FROM bk_expenses
      WHERE EXTRACT(YEAR FROM expense_date) = $1
      GROUP BY vendor
      ORDER BY total_paid DESC
    `, [year]);
    const vendors1099 = rows.filter(r=>parseFloat(r.total_paid)>=600);
    res.json({ year, all_vendors: rows, vendors_1099: vendors1099, total_1099_count: vendors1099.length });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── BUDGET VS ACTUAL ──────────────────────────────────────────────────────
bookkeepingRouter.get('/budgets', async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0,7);
  try {
    const { rows:budgets } = await pool.query(`SELECT b.*, c.name AS category_name FROM bk_budgets b JOIN bk_expense_categories c ON c.id=b.category_id WHERE b.month=$1 ORDER BY c.name`,[month]);
    const { rows:actuals } = await pool.query(`
      SELECT COALESCE(pc.id,c.id) AS category_id, SUM(e.amount) AS actual
      FROM bk_expenses e
      LEFT JOIN bk_expense_categories c ON c.id=e.category_id
      LEFT JOIN bk_expense_categories pc ON pc.id=c.parent_id
      WHERE to_char(e.expense_date,'YYYY-MM')=$1
      GROUP BY 1
    `,[month]);
    const actMap = Object.fromEntries(actuals.map(a=>[a.category_id,parseFloat(a.actual)]));
    const result = budgets.map(b=>({...b,actual:actMap[b.category_id]||0,variance:(actMap[b.category_id]||0)-parseFloat(b.budget_amount)}));
    res.json({month,budgets:result});
  } catch(e){ res.status(500).json({error:e.message}); }
});
bookkeepingRouter.post('/budgets', async (req, res) => {
  const { category_id, month, budget_amount } = req.body;
  if (!category_id||!month||!budget_amount) return res.status(400).json({error:'category_id, month, budget_amount required'});
  try {
    const { rows } = await pool.query(
      `INSERT INTO bk_budgets (category_id,month,budget_amount) VALUES ($1,$2,$3)
       ON CONFLICT (category_id,month) DO UPDATE SET budget_amount=$3 RETURNING *`,
      [category_id,month,budget_amount]
    );
    await logAudit(null, { action:'budget.upsert', entity:'budget', entity_id:rows[0].id,
      actor:actorOf(req), amount:parseFloat(budget_amount)||null, detail:`Budget for category #${category_id}, ${month}` });
    res.json(rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});
bookkeepingRouter.delete('/budgets/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM bk_budgets WHERE id=$1',[req.params.id]);
    await logAudit(null, { action:'budget.delete', entity:'budget', entity_id:parseInt(req.params.id),
      actor:actorOf(req), detail:`Deleted budget #${req.params.id}` });
    res.json({ok:true});
  }
  catch(e){ res.status(500).json({error:e.message}); }
});

// ─── YEAR-END TAX PACKET ───────────────────────────────────────────────────
bookkeepingRouter.get('/export/tax-packet', async (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  try {
    const [bonds, expenses, vendors1099, summary] = await Promise.all([
      pool.query(`SELECT bond_number,insured_name,bond_type,premium,commission_rate,commission_amt,carrier_remit_amt,effective_date,status FROM bk_bonds WHERE EXTRACT(YEAR FROM effective_date)=$1 AND status IN ('issued','expired') ORDER BY effective_date`,[year]),
      pool.query(`SELECT e.expense_date,e.vendor,e.description,e.amount,c.name AS category,COALESCE(c.deductible_pct,100) AS deductible_pct,ROUND(e.amount*COALESCE(c.deductible_pct,100)/100,2) AS deductible_amt FROM bk_expenses e LEFT JOIN bk_expense_categories c ON c.id=e.category_id WHERE EXTRACT(YEAR FROM e.expense_date)=$1 ORDER BY e.expense_date`,[year]),
      pool.query(`SELECT vendor,SUM(amount) AS total FROM bk_expenses WHERE EXTRACT(YEAR FROM expense_date)=$1 GROUP BY vendor HAVING SUM(amount)>=600 ORDER BY total DESC`,[year]),
      pool.query(`SELECT SUM(premium) AS total_premium,SUM(commission_amt) AS total_commission,SUM(carrier_remit_amt) AS total_remitted,COUNT(*) AS bond_count FROM bk_bonds WHERE EXTRACT(YEAR FROM effective_date)=$1 AND status IN ('issued','expired')`,[year]),
    ]);
    const totalExp = expenses.rows.reduce((s,r)=>s+parseFloat(r.amount),0);
    const totalDed = expenses.rows.reduce((s,r)=>s+parseFloat(r.deductible_amt),0);
    const rev = parseFloat(summary.rows[0]?.total_commission||0);
    const netIncome = rev - totalDed;

    // SE tax mirrors /ai/tax-estimate exactly: 12.4% Social Security capped at
    // the wage base, plus 2.9% Medicare uncapped (not a flat 15.3%).
    const SS_WAGE_BASE = 176100;
    const seBase = Math.max(0, netIncome) * 0.9235;
    const seTax = Math.min(seBase, SS_WAGE_BASE) * 0.124 + seBase * 0.029;

    const csv = (rows,cols) => toCsv(cols, rows.map(r=>cols.map(c=>r[c]??'')));
    const out = [
      `QUANTUM SURETY LLC — TAX PACKET ${year}`,
      `Generated: ${new Date().toISOString().slice(0,10)}`,
      '',
      `INCOME SUMMARY`,
      `Total Premiums Written,$${parseFloat(summary.rows[0]?.total_premium||0).toFixed(2)}`,
      `Commission Revenue,$${rev.toFixed(2)}`,
      `Carrier Remittances,$${parseFloat(summary.rows[0]?.total_remitted||0).toFixed(2)}`,
      `Bonds Issued,${summary.rows[0]?.bond_count||0}`,
      '',
      `EXPENSE SUMMARY`,
      `Total Expenses,$${totalExp.toFixed(2)}`,
      `Deductible Amount,$${totalDed.toFixed(2)}`,
      `Net Income (Revenue - Deductible Expenses),$${netIncome.toFixed(2)}`,
      '',
      `SE TAX ESTIMATE`,
      `SE Tax Base (92.35% of net),$${seBase.toFixed(2)}`,
      // No thousands separator: an unquoted comma would shift this row's columns.
      `SE Tax (12.4% SS capped at $${SS_WAGE_BASE} + 2.9% Medicare),$${seTax.toFixed(2)}`,
      '',
      '--- BOND DETAIL ---',
      csv(bonds.rows,['bond_number','insured_name','bond_type','premium','commission_amt','carrier_remit_amt','effective_date']),
      '',
      '--- EXPENSE DETAIL ---',
      csv(expenses.rows,['expense_date','vendor','description','amount','category','deductible_pct','deductible_amt']),
      '',
      '--- 1099 VENDORS (paid $600+) ---',
      csv(vendors1099.rows,['vendor','total']),
    ].join('\n');

    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="quantum_surety_tax_packet_${year}.csv"`);
    res.send(out);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// KPI cache endpoint — serves the daily snapshot only when it is from today;
// a stale (or missing) cache falls through to a live computation. MTD/YTD are
// keyed on effective_date with the shared revenue rule (issued + expired),
// matching /pl and /dashboard.
bookkeepingRouter.get('/kpi', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM bk_kpi_cache WHERE snapshot_date = CURRENT_DATE ORDER BY id DESC LIMIT 1'
    );
    if (rows.length) return res.json(rows[0]);

    // Cache missing or stale — compute live
    const year = new Date().getFullYear().toString();
    const month = new Date().toISOString().slice(0,7);
    const [mtd, ytd, active, expiring, bills] = await Promise.all([
      pool.query("SELECT COUNT(*) AS bonds, COALESCE(SUM(commission_amt),0) AS commission, COALESCE(SUM(premium),0) AS premium FROM bk_bonds WHERE to_char(effective_date,'YYYY-MM')=$1 AND status IN ('issued','expired')", [month]),
      pool.query("SELECT COUNT(*) AS bonds, COALESCE(SUM(commission_amt),0) AS commission FROM bk_bonds WHERE EXTRACT(YEAR FROM effective_date)=$1 AND status IN ('issued','expired')", [year]),
      pool.query('SELECT COUNT(*) AS count FROM bk_bonds WHERE status=$1', ['issued']),
      pool.query('SELECT COUNT(*) AS count FROM bk_bonds WHERE status=$1 AND expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE+30', ['issued']),
      pool.query('SELECT COALESCE(SUM(amount),0) AS total FROM bk_bills WHERE status=$1', ['unpaid']),
    ]);
    res.json({
      snapshot_date: new Date().toISOString().slice(0,10),
      active_bonds: parseInt(active.rows[0].count),
      mtd_commission: parseFloat(mtd.rows[0].commission),
      ytd_commission: parseFloat(ytd.rows[0].commission),
      mtd_premium: parseFloat(mtd.rows[0].premium),
      mtd_bonds: parseInt(mtd.rows[0].bonds),
      ytd_bonds: parseInt(ytd.rows[0].bonds),
      expiring_30d: parseInt(expiring.rows[0].count),
      unpaid_bills: parseFloat(bills.rows[0].total),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Auto-run all recurring expenses due today
bookkeepingRouter.post('/expenses/recurring/run-due', async (req, res) => {
  try {
    // Same closed-period rule as the sibling /:id/run — cron-driven expenses
    // must not land inside a closed period unaudited (expenses post at
    // CURRENT_DATE, so guarding on today covers every row this run creates).
    if (!(await guardClosedPeriod(req, res, [new Date()],
      { entity: 'recurring_expense', detail: 'Recurring expenses run-due' }))) return;
    const { rows: due } = await pool.query(
      'SELECT * FROM bk_recurring_expenses WHERE active=true AND next_due <= CURRENT_DATE'
    );
    const results = [];
    for (const r of due) {
      const { rows: exp } = await pool.query(
        'INSERT INTO bk_expenses (category_id,vendor,description,amount,expense_date,payment_method,notes) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6) RETURNING *',
        [r.category_id, r.vendor, r.description, r.amount, r.payment_method,
         'Auto-created from recurring schedule' + (r.notes ? ': ' + r.notes : '')]
      );
      await pool.query(
        `UPDATE bk_recurring_expenses
         SET next_due = next_due + CASE frequency
           WHEN 'weekly'    THEN INTERVAL '7 days'
           WHEN 'monthly'   THEN INTERVAL '1 month'
           WHEN 'quarterly' THEN INTERVAL '3 months'
           ELSE INTERVAL '1 year' END,
         run_count = run_count + 1,
         last_run  = CURRENT_DATE
         WHERE id = $1`,
        [r.id]
      );
      results.push({ id: r.id, vendor: r.vendor, amount: r.amount, expense_id: exp[0].id });
    }
    console.log('[Recurring] Auto-ran ' + results.length + ' expenses due today');
    res.json({ ok: true, ran: results.length, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
