import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const trackingRouter = Router();

// Click redirect with UTM tracking
trackingRouter.get('/click', async (req, res) => {
  const { campaign, contact, type, url = 'https://quantumsurety.bond/quote' } = req.query;
  
  const utmUrl = new URL(url);
  utmUrl.searchParams.set('utm_source', 'crm');
  utmUrl.searchParams.set('utm_medium', 'email');
  utmUrl.searchParams.set('utm_campaign', campaign || 'general');
  utmUrl.searchParams.set('utm_content', type || 'contractor');

  try {
    await db.execute(sql`
      INSERT INTO link_clicks (campaign_type, contact_email, contact_type, url, utm_campaign, utm_content)
      VALUES (${campaign||'general'}, ${contact||''}, ${type||'contractor'}, ${utmUrl.toString()}, ${campaign||'general'}, ${type||'contractor'})
    `);
  } catch(e) { /* non-blocking */ }

  res.redirect(utmUrl.toString());
});

// Generate tracked URL for use in email templates
trackingRouter.post('/url', async (req, res) => {
  const { campaign, contact_email, contact_type, destination = 'https://quantumsurety.bond/quote' } = req.body;
  const base = process.env.BASE_URL || 'http://192.168.4.122:8095';
  const tracked = `${base}/api/tracking/click?campaign=${encodeURIComponent(campaign||'general')}&contact=${encodeURIComponent(contact_email||'')}&type=${encodeURIComponent(contact_type||'contractor')}&url=${encodeURIComponent(destination)}`;
  res.json({ url: tracked });
});

// Stats
trackingRouter.get('/stats', async (req, res) => {
  try {
    const [total, byCampaign, recent] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as total FROM link_clicks`),
      db.execute(sql`SELECT utm_campaign, COUNT(*) as clicks FROM link_clicks GROUP BY utm_campaign ORDER BY clicks DESC LIMIT 10`),
      db.execute(sql`SELECT * FROM link_clicks ORDER BY clicked_at DESC LIMIT 20`),
    ]);
    res.json({ total: total.rows[0].total, by_campaign: byCampaign.rows, recent: recent.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
