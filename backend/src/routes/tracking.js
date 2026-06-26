import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const trackingRouter = Router();

// 1x1 open-tracking pixel
// drip.js sends: ?drip=<id>&e=<email>&t=<contact_type>
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'
);
trackingRouter.get('/open', async (req, res) => {
  const { drip = '', e = '', t = 'notary' } = req.query;
  try {
    await db.execute(sql`
      INSERT INTO email_events (email_id, contact_email, contact_type, event_type, metadata)
      VALUES ('', ${e}, ${t}, 'email.opened', ${JSON.stringify({ drip_id: drip, source: 'pixel' })}::jsonb)
    `);
  } catch (_) { /* non-blocking */ }
  res.set('Content-Type', 'image/gif').set('Cache-Control', 'no-store').send(PIXEL);
});

// Click redirect — drip.js sends: ?drip=<id>&e=<email>&t=<contact_type>&url=<destination>
trackingRouter.get('/click', async (req, res) => {
  const { drip = 'general', e = '', t = 'notary', url = 'https://quantumsurety.bond' } = req.query;

  const utmUrl = new URL(url);
  utmUrl.searchParams.set('utm_source', 'crm');
  utmUrl.searchParams.set('utm_medium', 'email');
  utmUrl.searchParams.set('utm_campaign', drip);
  utmUrl.searchParams.set('utm_content', t);

  try {
    await Promise.all([
      // Record in link_clicks for UTM/analytics
      db.execute(sql`
        INSERT INTO link_clicks (campaign_type, contact_email, contact_type, url, utm_campaign, utm_content)
        VALUES (${drip}, ${e}, ${t}, ${utmUrl.toString()}, ${drip}, ${t})
      `),
      // Record in email_events so auto-pipeline can promote clickers to leads
      db.execute(sql`
        INSERT INTO email_events (email_id, contact_email, contact_type, event_type, metadata)
        VALUES ('', ${e}, ${t}, 'email.clicked', ${JSON.stringify({ drip_id: drip, source: 'link' })}::jsonb)
      `),
    ]);
  } catch (_) { /* non-blocking */ }

  res.redirect(utmUrl.toString());
});

// Generate tracked URL (used by manual/API callers — keeps old param convention)
trackingRouter.post('/url', async (req, res) => {
  const { campaign, contact_email, contact_type, destination = 'https://quantumsurety.bond/quote' } = req.body;
  const base = process.env.BASE_URL || 'https://crm-api.permitpilot.online';
  const tracked = `${base}/api/tracking/click?drip=${encodeURIComponent(campaign||'general')}&e=${encodeURIComponent(contact_email||'')}&t=${encodeURIComponent(contact_type||'notary')}&url=${encodeURIComponent(destination)}`;
  res.json({ url: tracked });
});

// Stats endpoint
trackingRouter.get('/stats', async (req, res) => {
  try {
    const [clicks, opens, recent] = await Promise.all([
      db.execute(sql`
        SELECT campaign_type AS drip_id, COUNT(*) AS clicks, COUNT(DISTINCT contact_email) AS unique_clicks
        FROM link_clicks
        WHERE clicked_at >= NOW() - INTERVAL '7 days'
        GROUP BY campaign_type ORDER BY clicks DESC LIMIT 20
      `),
      db.execute(sql`
        SELECT (metadata->>'drip_id') AS drip_id, contact_type, COUNT(*) AS opens
        FROM email_events
        WHERE event_type = 'email.opened' AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY 1, 2 ORDER BY opens DESC LIMIT 20
      `),
      db.execute(sql`SELECT * FROM link_clicks ORDER BY clicked_at DESC LIMIT 20`),
    ]);
    res.json({
      clicks_7d: clicks.rows,
      opens_7d: opens.rows,
      recent_clicks: recent.rows,
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
