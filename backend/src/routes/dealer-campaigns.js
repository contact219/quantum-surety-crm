import { Router } from 'express';
import { sendEmail } from '../mailer.js';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const dealerCampaignsRouter = Router();

function buildConditions(filters = {}) {
  const searchPct = filters.search ? `%${filters.search}%` : null;
  const cityPct   = filters.city   ? `%${filters.city}%`   : null;
  const countyPct = filters.county ? `%${filters.county}%` : null;

  const searchCond = searchPct ? sql`AND (business_name ILIKE ${searchPct} OR email ILIKE ${searchPct})` : sql``;
  const cityCond   = cityPct   ? sql`AND city ILIKE ${cityPct}`     : sql``;
  const countyCond = countyPct ? sql`AND county ILIKE ${countyPct}` : sql``;
  const typeCond   = filters.license_type ? sql`AND license_type ILIKE ${'%'+filters.license_type+'%'}` : sql``;

  let expCond;
  if      (filters.expiring === '30')      expCond = sql`AND license_expiration <= CURRENT_DATE + INTERVAL '30 days'  AND license_expiration >= CURRENT_DATE`;
  else if (filters.expiring === '60')      expCond = sql`AND license_expiration <= CURRENT_DATE + INTERVAL '60 days'  AND license_expiration >= CURRENT_DATE`;
  else if (filters.expiring === '90')      expCond = sql`AND license_expiration <= CURRENT_DATE + INTERVAL '90 days'  AND license_expiration >= CURRENT_DATE`;
  else if (filters.expiring === '180')     expCond = sql`AND license_expiration <= CURRENT_DATE + INTERVAL '180 days' AND license_expiration >= CURRENT_DATE`;
  else if (filters.expiring === 'expired') expCond = sql`AND license_expiration < CURRENT_DATE`;
  else expCond = sql``;

  return { searchCond, cityCond, countyCond, typeCond, expCond };
}

function interpolate(template, d, expDate) {
  return template
    .replace(/{{business_name}}/g, d.business_name || '')
    .replace(/{{name}}/g,          d.business_name || '')
    .replace(/{{expire_date}}/g,   expDate)
    .replace(/{{license_type}}/g,  d.license_type || '')
    .replace(/{{county}}/g,        d.county || '')
    .replace(/{{city}}/g,          d.city || '');
}

// Count matching dealers
dealerCampaignsRouter.post('/count', async (req, res) => {
  const { searchCond, cityCond, countyCond, typeCond, expCond } = buildConditions(req.body?.filters);
  const skipSentCond = req.body?.skip_sent
    ? sql`AND id NOT IN (SELECT dealer_id FROM dealer_campaign_sends WHERE dealer_id IS NOT NULL AND status = 'sent')`
    : sql``;
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) as count FROM auto_dealers
      WHERE email != '' AND email IS NOT NULL
      AND email NOT IN (SELECT email FROM unsubscribes)
      ${searchCond} ${cityCond} ${countyCond} ${typeCond} ${expCond} ${skipSentCond}
    `);
    res.json({ count: parseInt(result.rows[0].count) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Send to filtered audience
dealerCampaignsRouter.post('/send', async (req, res) => {
  const { subject, body, from_name, from_email, filters, campaign_name, skip_sent } = req.body;
  if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });

  const { searchCond, cityCond, countyCond, typeCond, expCond } = buildConditions(filters);
  const skipSentCond = skip_sent
    ? sql`AND id NOT IN (SELECT dealer_id FROM dealer_campaign_sends WHERE dealer_id IS NOT NULL AND status = 'sent')`
    : sql``;

  try {
    const rows = await db.execute(sql`
      SELECT id, business_name, dba_name, license_type, license_expiration, city, county, email
      FROM auto_dealers
      WHERE email != '' AND email IS NOT NULL
      AND email NOT IN (SELECT email FROM unsubscribes)
      ${searchCond} ${cityCond} ${countyCond} ${typeCond} ${expCond} ${skipSentCond}
      LIMIT 5000
    `);

    let sent = 0, failed = 0;
    const name = campaign_name || subject;

    for (const d of rows.rows) {
      const expDate = d.license_expiration
        ? new Date(d.license_expiration).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : '';
      const html = interpolate(body, d, expDate);
      const subj = interpolate(subject, d, expDate);

      try {
        await sendEmail({
          from: `"${(from_name || 'Quantum Surety').replace(/"/g,'')}" <${from_email || 'info@quantumsurety.bond'}>`,
          to: d.email, subject: subj, html,
        });
        await db.execute(sql`
          INSERT INTO dealer_campaign_sends (dealer_id, email, campaign_name, subject, status)
          VALUES (${d.id}, ${d.email}, ${name}, ${subj}, 'sent')
        `);
        sent++;
        await new Promise(r => setTimeout(r, 300));
      } catch(e) {
        await db.execute(sql`
          INSERT INTO dealer_campaign_sends (dealer_id, email, campaign_name, subject, status, error)
          VALUES (${d.id}, ${d.email}, ${name}, ${subj}, 'failed', ${e.message})
        `).catch(() => {});
        failed++;
      }
    }

    res.json({ ok: true, sent, failed, total: rows.rows.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Campaign send history
dealerCampaignsRouter.get('/history', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const [rows, total] = await Promise.all([
      db.execute(sql`
        SELECT dcs.id, dcs.dealer_id, dcs.email, dcs.campaign_name, dcs.subject,
               dcs.status, dcs.error, dcs.is_auto, dcs.sent_at,
               d.business_name, d.city, d.county, d.license_expiration
        FROM dealer_campaign_sends dcs
        LEFT JOIN auto_dealers d ON d.id = dcs.dealer_id
        ORDER BY dcs.sent_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`SELECT COUNT(*) as count FROM dealer_campaign_sends`),
    ]);
    res.json({ rows: rows.rows, total: parseInt(total.rows[0].count) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Sent dealer IDs (for SENT badges)
dealerCampaignsRouter.get('/sent-ids', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT dealer_id FROM dealer_campaign_sends
      WHERE dealer_id IS NOT NULL AND status = 'sent'
    `);
    res.json({ ids: result.rows.map(r => r.dealer_id) });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
