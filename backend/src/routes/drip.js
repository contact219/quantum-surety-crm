import { Router } from 'express';
import { sendEmail } from '../mailer.js';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const dripRouter = Router();

const APP_URL = process.env.APP_URL || 'https://quantumsurety.bond';

// Weekday gate — skip Saturday (6) and Sunday (0) unless DRIP_ALL_DAYS=true
function isWeekday() {
  if (process.env.DRIP_ALL_DAYS === 'true') return true;
  const day = new Date().getUTCDay(); // use UTC; server is CDT (UTC-5/6)
  // Convert to CDT
  const cdtHour = (new Date().getUTCHours() - 5 + 24) % 24;
  const cdtDay  = cdtHour < 0 ? (day - 1 + 7) % 7 : day;
  return cdtDay !== 0 && cdtDay !== 6;
}

function interpolate(template, vars) {
  return template
    .replace(/{{first_name}}/g,      vars.first_name || '')
    .replace(/{{name}}/g,            vars.name || '')
    .replace(/{{expire_date}}/g,     vars.expire_date || '')
    .replace(/{{surety_company}}/g,  vars.surety_company || '')
    .replace(/{{business_name}}/g,   vars.business_name || '')
    .replace(/{{license_type}}/g,    vars.license_type || '')
    .replace(/{{city}}/g,            vars.city || '')
    .replace(/{{county}}/g,          vars.county || '')
    .replace(/{{unsubscribe_url}}/g, vars.unsubscribe_url || '');
}

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

// Run drip — called by cron 4x/day at 9, 10, 11, 12 CDT
dripRouter.post('/run', async (req, res) => {
  // Skip weekends to protect SES reputation and focus sends on business days
  if (!isWeekday()) {
    return res.json({ ok: true, skipped: 'weekend', total_sent: 0 });
  }

  try {
    const schedules = await db.execute(sql`SELECT * FROM drip_schedules WHERE status = 'active'`);
    let totalSent = 0;

    for (const schedule of schedules.rows) {
      const filters = schedule.filters || {};
      // emails_per_day split across 4 cron runs
      const limit = Math.ceil((schedule.emails_per_day || 100) / 4);
      let contacts = [];

      // ── NOTARY ────────────────────────────────────────────────────────────
      if (schedule.contact_type === 'notary') {
        const suretyPct  = filters.surety ? `%${filters.surety}%` : null;
        const cityPct    = filters.city   ? `%${filters.city}%`   : null;
        const suretyCond = suretyPct ? sql`AND surety_company ILIKE ${suretyPct}` : sql``;
        const cityCond   = cityPct   ? sql`AND city ILIKE ${cityPct}`             : sql``;
        const expCond    = filters.expiring === '30'      ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '30 days'  AND expire_date >= CURRENT_DATE`
                         : filters.expiring === '60'      ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '60 days'  AND expire_date >= CURRENT_DATE`
                         : filters.expiring === '90'      ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '90 days'  AND expire_date >= CURRENT_DATE`
                         : filters.expiring === '180'     ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '180 days' AND expire_date >= CURRENT_DATE`
                         : filters.expiring === 'today'   ? sql`AND expire_date = CURRENT_DATE`
                         : filters.expiring === 'next3'   ? sql`AND expire_date <= CURRENT_DATE + INTERVAL '3 days'  AND expire_date >= CURRENT_DATE`
                         : filters.expiring === 'expired' ? sql`AND expire_date < CURRENT_DATE`
                         : sql``;
        const result = await db.execute(sql`
          SELECT id, first_name, last_name, email, expire_date, surety_company FROM notaries
          WHERE email != '' AND email IS NOT NULL
          AND email NOT IN (SELECT email FROM unsubscribes)
          AND email NOT IN (
            SELECT email FROM notary_campaign_sends
            WHERE drip_id = ${schedule.id}
            AND status IN ('sent','suppressed')
            AND sent_at > NOW() - INTERVAL '60 days'
          )
          ${suretyCond} ${cityCond} ${expCond}
          ORDER BY expire_date ASC LIMIT ${limit}
        `);
        contacts = result.rows.map(r => ({ ...r, _type: 'notary' }));

      // ── NOTARY FOLLOW-UP ──────────────────────────────────────────────────
      } else if (schedule.contact_type === 'notary_followup') {
        const result = await db.execute(sql`
          SELECT DISTINCT ON (n.email)
            n.id, n.first_name, n.last_name, n.email, n.expire_date, n.surety_company
          FROM notaries n
          WHERE n.email != '' AND n.email IS NOT NULL
          AND n.email NOT IN (SELECT email FROM unsubscribes)
          AND n.email IN (
            SELECT email FROM notary_campaign_sends
            WHERE status = 'sent' AND is_auto = false
            AND sent_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '5 days'
          )
          AND n.email NOT IN (
            SELECT email FROM notary_campaign_sends
            WHERE drip_id = ${schedule.id}
            AND campaign_name LIKE 'FOLLOW-UP:%' AND status = 'sent'
          )
          AND n.expire_date >= CURRENT_DATE
          ORDER BY n.email, n.expire_date ASC
          LIMIT ${limit}
        `);
        contacts = result.rows.map(r => ({ ...r, _type: 'notary' }));

      // ── DEALER ────────────────────────────────────────────────────────────
      } else if (schedule.contact_type === 'dealer') {
        const cityPct    = filters.city         ? `%${filters.city}%`         : null;
        const countyPct  = filters.county       ? `%${filters.county}%`       : null;
        const cityCond   = cityPct   ? sql`AND city ILIKE ${cityPct}`     : sql``;
        const countyCond = countyPct ? sql`AND county ILIKE ${countyPct}` : sql``;
        const typeCond   = filters.license_type ? sql`AND license_type ILIKE ${'%'+filters.license_type+'%'}` : sql``;
        const expCond    = filters.expiring === '30'      ? sql`AND license_expiration <= CURRENT_DATE + INTERVAL '30 days'  AND license_expiration >= CURRENT_DATE`
                         : filters.expiring === '60'      ? sql`AND license_expiration <= CURRENT_DATE + INTERVAL '60 days'  AND license_expiration >= CURRENT_DATE`
                         : filters.expiring === '90'      ? sql`AND license_expiration <= CURRENT_DATE + INTERVAL '90 days'  AND license_expiration >= CURRENT_DATE`
                         : filters.expiring === '180'     ? sql`AND license_expiration <= CURRENT_DATE + INTERVAL '180 days' AND license_expiration >= CURRENT_DATE`
                         : filters.expiring === 'today'   ? sql`AND license_expiration = CURRENT_DATE`
                         : filters.expiring === 'next3'   ? sql`AND license_expiration <= CURRENT_DATE + INTERVAL '3 days'  AND license_expiration >= CURRENT_DATE`
                         : filters.expiring === 'expired' ? sql`AND license_expiration < CURRENT_DATE`
                         : sql``;
        const result = await db.execute(sql`
          SELECT id, business_name, email, license_expiration as expire_date,
                 license_type, city, county
          FROM auto_dealers
          WHERE email != '' AND email IS NOT NULL
          AND email NOT IN (SELECT email FROM unsubscribes)
          AND id NOT IN (
            SELECT dealer_id FROM dealer_campaign_sends
            WHERE drip_id = ${schedule.id}
            AND status = 'sent'
            AND sent_at > NOW() - INTERVAL '60 days'
          )
          ${cityCond} ${countyCond} ${typeCond} ${expCond}
          ORDER BY license_expiration ASC LIMIT ${limit}
        `);
        contacts = result.rows.map(r => ({
          ...r,
          first_name: r.business_name,
          last_name: '',
          surety_company: r.license_type,
          _type: 'dealer',
        }));

      // ── DEALER FOLLOW-UP ──────────────────────────────────────────────────
      } else if (schedule.contact_type === 'dealer_followup') {
        const result = await db.execute(sql`
          SELECT DISTINCT ON (d.email)
            d.id, d.business_name, d.email, d.license_expiration as expire_date,
            d.license_type, d.city, d.county
          FROM auto_dealers d
          WHERE d.email != '' AND d.email IS NOT NULL
          AND d.email NOT IN (SELECT email FROM unsubscribes)
          AND d.id IN (
            SELECT dealer_id FROM dealer_campaign_sends
            WHERE status = 'sent' AND is_auto = false
            AND sent_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '5 days'
          )
          AND d.email NOT IN (
            SELECT email FROM dealer_campaign_sends
            WHERE drip_id = ${schedule.id}
            AND campaign_name LIKE 'FOLLOW-UP:%' AND status = 'sent'
          )
          AND d.license_expiration >= CURRENT_DATE
          ORDER BY d.email, d.license_expiration ASC
          LIMIT ${limit}
        `);
        contacts = result.rows.map(r => ({
          ...r,
          first_name: r.business_name,
          last_name: '',
          surety_company: r.license_type,
          _type: 'dealer',
        }));

      // ── LAPSED NOTARY (bond already expired) ─────────────────────────────
      } else if (schedule.contact_type === 'lapsed_notary') {
        const cityPct  = filters.city ? `%${filters.city}%` : null;
        const cityCond = cityPct ? sql`AND city ILIKE ${cityPct}` : sql``;
        const result = await db.execute(sql`
          SELECT id, first_name, last_name, email, expire_date, surety_company FROM notaries
          WHERE email != '' AND email IS NOT NULL
          AND expire_date < CURRENT_DATE
          AND expire_date > CURRENT_DATE - INTERVAL '2 years'
          AND email NOT IN (SELECT email FROM unsubscribes)
          AND email NOT IN (
            SELECT email FROM notary_campaign_sends
            WHERE drip_id = ${schedule.id}
            AND status IN ('sent','suppressed')
            AND sent_at > NOW() - INTERVAL '60 days'
          )
          ${cityCond}
          ORDER BY expire_date DESC LIMIT ${limit}
        `);
        contacts = result.rows.map(r => ({ ...r, _type: 'notary' }));

      // ── NOTARY OPENER FOLLOW-UP (opened email in last 30d) ────────────────
      } else if (schedule.contact_type === 'notary_opener') {
        const result = await db.execute(sql`
          SELECT DISTINCT ON (n.email)
            n.id, n.first_name, n.last_name, n.email, n.expire_date, n.surety_company
          FROM notaries n
          WHERE n.email != '' AND n.email IS NOT NULL
          AND n.email NOT IN (SELECT email FROM unsubscribes)
          AND n.email IN (
            SELECT contact_email FROM email_events
            WHERE event_type = 'email.opened'
            AND created_at > NOW() - INTERVAL '30 days'
          )
          AND n.email NOT IN (
            SELECT email FROM notary_campaign_sends
            WHERE drip_id = ${schedule.id}
            AND campaign_name LIKE 'WARM-OPEN:%' AND status = 'sent'
            AND sent_at > NOW() - INTERVAL '60 days'
          )
          ORDER BY n.email, n.expire_date ASC
          LIMIT ${limit}
        `);
        contacts = result.rows.map(r => ({ ...r, _type: 'notary' }));

      // ── CONTRACTOR ────────────────────────────────────────────────────────
      } else if (schedule.contact_type === 'contractor') {
        const stateCond = filters.state ? sql`AND state = ${filters.state}` : sql``;
        const certCond  = filters.cert_type ? sql`AND certification_type ILIKE ${'%' + filters.cert_type + '%'}` : sql``;
        const result = await db.execute(sql`
          SELECT id, company_name as first_name, '' as last_name, email,
                 null::date as expire_date, certification_type as surety_company, city
          FROM contractors
          WHERE email IS NOT NULL AND email != ''
          AND email NOT IN (SELECT email FROM unsubscribes)
          AND email NOT IN (
            SELECT contact_email FROM email_events
            WHERE contact_type = 'contractor' AND event_type = 'email.sent'
            AND created_at > NOW() - INTERVAL '90 days'
          )
          ${stateCond} ${certCond}
          ORDER BY company_name ASC LIMIT ${limit}
        `);
        contacts = result.rows.map(r => ({ ...r, _type: 'contractor' }));

      } else {
        console.warn(`Unknown contact_type: ${schedule.contact_type} for drip ${schedule.id}`);
      }

      let sent = 0;
      for (const c of contacts) {
        if (!c.email) continue;

        const expDate      = c.expire_date ? new Date(c.expire_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
        const unsubUrl     = `${APP_URL}/api/unsubscribe?email=${encodeURIComponent(c.email)}`;
        const vars = {
          first_name:     c.first_name || '',
          name:           `${c.first_name || ''} ${c.last_name || ''}`.trim(),
          expire_date:    expDate,
          surety_company: c.surety_company || '',
          business_name:  c.business_name || c.first_name || '',
          license_type:   c.license_type || '',
          city:           c.city || '',
          county:         c.county || '',
          unsubscribe_url: unsubUrl,
        };

        const rawHtml = interpolate(schedule.body, vars);
        const subj = interpolate(schedule.subject, vars);
        const pixelUrl = `https://crm-api.permitpilot.online/api/tracking/open?drip=${schedule.id}&e=${encodeURIComponent(c.email)}&t=${encodeURIComponent(c._type)}`;
        const linkedHtml = rawHtml.replace(/href="(https?:\/\/quantumsurety\.bond[^"]*)"/g, (m, u) => {
          if (u.includes('/unsubscribe') || u.includes('/api/tracking/')) return m;
          const tracked = `https://crm-api.permitpilot.online/api/tracking/click?drip=${schedule.id}&e=${encodeURIComponent(c.email)}&t=${encodeURIComponent(c._type)}&url=${encodeURIComponent(u)}`;
          return `href="${tracked}"`;
        });
        const html = linkedHtml.replace('</div>', `<img src="${pixelUrl}" width="1" height="1" style="display:none" /></div>`);

        try {
          const r = await sendEmail({
            from: `"${schedule.from_name.replace(/"/g, '')}" <${schedule.from_email}>`,
            to: c.email,
            subject: subj,
            html,
            headers: {
              'List-Unsubscribe':      `<${unsubUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          });

          const emailId = r.id || '';
          await db.execute(sql`
            INSERT INTO email_events (email_id, contact_email, contact_type, event_type, metadata)
            VALUES (${emailId}, ${c.email}, ${c._type}, 'email.sent', ${JSON.stringify({ drip_id: schedule.id })}::jsonb)
          `);

          if (c._type === 'notary') {
            await db.execute(sql`
              INSERT INTO notary_campaign_sends (notary_id, email, campaign_name, subject, status, is_auto, drip_id)
              VALUES (${c.id || null}, ${c.email}, ${schedule.name}, ${subj}, 'sent', true, ${schedule.id})
            `);
          } else if (c._type === 'dealer') {
            await db.execute(sql`
              INSERT INTO dealer_campaign_sends (dealer_id, email, campaign_name, subject, status, is_auto, drip_id)
              VALUES (${c.id || null}, ${c.email}, ${schedule.name}, ${subj}, 'sent', true, ${schedule.id})
            `);
          }

          sent++;
          await new Promise(resolve => setTimeout(resolve, 80));
        } catch(e) {
          const msg = e.message || '';
          const code = e.Code || e.code || '';
          if (/Throttling|throttl|rate.exceed|too many/i.test(msg + code)) {
            console.error('Drip rate limited by SES — stopping this run.');
            break;
          }
          console.error('Drip send error:', msg);
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

// Daily alert — notaries expiring in 30 days
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
        <td style="padding:6px 12px;color:#C9A84C">${new Date(n.expire_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        <td style="padding:6px 12px;font-size:12px;color:#666">${n.surety_company}</td>
        <td style="padding:6px 12px"><a href="mailto:${n.email}" style="color:#4C9AC9">${n.email}</a></td>
      </tr>
    `).join('');

    await sendEmail({
      from: 'Quantum Surety CRM <info@quantumsurety.bond>',
      to: to_email,
      subject: `${notaries.length} Texas Notaries Expiring in 30 Days — ${new Date().toLocaleDateString()}`,
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
          <p style="margin-top:24px;color:#666;font-size:12px">Quantum Surety CRM</p>
        </div>
      `,
    });
    res.json({ ok: true, sent_to: to_email, count: notaries.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── AUTO-PIPELINE ─────────────────────────────────────────────────────────────
// Nightly job: add anyone who opened/clicked a drip email in the last 25h to leads

dripRouter.post('/auto-pipeline', async (req, res) => {
  let contractors = 0, notaries = 0, dealers = 0;
  try {
    const cr = await db.execute(sql`
      INSERT INTO leads (name, email, phone, bond_type, source, status, notes, lead_time, created_at, updated_at)
      SELECT DISTINCT ON (c.email)
        c.company_name, c.email,
        CASE WHEN c.phone ~ '^[0-9]' THEN c.phone ELSE '' END,
        'Texas Contractor License Bond',
        'auto-pipeline — drip open/click',
        'new',
        'Auto-added ' || TO_CHAR(NOW() AT TIME ZONE 'America/Chicago','Mon DD') ||
          ': opened/clicked contractor email. HUB certified, ' || c.city || ' TX.',
        NOW(), NOW(), NOW()
      FROM email_events e
      JOIN contractors c ON c.email = e.contact_email
      WHERE e.event_type IN ('email.opened','email.clicked')
        AND e.created_at > NOW() - INTERVAL '25 hours'
        AND e.contact_type = 'contractor'
        AND c.email IS NOT NULL AND c.email != ''
        AND c.email NOT IN (SELECT email FROM leads WHERE created_at > NOW() - INTERVAL '7 days')
      ON CONFLICT (email, lead_time) DO NOTHING
      RETURNING id
    `);
    contractors = cr.rows.length;

    const nr = await db.execute(sql`
      INSERT INTO leads (name, email, phone, bond_type, source, status, notes, lead_time, created_at, updated_at)
      SELECT DISTINCT ON (n.email)
        n.first_name || ' ' || n.last_name, n.email, '',
        'Texas Notary Bond',
        'auto-pipeline — drip open/click',
        'new',
        'Auto-added ' || TO_CHAR(NOW() AT TIME ZONE 'America/Chicago','Mon DD') ||
          ': opened/clicked notary email. Expires: ' ||
          COALESCE(TO_CHAR(n.expire_date,'Mon DD YYYY'),'unknown'),
        NOW(), NOW(), NOW()
      FROM email_events e
      JOIN notaries n ON n.email = e.contact_email
      WHERE e.event_type IN ('email.opened','email.clicked')
        AND e.created_at > NOW() - INTERVAL '25 hours'
        AND e.contact_type = 'notary'
        AND n.email IS NOT NULL AND n.email != ''
        AND n.email NOT IN (SELECT email FROM leads WHERE created_at > NOW() - INTERVAL '7 days')
      ON CONFLICT (email, lead_time) DO NOTHING
      RETURNING id
    `);
    notaries = nr.rows.length;

    const dr = await db.execute(sql`
      INSERT INTO leads (name, email, phone, bond_type, source, status, notes, lead_time, created_at, updated_at)
      SELECT DISTINCT ON (d.email)
        d.business_name, d.email, COALESCE(d.phone,''),
        'Texas GDN Dealer Bond',
        'auto-pipeline — drip open/click',
        'new',
        'Auto-added ' || TO_CHAR(NOW() AT TIME ZONE 'America/Chicago','Mon DD') ||
          ': opened/clicked dealer email. License expires: ' ||
          COALESCE(TO_CHAR(d.license_expiration,'Mon DD YYYY'),'unknown'),
        NOW(), NOW(), NOW()
      FROM email_events e
      JOIN auto_dealers d ON d.email = e.contact_email
      WHERE e.event_type IN ('email.opened','email.clicked')
        AND e.created_at > NOW() - INTERVAL '25 hours'
        AND e.contact_type = 'dealer'
        AND d.email IS NOT NULL AND d.email != ''
        AND d.email NOT IN (SELECT email FROM leads WHERE created_at > NOW() - INTERVAL '7 days')
      ON CONFLICT (email, lead_time) DO NOTHING
      RETURNING id
    `);
    dealers = dr.rows.length;

    console.log(`[Auto-pipeline] contractors=${contractors} notaries=${notaries} dealers=${dealers}`);
    res.json({ ok: true, inserted: contractors + notaries + dealers, contractors, notaries, dealers });
  } catch(err) {
    console.error('[Auto-pipeline]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CAMPAIGN ANALYTICS ────────────────────────────────────────────────────────

dripRouter.get('/analytics', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        ds.id, ds.name, ds.contact_type, ds.status,
        ds.emails_per_day, ds.total_sent, ds.last_run,
        COUNT(DISTINCT CASE WHEN ee.event_type = 'email.opened'  THEN ee.contact_email END)::int AS unique_opens,
        COUNT(DISTINCT CASE WHEN ee.event_type = 'email.clicked' THEN ee.contact_email END)::int AS unique_clicks,
        COUNT(CASE WHEN ee.event_type = 'email.opened'  THEN 1 END)::int AS total_opens,
        COUNT(CASE WHEN ee.event_type = 'email.clicked' THEN 1 END)::int AS total_clicks,
        COUNT(DISTINCT CASE WHEN ee.event_type = 'email.opened' AND ee.created_at > NOW() - INTERVAL '7 days'
          THEN ee.contact_email END)::int AS opens_7d
      FROM drip_schedules ds
      LEFT JOIN email_events ee
        ON (ee.metadata->>'drip_id')::text = ds.id::text
      GROUP BY ds.id
      ORDER BY ds.total_sent DESC
    `);

    const rows = result.rows.map(r => ({
      ...r,
      open_rate:  r.total_sent > 0 ? Math.round((r.unique_opens  / r.total_sent) * 100) : 0,
      click_rate: r.total_sent > 0 ? Math.round((r.unique_clicks / r.total_sent) * 100) : 0,
    }));

    res.json(rows);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});
