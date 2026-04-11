import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const pipelineRouter = Router();

const STATUSES = ['new','contacted','opened','clicked','quoted','bonded'];

pipelineRouter.get('/stats', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT status, COUNT(*) as count FROM contact_status GROUP BY status ORDER BY count DESC
    `);
    const events = await db.execute(sql`
      SELECT event_type, COUNT(*) as count FROM email_events
      WHERE created_at > now() - INTERVAL '30 days'
      GROUP BY event_type ORDER BY count DESC
    `);
    res.json({ pipeline: result.rows, events: events.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

pipelineRouter.post('/status', async (req, res) => {
  const { email, contact_type, status, notes } = req.body;
  if (!email || !status) return res.status(400).json({ error: 'email and status required' });
  try {
    await db.execute(sql`
      INSERT INTO contact_status (contact_email, contact_type, status, notes, last_contacted, updated_at)
      VALUES (${email}, ${contact_type||'contractor'}, ${status}, ${notes||''}, now(), now())
      ON CONFLICT (contact_email) DO UPDATE SET
        status=${status}, notes=${notes||''}, last_contacted=now(), updated_at=now()
    `);
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

pipelineRouter.get('/status/:email', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT * FROM contact_status WHERE contact_email = ${req.params.email}
    `);
    res.json(result.rows[0] || { status: 'new' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
