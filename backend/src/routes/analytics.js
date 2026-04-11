import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const analyticsRouter = Router();

analyticsRouter.get('/', async (req, res) => {
  try {
    const [contractorsByState, certTypes, emailsSent, notaryExpiry, pipeline, recentEvents] = await Promise.all([
      db.execute(sql`SELECT state, COUNT(*) as count FROM contractors GROUP BY state ORDER BY count DESC LIMIT 8`),
      db.execute(sql`SELECT certification_type, COUNT(*) as count FROM contractors WHERE certification_type IS NOT NULL GROUP BY certification_type ORDER BY count DESC LIMIT 8`),
      db.execute(sql`SELECT DATE(created_at) as date, COUNT(*) as count FROM email_events WHERE event_type='email.sent' AND created_at > now() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY date ASC`),
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE expire_date < CURRENT_DATE) as expired,
          COUNT(*) FILTER (WHERE expire_date <= CURRENT_DATE + INTERVAL '90 days' AND expire_date >= CURRENT_DATE) as days_90,
          COUNT(*) FILTER (WHERE expire_date <= CURRENT_DATE + INTERVAL '180 days' AND expire_date > CURRENT_DATE + INTERVAL '90 days') as days_180,
          COUNT(*) FILTER (WHERE expire_date > CURRENT_DATE + INTERVAL '180 days') as future
        FROM notaries
      `),
      db.execute(sql`SELECT status, COUNT(*) as count FROM contact_status GROUP BY status`),
      db.execute(sql`SELECT event_type, COUNT(*) as count FROM email_events WHERE created_at > now() - INTERVAL '7 days' GROUP BY event_type ORDER BY count DESC`),
    ]);

    res.json({
      contractors_by_state: contractorsByState.rows,
      cert_types: certTypes.rows,
      emails_sent_daily: emailsSent.rows,
      notary_expiry: notaryExpiry.rows[0],
      pipeline: pipeline.rows,
      recent_events: recentEvents.rows,
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});
