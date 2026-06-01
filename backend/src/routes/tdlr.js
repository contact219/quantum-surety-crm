import { Router } from 'express';
import { db, pool } from '../db.js';
import { sql } from 'drizzle-orm';

export const tdlrRouter = Router();

tdlrRouter.get('/stats', async (req, res) => {
  try {
    const [totals, top_types, top_counties] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') as expiring_30,
          COUNT(*) FILTER (WHERE expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days') as expiring_90,
          COUNT(*) FILTER (WHERE expire_date < CURRENT_DATE) as expired,
          COUNT(business_phone) FILTER (WHERE business_phone != '' AND business_phone IS NOT NULL) as with_phone
        FROM tdlr_licenses
      `),
      db.execute(sql`
        SELECT license_type, COUNT(*) as count FROM tdlr_licenses
        WHERE license_type IS NOT NULL AND license_type != ''
        GROUP BY license_type ORDER BY count DESC LIMIT 12
      `),
      db.execute(sql`
        SELECT business_county, COUNT(*) as count FROM tdlr_licenses
        WHERE business_county IS NOT NULL AND business_county != ''
        GROUP BY business_county ORDER BY count DESC LIMIT 10
      `),
    ]);
    res.json({ ...totals.rows[0], top_types: top_types.rows, top_counties: top_counties.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

tdlrRouter.get('/', async (req, res) => {
  try {
    const { page=1, limit=50, search='', county='', license_type='', expiring='', has_phone='' } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    const lim    = parseInt(limit);

    const searchCond  = search       ? sql`AND (business_name ILIKE ${'%'+search+'%'} OR owner_name ILIKE ${'%'+search+'%'} OR license_number ILIKE ${'%'+search+'%'})` : sql``;
    const countyCond  = county       ? sql`AND business_county ILIKE ${'%'+county+'%'}` : sql``;
    const typeCond    = license_type ? sql`AND license_type ILIKE ${'%'+license_type+'%'}` : sql``;
    const phoneCond   = has_phone === 'true' ? sql`AND business_phone != '' AND business_phone IS NOT NULL` : sql``;
    const expCond     = expiring === '30'      ? sql`AND expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`
                      : expiring === '60'      ? sql`AND expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'`
                      : expiring === '90'      ? sql`AND expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'`
                      : expiring === '180'     ? sql`AND expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '180 days'`
                      : expiring === 'expired' ? sql`AND expire_date < CURRENT_DATE`
                      : sql``;

    const [rows, cnt] = await Promise.all([
      db.execute(sql`
        SELECT id, license_type, license_number, license_subtype,
               business_name, business_county, business_city, business_state, business_zip,
               business_phone, expire_date, owner_name, owner_phone
        FROM tdlr_licenses WHERE 1=1
        ${searchCond} ${countyCond} ${typeCond} ${phoneCond} ${expCond}
        ORDER BY expire_date ASC NULLS LAST
        LIMIT ${lim} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) as count FROM tdlr_licenses WHERE 1=1
        ${searchCond} ${countyCond} ${typeCond} ${phoneCond} ${expCond}
      `),
    ]);

    res.json({
      data: rows.rows,
      total: parseInt(cnt.rows[0].count),
      page: parseInt(page),
      pages: Math.ceil(parseInt(cnt.rows[0].count) / lim),
    });
  } catch(err) {
    console.error('TDLR query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
