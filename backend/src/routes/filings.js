import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';
import { sendEmail } from '../mailer.js';

export const filingsRouter = Router();

const STATUS_LABELS = {
  received:   'Received',
  preparing:  'Preparing',
  mailed:     'Mailed',
  confirmed:  'Confirmed',
  rejected:   'Rejected',
};

// ── GET /api/filings — admin queue ────────────────────────────────────────────
filingsRouter.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    const statusCond = status && status !== 'all' ? sql`AND status = ${status}` : sql``;
    const searchCond = search
      ? sql`AND (notary_name ILIKE ${'%'+search+'%'} OR notary_email ILIKE ${'%'+search+'%'} OR county ILIKE ${'%'+search+'%'})`
      : sql``;
    const result = await db.execute(sql`
      SELECT * FROM bond_filings
      WHERE 1=1 ${statusCond} ${searchCond}
      ORDER BY created_at DESC LIMIT 200
    `);
    const counts = await db.execute(sql`
      SELECT status, COUNT(*)::int AS n FROM bond_filings GROUP BY status
    `);
    res.json({ filings: result.rows, counts: counts.rows });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/filings — create (called from Bond Verify webhook) ──────────────
filingsRouter.post('/', async (req, res) => {
  const {
    request_id, notary_name, notary_email, notary_phone,
    county, bond_number, bond_amount, effective_date, expiry_date,
    surety_company, cert_filename, cert_base64,
    price_paid, stripe_payment_id,
  } = req.body;

  if (!notary_name || !notary_email || !county)
    return res.status(400).json({ error: 'notary_name, notary_email, and county required' });

  try {
    const result = await db.execute(sql`
      INSERT INTO bond_filings
        (request_id, notary_name, notary_email, notary_phone, county,
         bond_number, bond_amount, effective_date, expiry_date, surety_company,
         cert_filename, cert_base64, price_paid, stripe_payment_id, status)
      VALUES
        (${request_id||null}, ${notary_name}, ${notary_email}, ${notary_phone||null}, ${county},
         ${bond_number||null}, ${bond_amount||null},
         ${effective_date||null}, ${expiry_date||null}, ${surety_company||null},
         ${cert_filename||null}, ${cert_base64||null},
         ${price_paid||12.99}, ${stripe_payment_id||null}, 'received')
      RETURNING id
    `);
    res.json({ ok: true, id: result.rows[0].id });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/filings/:id/status — update status + trigger email ─────────────
filingsRouter.patch('/:id/status', async (req, res) => {
  const id = parseInt(req.params.id);
  const { status, tracking_number, admin_notes } = req.body;

  if (!STATUS_LABELS[status]) return res.status(400).json({ error: 'invalid status' });

  try {
    const mailedAt  = status === 'mailed'    ? sql`, mailed_at = NOW()`    : sql``;
    const confirmedAt = status === 'confirmed' ? sql`, confirmed_at = NOW()` : sql``;
    const trackingSet = tracking_number ? sql`, tracking_number = ${tracking_number}` : sql``;
    const notesSet    = admin_notes     ? sql`, admin_notes = ${admin_notes}`          : sql``;

    await db.execute(sql`
      UPDATE bond_filings
      SET status = ${status}, updated_at = NOW()
          ${mailedAt} ${confirmedAt} ${trackingSet} ${notesSet}
      WHERE id = ${id}
    `);

    // Send status email
    const [[filing]] = await (async () => {
      const r = await db.execute(sql`SELECT * FROM bond_filings WHERE id = ${id}`);
      return [r.rows];
    })();
    if (filing && filing.notary_email) {
      await sendStatusEmail(filing, status, tracking_number);
    }

    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/filings/:id/cert — stream cert PDF back to admin ─────────────────
filingsRouter.get('/:id/cert', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT cert_base64, cert_filename FROM bond_filings WHERE id = ${parseInt(req.params.id)}
    `);
    const row = result.rows[0];
    if (!row || !row.cert_base64) return res.status(404).json({ error: 'No cert on file' });
    const buf = Buffer.from(row.cert_base64, 'base64');
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${row.cert_filename || 'bond-cert.pdf'}"`);
    res.send(buf);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/filings/counties — TX county list ────────────────────────────────
filingsRouter.get('/counties', async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT county_name, clerk_name, address, city, zip, phone
      FROM tx_county_clerks ORDER BY county_name ASC
    `);
    res.json(result.rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Email helpers ─────────────────────────────────────────────────────────────
async function sendStatusEmail(filing, status, trackingNumber) {
  const first = (filing.notary_name || '').split(' ')[0];
  const county = filing.county;
  const wrap = body => `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;
                background:#0a0f1e;color:#e2e8f0;border-radius:12px">
      <div style="color:#f59e0b;font-size:11px;letter-spacing:3px;font-weight:700;margin-bottom:20px">
        QUANTUM SURETY · FILING SERVICE
      </div>
      ${body}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #1e293b;
                  font-size:12px;color:#64748b">
        Quantum Surety LLC · Texas Bonds · quantumsurety.bond
      </div>
    </div>`;

  const templates = {
    mailed: {
      subject: `Your bond has been mailed — ${county} County`,
      html: wrap(`
        <h2 style="color:#fff;margin-bottom:16px">Your bond is on its way</h2>
        <p>Hi ${first},</p>
        <p>We mailed your notary bond certificate to <strong>${county} County Clerk</strong>
           today via USPS Certified Mail.</p>
        ${trackingNumber ? `
        <div style="background:#1e293b;border-radius:8px;padding:20px;margin:24px 0;text-align:center">
          <div style="font-size:11px;color:#94a3b8;margin-bottom:6px">USPS TRACKING NUMBER</div>
          <div style="font-size:20px;font-weight:700;color:#f59e0b;letter-spacing:2px">${trackingNumber}</div>
          <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}"
             style="display:inline-block;margin-top:12px;color:#60a5fa;font-size:13px">
            Track on USPS.com →
          </a>
        </div>` : ''}
        <p style="color:#94a3b8;font-size:13px">County clerks typically process filings within
           3–5 business days of receipt. We'll email you once we confirm it's recorded.</p>`)
    },
    confirmed: {
      subject: `Your bond has been officially recorded — ${county} County`,
      html: wrap(`
        <h2 style="color:#22c55e;margin-bottom:16px">✓ Bond Recorded</h2>
        <p>Hi ${first},</p>
        <p>Your notary bond has been officially recorded with <strong>${county} County Clerk</strong>.
           You're all set to begin notarizing in Texas.</p>
        <div style="background:#1e293b;border-radius:8px;padding:20px;margin:24px 0">
          <div style="font-size:12px;color:#94a3b8;margin-bottom:8px">RECORDED FILING</div>
          <div><strong>County:</strong> ${county}</div>
          ${filing.bond_number ? `<div><strong>Bond #:</strong> ${filing.bond_number}</div>` : ''}
          ${filing.surety_company ? `<div><strong>Surety:</strong> ${filing.surety_company}</div>` : ''}
        </div>
        <p style="color:#94a3b8;font-size:13px">Keep this email as your filing confirmation record.</p>`)
    },
    rejected: {
      subject: `Filing issue — ${county} County (action needed)`,
      html: wrap(`
        <h2 style="color:#f87171;margin-bottom:16px">Filing Returned</h2>
        <p>Hi ${first},</p>
        <p>Your bond filing to <strong>${county} County Clerk</strong> was returned. This sometimes
           happens when a county requires a specific form or has a processing backlog.</p>
        <p>Please reply to this email so we can resolve it — there's no additional charge.</p>`)
    },
  };

  const t = templates[status];
  if (!t) return;

  await sendEmail({
    from: '"Quantum Surety Filing Service" <filings@quantumsurety.bond>',
    to: filing.notary_email,
    subject: t.subject,
    html: t.html,
  });
}
