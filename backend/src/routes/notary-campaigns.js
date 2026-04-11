import { Router } from 'express';
import { Resend } from 'resend';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const notaryCampaignsRouter = Router();
const resend = new Resend(process.env.RESEND_API_KEY);

function buildConditions(filters={}) {
  const suretyPct = filters.surety ? `%${filters.surety}%` : null;
  const cityPct   = filters.city   ? `%${filters.city}%`   : null;
  const suretyCond = suretyPct ? sql`AND surety_company ILIKE ${suretyPct}` : sql``;
  const cityCond   = cityPct   ? sql`AND city ILIKE ${cityPct}`             : sql``;
  const expCond    = filters.expiring === '90'      ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '90 days' AND expire_date >= CURRENT_DATE`
                   : filters.expiring === '180'     ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '180 days' AND expire_date >= CURRENT_DATE`
                   : filters.expiring === 'expired' ? sql`AND expire_date < CURRENT_DATE`
                   : sql``;
  return { suretyCond, cityCond, expCond };
}

notaryCampaignsRouter.post('/count', async (req, res) => {
  const { suretyCond, cityCond, expCond } = buildConditions(req.body?.filters);
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM notaries
      WHERE email != '' AND email IS NOT NULL
      ${suretyCond} ${cityCond} ${expCond}
    `);
    res.json({ count: parseInt(result.rows[0].count) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

notaryCampaignsRouter.post('/send', async (req, res) => {
  const { subject, body, from_name, from_email, filters } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
  const { suretyCond, cityCond, expCond } = buildConditions(filters);
  try {
    const rows = await db.execute(sql`
      SELECT id, first_name, last_name, email, expire_date, surety_company
      FROM notaries
      WHERE email != '' AND email IS NOT NULL
      ${suretyCond} ${cityCond} ${expCond}
      LIMIT 5000
    `);
    let sent=0, failed=0;
    for (const c of rows.rows) {
      const expDate = c.expire_date ? new Date(c.expire_date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '';
      const html = body.replace(/{{first_name}}/g,c.first_name||'').replace(/{{name}}/g,`${c.first_name||''} ${c.last_name||''}`.trim()).replace(/{{expire_date}}/g,expDate).replace(/{{surety_company}}/g,c.surety_company||'');
      const subj = subject.replace(/{{first_name}}/g,c.first_name||'').replace(/{{expire_date}}/g,expDate);
      try {
        await resend.emails.send({ from:`${from_name||'Quantum Surety'} <${from_email||'info@quantumsurety.bond'}>`, to:[c.email], subject:subj, html });
        sent++;
        await new Promise(r=>setTimeout(r,500));
      } catch(e) { failed++; }
    }
    res.json({ ok:true, sent, failed, total:rows.rows.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
