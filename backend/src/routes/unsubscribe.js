import express, { Router } from 'express';
import https from 'https';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const unsubscribeRouter = Router();

async function addToUnsubscribes(email, source) {
  if (!email) return;
  await db.execute(sql`
    INSERT INTO unsubscribes (email, source) VALUES (${email}, ${source})
    ON CONFLICT (email) DO NOTHING
  `);
}

// One-click unsubscribe landing page (GET — user clicks link in email)
unsubscribeRouter.get('/', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.send('<h2>Invalid unsubscribe link.</h2>');
  try {
    await addToUnsubscribes(email, 'link_click');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Unsubscribed - Quantum Surety</title>
      <style>body{font-family:Arial,sans-serif;max-width:500px;margin:80px auto;text-align:center;color:#333}
      h2{color:#C9A84C}.btn{background:#C9A84C;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:16px;font-weight:bold}</style>
      </head>
      <body>
        <h2>You've been unsubscribed</h2>
        <p>${email} has been removed from all Quantum Surety marketing emails.</p>
        <a href="https://quantumsurety.bond" class="btn">Visit Quantum Surety</a>
      </body>
      </html>
    `);
  } catch(err) { res.status(500).send('Error processing unsubscribe.'); }
});

// RFC 8058 one-click POST — Gmail/Yahoo send this when the native unsubscribe button is clicked.
// Body: application/x-www-form-urlencoded with List-Unsubscribe=One-Click
unsubscribeRouter.post('/', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'missing email' });
  try {
    await addToUnsubscribes(email, 'one_click');
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// SES complaint/bounce SNS webhook.
// In AWS: SES → Configuration Set → SNS destination → point to this endpoint.
// SNS sends application/x-amz-sns-message content type, so we parse it as text.
unsubscribeRouter.post('/ses-complaint', express.text({ type: '*/*' }), async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const msgType = req.headers['x-amz-sns-message-type'];

    // Auto-confirm SNS topic subscription
    if (msgType === 'SubscriptionConfirmation' && body.SubscribeURL) {
      https.get(body.SubscribeURL, () => {});
      return res.json({ ok: true, confirmed: true });
    }

    if (msgType !== 'Notification') return res.json({ ok: true });

    const message = typeof body.Message === 'string' ? JSON.parse(body.Message) : body.Message;
    const type = message?.notificationType;

    if (type === 'Complaint') {
      const recipients = message?.complaint?.complainedRecipients || [];
      for (const r of recipients) {
        if (r.emailAddress) await addToUnsubscribes(r.emailAddress, 'ses_complaint').catch(() => {});
      }
    } else if (type === 'Bounce' && message?.bounce?.bounceType === 'Permanent') {
      const recipients = message?.bounce?.bouncedRecipients || [];
      for (const r of recipients) {
        if (r.emailAddress) await addToUnsubscribes(r.emailAddress, 'ses_bounce').catch(() => {});
      }
    }

    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Webhook for Resend events (opens, clicks, bounces)
unsubscribeRouter.post('/webhook', async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const event of events) {
      const email = event.data?.email_id || event.email_id || '';
      const to = event.data?.to?.[0] || '';
      const type = event.type || event.event || '';

      if (type === 'email.bounced' || type === 'email.complained') {
        await addToUnsubscribes(to, type).catch(() => {});
      }

      await db.execute(sql`
        INSERT INTO email_events (email_id, contact_email, event_type, metadata)
        VALUES (${email}, ${to}, ${type}, ${JSON.stringify(event)}::jsonb)
      `);
    }
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

unsubscribeRouter.get('/list', async (req, res) => {
  try {
    const result = await db.execute(sql`SELECT * FROM unsubscribes ORDER BY created_at DESC LIMIT 100`);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});
