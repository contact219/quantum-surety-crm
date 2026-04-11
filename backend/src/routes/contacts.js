import { Router } from 'express';
import { db, contractors } from '../db.js';
import { eq, ilike, or, and, sql, desc, asc, isNotNull, ne } from 'drizzle-orm';
export const contactsRouter = Router();

const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const enrich = r => ({
  ...r,
  contact_email: emailRx.test(r.website||'') ? r.website : (r.email||''),
  contact_website: !emailRx.test(r.website||'') && r.website !== 'Y' && r.website ? r.website : '',
});

contactsRouter.get('/', async (req, res) => {
  try {
    const {
      page=1, limit=50, search='', state='',
      has_email='', has_fax='', city=''
    } = req.query;

    const offset = (parseInt(page)-1) * parseInt(limit);
    let conds = [];

    if (search) conds.push(or(
      ilike(contractors.company_name, `%${search}%`),
      ilike(contractors.city, `%${search}%`)
    ));
    if (state)     conds.push(eq(contractors.state, state));
    if (city)      conds.push(ilike(contractors.city, `%${city}%`));
    if (has_email === 'true') conds.push(sql`(${contractors.website} ~ '^[^@]+@[^@]+\\.[^@]+$')`);
    if (has_fax === 'true')   conds.push(sql`(${contractors.fax} IS NOT NULL AND ${contractors.fax} != '' AND ${contractors.fax} != 'M' AND ${contractors.fax} != 'Y' AND ${contractors.fax} != 'F' AND length(${contractors.fax}) > 6)`);

    const where = conds.length ? and(...conds) : undefined;

    const [rows, cnt] = await Promise.all([
      db.select({
        id: contractors.id,
        company_name: contractors.company_name,
        city: contractors.city,
        state: contractors.state,
        zip: contractors.zip,
        phone: contractors.phone,
        fax: contractors.fax,
        website: contractors.website,
        email: contractors.email,
        certification_type: contractors.certification_type,
        certification_number: contractors.certification_number,
        naics_codes: contractors.naics_codes,
        address: contractors.address,
        address2: contractors.address2,
      })
      .from(contractors)
      .where(where)
      .orderBy(asc(contractors.company_name))
      .limit(parseInt(limit))
      .offset(offset),

      db.select({count: sql`count(*)`}).from(contractors).where(where),
    ]);

    res.json({
      data: rows.map(enrich),
      total: parseInt(cnt[0].count),
      page: parseInt(page),
      pages: Math.ceil(parseInt(cnt[0].count) / parseInt(limit)),
    });
  } catch(err) {
    console.error(err);
    res.status(500).json({error: err.message});
  }
});

contactsRouter.get('/stats', async (req, res) => {
  try {
    const [total, byState, withEmail, withPhone, withFax] = await Promise.all([
      db.select({count: sql`count(*)`}).from(contractors),
      db.select({state: contractors.state, count: sql`count(*)`})
        .from(contractors).groupBy(contractors.state)
        .orderBy(desc(sql`count(*)`)).limit(10),
      db.select({count: sql`count(*)`}).from(contractors)
        .where(sql`${contractors.website} ~ '^[^@]+@[^@]+\\.[^@]+$'`),
      db.select({count: sql`count(*)`}).from(contractors)
        .where(sql`${contractors.phone} IS NOT NULL AND ${contractors.phone} != ''`),
      db.select({count: sql`count(*)`}).from(contractors)
        .where(sql`(${contractors.fax} IS NOT NULL AND ${contractors.fax} != '' AND ${contractors.fax} != 'M' AND ${contractors.fax} != 'Y' AND ${contractors.fax} != 'F' AND length(${contractors.fax}) > 6)`),
    ]);
    res.json({
      total: parseInt(total[0].count),
      by_state: byState.map(r=>({state: r.state, count: parseInt(r.count)})),
      with_email: parseInt(withEmail[0].count),
      with_phone: parseInt(withPhone[0].count),
      with_fax: parseInt(withFax[0].count),
    });
  } catch(err) { res.status(500).json({error: err.message}); }
});

contactsRouter.get('/:id', async (req, res) => {
  try {
    const [row] = await db.select().from(contractors).where(eq(contractors.id, parseInt(req.params.id)));
    if (!row) return res.status(404).json({error: 'Not found'});
    res.json(enrich(row));
  } catch(err) { res.status(500).json({error: err.message}); }
});
