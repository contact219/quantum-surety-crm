import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const unsubscribeRouter = Router();

// One-click unsubscribe landing page
unsubscribeRouter.get('/', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.send('<h2>Invalid unsubscribe link.</h2>');
  try {
    await db.execute(sql`
      INSERT INTO unsubscribes (email) VALUES (${email})
      ON CONFLICT (email) DO NOTHING
    `);
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

// Webhook for Resend events (opens, clicks, bounces)
unsubscribeRouter.post('/webhook', async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    for (const event of events) {
      const email = event.data?.email_id || event.email_id || '';
      const to = event.data?.to?.[0] || '';
      const type = event.type || event.event || '';

      if (type === 'email.bounced' || type === 'email.complained') {
        await db.execute(sql`
          INSERT INTO unsubscribes (email, source) VALUES (${to}, ${type})
          ON CONFLICT (email) DO NOTHING
        `);
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
