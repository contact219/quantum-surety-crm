import express from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const leadsRouter = express.Router();

const BOND_LABELS = {
  notary: 'Texas Notary Bond',
  dealer: 'Texas GDN Dealer Bond',
  gdn: 'Texas GDN Dealer Bond',
  contractor: 'Texas Contractor License Bond',
  construction: 'Texas Construction Bond',
  bid: 'Texas Bid Bond',
  performance: 'Texas Performance & Payment Bond',
  payment: 'Texas Payment Bond',
  mortgage: 'Texas Mortgage Broker Bond',
  'credit-access-business': 'Texas Credit Access Business Bond',
  'collection-agency': 'Texas Collection Agency Bond',
  'property-tax-consultant': 'Texas Property Tax Consultant Bond',
};
function bondLabel(raw) {
  if (!raw) return 'Unknown';
  return BOND_LABELS[raw.toLowerCase()] || raw;
}

// POST /api/leads — public form submission from website
leadsRouter.post('/', async (req, res) => {
  try {
    const { name, email, phone, bond_type, source } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });
    await db.execute(sql`
      INSERT INTO site_leads (name, email, phone, bond_type, source, captured_at)
      VALUES (${name}, ${email}, ${phone || null}, ${bondLabel(bond_type)}, ${source || 'get-bond'}, NOW())
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO leads (name, email, phone, bond_type, source, status, lead_time)
      VALUES (${name}, ${email}, ${phone || null}, ${bondLabel(bond_type)}, ${source || 'get-bond form'}, 'new', NOW())
      ON CONFLICT (email, lead_time) DO NOTHING
    `);
    console.log('[LEAD] ' + name + ' <' + email + '> — ' + bondLabel(bond_type));
    res.json({ ok: true });
  } catch (err) {
    console.error('[Leads POST]', err.message);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

// POST /api/leads/manual — admin manual lead creation
leadsRouter.post('/manual', async (req, res) => {
  try {
    const { name, email, phone, bond_type, source, notes, status } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });
    const result = await db.execute(sql`
      INSERT INTO leads (name, email, phone, bond_type, source, status, notes, lead_time)
      VALUES (
        ${name}, ${email}, ${phone || null},
        ${bond_type || null}, ${source || 'manual entry'},
        ${status || 'new'}, ${notes || null}, NOW()
      )
      RETURNING *
    `);
    console.log('[LEAD MANUAL] ' + name + ' <' + email + '>');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Leads POST /manual]', err.message);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// GET /api/leads/stats
leadsRouter.get('/stats', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status='new') AS new_count,
        COUNT(*) FILTER (WHERE status='contacted') AS contacted_count,
        COUNT(*) FILTER (WHERE status='sold') AS sold_count,
        COUNT(*) FILTER (WHERE status='no_follow_up') AS no_follow_up_count,
        COUNT(*) AS total,
        COALESCE(SUM(sale_amount) FILTER (WHERE status='sold'), 0) AS revenue,
        COUNT(*) FILTER (WHERE lead_time >= date_trunc('day', NOW() AT TIME ZONE 'America/Chicago')) AS today_new,
        COUNT(*) FILTER (WHERE lead_time >= date_trunc('week', NOW() AT TIME ZONE 'America/Chicago')) AS week_new,
        COALESCE(SUM(sale_amount) FILTER (
          WHERE status='sold' AND lead_time >= date_trunc('month', NOW() AT TIME ZONE 'America/Chicago')
        ), 0) AS month_revenue
      FROM leads
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads — list with filters
leadsRouter.get('/', async (req, res) => {
  try {
    const { status, search, bond_type, date_from, date_to } = req.query;
    const where = [];

    if (status && status !== 'all') {
      where.push(`status = '${status.replace(/'/g, "''")}'`);
    }
    if (search) {
      const s = search.replace(/'/g, "''");
      where.push(`(name ILIKE '%${s}%' OR email ILIKE '%${s}%' OR phone ILIKE '%${s}%')`);
    }
    if (bond_type && bond_type !== 'all') {
      const bt = bond_type.replace(/'/g, "''");
      where.push(`bond_type ILIKE '%${bt}%'`);
    }
    if (date_from && /^\d{4}-\d{2}-\d{2}$/.test(date_from)) {
      where.push(`lead_time >= '${date_from}'::timestamptz`);
    }
    if (date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
      where.push(`lead_time < ('${date_to}'::date + interval '1 day')::timestamptz`);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const result = await db.execute(sql.raw(
      `SELECT id, name, email, phone, bond_type, source, status, notes, sale_amount, lead_time, created_at
       FROM leads ${whereClause}
       ORDER BY lead_time DESC NULLS LAST
       LIMIT 500`
    ));
    res.json({ leads: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[Leads GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id
leadsRouter.patch('/:id', async (req, res) => {
  try {
    const { status, notes, sale_amount } = req.body || {};
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const sets = [];
    const vals = [];
    if (status !== undefined) { sets.push(`status = $${sets.length + 1}`); vals.push(status); }
    if (notes !== undefined) { sets.push(`notes = $${sets.length + 1}`); vals.push(notes); }
    if (sale_amount !== undefined) { sets.push(`sale_amount = $${sets.length + 1}`); vals.push(sale_amount || null); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    const result = await db.execute(sql.raw(
      `UPDATE leads SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    ));
    if (!result.rows.length) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Leads PATCH]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/leads/:id
leadsRouter.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const result = await db.execute(sql.raw(
      `DELETE FROM leads WHERE id = $1 RETURNING id`,
      [id]
    ));
    if (!result.rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Leads DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});
