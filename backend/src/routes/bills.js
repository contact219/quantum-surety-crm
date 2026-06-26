import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = '/app/uploads';

export const billsRouter = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `bill_${Date.now()}_${safe}`);
  },
});
const upload = multer({ storage, limits: { files: 10, fileSize: 25 * 1024 * 1024 } });

export async function initBills() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_bills (
      id SERIAL PRIMARY KEY,
      vendor TEXT NOT NULL,
      invoice_number TEXT,
      description TEXT,
      amount NUMERIC(10,2) NOT NULL,
      invoice_date DATE,
      due_date DATE,
      status TEXT DEFAULT 'unpaid',
      category_id INTEGER REFERENCES bk_expense_categories(id),
      paid_date DATE,
      paid_amount NUMERIC(10,2),
      payment_method TEXT DEFAULT 'card',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bk_bill_documents (
      id SERIAL PRIMARY KEY,
      bill_id INTEGER REFERENCES bk_bills(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

billsRouter.get('/bills', async (req, res) => {
  try {
    const { status, from, to } = req.query;
    const conds = ['1=1'];
    const params = [];
    let p = 1;
    if (status && status !== 'all') { conds.push(`b.status=$${p++}`); params.push(status); }
    if (from) { conds.push(`b.due_date>=$${p++}`); params.push(from); }
    if (to)   { conds.push(`b.due_date<=$${p++}`); params.push(to); }

    const { rows } = await pool.query(`
      SELECT b.*,
        c.name AS category_name,
        CASE
          WHEN b.status='unpaid' AND b.due_date IS NOT NULL AND b.due_date < CURRENT_DATE
          THEN 'overdue'
          ELSE b.status
        END AS computed_status,
        COALESCE(
          json_agg(
            json_build_object(
              'id', d.id, 'filename', d.filename, 'original_name', d.original_name,
              'file_size', d.file_size, 'mime_type', d.mime_type
            )
          ) FILTER (WHERE d.id IS NOT NULL), '[]'
        ) AS documents
      FROM bk_bills b
      LEFT JOIN bk_expense_categories c ON c.id=b.category_id
      LEFT JOIN bk_bill_documents d ON d.bill_id=b.id
      WHERE ${conds.join(' AND ')}
      GROUP BY b.id, c.name
      ORDER BY b.due_date ASC NULLS LAST, b.created_at DESC
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

billsRouter.post('/bills', async (req, res) => {
  try {
    const { vendor, invoice_number, description, amount, invoice_date, due_date, status, category_id, notes } = req.body;
    const { rows } = await pool.query(`
      INSERT INTO bk_bills (vendor, invoice_number, description, amount, invoice_date, due_date, status, category_id, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [vendor, invoice_number||null, description||null, amount, invoice_date||null, due_date||null, status||'unpaid', category_id||null, notes||null]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

billsRouter.put('/bills/:id', async (req, res) => {
  try {
    const { vendor, invoice_number, description, amount, invoice_date, due_date, status, category_id, notes } = req.body;
    const { rows } = await pool.query(`
      UPDATE bk_bills SET
        vendor=$1, invoice_number=$2, description=$3, amount=$4, invoice_date=$5,
        due_date=$6, status=$7, category_id=$8, notes=$9, updated_at=NOW()
      WHERE id=$10 RETURNING *
    `, [vendor, invoice_number||null, description||null, amount, invoice_date||null, due_date||null, status, category_id||null, notes||null, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

billsRouter.delete('/bills/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM bk_bills WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

billsRouter.post('/bills/:id/pay', async (req, res) => {
  try {
    const { paid_date, paid_amount, payment_method } = req.body;
    const { rows: bills } = await pool.query('SELECT * FROM bk_bills WHERE id=$1', [req.params.id]);
    if (!bills.length) return res.status(404).json({ error: 'Not found' });
    const bill = bills[0];

    await pool.query(`
      UPDATE bk_bills SET status='paid', paid_date=$1, paid_amount=$2, payment_method=$3, updated_at=NOW()
      WHERE id=$4
    `, [paid_date||new Date().toISOString().slice(0,10), paid_amount||bill.amount, payment_method||'card', req.params.id]);

    const { rows: exp } = await pool.query(`
      INSERT INTO bk_expenses (category_id, vendor, description, amount, expense_date, payment_method, reference_number, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id
    `, [
      bill.category_id||null,
      bill.vendor,
      bill.description || `Bill payment: ${bill.vendor}`,
      paid_amount || bill.amount,
      paid_date || new Date().toISOString().slice(0,10),
      payment_method || 'card',
      bill.invoice_number || null,
      `Auto-created from bill #${bill.id}`,
    ]);

    res.json({ ok: true, expense_id: exp[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

billsRouter.post('/bills/:id/documents', upload.array('files', 10), async (req, res) => {
  try {
    const inserted = [];
    for (const f of (req.files || [])) {
      const { rows } = await pool.query(`
        INSERT INTO bk_bill_documents (bill_id, filename, original_name, file_size, mime_type)
        VALUES ($1,$2,$3,$4,$5) RETURNING *
      `, [req.params.id, f.filename, f.originalname, f.size, f.mimetype]);
      inserted.push(rows[0]);
    }
    res.json(inserted);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

billsRouter.delete('/bill-documents/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM bk_bill_documents WHERE id=$1 RETURNING filename', [req.params.id]);
    if (rows[0]?.filename) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, rows[0].filename)); } catch {}
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

billsRouter.get('/bill-uploads/:filename', (req, res) => {
  const fp = path.join(UPLOAD_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(fp);
});
