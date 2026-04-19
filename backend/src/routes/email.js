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
      from: `${from_name||'Quantum Surety'} <${from_email||'info@quantumsurety.bond'}>`,
      to: to_email, subject, html: body,
    });
    res.json({ok:true, id:r.id});
  } catch(err) { res.status(500).json({error:err.message}); }
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
