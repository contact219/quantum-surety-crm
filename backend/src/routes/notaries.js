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
      SELECT surety_company, COUNT(*) as count
      FROM notaries WHERE surety_company != ''
      GROUP BY surety_company ORDER BY count DESC LIMIT 8
    `);
    res.json({ ...result.rows[0], top_companies: top.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

notariesRouter.get('/', async (req, res) => {
  try {
    const {
      page=1, limit=50, search='', city='',
      surety='', expiring='', has_email=''
    } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);

    let where = 'WHERE 1=1';
    const params = [];
    let i = 1;

    if (search) { where += ` AND (first_name ILIKE $${i} OR last_name ILIKE $${i} OR email ILIKE $${i})`; params.push(`%${search}%`); i++; }
    if (city)   { where += ` AND city ILIKE $${i}`; params.push(`%${city}%`); i++; }
    if (surety) { where += ` AND surety_company ILIKE $${i}`; params.push(`%${surety}%`); i++; }
    if (has_email === 'true') { where += ` AND email != '' AND email IS NOT NULL`; }
    if (expiring === '90')  { where += ` AND expire_date <= CURRENT_DATE + INTERVAL '90 days' AND expire_date >= CURRENT_DATE`; }
    if (expiring === '180') { where += ` AND expire_date <= CURRENT_DATE + INTERVAL '180 days' AND expire_date >= CURRENT_DATE`; }
    if (expiring === 'expired') { where += ` AND expire_date < CURRENT_DATE`; }

    const [rows, cnt] = await Promise.all([
      db.execute(sql.raw(`SELECT id, notary_id, first_name, last_name, email, city, zip, expire_date, surety_company, agency FROM notaries ${where} ORDER BY expire_date ASC LIMIT ${parseInt(limit)} OFFSET ${offset}`, params)),
      db.execute(sql.raw(`SELECT COUNT(*) as count FROM notaries ${where}`, params)),
    ]);

    res.json({
      data: rows.rows,
      total: parseInt(cnt.rows[0].count),
      page: parseInt(page),
      pages: Math.ceil(parseInt(cnt.rows[0].count)/parseInt(limit)),
    });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

notariesRouter.get('/companies', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT surety_company, COUNT(*) as count
      FROM notaries WHERE surety_company != ''
      GROUP BY surety_company ORDER BY count DESC LIMIT 20
    `);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
