import { Router } from 'express';
import { Resend } from 'resend';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const notaryCampaignsRouter = Router();
const resend = new Resend(process.env.RESEND_API_KEY);

function buildWhere(filters) {
  let where = "WHERE email != '' AND email IS NOT NULL";
  const params = [];
  let i = 1;
  if (filters?.surety) { where += ` AND surety_company ILIKE $${i}`; params.push(`%${filters.surety}%`); i++; }
  if (filters?.city)   { where += ` AND city ILIKE $${i}`; params.push(`%${filters.city}%`); i++; }
  if (filters?.expiring === '90')      where += ` AND expire_date <= CURRENT_DATE + INTERVAL '90 days' AND expire_date >= CURRENT_DATE`;
  if (filters?.expiring === '180')     where += ` AND expire_date <= CURRENT_DATE + INTERVAL '180 days' AND expire_date >= CURRENT_DATE`;
  if (filters?.expiring === 'expired') where += ` AND expire_date < CURRENT_DATE`;
  return { where, params };
}

notaryCampaignsRouter.post('/count', async (req, res) => {
  const { where, params } = buildWhere(req.body?.filters);
  try {
    const result = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM notaries ${where}`, params));
    res.json({ count: parseInt(result.rows[0].count) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

notaryCampaignsRouter.post('/send', async (req, res) => {
  const { subject, body, from_name, from_email, filters } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
  const { where, params } = buildWhere(filters);
  try {
    const rows = await db.execute(sql.raw(
      `SELECT id, first_name, last_name, email, expire_date, surety_company FROM notaries ${where} LIMIT 5000`, params
    ));
    let sent = 0, failed = 0;
    for (const c of rows.rows) {
      const name = `${c.first_name} ${c.last_name}`.trim();
      const expDate = c.expire_date ? new Date(c.expire_date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '';
      const html = body.replace(/{{name}}/g,name).replace(/{{first_name}}/g,c.first_name||'').replace(/{{expire_date}}/g,expDate).replace(/{{surety_company}}/g,c.surety_company||'');
      const subj = subject.replace(/{{name}}/g,name).replace(/{{first_name}}/g,c.first_name||'');
      try {
        await resend.emails.send({ from:`${from_name||'Quantum Surety'} <${from_email||'info@quantumsurety.bond'}>`, to:[c.email], subject:subj, html });
        sent++;
        await new Promise(r=>setTimeout(r,500));
      } catch(e) { failed++; }
    }
    res.json({ ok:true, sent, failed, total:rows.rows.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
