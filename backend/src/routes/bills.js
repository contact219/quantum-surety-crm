import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';
import { logAudit, actorOf, guardClosedPeriod } from './bookkeeping.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = '/app/uploads';

export const billsRouter = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `bill_${Date.now()}_${safe}`);
  },
});
// Same fileFilter as expenses.js uploads: document/image types only.
const upload = multer({
  storage,
  limits: { files: 10, fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /pdf|jpe?g|png|gif|webp|doc|docx|xls|xlsx|csv|txt/i.test(
      path.extname(file.originalname)
    );
    cb(null, ok);
  },
});

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
  // Expenses auto-created by paying a bill link back by id (was notes-text only).
  // bk_expenses is created by the expenses module init; guard with IF EXISTS and
  // retry the index creation defensively so boot order can't break startup.
  await pool.query(`ALTER TABLE IF EXISTS bk_expenses ADD COLUMN IF NOT EXISTS bill_id INTEGER`);
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS bk_expenses_bill_idx ON bk_expenses(bill_id)`);
  } catch (e) { console.error('[Bills] bk_expenses_bill_idx deferred:', e.message); }
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
    // Closed-period guard on the accrual date (matches the journal's
    // COALESCE(invoice_date, due_date, created_at) dating).
    if (!(await guardClosedPeriod(req, res, [invoice_date || due_date || new Date()],
      { entity: 'bill', detail: `Bill create — ${vendor}` }))) return;
    const { rows } = await pool.query(`
      INSERT INTO bk_bills (vendor, invoice_number, description, amount, invoice_date, due_date, status, category_id, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [vendor, invoice_number||null, description||null, amount, invoice_date||null, due_date||null, status||'unpaid', category_id||null, notes||null]);
    await logAudit(null, { action:'bill.create', entity:'bill', entity_id:rows[0].id,
      actor:actorOf(req), amount:parseFloat(amount)||null, detail:`Created bill — ${vendor}` });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

billsRouter.put('/bills/:id', async (req, res) => {
  try {
    const { vendor, invoice_number, description, amount, invoice_date, due_date, status, category_id, notes } = req.body;
    const { rows: prevRows } = await pool.query('SELECT * FROM bk_bills WHERE id=$1', [req.params.id]);
    if (!prevRows.length) return res.status(404).json({ error: 'Not found' });
    const prev = prevRows[0];

    // Mirror of the DELETE guard: paying the bill already created a linked
    // expense, so un-paying it or changing its amount here would silently
    // diverge the bill from money already booked. Other fields stay editable.
    if (prev.status === 'paid') {
      const amountChanged = amount != null && amount !== '' &&
        Math.abs(parseFloat(amount) - parseFloat(prev.amount)) > 0.005;
      const statusChanged = status != null && status !== 'paid';
      if (amountChanged || statusChanged) {
        return res.status(409).json({ error: 'Bill is paid — its payment already created a linked expense. Remove or adjust the linked expense first, then edit the bill.' });
      }
    }

    // Flipping straight to 'paid' here would bypass POST /bills/:id/pay — no
    // linked expense would be created, so A/P never relieves in the journal
    // and the paid-bill guard above would then make the bill a dead end.
    if (prev.status !== 'paid' && status === 'paid') {
      return res.status(400).json({ error: 'Use the Pay action (POST /bills/:id/pay) to mark a bill paid — it records the payment expense the books need.' });
    }

    // Closed-period guard: both the current and the new accrual dates.
    if (!(await guardClosedPeriod(req, res,
      [prev.invoice_date || prev.due_date || prev.created_at, invoice_date || due_date],
      { entity: 'bill', entity_id: prev.id, detail: `Bill edit #${prev.id}` }))) return;

    const { rows } = await pool.query(`
      UPDATE bk_bills SET
        vendor=$1, invoice_number=$2, description=$3, amount=$4, invoice_date=$5,
        due_date=$6, status=$7, category_id=$8, notes=$9, updated_at=NOW()
      WHERE id=$10 RETURNING *
    `, [vendor, invoice_number||null, description||null, amount, invoice_date||null, due_date||null, status, category_id||null, notes||null, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logAudit(null, { action:'bill.update', entity:'bill', entity_id:rows[0].id,
      actor:actorOf(req), amount:parseFloat(amount)||null, detail:`Edited bill #${rows[0].id} — ${vendor}` });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Deleting a PAID bill is blocked: its payment already produced a linked
// expense row. Unpay/adjust the expense first, then delete.
billsRouter.delete('/bills/:id', async (req, res) => {
  try {
    const { rows: prevRows } = await pool.query('SELECT * FROM bk_bills WHERE id=$1', [req.params.id]);
    if (!prevRows.length) return res.status(404).json({ error: 'Not found' });
    const prev = prevRows[0];
    if (prev.status === 'paid') {
      return res.status(409).json({ error: 'Cannot delete a paid bill — remove or adjust its linked expense first' });
    }
    // Closed-period guard on the accrual date the delete would erase.
    if (!(await guardClosedPeriod(req, res, [prev.invoice_date || prev.due_date || prev.created_at],
      { entity: 'bill', entity_id: prev.id, detail: `Bill delete #${prev.id}` }))) return;
    const { rows } = await pool.query(
      `DELETE FROM bk_bills WHERE id=$1 AND status != 'paid' RETURNING id, vendor, amount`, [req.params.id]
    );
    if (!rows.length) {
      // Raced: paid between the check and the delete.
      return res.status(409).json({ error: 'Cannot delete a paid bill — remove or adjust its linked expense first' });
    }
    await logAudit(null, { action:'bill.delete', entity:'bill', entity_id:rows[0].id,
      actor:actorOf(req), amount:parseFloat(rows[0].amount)||null, detail:`Deleted bill #${rows[0].id} — ${rows[0].vendor}` });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

billsRouter.post('/bills/:id/pay', async (req, res) => {
  // Closed-period guard on the payment/expense date (before taking a client).
  try {
    if (!(await guardClosedPeriod(req, res, [req.body.paid_date || new Date()],
      { entity: 'bill', entity_id: parseInt(req.params.id), detail: `Bill pay #${req.params.id}` }))) return;
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const client = await pool.connect();
  try {
    const { paid_date, paid_amount, payment_method } = req.body;
    await client.query('BEGIN');

    // Unpaid guard in the UPDATE itself: a second pay call finds no row and
    // cannot create a second expense. `??` (not ||) so an explicit $0
    // settlement keeps paid_amount 0 instead of collapsing to the full
    // amount; an explicitly-passed payment_method (even '') is honored while
    // an omitted one keeps the bill's existing value.
    const { rows: bills } = await client.query(`
      UPDATE bk_bills SET status='paid', paid_date=$1, paid_amount=COALESCE($2, amount),
        payment_method=COALESCE($3, payment_method), updated_at=NOW()
      WHERE id=$4 AND status='unpaid' RETURNING *
    `, [paid_date||new Date().toISOString().slice(0,10), paid_amount ?? null, payment_method ?? null, req.params.id]);
    if (!bills.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Bill not found or not unpaid' });
    }
    const bill = bills[0];

    const { rows: exp } = await client.query(`
      INSERT INTO bk_expenses (category_id, vendor, description, amount, expense_date, payment_method, reference_number, notes, bill_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
    `, [
      bill.category_id||null,
      bill.vendor,
      bill.description || `Bill payment: ${bill.vendor}`,
      bill.paid_amount,
      bill.paid_date,
      bill.payment_method,
      bill.invoice_number || null,
      `Auto-created from bill #${bill.id}`,
      bill.id,
    ]);

    await logAudit(client, { action:'bill.pay', entity:'bill', entity_id:bill.id,
      actor:actorOf(req), amount:parseFloat(bill.paid_amount)||null,
      detail:`Paid bill #${bill.id} — ${bill.vendor} (expense #${exp[0].id})` });

    await client.query('COMMIT');
    res.json({ ok: true, expense_id: exp[0].id });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {}); // connection may already be dead
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
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
