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
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed — Quantum Surety</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#0A0A0F;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#13131A;border:1px solid #2a2a3a;border-radius:16px;max-width:480px;width:100%;padding:40px 36px;text-align:center}
  .logo-label{font-size:9px;font-family:monospace;letter-spacing:4px;color:#C9A84C;margin-bottom:4px}
  .logo{font-size:26px;font-weight:900;letter-spacing:4px;color:#fff;margin-bottom:4px}
  .gold-line{height:2px;width:48px;background:#C9A84C;margin:16px auto 28px}
  .icon{width:52px;height:52px;border-radius:50%;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:22px}
  h1{color:#fff;font-size:20px;margin-bottom:10px}
  .email{color:#C9A84C;font-size:13px;font-family:monospace;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:6px;padding:6px 14px;display:inline-block;margin-bottom:16px}
  p{color:#888;font-size:13px;line-height:1.7;margin-bottom:24px}
  .btn{background:#C9A84C;color:#000;padding:13px 28px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:700;font-size:14px;letter-spacing:.5px}
  .btn:hover{background:#d4b55a}
  .links{margin-top:20px;display:flex;justify-content:center;gap:20px;flex-wrap:wrap}
  .links a{color:#555;font-size:12px;text-decoration:none}
  .links a:hover{color:#C9A84C}
</style>
</head>
<body>
<div class="card">
  <div class="logo-label">QUANTUM SURETY</div>
  <div class="logo">CRM</div>
  <div class="gold-line"></div>
  <div class="icon">✓</div>
  <h1>You've been unsubscribed</h1>
  <div class="email">${email}</div>
  <p>You've been removed from all Quantum Surety marketing emails.<br>We're sorry to see you go — if you ever need a Texas surety bond, we're here.</p>
  <a href="https://quantumsurety.bond" class="btn">Visit Quantum Surety →</a>
  <div class="links">
    <a href="https://quantumsurety.bond/bonds/notary-bond-texas">Notary Bonds</a>
    <a href="https://quantumsurety.bond/bonds/gdn-bond-texas">Dealer Bonds</a>
    <a href="https://quantumsurety.bond/bonds/license-bond-texas">License Bonds</a>
  </div>
</div>
</body>
</html>`);
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
