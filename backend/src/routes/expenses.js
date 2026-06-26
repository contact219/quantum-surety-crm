import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const ses = new SESv2Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const FROM_EMAIL = 'Quantum Surety <nice.shotwell-sparks@quantumsurety.bond>';

export const expensesRouter = express.Router();

const UPLOAD_DIR = '/app/uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /pdf|jpe?g|png|gif|webp|doc|docx|xls|xlsx|csv|txt/i.test(
      path.extname(file.originalname)
    );
    cb(null, ok);
  },
});

// ?????? Category seed ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
const SEED = [
  { name: 'Home Office',                         parent: null,                              deductible: 50  },
  { name: 'Utilities',                           parent: 'Home Office',                     deductible: 50  },
  { name: 'Insurance',                           parent: 'Home Office',                     deductible: 50  },
  { name: 'Mortgage / Rent',                     parent: 'Home Office',                     deductible: 50  },
  { name: 'Licenses & Dues',                     parent: null,                              deductible: 100 },
  { name: 'Insurance (E&O)',                     parent: null,                              deductible: 100 },
  { name: 'Professional Services',               parent: null,                              deductible: 100 },
  { name: 'Accountant',                          parent: 'Professional Services',           deductible: 100 },
  { name: 'Legal',                               parent: 'Professional Services',           deductible: 100 },
  { name: 'Technology & Software',               parent: null,                              deductible: 100 },
  { name: 'Marketing',                           parent: null,                              deductible: 100 },
  { name: 'Office Supplies',                     parent: null,                              deductible: 100 },
  { name: 'Vehicle / Mileage',                   parent: null,                              deductible: 100 },
  { name: 'Education & Training',                parent: null,                              deductible: 100 },
  { name: 'Business-Specific (100% Deductible)', parent: null,                              deductible: 100 },
  { name: 'E&O Premium',                         parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'RLI Carrier Fees',                    parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'State Insurance License Renewals',    parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'CE Courses & Training',               parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Professional Memberships',            parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Accounting / Bookkeeping Fees',       parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Legal Fees',                          parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Texas LLC Franchise Tax',             parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Office Supplies (Biz)',               parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Business Phone',                      parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Internet',                            parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Computer & Equipment',                parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Software Subscriptions',              parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Marketing & Advertising',             parent: 'Business-Specific (100% Deductible)', deductible: 100 },
  { name: 'Bank Fees',                           parent: 'Business-Specific (100% Deductible)', deductible: 100 },
];

async function initExpenses() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_expense_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES bk_expense_categories(id) ON DELETE CASCADE,
      deductible_pct NUMERIC(5,2) DEFAULT 100.00,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bk_expenses (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES bk_expense_categories(id),
      vendor TEXT,
      description TEXT,
      amount NUMERIC(10,2) NOT NULL,
      expense_date DATE NOT NULL,
      payment_method TEXT DEFAULT 'card',
      reference_number TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bk_expense_documents (
      id SERIAL PRIMARY KEY,
      expense_id INTEGER REFERENCES bk_expenses(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*) FROM bk_expense_categories');
  if (parseInt(rows[0].count) === 0) {
    const idMap = {};
    for (let i = 0; i < SEED.length; i++) {
      const s = SEED[i];
      const parentId = s.parent ? idMap[s.parent] : null;
      const { rows: r } = await pool.query(
        `INSERT INTO bk_expense_categories (name, parent_id, deductible_pct, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`,
        [s.name, parentId, s.deductible, i]
      );
      idMap[s.name] = r[0].id;
    }
    console.log('[Expenses] Seeded', SEED.length, 'categories');
  }
}
initExpenses().catch(e => console.error('[Expenses] Init error:', e.message));

// ?????? Categories ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
expensesRouter.get('/categories', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM bk_expense_categories ORDER BY sort_order, name`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

expensesRouter.post('/categories', async (req, res) => {
  const { name, parent_id, deductible_pct } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO bk_expense_categories (name, parent_id, deductible_pct) VALUES ($1,$2,$3) RETURNING *`,
      [name, parent_id || null, deductible_pct ?? 100]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ?????? Expenses ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
expensesRouter.get('/expenses', async (req, res) => {
  const { category_id, from, to, q, month } = req.query;
  const conds = ['1=1'];
  const params = [];
  let p = 1;
  if (category_id) { conds.push(`e.category_id=$${p++}`); params.push(category_id); }
  if (from)        { conds.push(`e.expense_date>=$${p++}`); params.push(from); }
  if (to)          { conds.push(`e.expense_date<=$${p++}`); params.push(to); }
  if (month)       { conds.push(`to_char(e.expense_date,'YYYY-MM')=$${p++}`); params.push(month); }
  if (q) {
    conds.push(`(e.vendor ILIKE $${p} OR e.description ILIKE $${p})`);
    params.push(`%${q}%`); p++;
  }
  try {
    const { rows } = await pool.query(`
      SELECT e.*,
        c.name AS category_name, c.parent_id, c.deductible_pct,
        pc.name AS parent_name,
        COALESCE(json_agg(d ORDER BY d.uploaded_at) FILTER (WHERE d.id IS NOT NULL),'[]') AS documents
      FROM bk_expenses e
      LEFT JOIN bk_expense_categories c ON c.id = e.category_id
      LEFT JOIN bk_expense_categories pc ON pc.id = c.parent_id
      LEFT JOIN bk_expense_documents d ON d.expense_id = e.id
      WHERE ${conds.join(' AND ')}
      GROUP BY e.id, c.id, pc.id
      ORDER BY e.expense_date DESC, e.id DESC
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

expensesRouter.get('/expenses/summary', async (req, res) => {
  const { month, year } = req.query;
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(pc.name, c.name, 'Uncategorized') AS category,
        SUM(e.amount) AS total,
        SUM(e.amount * COALESCE(c.deductible_pct, 100) / 100) AS deductible_total,
        COUNT(*) AS count
      FROM bk_expenses e
      LEFT JOIN bk_expense_categories c ON c.id = e.category_id
      LEFT JOIN bk_expense_categories pc ON pc.id = c.parent_id
      WHERE ($1::text IS NULL OR to_char(e.expense_date,'YYYY-MM')=$1)
        AND ($2::text IS NULL OR to_char(e.expense_date,'YYYY')=$2)
      GROUP BY COALESCE(pc.name, c.name, 'Uncategorized')
      ORDER BY total DESC
    `, [month || null, year || null]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

expensesRouter.post('/expenses', async (req, res) => {
  const { category_id, vendor, description, amount, expense_date, payment_method, reference_number, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO bk_expenses (category_id, vendor, description, amount, expense_date, payment_method, reference_number, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [category_id || null, vendor, description, amount, expense_date, payment_method || 'card', reference_number, notes]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

expensesRouter.put('/expenses/:id', async (req, res) => {
  const { category_id, vendor, description, amount, expense_date, payment_method, reference_number, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE bk_expenses SET category_id=$1, vendor=$2, description=$3, amount=$4,
       expense_date=$5, payment_method=$6, reference_number=$7, notes=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [category_id || null, vendor, description, amount, expense_date, payment_method || 'card', reference_number, notes, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

expensesRouter.delete('/expenses/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT filename FROM bk_expense_documents WHERE expense_id=$1', [req.params.id]
    );
    for (const r of rows) {
      const fp = path.join(UPLOAD_DIR, r.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await pool.query('DELETE FROM bk_expenses WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ?????? Documents ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
expensesRouter.post('/expenses/:id/documents', upload.array('files', 10), async (req, res) => {
  try {
    const docs = [];
    for (const f of req.files || []) {
      const { rows } = await pool.query(
        `INSERT INTO bk_expense_documents (expense_id, filename, original_name, file_size, mime_type)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.params.id, f.filename, f.originalname, f.size, f.mimetype]
      );
      docs.push(rows[0]);
    }
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

expensesRouter.delete('/documents/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT filename FROM bk_expense_documents WHERE id=$1', [req.params.id]
    );
    if (rows[0]) {
      const fp = path.join(UPLOAD_DIR, rows[0].filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await pool.query('DELETE FROM bk_expense_documents WHERE id=$1', [req.params.id]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ?????? File serving ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
expensesRouter.get('/uploads/:filename', (req, res) => {
  const fp = path.join(UPLOAD_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(fp);
});

// ?????? CSV helpers ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n');
}

// ?????? Export: detail CSV ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
expensesRouter.get('/export/expenses', async (req, res) => {
  const { from, to, category_id } = req.query;
  const conds = ['1=1'];
  const params = [];
  let p = 1;
  if (from)        { conds.push(`e.expense_date>=$${p++}`); params.push(from); }
  if (to)          { conds.push(`e.expense_date<=$${p++}`); params.push(to); }
  if (category_id) { conds.push(`e.category_id=$${p++}`); params.push(category_id); }
  try {
    const { rows } = await pool.query(`
      SELECT e.expense_date, e.vendor, pc.name AS parent_cat, c.name AS sub_cat,
        e.description, e.amount, c.deductible_pct,
        ROUND(e.amount * COALESCE(c.deductible_pct,100)/100, 2) AS deductible_amt,
        e.payment_method, e.reference_number, e.notes
      FROM bk_expenses e
      LEFT JOIN bk_expense_categories c ON c.id=e.category_id
      LEFT JOIN bk_expense_categories pc ON pc.id=c.parent_id
      WHERE ${conds.join(' AND ')}
      ORDER BY e.expense_date, e.id
    `, params);
    const label = from && to ? `${from}_to_${to}` : from || to || 'all';
    const csv = toCsv(
      ['Date','Vendor','Category','Subcategory','Description','Amount','Deductible%','Deductible Amount','Payment Method','Ref #','Notes'],
      rows.map(r => [r.expense_date?.toISOString?.()?.slice(0,10) || r.expense_date, r.vendor, r.parent_cat||r.sub_cat, r.parent_cat?r.sub_cat:'', r.description, r.amount, r.deductible_pct, r.deductible_amt, r.payment_method, r.reference_number, r.notes])
    );
    res.setHeader('Content-Disposition', `attachment; filename="expenses_detail_${label}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ?????? Export: summary CSV ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
expensesRouter.get('/export/expenses-summary', async (req, res) => {
  const { from, to } = req.query;
  const conds = ['1=1'];
  const params = [];
  let p = 1;
  if (from) { conds.push(`e.expense_date>=$${p++}`); params.push(from); }
  if (to)   { conds.push(`e.expense_date<=$${p++}`); params.push(to); }
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(pc.name, c.name, 'Uncategorized') AS category,
        c.name AS subcategory,
        COUNT(*) AS transactions,
        SUM(e.amount) AS total,
        COALESCE(c.deductible_pct,100) AS deductible_pct,
        ROUND(SUM(e.amount)*COALESCE(c.deductible_pct,100)/100,2) AS deductible_total,
        ROUND(SUM(e.amount)*(1-COALESCE(c.deductible_pct,100)/100),2) AS non_deductible
      FROM bk_expenses e
      LEFT JOIN bk_expense_categories c ON c.id=e.category_id
      LEFT JOIN bk_expense_categories pc ON pc.id=c.parent_id
      WHERE ${conds.join(' AND ')}
      GROUP BY COALESCE(pc.name,c.name,'Uncategorized'), c.name, c.deductible_pct
      ORDER BY category, subcategory
    `, params);
    const label = from && to ? `${from}_to_${to}` : from || to || 'all';
    const csv = toCsv(
      ['Category','Subcategory','Transactions','Total Amount','Deductible %','Deductible Amount','Non-Deductible'],
      rows.map(r => [r.category, r.subcategory||'', r.transactions, r.total, r.deductible_pct, r.deductible_total, r.non_deductible])
    );
    res.setHeader('Content-Disposition', `attachment; filename="expenses_summary_${label}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ?????? Email report to accountant ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
expensesRouter.post('/expenses/email-report', async (req, res) => {
  const { to, from_date, to_date, message } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email required' });
  try {
    // Fetch summary
    const conds = ['1=1'];
    const params = [];
    let p = 1;
    if (from_date) { conds.push(`e.expense_date>=$${p++}`); params.push(from_date); }
    if (to_date)   { conds.push(`e.expense_date<=$${p++}`); params.push(to_date); }

    const { rows: sum } = await pool.query(`
      SELECT COALESCE(pc.name,c.name,'Uncategorized') AS category,
        COUNT(*) AS n, SUM(e.amount) AS total,
        ROUND(SUM(e.amount * COALESCE(c.deductible_pct,100) / 100),2) AS deductible
      FROM bk_expenses e
      LEFT JOIN bk_expense_categories c ON c.id=e.category_id
      LEFT JOIN bk_expense_categories pc ON pc.id=c.parent_id
      WHERE ${conds.join(' AND ')}
      GROUP BY COALESCE(pc.name,c.name,'Uncategorized')
      ORDER BY total DESC
    `, params);

    const { rows: det } = await pool.query(`
      SELECT e.expense_date,e.vendor,COALESCE(pc.name,c.name) AS category,c.name AS sub,
        e.description,e.amount,COALESCE(c.deductible_pct,100) AS ded_pct,
        ROUND(e.amount*COALESCE(c.deductible_pct,100)/100,2) AS ded_amt,
        e.payment_method,e.reference_number,e.notes
      FROM bk_expenses e
      LEFT JOIN bk_expense_categories c ON c.id=e.category_id
      LEFT JOIN bk_expense_categories pc ON pc.id=c.parent_id
      WHERE ${conds.join(' AND ')}
      ORDER BY e.expense_date,e.id
    `, params);

    const totalAll  = sum.reduce((s,r)=>s+parseFloat(r.total),0);
    const totalDed  = sum.reduce((s,r)=>s+parseFloat(r.deductible),0);
    const period    = from_date && to_date ? `${from_date} to ${to_date}` : from_date || to_date || 'All dates';

    const sumRows = sum.map(r =>
      `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb">${r.category}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${r.n}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right">$${parseFloat(r.total).toFixed(2)}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#16a34a">$${parseFloat(r.deductible).toFixed(2)}</td></tr>`
    ).join('');

    const html = `<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#1f2937">
<h2 style="margin:0 0 4px">Quantum Surety ??? Expense Report</h2>
<p style="margin:0 0 20px;color:#6b7280;font-size:13px">Period: ${period}</p>
${message ? `<p style="font-size:14px;margin-bottom:20px">${message}</p>` : ''}
<h3 style="font-size:15px;margin:0 0 8px">Summary by Category</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
<thead><tr style="background:#f3f4f6">
<th style="padding:8px 12px;text-align:left">Category</th>
<th style="padding:8px 12px;text-align:center">#</th>
<th style="padding:8px 12px;text-align:right">Total</th>
<th style="padding:8px 12px;text-align:right">Deductible</th>
</tr></thead>
<tbody>${sumRows}
<tr style="font-weight:700;background:#f9fafb">
<td style="padding:8px 12px">TOTAL</td>
<td style="padding:8px 12px;text-align:center">${det.length}</td>
<td style="padding:8px 12px;text-align:right">$${totalAll.toFixed(2)}</td>
<td style="padding:8px 12px;text-align:right;color:#16a34a">$${totalDed.toFixed(2)}</td>
</tr></tbody></table>
<p style="font-size:11px;color:#9ca3af">Full detail attached as CSV. Generated by Quantum Surety CRM.</p></div>`;

    const detCsv = toCsv(
      ['Date','Vendor','Category','Subcategory','Description','Amount','Deductible%','Deductible Amt','Method','Ref #','Notes'],
      det.map(r => [r.expense_date?.toISOString?.()?.slice(0,10)||r.expense_date, r.vendor, r.category, r.sub||'', r.description, r.amount, r.ded_pct, r.ded_amt, r.payment_method, r.reference_number, r.notes])
    );

    const boundary = `bndry${Date.now()}`;
    const raw = [
      `From: ${FROM_EMAIL}`,
      `To: ${to}`,
      `Subject: Quantum Surety Expense Report ??? ${period}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      ``,
      html,
      ``,
      `--${boundary}`,
      `Content-Type: text/csv; charset=UTF-8`,
      `Content-Disposition: attachment; filename="expenses_detail_${period.replace(/\s/g,'_')}.csv"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(detCsv).toString('base64'),
      ``,
      `--${boundary}--`,
    ].join('\r\n');

    await ses.send(new SendEmailCommand({ Content: { Raw: { Data: Buffer.from(raw) } } }));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
