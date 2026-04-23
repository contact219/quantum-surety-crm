import { Router } from 'express';
import { db, contractors } from '../db.js';
import { eq, sql } from 'drizzle-orm';
import { sendEmail } from '../mailer.js';
export const emailRouter = Router();

emailRouter.post('/send', async (req, res) => {
  const { to_email, subject, body, from_name, from_email } = req.body;
  if (!to_email||!subject||!body) return res.status(400).json({error:'to_email, subject, body required'});
  try {
    const r = await sendEmail({
      from: `"${(from_name||'Quantum Surety').replace(/"/g,'')}" <${from_email||'info@quantumsurety.bond'}>`,
      to: to_email, subject, html: body,
    });
    res.json({ok:true, id:r.id});
  } catch(err) { res.status(500).json({error:err.message}); }
});

// Send to specific contractor IDs (ad-hoc, no campaign record required)
emailRouter.post('/send-selected', async (req, res) => {
  const { ids, subject, body, from_name, from_email } = req.body;
  if (!ids?.length) return res.status(400).json({ error: 'ids required' });
  if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });

  const safeIds = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!safeIds.length) return res.json({ ok: true, sent: 0, failed: 0, total: 0 });

  const inClause = sql.join(safeIds.map(id => sql`${id}`), sql`, `);
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  try {
    const rows = await db.execute(sql`
      SELECT id, company_name, email, website FROM contractors WHERE id IN (${inClause})
    `);
    let sent = 0, failed = 0;
    for (const c of rows.rows) {
      const to = emailRx.test(c.website || '') ? c.website : c.email;
      if (!to) { failed++; continue; }
      const html = body.replace(/{{company_name}}/g, c.company_name || '');
      const subj = subject.replace(/{{company_name}}/g, c.company_name || '');
      try {
        await sendEmail({
          from: `"${(from_name || 'Quantum Surety').replace(/"/g, '')}" <${from_email || 'info@quantumsurety.bond'}>`,
          to, subject: subj, html,
        });
        sent++;
        await new Promise(r => setTimeout(r, 300));
      } catch (e) { failed++; }
    }
    res.json({ ok: true, sent, failed, total: rows.rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

emailRouter.post('/campaign/:id/send', async (req, res) => {
  const { contact_ids } = req.body;
  const campaignId = parseInt(req.params.id);
  if (!contact_ids?.length) return res.status(400).json({error:'contact_ids required'});
  try {
    const camp = await db.execute(sql`SELECT * FROM campaigns WHERE id=${campaignId}`);
    const c = camp.rows[0];
    if (!c) return res.status(404).json({error:'Campaign not found'});
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const results = {sent:0,failed:0,skipped:0};
    for (const cid of contact_ids) {
      const [contact] = await db.select().from(contractors).where(eq(contractors.id,cid));
      if (!contact) { results.skipped++; continue; }
      const email = emailRx.test(contact.website||'') ? contact.website : contact.email;
      if (!email) { results.skipped++; continue; }
      try {
        await sendEmail({
          from:`${c.from_name} <${c.from_email}>`, to: email,
          subject:c.subject, html:c.body.replace(/{{company_name}}/g,contact.company_name),
        });
        await db.execute(sql`INSERT INTO campaign_sends(campaign_id,contractor_id,email,status,sent_at) VALUES(${campaignId},${cid},${email},'sent',now())`);
        results.sent++;
        await new Promise(r=>setTimeout(r,500));
      } catch(err) {
        await db.execute(sql`INSERT INTO campaign_sends(campaign_id,contractor_id,email,status,error) VALUES(${campaignId},${cid},${email},'failed',${err.message})`);
        results.failed++;
      }
    }
    await db.execute(sql`UPDATE campaigns SET status='sent',sent_count=${results.sent},sent_at=now() WHERE id=${campaignId}`);
    res.json({ok:true,...results});
  } catch(err) { res.status(500).json({error:err.message}); }
});
