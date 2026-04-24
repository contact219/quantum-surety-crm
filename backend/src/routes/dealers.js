import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const dealersRouter = Router();

dealersRouter.get('/stats', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(email) FILTER (WHERE email != '' AND email IS NOT NULL) as with_email,
        COUNT(*) FILTER (WHERE license_expiration <= CURRENT_DATE + INTERVAL '90 days' AND license_expiration >= CURRENT_DATE) as expiring_90,
        COUNT(*) FILTER (WHERE license_expiration <= CURRENT_DATE + INTERVAL '180 days' AND license_expiration >= CURRENT_DATE) as expiring_180,
        COUNT(*) FILTER (WHERE license_expiration < CURRENT_DATE) as expired
      FROM auto_dealers
    `);
    const top_counties = await db.execute(sql`
      SELECT county, COUNT(*) as count FROM auto_dealers
      WHERE county IS NOT NULL AND county != ''
      GROUP BY county ORDER BY count DESC LIMIT 15
    `);
    const top_types = await db.execute(sql`
      SELECT license_type, COUNT(*) as count FROM auto_dealers
      WHERE license_type IS NOT NULL AND license_type != ''
      GROUP BY license_type ORDER BY count DESC LIMIT 10
    `);
    res.json({ ...result.rows[0], top_counties: top_counties.rows, top_types: top_types.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

dealersRouter.get('/', async (req, res) => {
  try {
    const { page=1, limit=50, search='', city='', county='', license_type='', expiring='', has_email='' } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    const lim = parseInt(limit);

    const searchPct = `%${search}%`;
    const cityPct   = `%${city}%`;
    const countyPct = `%${county}%`;

    const searchCond    = search       ? sql`AND (business_name ILIKE ${searchPct} OR email ILIKE ${searchPct})` : sql``;
    const cityCond      = city         ? sql`AND city ILIKE ${cityPct}` : sql``;
    const countyCond    = county       ? sql`AND county ILIKE ${countyPct}` : sql``;
    const typeCond      = license_type ? sql`AND license_type ILIKE ${'%'+license_type+'%'}` : sql``;
    const emailCond     = has_email === 'true' ? sql`AND email != '' AND email IS NOT NULL` : sql``;
    const expCond       = expiring === '30'      ? sql`AND license_expiration <= CURRENT_DATE + INTERVAL '30 days'  AND license_expiration >= CURRENT_DATE`
                        : expiring === '60'      ? sql`AND license_expiration <= CURRENT_DATE + INTERVAL '60 days'  AND license_expiration >= CURRENT_DATE`
                        : expiring === '90'      ? sql`AND license_expiration <= CURRENT_DATE + INTERVAL '90 days'  AND license_expiration >= CURRENT_DATE`
                        : expiring === '180'     ? sql`AND license_expiration <= CURRENT_DATE + INTERVAL '180 days' AND license_expiration >= CURRENT_DATE`
                        : expiring === 'expired' ? sql`AND license_expiration < CURRENT_DATE`
                        : sql``;

    const [rows, cnt] = await Promise.all([
      db.execute(sql`
        SELECT id, business_name, dba_name, license_number, license_category, license_type,
               license_expiration, city, state, zip, county, phone, email
        FROM auto_dealers WHERE 1=1
        ${searchCond} ${cityCond} ${countyCond} ${typeCond} ${emailCond} ${expCond}
        ORDER BY license_expiration ASC NULLS LAST
        LIMIT ${lim} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) as count FROM auto_dealers WHERE 1=1
        ${searchCond} ${cityCond} ${countyCond} ${typeCond} ${emailCond} ${expCond}
      `),
    ]);

    res.json({
      data: rows.rows,
      total: parseInt(cnt.rows[0].count),
      page: parseInt(page),
      pages: Math.ceil(parseInt(cnt.rows[0].count) / lim),
    });
  } catch(err) {
    console.error('Dealers query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
