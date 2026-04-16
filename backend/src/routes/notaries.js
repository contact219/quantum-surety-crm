import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const notariesRouter = Router();

notariesRouter.get('/stats', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(email) FILTER (WHERE email != '') as with_email,
        COUNT(*) FILTER (WHERE expire_date <= CURRENT_DATE + INTERVAL '90 days' AND expire_date >= CURRENT_DATE) as expiring_90,
        COUNT(*) FILTER (WHERE expire_date <= CURRENT_DATE + INTERVAL '180 days' AND expire_date >= CURRENT_DATE) as expiring_180,
        COUNT(*) FILTER (WHERE expire_date < CURRENT_DATE) as expired,
        COUNT(*) FILTER (WHERE surety_company != '' AND surety_company NOT ILIKE '%RLI%') as competitor_bonded
      FROM notaries
    `);
    const top = await db.execute(sql`
      SELECT surety_company, COUNT(*) as count FROM notaries
      WHERE surety_company != '' GROUP BY surety_company ORDER BY count DESC LIMIT 20
    `);
    res.json({ ...result.rows[0], top_companies: top.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

notariesRouter.get('/companies', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT surety_company, COUNT(*) as count FROM notaries
      WHERE surety_company != '' GROUP BY surety_company ORDER BY count DESC LIMIT 20
    `);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

notariesRouter.get('/', async (req, res) => {
  try {
    const { page=1, limit=50, search='', city='', surety='', expiring='', has_email='', date_from='', date_to='' } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    const lim = parseInt(limit);

    // Build query using drizzle sql template tag with safe interpolation
    const searchPct = `%${search}%`;
    const cityPct = `%${city}%`;
    const suretyPct = `%${surety}%`;

    let rows, cnt;

    // Use conditional sql fragments
    const searchCond = search ? sql`AND (first_name ILIKE ${searchPct} OR last_name ILIKE ${searchPct} OR email ILIKE ${searchPct})` : sql``;
    const cityCond   = city   ? sql`AND city ILIKE ${cityPct}` : sql``;
    const suretyCond = surety ? sql`AND surety_company ILIKE ${suretyPct}` : sql``;
    const emailCond  = has_email === 'true' ? sql`AND email != '' AND email IS NOT NULL` : sql``;
    const expCond    = expiring === '30'      ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '30 days' AND expire_date >= CURRENT_DATE`
                     : expiring === '60'      ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '60 days' AND expire_date >= CURRENT_DATE`
                     : expiring === '90'      ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '90 days' AND expire_date >= CURRENT_DATE`
                     : expiring === '180'     ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '180 days' AND expire_date >= CURRENT_DATE`
                     : expiring === 'expired' ? sql`AND expire_date < CURRENT_DATE`
                     : (date_from || date_to) ? sql`${date_from ? sql`AND expire_date >= ${date_from}::date` : sql``} ${date_to ? sql`AND expire_date <= ${date_to}::date` : sql``}`
                     : sql``;

    [rows, cnt] = await Promise.all([
      db.execute(sql`
        SELECT id, notary_id, first_name, last_name, email, city, zip, expire_date, surety_company, agency
        FROM notaries
        WHERE 1=1
        ${searchCond} ${cityCond} ${suretyCond} ${emailCond} ${expCond}
        ORDER BY expire_date ASC
        LIMIT ${lim} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) as count FROM notaries
        WHERE 1=1
        ${searchCond} ${cityCond} ${suretyCond} ${emailCond} ${expCond}
      `),
    ]);

    res.json({
      data: rows.rows,
      total: parseInt(cnt.rows[0].count),
      page: parseInt(page),
      pages: Math.ceil(parseInt(cnt.rows[0].count) / lim),
    });
  } catch(err) {
    console.error('Notaries query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
