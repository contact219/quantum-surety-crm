import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const contractorsRouter = Router();

contractorsRouter.get('/stats', async (req, res) => {
  try {
    const [totals, top_types, top_states] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) as total,
          COUNT(email) FILTER (WHERE email != '' AND email IS NOT NULL) as with_email,
          COUNT(*) FILTER (WHERE state = 'TX') as texas,
          COUNT(*) FILTER (WHERE bonding_amount IS NOT NULL AND bonding_amount > 0) as bonded
        FROM contractors
      `),
      db.execute(sql`
        SELECT certification_type, COUNT(*) as count FROM contractors
        WHERE certification_type IS NOT NULL AND certification_type != ''
        GROUP BY certification_type ORDER BY count DESC LIMIT 8
      `),
      db.execute(sql`
        SELECT state, COUNT(*) as count FROM contractors
        WHERE state IS NOT NULL AND state != ''
        GROUP BY state ORDER BY count DESC LIMIT 8
      `),
    ]);
    res.json({ ...totals.rows[0], top_types: top_types.rows, top_states: top_states.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

contractorsRouter.get('/', async (req, res) => {
  try {
    const { page=1, limit=50, search='', city='', state='', cert_type='', has_email='' } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    const lim = parseInt(limit);

    const searchCond   = search    ? sql`AND (company_name ILIKE ${'%'+search+'%'} OR email ILIKE ${'%'+search+'%'} OR phone ILIKE ${'%'+search+'%'})` : sql``;
    const cityCond     = city      ? sql`AND city ILIKE ${'%'+city+'%'}` : sql``;
    const stateCond    = state     ? sql`AND state = ${state.toUpperCase()}` : sql``;
    const certCond     = cert_type ? sql`AND certification_type ILIKE ${'%'+cert_type+'%'}` : sql``;
    const emailCond    = has_email === 'true' ? sql`AND email != '' AND email IS NOT NULL` : sql``;

    const [rows, cnt] = await Promise.all([
      db.execute(sql`
        SELECT id, company_name, address, city, state, zip, phone, email,
               certification_type, certification_number, bonding_amount, bonding_company, bonding_expiration
        FROM contractors WHERE 1=1
        ${searchCond} ${cityCond} ${stateCond} ${certCond} ${emailCond}
        ORDER BY company_name ASC
        LIMIT ${lim} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) as count FROM contractors WHERE 1=1
        ${searchCond} ${cityCond} ${stateCond} ${certCond} ${emailCond}
      `),
    ]);

    res.json({
      data: rows.rows,
      total: parseInt(cnt.rows[0].count),
      page: parseInt(page),
      pages: Math.ceil(parseInt(cnt.rows[0].count) / lim),
    });
  } catch(err) {
    console.error('Contractors query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
