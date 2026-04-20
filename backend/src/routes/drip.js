import { Router } from 'express';
import { sendEmail } from '../mailer.js';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const dripRouter = Router();

dripRouter.get('/', async (req, res) => {
  try {
    const result = await db.execute(sql`SELECT * FROM drip_schedules ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

dripRouter.post('/', async (req, res) => {
  const { name, contact_type, filters, emails_per_day, from_name, from_email, subject, body } = req.body;
  try {
    const result = await db.execute(sql`
      INSERT INTO drip_schedules (name, contact_type, filters, emails_per_day, from_name, from_email, subject, body)
      VALUES (${name}, ${contact_type||'contractor'}, ${JSON.stringify(filters||{})}::jsonb,
              ${emails_per_day||100}, ${from_name||'Quantum Surety'},
              ${from_email||'info@quantumsurety.bond'}, ${subject}, ${body})
      RETURNING *
    `);
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

dripRouter.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  try {
    await db.execute(sql`UPDATE drip_schedules SET status=${status} WHERE id=${parseInt(req.params.id)}`);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

dripRouter.delete('/:id', async (req, res) => {
  try {
    await db.execute(sql`DELETE FROM drip_schedules WHERE id=${parseInt(req.params.id)}`);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Run drip — called by cron
dripRouter.post('/run', async (req, res) => {
  try {
    const schedules = await db.execute(sql`
      SELECT * FROM drip_schedules WHERE status = 'active'
    `);

    let totalSent = 0;

    for (const schedule of schedules.rows) {
      const filters = schedule.filters || {};
      const limit = schedule.emails_per_day || 100;

      // Build conditions based on contact_type
      let contacts = [];
      if (schedule.contact_type === 'notary') {
        const suretyPct = filters.surety ? `%${filters.surety}%` : null;
        const cityPct = filters.city ? `%${filters.city}%` : null;
        const suretyCond = suretyPct ? sql`AND surety_company ILIKE ${suretyPct}` : sql``;
        const cityCond = cityPct ? sql`AND city ILIKE ${cityPct}` : sql``;
        const expCond = filters.expiring === '30'  ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '30 days'  AND expire_date >= CURRENT_DATE`
                      : filters.expiring === '60'  ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '60 days'  AND expire_date >= CURRENT_DATE`
                      : filters.expiring === '90'  ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '90 days'  AND expire_date >= CURRENT_DATE`
                      : filters.expiring === '180' ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '180 days' AND expire_date >= CURRENT_DATE`
                      : filters.expiring === 'expired' ? sql`AND expire_date < CURRENT_DATE`
                      : sql``;
        const result = await db.execute(sql`
          SELECT id, first_name, last_name, email, expire_date, surety_company FROM notaries
          WHERE email != '' AND email IS NOT NULL
          AND email NOT IN (SELECT email FROM unsubscribes)
          AND email NOT IN (
            SELECT email FROM notary_campaign_sends
            WHERE status = 'sent'
          )
          ${suretyCond} ${cityCond} ${expCond}
          ORDER BY expire_date ASC LIMIT ${limit}
        `);
        contacts = result.rows;
      } else {
        const stateCond = filters.state ? sql`AND state = ${filters.state}` : sql``;
        const result = await db.execute(sql`
          SELECT company_name as first_name, '' as last_name, 
                 CASE WHEN website ~ '^[^@]+@[^@]+\.[^@]+$' THEN website ELSE email END as email,
                 null as expire_date, certification_type as surety_company
          FROM contractors
          WHERE (website ~ '^[^@]+@[^@]+\.[^@]+$' OR (email IS NOT NULL AND email != ''))
          AND (website IS NULL OR website NOT IN (SELECT email FROM unsubscribes))
          ${stateCond}
          LIMIT ${limit}
        `);
        contacts = result.rows;
      }

      let sent = 0;
      for (const c of contacts) {
        if (!c.email) continue;
        const expDate = c.expire_date ? new Date(c.expire_date).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '';
        const baseUrl = process.env.BASE_URL || 'https://crm.quantumsurety.bond';
        const unsubUrl = `${baseUrl}/api/unsubscribe?email=${encodeURIComponent(c.email)}`;
        const html = schedule.body
          .replace(/{{first_name}}/g, c.first_name||'')
          .replace(/{{name}}/g, `${c.first_name||''} ${c.last_name||''}`.trim())
          .replace(/{{expire_date}}/g, expDate)
          .replace(/{{surety_company}}/g, c.surety_company||'')
          .replace(/{{unsubscribe_url}}/g, unsubUrl);
        const subj = schedule.subject
          .replace(/{{first_name}}/g, c.first_name||'')
          .replace(/{{expire_date}}/g, expDate);

        try {
          const r = await sendEmail({
            from: `${schedule.from_name} <${schedule.from_email}>`,
            to: c.email,
            subject: subj,
            html,
            headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
          });
          const emailId = r.id || '';
          await db.execute(sql`
            INSERT INTO email_events (email_id, contact_email, event_type, metadata)
            VALUES (${emailId}, ${c.email}, 'email.sent', ${JSON.stringify({drip_id:schedule.id})}::jsonb)
          `);
          // Also record in notary_campaign_sends so UI history + SENT badges work
          if (schedule.contact_type === 'notary') {
            await db.execute(sql`
              INSERT INTO notary_campaign_sends (notary_id, email, campaign_name, subject, status, is_auto, drip_id)
              VALUES (${c.id||null}, ${c.email}, ${schedule.name}, ${subj}, 'sent', true, ${schedule.id})
            `);
          }
          sent++;
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch(e) {
          if (e.status === 429 || /too many requests/i.test(e.message)) {
            console.error('Drip rate limited by Mailgun — stopping this run, will resume next scheduled run.');
            break;
          }
          console.error('Drip send error:', e.message);
        }
      }

      await db.execute(sql`
        UPDATE drip_schedules SET total_sent = total_sent + ${sent}, last_run = now()
        WHERE id = ${schedule.id}
      `);
      totalSent += sent;
    }

    res.json({ ok: true, total_sent: totalSent });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Alert: notaries expiring in 30 days - send digest to owner
dripRouter.post('/alert', async (req, res) => {
  const { to_email = 'administrator@quantumsurety.bond' } = req.body;
  try {
    const result = await db.execute(sql`
      SELECT first_name, last_name, email, city, expire_date, surety_company
      FROM notaries
      WHERE expire_date = CURRENT_DATE + INTERVAL '30 days'
      AND email != '' AND email IS NOT NULL
      ORDER BY city ASC LIMIT 500
    `);
    const notaries = result.rows;
    if (!notaries.length) return res.json({ ok: true, message: 'No notaries expiring in exactly 30 days' });

    const rows = notaries.map(n => `
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:6px 12px">${n.first_name} ${n.last_name}</td>
        <td style="padding:6px 12px">${n.city}</td>
        <td style="padding:6px 12px;color:#C9A84C">${new Date(n.expire_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
        <td style="padding:6px 12px;font-size:12px;color:#666">${n.surety_company}</td>
        <td style="padding:6px 12px"><a href="mailto:${n.email}" style="color:#4C9AC9">${n.email}</a></td>
      </tr>
    `).join('');

    await sendEmail({
      from: 'Quantum Surety CRM <info@quantumsurety.bond>',
      to: to_email,
      subject: `🔔 ${notaries.length} Texas Notaries Expiring in 30 Days — ${new Date().toLocaleDateString()}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:24px">
          <div style="border-bottom:3px solid #C9A84C;margin-bottom:24px;padding-bottom:12px">
            <h2 style="margin:0;color:#0A0A0F">Quantum Surety CRM — Daily Alert</h2>
            <p style="margin:4px 0 0;color:#666">${notaries.length} notaries with bonds expiring in 30 days</p>
          </div>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#f5f5f5">
                <th style="padding:8px 12px;text-align:left">Name</th>
                <th style="padding:8px 12px;text-align:left">City</th>
                <th style="padding:8px 12px;text-align:left">Expires</th>
                <th style="padding:8px 12px;text-align:left">Current Carrier</th>
                <th style="padding:8px 12px;text-align:left">Email</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:24px;color:#666;font-size:12px">Quantum Surety CRM · <a href="http://192.168.4.122:8095">Open CRM</a></p>
        </div>
      `,
    });
    res.json({ ok: true, sent_to: to_email, count: notaries.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
