import { Router } from 'express';
import { db, contractors } from '../db.js';
import { eq, ilike, or, and, sql, desc, asc } from 'drizzle-orm';
export const contactsRouter = Router();
const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const enrich = r => ({
  ...r,
  contact_email: emailRx.test(r.website||'') ? r.website : (r.email||''),
  contact_website: !emailRx.test(r.website||'') && r.website !== 'Y' && r.website ? r.website : '',
});
contactsRouter.get('/', async (req, res) => {
  try {
    const { page=1, limit=50, search='', state='', cert_type='', has_email='' } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let conds = [];
    if (search) conds.push(or(ilike(contractors.company_name,`%${search}%`), ilike(contractors.city,`%${search}%`)));
    if (state) conds.push(eq(contractors.state, state));
    if (cert_type) conds.push(eq(contractors.certification_type, cert_type));
    if (has_email==='true') conds.push(sql`(${contractors.website} ~ '^[^@]+@[^@]+\\.[^@]+$')`);
    const where = conds.length ? and(...conds) : undefined;
    const [rows, cnt] = await Promise.all([
      db.select().from(contractors).where(where).orderBy(asc(contractors.company_name)).limit(parseInt(limit)).offset(offset),
      db.select({count:sql`count(*)`}).from(contractors).where(where),
    ]);
    res.json({ data: rows.map(enrich), total: parseInt(cnt[0].count), page: parseInt(page), pages: Math.ceil(parseInt(cnt[0].count)/parseInt(limit)) });
  } catch(err) { res.status(500).json({error:err.message}); }
});
contactsRouter.get('/stats', async (req, res) => {
  try {
    const [total, byState, withEmail, withPhone] = await Promise.all([
      db.select({count:sql`count(*)`}).from(contractors),
      db.select({state:contractors.state,count:sql`count(*)`}).from(contractors).groupBy(contractors.state).orderBy(desc(sql`count(*)`)).limit(10),
      db.select({count:sql`count(*)`}).from(contractors).where(sql`${contractors.website} ~ '^[^@]+@[^@]+\\.[^@]+$'`),
      db.select({count:sql`count(*)`}).from(contractors).where(sql`${contractors.phone} IS NOT NULL AND ${contractors.phone} != ''`),
    ]);
    res.json({ total:parseInt(total[0].count), by_state:byState.map(r=>({state:r.state,count:parseInt(r.count)})), with_email:parseInt(withEmail[0].count), with_phone:parseInt(withPhone[0].count) });
  } catch(err) { res.status(500).json({error:err.message}); }
});
contactsRouter.get('/:id', async (req, res) => {
  try {
    const [row] = await db.select().from(contractors).where(eq(contractors.id,parseInt(req.params.id)));
    if (!row) return res.status(404).json({error:'Not found'});
    res.json(enrich(row));
  } catch(err) { res.status(500).json({error:err.message}); }
});
