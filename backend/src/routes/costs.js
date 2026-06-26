import express from 'express';
import { pool } from '../db.js';

export const costsRouter = express.Router();

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS op_cost_rates (
        id SERIAL PRIMARY KEY,
        service_key VARCHAR(50) NOT NULL UNIQUE,
        display_name VARCHAR(100) NOT NULL,
        category VARCHAR(50) DEFAULT 'usage',
        unit_label VARCHAR(50),
        rate_per_unit DECIMAL(10,6) DEFAULT 0,
        monthly_flat DECIMAL(10,2) DEFAULT 0,
        notes TEXT,
        updated_at TIMESTAMP DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS op_cost_entries (
        id SERIAL PRIMARY KEY,
        service_key VARCHAR(50) NOT NULL,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        actual_amount DECIMAL(10,2),
        units_consumed DECIMAL(12,2),
        notes TEXT,
        is_auto BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now(),
        UNIQUE(service_key, year, month)
      );
      CREATE INDEX IF NOT EXISTS op_cost_entries_period ON op_cost_entries(year, month);
    `);
    await pool.query(`
      INSERT INTO op_cost_rates (service_key, display_name, category, unit_label, rate_per_unit, monthly_flat, notes)
      VALUES
        ('ses', 'AWS SES (Email)', 'usage', '1K emails', 0.10, 15.00, 'Base subscription + $0.10/1K emails'),
        ('retellai', 'Retell AI (Voice)', 'usage', 'minute', 0.07, 20.00, '~$0.07/min inbound+outbound'),
        ('claude', 'Claude AI', 'flat', 'month', 0, 20.00, 'Log actual from Anthropic console'),
        ('vps', 'VPS Hosting', 'flat', 'month', 0, 30, '130.51.23.147 - update with invoice amount'),
        ('neon', 'Neon PostgreSQL', 'flat', 'month', 0, 0, 'Free tier - update if on paid plan'),
        ('domain', 'Domain / DNS', 'flat', 'month', 0, 2.50, 'quantumsurety.bond ~$30/yr prorated'),
        ('cloudflare', 'Cloudflare', 'flat', 'month', 0, 0, 'Free tier currently'),
        ('zohomail', 'Zoho Mail', 'flat', 'month', 0, 12.50, 'Zoho Mail subscription'),
        ('other', 'Other / Misc', 'manual', '', 0, 0, 'Miscellaneous expenses')
      ON CONFLICT (service_key) DO NOTHING
    `);
    console.log('[Costs] Tables ready');
  } catch (e) {
    console.error('[Costs] Init error:', e.message);
  }
})();

costsRouter.get('/rates', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM op_cost_rates ORDER BY id');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

costsRouter.put('/rates/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { rate_per_unit, monthly_flat, notes, display_name } = req.body;
    await pool.query(
      'UPDATE op_cost_rates SET rate_per_unit=$1, monthly_flat=$2, notes=$3, display_name=COALESCE($4,display_name), updated_at=now() WHERE service_key=$5',
      [rate_per_unit ?? 0, monthly_flat ?? 0, notes ?? '', display_name, key]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function getEmailCount(y, m) {
  try {
    const start = new Date(y, m - 1, 1).toISOString();
    const end = new Date(y, m, 1).toISOString();
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM campaign_sends WHERE status='sent' AND sent_at>=$1 AND sent_at<$2)
        +(SELECT COUNT(*) FROM notary_campaign_sends WHERE sent_at>=$1 AND sent_at<$2)
        +(SELECT COUNT(*) FROM dealer_campaign_sends WHERE sent_at>=$1 AND sent_at<$2)
      AS total
    `, [start, end]);
    return parseInt(rows[0]?.total || 0);
  } catch { return 0; }
}

async function getVoiceMinutes(y, m) {
  try {
    const resp = await fetch('https://voice-agent.permitpilot.online/api/calls', { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return 0;
    const calls = await resp.json();
    const secs = calls
      .filter(c => {
        const d = new Date(c.start_timestamp || c.call_start || c.created_at || 0);
        return d.getFullYear() === y && d.getMonth() + 1 === m;
      })
      .reduce((s, c) => s + (parseInt(c.call_duration_secs || c.duration_seconds || 0) || 0), 0);
    return Math.ceil(secs / 60);
  } catch { return 0; }
}

costsRouter.get('/summary', async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months || '6'), 12);
    const now = new Date();
    const { rows: rates } = await pool.query('SELECT * FROM op_cost_rates ORDER BY id');
    const result = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const [{ rows: entries }, emailCount, voiceMinutes] = await Promise.all([
        pool.query(`
          SELECT e.*, r.display_name, r.category, r.rate_per_unit, r.monthly_flat, r.unit_label
          FROM op_cost_entries e JOIN op_cost_rates r ON r.service_key=e.service_key
          WHERE e.year=$1 AND e.month=$2 ORDER BY e.service_key
        `, [y, m]),
        getEmailCount(y, m),
        getVoiceMinutes(y, m),
      ]);
      const daysInMonth = new Date(y, m, 0).getDate();
      const daysElapsed = (y === now.getFullYear() && m === now.getMonth() + 1)
        ? Math.max(1, now.getDate()) : daysInMonth;
      result.push({
        year: y, month: m,
        month_label: d.toLocaleString('en-US', { month: 'long' }),
        days_in_month: daysInMonth,
        days_elapsed: daysElapsed,
        entries,
        rates,
        auto: {
          ses_emails: emailCount,
          ses_est_cost: Math.round((emailCount / 1000) * 10) / 100,
          voice_minutes: voiceMinutes,
          voice_est_cost: Math.round(voiceMinutes * 7) / 100,
        },
      });
    }
    res.json(result);
  } catch (e) {
    console.error('[Costs summary]', e.message);
    res.status(500).json({ error: e.message });
  }
});

costsRouter.post('/entry', async (req, res) => {
  try {
    const { service_key, year, month, actual_amount, units_consumed, notes } = req.body;
    await pool.query(`
      INSERT INTO op_cost_entries (service_key, year, month, actual_amount, units_consumed, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,now())
      ON CONFLICT (service_key, year, month)
      DO UPDATE SET actual_amount=EXCLUDED.actual_amount, units_consumed=EXCLUDED.units_consumed, notes=EXCLUDED.notes, updated_at=now()
    `, [service_key, parseInt(year), parseInt(month),
        actual_amount != null ? parseFloat(actual_amount) : null,
        units_consumed != null ? parseFloat(units_consumed) : null,
        notes || null]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

costsRouter.delete('/entry/:key/:year/:month', async (req, res) => {
  try {
    const { key, year, month } = req.params;
    await pool.query('DELETE FROM op_cost_entries WHERE service_key=$1 AND year=$2 AND month=$3',
      [key, parseInt(year), parseInt(month)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
