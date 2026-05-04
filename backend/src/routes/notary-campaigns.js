import { Router } from 'express';
import { sendEmail } from '../mailer.js';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const notaryCampaignsRouter = Router();

const APP_URL = process.env.APP_URL || 'https://quantumsurety.bond';
const COOLDOWN_DAYS = 60;

function buildConditions(filters = {}) {
  const suretyPct = filters.surety ? `%${filters.surety}%` : null;
  const cityPct   = filters.city   ? `%${filters.city}%`   : null;
  const suretyCond = suretyPct ? sql`AND surety_company ILIKE ${suretyPct}` : sql``;
  const cityCond   = cityPct   ? sql`AND city ILIKE ${cityPct}`             : sql``;

  let expCond;
  if      (filters.expiring === '30')      expCond = sql`AND expire_date <= CURRENT_DATE + INTERVAL '30 days'  AND expire_date >= CURRENT_DATE`;
  else if (filters.expiring === '60')      expCond = sql`AND expire_date <= CURRENT_DATE + INTERVAL '60 days'  AND expire_date >= CURRENT_DATE`;
  else if (filters.expiring === '90')      expCond = sql`AND expire_date <= CURRENT_DATE + INTERVAL '90 days'  AND expire_date >= CURRENT_DATE`;
  else if (filters.expiring === '180')     expCond = sql`AND expire_date <= CURRENT_DATE + INTERVAL '180 days' AND expire_date >= CURRENT_DATE`;
  else if (filters.expiring === 'expired') expCond = sql`AND expire_date < CURRENT_DATE`;
  else if (filters.date_from || filters.date_to) {
    const fromPart = filters.date_from ? sql`AND expire_date >= ${filters.date_from}::date` : sql``;
    const toPart   = filters.date_to   ? sql`AND expire_date <= ${filters.date_to}::date`   : sql``;
    expCond = sql`${fromPart} ${toPart}`;
  } else {
    expCond = sql``;
  }

  const cooldownCond = sql`AND id NOT IN (
    SELECT notary_id FROM notary_campaign_sends
    WHERE notary_id IS NOT NULL AND status = 'sent'
    AND sent_at > NOW() - INTERVAL '${sql.raw(String(COOLDOWN_DAYS))} days'
  )`;

  return { suretyCond, cityCond, expCond, cooldownCond };
}

function interpolate(template, c, expDate, unsubscribeUrl) {
  return template
    .replace(/{{first_name}}/g,       c.first_name || '')
    .replace(/{{name}}/g,             `${c.first_name || ''} ${c.last_name || ''}`.trim())
    .replace(/{{expire_date}}/g,      expDate)
    .replace(/{{surety_company}}/g,   c.surety_company || '')
    .replace(/{{unsubscribe_url}}/g,  unsubscribeUrl || '');
}

// Count contacts matching filters (optionally skip already sent)
notaryCampaignsRouter.post('/count', async (req, res) => {
  const { suretyCond, cityCond, expCond, cooldownCond } = buildConditions(req.body?.filters);
  const skipSentCond = req.body?.skip_sent
    ? sql`AND id NOT IN (SELECT notary_id FROM notary_campaign_sends WHERE notary_id IS NOT NULL AND status = 'sent')`
    : sql``;
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM notaries
      WHERE email != '' AND email IS NOT NULL
      AND email NOT IN (SELECT email FROM unsubscribes)
      ${suretyCond} ${cityCond} ${expCond} ${skipSentCond} ${cooldownCond}
    `);
    res.json({ count: parseInt(result.rows[0].count) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Send to filtered audience
notaryCampaignsRouter.post('/send', async (req, res) => {
  const { subject, body, from_name, from_email, filters, campaign_name, skip_sent } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });

  const { suretyCond, cityCond, expCond, cooldownCond } = buildConditions(filters);
  const skipSentCond = skip_sent
    ? sql`AND id NOT IN (SELECT notary_id FROM notary_campaign_sends WHERE notary_id IS NOT NULL AND status = 'sent')`
    : sql``;

  try {
    const rows = await db.execute(sql`
      SELECT id, first_name, last_name, email, expire_date, surety_company
      FROM notaries
      WHERE email != '' AND email IS NOT NULL
      AND email NOT IN (SELECT email FROM unsubscribes)
      ${suretyCond} ${cityCond} ${expCond} ${skipSentCond} ${cooldownCond}
      LIMIT 5000
    `);

    let sent = 0, failed = 0;
    const name = campaign_name || subject;
    const senderEmail = from_email || 'info@quantumsurety.bond';

    for (const c of rows.rows) {
      const expDate = c.expire_date
        ? new Date(c.expire_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : '';
      const unsubscribeUrl = `${APP_URL}/api/unsubscribe?email=${encodeURIComponent(c.email)}`;
      const html = interpolate(body, c, expDate, unsubscribeUrl);
      const subj = interpolate(subject, c, expDate, unsubscribeUrl);

      try {
        await sendEmail({
          from: `"${(from_name || 'Quantum Surety').replace(/"/g,'')}" <${senderEmail}>`,
          to: c.email, subject: subj, html,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        await db.execute(sql`
          INSERT INTO notary_campaign_sends (notary_id, email, campaign_name, subject, status)
          VALUES (${c.id}, ${c.email}, ${name}, ${subj}, 'sent')
        `);
        sent++;
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {
        await db.execute(sql`
          INSERT INTO notary_campaign_sends (notary_id, email, campaign_name, subject, status, error)
          VALUES (${c.id}, ${c.email}, ${name}, ${subj}, 'failed', ${e.message})
        `).catch(() => {});
        failed++;
      }
    }

    res.json({ ok: true, sent, failed, total: rows.rows.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Send to specific notary IDs (manual selection)
notaryCampaignsRouter.post('/send-selected', async (req, res) => {
  const { ids, subject, body, from_name, from_email, campaign_name } = req.body;
  if (!ids?.length)       return res.status(400).json({ error: 'ids required' });
  if (!subject || !body)  return res.status(400).json({ error: 'subject and body required' });

  const safeIds = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!safeIds.length) return res.json({ ok: true, sent: 0, failed: 0, total: 0 });

  const inClause = sql.join(safeIds.map(id => sql`${id}`), sql`, `);
  const senderEmail = from_email || 'info@quantumsurety.bond';

  try {
    const rows = await db.execute(sql`
      SELECT id, first_name, last_name, email, expire_date, surety_company
      FROM notaries
      WHERE id IN (${inClause})
      AND email != '' AND email IS NOT NULL
    `);

    let sent = 0, failed = 0;
    const name = campaign_name || subject;

    for (const c of rows.rows) {
      const expDate = c.expire_date
        ? new Date(c.expire_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : '';
      const unsubscribeUrl = `${APP_URL}/api/unsubscribe?email=${encodeURIComponent(c.email)}`;
      const html = interpolate(body, c, expDate, unsubscribeUrl);
      const subj = interpolate(subject, c, expDate, unsubscribeUrl);

      try {
        await sendEmail({
          from: `"${(from_name || 'Quantum Surety').replace(/"/g,'')}" <${senderEmail}>`,
          to: c.email, subject: subj, html,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        await db.execute(sql`
          INSERT INTO notary_campaign_sends (notary_id, email, campaign_name, subject, status)
          VALUES (${c.id}, ${c.email}, ${name}, ${subj}, 'sent')
        `);
        sent++;
        await new Promise(r => setTimeout(r, 300));
      } catch(e) {
        await db.execute(sql`
          INSERT INTO notary_campaign_sends (notary_id, email, campaign_name, subject, status, error)
          VALUES (${c.id}, ${c.email}, ${name}, ${subj}, 'failed', ${e.message})
        `).catch(() => {});
        failed++;
      }
    }

    res.json({ ok: true, sent, failed, total: rows.rows.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Return set of already-contacted notary IDs (for "SENT" badge in UI)
notaryCampaignsRouter.get('/sent-ids', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT notary_id FROM notary_campaign_sends
      WHERE notary_id IS NOT NULL AND status = 'sent'
    `);
    res.json({ ids: result.rows.map(r => r.notary_id) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Campaign send history (paginated)
notaryCampaignsRouter.get('/history', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const [rows, total] = await Promise.all([
      db.execute(sql`
        SELECT ncs.id, ncs.notary_id, ncs.email, ncs.campaign_name, ncs.subject,
               ncs.status, ncs.error, ncs.is_auto, ncs.sent_at,
               n.first_name, n.last_name, n.city, n.expire_date
        FROM notary_campaign_sends ncs
        LEFT JOIN notaries n ON n.id = ncs.notary_id
        ORDER BY ncs.sent_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`SELECT COUNT(*) as count FROM notary_campaign_sends`),
    ]);
    res.json({ rows: rows.rows, total: parseInt(total.rows[0].count) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Get active auto-campaign drip schedule (if any)
notaryCampaignsRouter.get('/auto', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT * FROM drip_schedules
      WHERE contact_type = 'notary' AND name LIKE 'AUTO:%'
      ORDER BY created_at DESC LIMIT 1
    `);
    res.json(result.rows[0] || null);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Create / replace auto-campaign drip schedule
notaryCampaignsRouter.post('/auto', async (req, res) => {
  const { subject, body, from_name, from_email, expiring_days, emails_per_day } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });

  const days    = String(expiring_days || '90');
  const name    = `AUTO: Notary Bond Expiry (${days}d)`;
  const filters = { expiring: days };

  try {
    await db.execute(sql`
      UPDATE drip_schedules SET status = 'paused'
      WHERE contact_type = 'notary' AND name LIKE 'AUTO:%'
    `);
    const result = await db.execute(sql`
      INSERT INTO drip_schedules
        (name, contact_type, filters, emails_per_day, from_name, from_email, subject, body, status)
      VALUES
        (${name}, 'notary', ${JSON.stringify(filters)}::jsonb, ${parseInt(emails_per_day) || 50},
         ${from_name || 'Quantum Surety'}, ${from_email || 'info@quantumsurety.bond'},
         ${subject}, ${body}, 'active')
      RETURNING *
    `);
    res.json(result.rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
