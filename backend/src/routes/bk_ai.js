import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = '/app/uploads';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export const bkAiRouter = express.Router();

const ocrUpload = multer({
  dest: UPLOAD_DIR,
  limits: { files: 1, fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg','image/png','image/gif','image/webp','application/pdf'].includes(file.mimetype);
    cb(null, ok);
  },
});

async function claudeVision(mediaType, base64Data, textPrompt) {
  const isPdf = mediaType === 'application/pdf';
  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: textPrompt }] }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Anthropic ${r.status}`);
  return j.content?.[0]?.text || '';
}

async function claudeText(prompt, system = '') {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: system || undefined,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Anthropic ${r.status}`);
  return j.content?.[0]?.text || '';
}

function parseJson(text) {
  const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

// ?????? OCR receipt/invoice ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
bkAiRouter.post('/ai/ocr', ocrUpload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = path.join(UPLOAD_DIR, req.file.filename);
  try {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const mediaType = req.file.mimetype;

    const prompt = `Extract expense data from this receipt/invoice. Return ONLY valid JSON with these exact fields:
{
  "vendor": "string",
  "amount": number (no currency symbols, just the number),
  "date": "YYYY-MM-DD or null",
  "description": "brief string",
  "suggested_category": "one of: Home Office, Utilities, Insurance, Mortgage, Licenses & Dues, E&O Insurance, Professional Services, Technology & Software, Marketing, Office Supplies, Vehicle/Mileage, Education & Training, E&O, RLI carrier fees, State insurance license renewals, CE courses, Professional memberships, Accounting/bookkeeping fees, Legal fees, Texas LLC franchise tax, Business phone, Internet, Computer & equipment, Software subscriptions, Marketing & advertising, Bank fees",
  "confidence": 0.0 to 1.0
}
Return only the JSON object, no markdown, no explanation.`;

    const raw = await claudeVision(mediaType, base64, prompt);
    const data = parseJson(raw);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    try { fs.unlinkSync(filePath); } catch {}
  }
});

// ?????? AI categorization ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
bkAiRouter.post('/ai/categorize', async (req, res) => {
  try {
    const { vendor = '', description = '' } = req.body;
    const { rows: cats } = await pool.query(
      'SELECT id, name, parent_id FROM bk_expense_categories ORDER BY parent_id NULLS FIRST, sort_order, name'
    );
    const catList = cats.map(c => `${c.id}: ${c.name}`).join('\n');

    const prompt = `Given vendor "${vendor}" and description "${description}", which expense category best fits?

Categories (id: name):
${catList}

Return ONLY a JSON object:
{
  "category_name": "string",
  "category_id": number,
  "confidence": 0.0 to 1.0,
  "reason": "one sentence"
}`;

    const raw = await claudeText(prompt);
    const result = parseJson(raw);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ?????? Monthly narrative ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
bkAiRouter.post('/ai/narrative', async (req, res) => {
  try {
    const { month } = req.body; // YYYY-MM
    if (!month) return res.status(400).json({ error: 'month required' });

    const [revRows, expRows, bondCount, unpaidBills] = await Promise.all([
      pool.query(`
        SELECT bond_type, SUM(premium * commission_rate) AS commission
        FROM bk_bonds
        WHERE DATE_TRUNC('month', effective_date) = $1::date
        GROUP BY bond_type ORDER BY commission DESC
      `, [`${month}-01`]),
      pool.query(`
        SELECT COALESCE(pc.name, c.name, 'Uncategorized') AS category, SUM(e.amount) AS total
        FROM bk_expenses e
        LEFT JOIN bk_expense_categories c ON c.id=e.category_id
        LEFT JOIN bk_expense_categories pc ON pc.id=c.parent_id
        WHERE DATE_TRUNC('month', e.expense_date) = $1::date
        GROUP BY COALESCE(pc.name, c.name, 'Uncategorized')
        ORDER BY total DESC
      `, [`${month}-01`]),
      pool.query(`
        SELECT COUNT(*) AS n FROM bk_bonds
        WHERE status='issued' AND DATE_TRUNC('month', effective_date) = $1::date
      `, [`${month}-01`]),
      pool.query(`SELECT COALESCE(SUM(amount),0) AS total FROM bk_bills WHERE status='unpaid'`),
    ]);

    const revenue = revRows.rows.reduce((s, r) => s + parseFloat(r.commission || 0), 0);
    const totalExpenses = expRows.rows.reduce((s, r) => s + parseFloat(r.total || 0), 0);
    const netIncome = revenue - totalExpenses;
    const marginPct = revenue > 0 ? ((netIncome / revenue) * 100).toFixed(1) : 0;
    const bondCount_ = parseInt(bondCount.rows[0]?.n || 0);

    const dataBlock = `
Month: ${month}
Revenue (bond commissions): $${revenue.toFixed(2)}
  ${revRows.rows.map(r => `  - ${r.bond_type}: $${parseFloat(r.commission).toFixed(2)}`).join('\n')}
Bonds issued: ${bondCount_}
Expenses: $${totalExpenses.toFixed(2)}
  ${expRows.rows.map(r => `  - ${r.category}: $${parseFloat(r.total).toFixed(2)}`).join('\n')}
Net income: $${netIncome.toFixed(2)}
Profit margin: ${marginPct}%
Outstanding unpaid bills: $${parseFloat(unpaidBills.rows[0]?.total || 0).toFixed(2)}
`.trim();

    const system = `You are a friendly bookkeeper for Quantum Surety LLC, a Texas surety bond agency. Write a concise monthly financial narrative (3-4 short paragraphs) that: 1) summarizes revenue and top bond types, 2) breaks down major expense categories, 3) gives net income and profit margin, 4) flags anything notable. Use plain English, no jargon. Be encouraging but honest. Include specific dollar amounts.`;

    const narrative = await claudeText(`Here is the financial data for ${month}:\n\n${dataBlock}\n\nWrite the monthly narrative.`, system);

    res.json({
      narrative,
      summary: {
        revenue: parseFloat(revenue.toFixed(2)),
        total_expenses: parseFloat(totalExpenses.toFixed(2)),
        net_income: parseFloat(netIncome.toFixed(2)),
        margin_pct: parseFloat(marginPct),
        bond_count: bondCount_,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ?????? Anomaly detection ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
bkAiRouter.get('/ai/anomalies', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const monthDate = `${month}-01`;
    const [prevYear, prevMonth] = month.split('-').map(Number);
    const prevMonthDate = new Date(prevYear, prevMonth - 2, 1).toISOString().slice(0, 10);

    const [uncat, catThis, catLast, noDocs, overdueBills, zeroBonds] = await Promise.all([
      pool.query(`
        SELECT vendor, amount, expense_date FROM bk_expenses
        WHERE category_id IS NULL AND amount > 25
          AND DATE_TRUNC('month', expense_date) = $1::date
        ORDER BY amount DESC LIMIT 20
      `, [monthDate]),
      pool.query(`
        SELECT COALESCE(pc.name,c.name,'Uncategorized') AS cat, SUM(e.amount) AS total
        FROM bk_expenses e
        LEFT JOIN bk_expense_categories c ON c.id=e.category_id
        LEFT JOIN bk_expense_categories pc ON pc.id=c.parent_id
        WHERE DATE_TRUNC('month', e.expense_date) = $1::date
        GROUP BY COALESCE(pc.name,c.name,'Uncategorized')
      `, [monthDate]),
      pool.query(`
        SELECT COALESCE(pc.name,c.name,'Uncategorized') AS cat, SUM(e.amount) AS total
        FROM bk_expenses e
        LEFT JOIN bk_expense_categories c ON c.id=e.category_id
        LEFT JOIN bk_expense_categories pc ON pc.id=c.parent_id
        WHERE DATE_TRUNC('month', e.expense_date) = $1::date
        GROUP BY COALESCE(pc.name,c.name,'Uncategorized')
      `, [prevMonthDate]),
      pool.query(`
        SELECT e.id, e.vendor, e.amount, e.expense_date
        FROM bk_expenses e
        WHERE e.amount > 100
          AND DATE_TRUNC('month', e.expense_date) = $1::date
          AND NOT EXISTS (SELECT 1 FROM bk_expense_documents d WHERE d.expense_id=e.id)
        ORDER BY e.amount DESC LIMIT 20
      `, [monthDate]),
      pool.query(`
        SELECT id, vendor, amount, due_date FROM bk_bills
        WHERE status='unpaid' AND due_date < CURRENT_DATE
        ORDER BY due_date ASC LIMIT 20
      `),
      pool.query(`
        SELECT bond_number, insured_name, premium, commission_rate
        FROM bk_bonds WHERE (premium=0 OR commission_rate=0) AND status='issued'
        LIMIT 10
      `),
    ]);

    const lastMap = Object.fromEntries(catLast.rows.map(r => [r.cat, parseFloat(r.total)]));
    const spikes = catThis.rows
      .filter(r => {
        const prev = lastMap[r.cat] || 0;
        const curr = parseFloat(r.total);
        return prev > 0 && curr > prev * 1.5 && (curr - prev) > 50;
      })
      .map(r => ({ cat: r.cat, this: parseFloat(r.total).toFixed(2), prev: (lastMap[r.cat]||0).toFixed(2) }));

    const findings = `
Uncategorized expenses over $25 this month (${month}): ${uncat.rows.length}
${uncat.rows.map(r => `  - ${r.vendor||'unknown'}: $${r.amount} on ${String(r.expense_date).slice(0,10)}`).join('\n')}

Category spending spikes (>50% increase vs last month, >$50 diff): ${spikes.length}
${spikes.map(s => `  - ${s.cat}: $${s.this} this month vs $${s.prev} last month`).join('\n')}

Expenses over $100 with no receipt/document attached: ${noDocs.rows.length}
${noDocs.rows.map(r => `  - ${r.vendor||'unknown'}: $${r.amount}`).join('\n')}

Overdue unpaid bills: ${overdueBills.rows.length}
${overdueBills.rows.map(r => `  - ${r.vendor}: $${r.amount} due ${String(r.due_date).slice(0,10)}`).join('\n')}

Issued bonds with missing commission/premium data: ${zeroBonds.rows.length}
${zeroBonds.rows.map(r => `  - ${r.bond_number} (${r.insured_name}): premium=$${r.premium}, rate=${r.commission_rate}`).join('\n')}
`.trim();

    const prompt = `You are a bookkeeper reviewing financial anomalies for Quantum Surety LLC, a Texas surety bond agency. Analyze these findings and return a JSON array of anomalies. For each item, assess severity and suggest a specific action.

Findings:
${findings}

Return ONLY a JSON array (no markdown):
[
  {
    "severity": "high" | "medium" | "low",
    "type": "short category label",
    "message": "what the issue is (one sentence)",
    "action": "what to do about it (one sentence)"
  }
]

Only include items that are actually present (non-zero counts). If everything looks clean, return an empty array [].`;

    const raw = await claudeText(prompt);
    const anomalies = parseJson(raw);

    res.json({ anomalies, checked_at: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ?????? Tax estimate (pure math, no AI) ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
bkAiRouter.get('/ai/tax-estimate', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const { rows } = await pool.query(`
      SELECT
        EXTRACT(QUARTER FROM q) AS quarter,
        COALESCE(SUM(rev),0) AS revenue,
        COALESCE(SUM(exp),0) AS expenses
      FROM (
        SELECT DATE_TRUNC('quarter', effective_date) AS q,
          SUM(premium * commission_rate) AS rev, 0 AS exp
        FROM bk_bonds
        WHERE EXTRACT(YEAR FROM effective_date) = $1 AND status='issued'
        GROUP BY DATE_TRUNC('quarter', effective_date)
        UNION ALL
        SELECT DATE_TRUNC('quarter', expense_date) AS q,
          0 AS rev, SUM(amount) AS exp
        FROM bk_expenses
        WHERE EXTRACT(YEAR FROM expense_date) = $1
        GROUP BY DATE_TRUNC('quarter', expense_date)
      ) sub
      GROUP BY q
      ORDER BY q
    `, [year]);

    const quarters = [1,2,3,4].map(q => {
      const row = rows.find(r => parseInt(r.quarter) === q) || { revenue: 0, expenses: 0 };
      const netIncome = parseFloat(row.revenue) - parseFloat(row.expenses);
      return { quarter: q, revenue: parseFloat(row.revenue), expenses: parseFloat(row.expenses), net_income: netIncome };
    });

    const ytdNet = quarters.reduce((s, q) => s + q.net_income, 0);
    const ytdRevenue = quarters.reduce((s, q) => s + q.revenue, 0);

    // SE tax on 92.35% of net (self-employment tax adjustment)
    const SS_WAGE_BASE = 176100;
    const seBase = Math.max(0, ytdNet) * 0.9235;
    const ssTax = Math.min(seBase, SS_WAGE_BASE) * 0.124;
    const medicareTax = seBase * 0.029;
    const seTax = ssTax + medicareTax;

    // SE deduction reduces taxable income
    const seDeduction = seTax * 0.5;
    const STANDARD_DEDUCTION = 14600;
    const taxableIncome = Math.max(0, ytdNet - seDeduction - STANDARD_DEDUCTION);

    // 2025 single filer brackets
    function calcIncomeTax(income) {
      const brackets = [
        { limit: 11925,  rate: 0.10 },
        { limit: 48475,  rate: 0.12 },
        { limit: 103350, rate: 0.22 },
        { limit: 197300, rate: 0.24 },
        { limit: Infinity, rate: 0.32 },
      ];
      let tax = 0, prev = 0;
      for (const { limit, rate } of brackets) {
        if (income <= prev) break;
        tax += (Math.min(income, limit) - prev) * rate;
        prev = limit;
      }
      return tax;
    }

    const incomeTax = calcIncomeTax(taxableIncome);
    const totalFederalTax = incomeTax + seTax;
    const quarterlyPayment = totalFederalTax / 4;

    const txFranchiseTax = ytdRevenue < 2470000
      ? { due: 0, note: 'No Tax Due ??? revenue below $2,470,000 threshold. Must still file PIR with Texas Comptroller by May 15.' }
      : { due: Math.max(0, ytdRevenue * 0.0075), note: '0.75% of taxable margin. Consult accountant for exact margin calculation.' };

    const dueDate = (m, d) => `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const estimatedPaymentDates = [
      { period: 'Q1', label: `Jan 1 ??? Mar 31, ${year}`, due: dueDate(4,15), amount: quarterlyPayment },
      { period: 'Q2', label: `Apr 1 ??? May 31, ${year}`, due: dueDate(6,16), amount: quarterlyPayment },
      { period: 'Q3', label: `Jun 1 ??? Aug 31, ${year}`, due: dueDate(9,15), amount: quarterlyPayment },
      { period: 'Q4', label: `Sep 1 ??? Dec 31, ${year}`, due: `${year+1}-01-15`, amount: quarterlyPayment },
    ];

    res.json({
      year,
      quarters,
      summary: {
        ytd_revenue: parseFloat(ytdRevenue.toFixed(2)),
        ytd_net_income: parseFloat(ytdNet.toFixed(2)),
        se_tax: parseFloat(seTax.toFixed(2)),
        se_deduction: parseFloat(seDeduction.toFixed(2)),
        taxable_income: parseFloat(taxableIncome.toFixed(2)),
        income_tax: parseFloat(incomeTax.toFixed(2)),
        total_federal_tax: parseFloat(totalFederalTax.toFixed(2)),
        quarterly_payment: parseFloat(quarterlyPayment.toFixed(2)),
      },
      estimated_payments: estimatedPaymentDates.map(p => ({ ...p, amount: parseFloat(p.amount.toFixed(2)) })),
      texas_franchise_tax: txFranchiseTax,
      notes: [
        '1099-NEC received from RLI Insurance at year-end (report as self-employment income)',
        'SE tax calculated on 92.35% of net profit per IRS rules',
        '50% of SE tax is deductible above the line',
        'Standard deduction assumed ($14,600 for 2025 single filer) ??? adjust if itemizing',
        'Texas LLC franchise tax: annual PIR filing due May 15 with Texas Comptroller',
        'Consult your accountant for final tax liability ??? this is an estimate only',
      ],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
