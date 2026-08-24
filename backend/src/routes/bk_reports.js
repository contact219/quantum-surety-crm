import express from 'express';
import { pool } from '../db.js';
import { toCsv, csvCell, logAudit, actorOf } from './bookkeeping.js';

// ─────────────────────────────────────────────────────────────────────────────
// DERIVED DOUBLE-ENTRY JOURNAL + QB-PARITY REPORTS
//
// No existing table is restructured. Two SQL views map every business event
// into balanced debit/credit journal lines over a fixed virtual chart of
// accounts; every report below is computed from those views, so history
// backfills automatically the moment the views exist.
//
// Balanced-by-construction rules:
//  * The commission leg of every split is computed as (total − other legs),
//    never as an independently rounded figure, so any rounding residual lands
//    on the commission leg and each journal entry nets to exactly 0.00.
//  * Every branch emits either the full entry or nothing (no partial entries).
//
// Documented approximations:
//  * Cancellation reversals are dated bk_bonds.cancelled_at (set by both
//    cancellation paths and backfilled once from updated_at by db.js);
//    updated_at::date remains only as a legacy fallback for rows the backfill
//    has not touched yet. This keeps closed-period reports stable even though
//    the nightly scraper sync bumps updated_at on every run.
//  * Remittance entries are dated sent_at::date; legacy rows sent before
//    sent_at existed fall back to confirmed_at, then created_at.
//  * DIRECT-BILL bonds (source='scraper' on a carrier flagged direct_bill —
//    e.g. RLI): the insured pays the carrier, the carrier pays us commission.
//    No A/R (1100) or Carrier Premium Payable (2000) ever exists for them.
//    Accrual books DR 1110 Commission Receivable / CR 4000 at issuance, and
//    the scraper's bk_commission_ledger post stands in for the carrier's
//    commission payment (DR 1010 / CR 1110 on accrual, DR 1010 / CR 4000 on
//    cash) at the ledger entry_date — the closest event we have to the
//    actual deposit date.
// ─────────────────────────────────────────────────────────────────────────────

export const bkReportsRouter = express.Router();

// Fixed chart of accounts. Expense accounts are dynamic: one per PARENT
// bk_expense_categories row at code 5000+id ('5000' itself = uncategorized
// fallback — ids are SERIAL starting at 1, so 5000+id is always >= 5001 and
// can never collide with it). Category ids >= 1000 yield 6xxx+ codes, which
// is why ALL classification below is numeric (code >= 5000 == expense), never
// a '5%' string-prefix match.
const STATIC_ACCOUNTS = [
  { code: '1000', name: 'Trust Bank Account',        type: 'asset' },
  { code: '1010', name: 'Operating Bank Account',    type: 'asset' },
  { code: '1100', name: 'Accounts Receivable',       type: 'asset' },
  { code: '1110', name: 'Commission Receivable',     type: 'asset' },
  { code: '2000', name: 'Carrier Premium Payable',   type: 'liability' },
  { code: '2100', name: 'Accounts Payable - Bills',  type: 'liability' },
  { code: '2200', name: 'Customer Refunds Payable',  type: 'liability' },
  { code: '3000', name: 'Owner Equity',              type: 'equity' },
  { code: '4000', name: 'Commission Income',         type: 'income' },
  { code: '4900', name: 'Other Income',              type: 'income' },
];

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const dateOr = (v, fallback) => (typeof v === 'string' && DATE_RE.test(v) ? v : fallback);
// basis is interpolated into SQL as a view name — strict whitelist only.
const basisOf = req => (String(req.query.basis || 'accrual').toLowerCase() === 'cash' ? 'cash' : 'accrual');
const viewFor = basis => (basis === 'cash' ? 'bk_journal_cash' : 'bk_journal_accrual');
// Numeric classification: dynamic expense codes can grow past '5999' (6xxx…)
// once category ids reach 1000, so first-digit / LIKE '5%' matching is wrong.
const typeOfCode = code => {
  const n = parseInt(code, 10);
  if (n >= 5000) return 'expense';
  if (n >= 4000) return 'income';
  if (n >= 3000) return 'equity';
  if (n >= 2000) return 'liability';
  return 'asset';
};
// Natural-balance sign for general-ledger running balances.
const signOfCode = code => {
  const t = typeOfCode(code);
  return (t === 'asset' || t === 'expense') ? 1 : -1;
};

// ─── SELF-INIT DDL (additive only; follows the expenses.js pattern) ──────────

// Shared CTEs: expense/bill → PARENT expense account, plus the remittance
// amount used by BOTH views. The remittance journal amount is the SUM of
// (premium − commission_amt) over the remittance's linked bonds — the exact
// figure the 2000 payable was credited per bond — so account 2000 clears to
// zero per bond by construction. (r.total_remitted sums carrier_remit_amt,
// which can differ by a cent when both generated columns round the same half
// up; legacy remittances with no link rows fall back to total_remitted.)
const CAT_CTES = `
  WITH ecat AS (
    SELECT e.id AS expense_id,
           COALESCE((5000 + COALESCE(pc.id, c.id))::text, '5000') AS account_code,
           COALESCE(pc.name, c.name, 'Uncategorized Expense')      AS account_name
    FROM bk_expenses e
    LEFT JOIN bk_expense_categories c  ON c.id = e.category_id
    LEFT JOIN bk_expense_categories pc ON pc.id = c.parent_id
  ),
  bcat AS (
    SELECT b.id AS bill_id,
           COALESCE((5000 + COALESCE(pc.id, c.id))::text, '5000') AS account_code,
           COALESCE(pc.name, c.name, 'Uncategorized Expense')      AS account_name
    FROM bk_bills b
    LEFT JOIN bk_expense_categories c  ON c.id = b.category_id
    LEFT JOIN bk_expense_categories pc ON pc.id = c.parent_id
  ),
  dbb AS (
    -- Direct-bill bonds: scraper-sourced AND carrier flagged direct_bill.
    -- The insured pays the carrier directly, so these bonds get the
    -- commission-receivable treatment instead of A/R + premium payable.
    SELECT b.id FROM bk_bonds b
    JOIN bk_carriers c ON c.id = b.carrier_id
    WHERE b.source = 'scraper' AND c.direct_bill
  ),
  remit AS (
    -- Per-remittance journal amounts. amt = SUM(premium − commission_amt)
    -- over linked NON-direct-bill bonds — the exact figure the 2000 payable
    -- was credited per bond, so 2000 clears to zero per bond by construction.
    -- Direct-bill bonds are excluded: their issuance never credits 2000, so
    -- a legacy include_uncollected remittance that contains them must not
    -- debit 2000 (or credit any bank) for their share — that money was never
    -- in trust and the payable never existed. A remittance with link rows
    -- but only direct-bill bonds nets to 0 and is filtered out by the
    -- amt <> 0 condition on the branches that use this.
    -- trust_amt mirrors the REAL trust posting in bookkeeping.js
    -- PUT /remittances/:id/status: per bond the trust only ever pays out
    -- LEAST(collected premium, premium − commission_amt), clamped to
    -- [0, amt] at the remittance level; any remainder (include_uncollected
    -- shares whose premium never reached trust) is paid from OPERATING, so
    -- the journal splits the cash credit between 1000 and 1010 the same way
    -- and both bank accounts match real cash movement. Legacy remittances
    -- with no link rows fall back to total_remitted for both columns
    -- (pre-link behavior posted the full amount from trust).
    SELECT r.id, r.carrier_id, r.period_start, r.period_end,
           COALESCE(r.sent_at::date, r.confirmed_at::date, r.created_at::date) AS entry_date,
           CASE WHEN s.links > 0 THEN s.amt ELSE r.total_remitted END AS amt,
           CASE WHEN s.links > 0 THEN LEAST(GREATEST(s.trust_funded, 0), s.amt)
                ELSE r.total_remitted END AS trust_amt
    FROM bk_carrier_remittances r
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS links,
             COALESCE(ROUND(SUM(CASE WHEN d.id IS NULL THEN b.premium - b.commission_amt END), 2), 0) AS amt,
             COALESCE(ROUND(SUM(CASE WHEN d.id IS NULL THEN LEAST(pc.collected, b.premium - b.commission_amt) END), 2), 0) AS trust_funded
      FROM bk_remittance_bonds rb
      JOIN bk_bonds b ON b.id = rb.bond_id
      LEFT JOIN dbb d ON d.id = b.id
      LEFT JOIN LATERAL (
        -- Only payments collected ON OR BEFORE the send date: the real
        -- bk_trust_account remittance_out froze the trust-funded figure at
        -- send time, so a payment collected later must not retroactively
        -- shift the journal's trust/operating split (a cleared line inside a
        -- completed reconciliation would silently change value).
        SELECT COALESCE(SUM(py.amount), 0) AS collected
        FROM bk_bond_payments py
        WHERE py.bond_id = b.id AND py.status = 'collected'
          AND COALESCE(py.collected_at::date, py.payment_date, py.created_at::date)
              <= COALESCE(r.sent_at::date, CURRENT_DATE)
      ) pc ON true
      WHERE rb.remittance_id = r.id
    ) s ON true
    WHERE r.status IN ('sent','confirmed')
  )
`;

// Commission sweep out of trust into operating: the app itself records this
// cash movement in bk_trust_account ('commission_out' at earn time, negative
// amount; 'commission_reversal' puts it back on cancellation/dedupe). Without
// these lines, journal 1000 would overstate the real trust bank by all
// commission ever earned and 1010 would only ever be credited — neither bank
// account could ever reconcile against a real statement. Cash movement is the
// same on both bases, so this block is UNIONed into both views.
const SWEEP_SQL = `
SELECT t.entry_date, 'bk_trust_account', t.id, 1,
       CASE WHEN t.entry_type = 'commission_out' THEN '1010' ELSE '1000' END,
       CASE WHEN t.entry_type = 'commission_out' THEN 'Operating Bank Account' ELSE 'Trust Bank Account' END,
       ABS(t.amount), 0::numeric,
       (CASE WHEN t.entry_type = 'commission_out' THEN 'Commission sweep to operating — ' ELSE 'Commission sweep reversed — ' END || COALESCE(t.description, 'trust entry #' || t.id))
FROM bk_trust_account t WHERE t.entry_type IN ('commission_out','commission_reversal')
UNION ALL
SELECT t.entry_date, 'bk_trust_account', t.id, 2,
       CASE WHEN t.entry_type = 'commission_out' THEN '1000' ELSE '1010' END,
       CASE WHEN t.entry_type = 'commission_out' THEN 'Trust Bank Account' ELSE 'Operating Bank Account' END,
       0::numeric, ABS(t.amount),
       (CASE WHEN t.entry_type = 'commission_out' THEN 'Commission sweep from trust — ' ELSE 'Commission sweep returned — ' END || COALESCE(t.description, 'trust entry #' || t.id))
FROM bk_trust_account t WHERE t.entry_type IN ('commission_out','commission_reversal')
`;

// Manual journal entries (bank fees, interest, owner draws, opening balances,
// reconciliation adjustments) — the derived views cannot represent these from
// business tables, yet /recon/:id/complete demands an exact 0.00 difference.
// A row's basis is 'both' | 'accrual' | 'cash'.
const MANUAL_SQL = basis => `
SELECT j.entry_date, 'bk_manual_journal', j.id, l.line_no,
       l.account_code, l.account_name, l.debit, l.credit,
       COALESCE(NULLIF(l.description, ''), j.memo, 'Manual journal entry')
FROM bk_manual_journal j
JOIN bk_manual_journal_lines l ON l.journal_id = j.id
WHERE j.basis IN ('both', '${basis}')
`;

// ACCRUAL basis: revenue and payables recognized at issuance / invoice date.
// NOTE: commission leg = the stored generated commission_amt — the SAME figure
// /pl, /dashboard, /kpi, and the tax packet report — and the carrier-payable
// leg is premium − commission_amt, so the residual cent rides on the payable
// leg and each entry still nets to exactly 0.00.
const ACCRUAL_VIEW_SQL = `
CREATE OR REPLACE VIEW bk_journal_accrual AS
${CAT_CTES}
-- 1) AGENCY-BILL bond issuance: DR A/R premium; CR carrier payable; CR
--    commission income. Direct-bill bonds (dbb) are EXCLUDED here: the
--    insured pays the carrier directly, so booking A/R + premium payable for
--    them would accrue phantom 1100/2000 balances that nothing could ever
--    relieve (and would flood A/R aging with insureds who owe us nothing).
SELECT b.effective_date AS entry_date, 'bk_bonds' AS source_table, b.id AS source_id, 1 AS line_no,
       '1100' AS account_code, 'Accounts Receivable' AS account_name,
       b.premium AS debit, 0::numeric AS credit,
       ('Bond ' || COALESCE(b.bond_number, '#' || b.id) || ' issued — ' || b.insured_name) AS description
FROM bk_bonds b WHERE b.status IN ('issued','expired','cancelled')
  AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
SELECT b.effective_date, 'bk_bonds', b.id, 2,
       '2000', 'Carrier Premium Payable',
       0::numeric, (b.premium - b.commission_amt),
       ('Carrier share — bond ' || COALESCE(b.bond_number, '#' || b.id))
FROM bk_bonds b WHERE b.status IN ('issued','expired','cancelled')
  AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
SELECT b.effective_date, 'bk_bonds', b.id, 3,
       '4000', 'Commission Income',
       0::numeric, b.commission_amt,
       ('Commission earned — bond ' || COALESCE(b.bond_number, '#' || b.id))
FROM bk_bonds b WHERE b.status IN ('issued','expired','cancelled')
  AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
-- 1b) DIRECT-BILL bond issuance: commission earned at issuance, receivable
--     from the CARRIER (not the insured): DR 1110 / CR 4000.
SELECT b.effective_date, 'bk_bonds', b.id, 1,
       '1110', 'Commission Receivable',
       b.commission_amt, 0::numeric,
       ('Direct-bill commission receivable — bond ' || COALESCE(b.bond_number, '#' || b.id) || ' (' || b.insured_name || ')')
FROM bk_bonds b WHERE b.status IN ('issued','expired','cancelled') AND b.commission_amt <> 0
  AND EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
SELECT b.effective_date, 'bk_bonds', b.id, 2,
       '4000', 'Commission Income',
       0::numeric, b.commission_amt,
       ('Commission earned — bond ' || COALESCE(b.bond_number, '#' || b.id))
FROM bk_bonds b WHERE b.status IN ('issued','expired','cancelled') AND b.commission_amt <> 0
  AND EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
-- 2) Bond cancellation: exact mirror of the issue entry, dated
--    COALESCE(cancelled_at, updated_at::date). cancelled_at is set by both
--    cancellation paths and freezes at first observation, so the reversal
--    date no longer slides to "last night's sync" every time the scraper
--    bumps updated_at on an unchanged cancelled bond.
SELECT COALESCE(b.cancelled_at, b.updated_at::date), 'bk_bonds_cancel', b.id, 1,
       '1100', 'Accounts Receivable',
       0::numeric, b.premium,
       ('Bond ' || COALESCE(b.bond_number, '#' || b.id) || ' cancelled — reversal')
FROM bk_bonds b WHERE b.status = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
SELECT COALESCE(b.cancelled_at, b.updated_at::date), 'bk_bonds_cancel', b.id, 2,
       '2000', 'Carrier Premium Payable',
       (b.premium - b.commission_amt), 0::numeric,
       ('Carrier share reversed — bond ' || COALESCE(b.bond_number, '#' || b.id))
FROM bk_bonds b WHERE b.status = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
SELECT COALESCE(b.cancelled_at, b.updated_at::date), 'bk_bonds_cancel', b.id, 3,
       '4000', 'Commission Income',
       b.commission_amt, 0::numeric,
       ('Commission reversed — bond ' || COALESCE(b.bond_number, '#' || b.id))
FROM bk_bonds b WHERE b.status = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
-- 2c) DIRECT-BILL cancellation mirror: DR 4000 / CR 1110.
SELECT COALESCE(b.cancelled_at, b.updated_at::date), 'bk_bonds_cancel', b.id, 1,
       '4000', 'Commission Income',
       b.commission_amt, 0::numeric,
       ('Commission reversed — bond ' || COALESCE(b.bond_number, '#' || b.id))
FROM bk_bonds b WHERE b.status = 'cancelled' AND b.commission_amt <> 0
  AND EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
SELECT COALESCE(b.cancelled_at, b.updated_at::date), 'bk_bonds_cancel', b.id, 2,
       '1110', 'Commission Receivable',
       0::numeric, b.commission_amt,
       ('Direct-bill commission receivable reversed — bond ' || COALESCE(b.bond_number, '#' || b.id))
FROM bk_bonds b WHERE b.status = 'cancelled' AND b.commission_amt <> 0
  AND EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
-- 2b) Cancelled bond that HAD collected payments: the cancel mirror above
--     reverses the full premium out of A/R while the collection entries below
--     already credited A/R by the collected amount, leaving 1100 with a
--     negative residual. Reclass that residual into 2200 Customer Refunds
--     Payable (DR 1100 / CR 2200): A/R nets to exactly zero for every
--     cancelled bond and the amount owed back to the insured is visible as a
--     liability until refunded. (A/R aging keys off this: it excludes
--     cancelled bonds entirely, which is consistent with 1100 because of this
--     reclass.)
SELECT COALESCE(b.cancelled_at, b.updated_at::date), 'bk_bonds_cancel_refund', b.id, 1,
       '1100', 'Accounts Receivable',
       p.collected, 0::numeric,
       ('Collected cash reclassed to refund payable — bond ' || COALESCE(b.bond_number, '#' || b.id))
FROM bk_bonds b
JOIN (SELECT bond_id, ROUND(SUM(amount), 2) AS collected FROM bk_bond_payments
      WHERE status = 'collected' GROUP BY bond_id) p ON p.bond_id = b.id
WHERE b.status = 'cancelled' AND p.collected <> 0
  AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
SELECT COALESCE(b.cancelled_at, b.updated_at::date), 'bk_bonds_cancel_refund', b.id, 2,
       '2200', 'Customer Refunds Payable',
       0::numeric, p.collected,
       ('Refund owed to insured — ' || b.insured_name)
FROM bk_bonds b
JOIN (SELECT bond_id, ROUND(SUM(amount), 2) AS collected FROM bk_bond_payments
      WHERE status = 'collected' GROUP BY bond_id) p ON p.bond_id = b.id
WHERE b.status = 'cancelled' AND p.collected <> 0
  AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
-- 3) Premium collection: cash into trust, A/R relieved. Bond-status filter
--    mirrors the issuance branch: a collected payment on a 'saved'/pipeline
--    bond has no issuance debit yet and would drive 1100 negative, breaking
--    the aging-ties-to-1100 identity. Direct-bill (dbb) bonds are excluded
--    with the SAME predicate as issuance: they have no 1100 debit to
--    relieve, their income arrives via bk_commission_ledger (7b), and any
--    historical payment row on one would double-count revenue-side cash
--    (the API now rejects such payments, but legacy rows must stay out too).
SELECT COALESCE(py.collected_at::date, py.payment_date, py.created_at::date),
       'bk_bond_payments', py.id, 1,
       '1000', 'Trust Bank Account',
       py.amount, 0::numeric,
       ('Premium collected — ' || b.insured_name || ' (bond ' || COALESCE(b.bond_number, '#' || b.id) || ')')
FROM bk_bond_payments py JOIN bk_bonds b ON b.id = py.bond_id
WHERE py.status = 'collected' AND b.status IN ('issued','expired','cancelled')
  AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
SELECT COALESCE(py.collected_at::date, py.payment_date, py.created_at::date),
       'bk_bond_payments', py.id, 2,
       '1100', 'Accounts Receivable',
       0::numeric, py.amount,
       ('A/R relieved — ' || b.insured_name)
FROM bk_bond_payments py JOIN bk_bonds b ON b.id = py.bond_id
WHERE py.status = 'collected' AND b.status IN ('issued','expired','cancelled')
  AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = b.id)
UNION ALL
-- 4) Carrier remittance: payable settled. CR trust only for the trust-funded
--    share (mirrors the LEAST-capped bk_trust_account posting in
--    bookkeeping.js PUT /remittances/:id/status); the remainder is CR
--    operating. amt = trust_amt + (amt − trust_amt), so the entry always
--    balances to the cent — see remit CTE note.
SELECT r.entry_date,
       'bk_carrier_remittances', r.id, 1,
       '2000', 'Carrier Premium Payable',
       r.amt, 0::numeric,
       ('Remittance #' || r.id || ' to carrier #' || r.carrier_id || ' (' || r.period_start || ' – ' || r.period_end || ')')
FROM remit r WHERE r.amt <> 0
UNION ALL
SELECT r.entry_date,
       'bk_carrier_remittances', r.id, 2,
       '1000', 'Trust Bank Account',
       0::numeric, r.trust_amt,
       ('Remittance #' || r.id || ' paid from trust')
FROM remit r WHERE r.trust_amt <> 0
UNION ALL
SELECT r.entry_date,
       'bk_carrier_remittances', r.id, 3,
       '1010', 'Operating Bank Account',
       0::numeric, ROUND(r.amt - r.trust_amt, 2),
       ('Remittance #' || r.id || ' non-trust share paid from operating')
FROM remit r WHERE ROUND(r.amt - r.trust_amt, 2) <> 0
UNION ALL
-- 5) Direct expenses (no bill): expense recognized, paid from operating.
SELECT e.expense_date, 'bk_expenses', e.id, 1,
       ec.account_code, ec.account_name,
       e.amount, 0::numeric,
       (COALESCE(e.vendor, 'Expense') || COALESCE(' — ' || NULLIF(e.description, ''), ''))
FROM bk_expenses e JOIN ecat ec ON ec.expense_id = e.id
WHERE e.bill_id IS NULL
UNION ALL
SELECT e.expense_date, 'bk_expenses', e.id, 2,
       '1010', 'Operating Bank Account',
       0::numeric, e.amount,
       ('Paid — ' || COALESCE(e.vendor, 'expense #' || e.id))
FROM bk_expenses e WHERE e.bill_id IS NULL
UNION ALL
-- 6) Bill-payment expenses: settle A/P from operating (the expense leg was
--    already accrued by the bill entry below). 2100 is relieved by the BILL
--    amount — a payment marks the bill settled even when paid_amount differs
--    — cash out is the expense (paid) amount, and any over/short difference
--    books to the bill's expense account (line 3) so the entry balances and
--    no phantom A/P residual survives a partial or over-payment.
SELECT e.expense_date, 'bk_expenses', e.id, 1,
       '2100', 'Accounts Payable - Bills',
       COALESCE(bl.amount, e.amount), 0::numeric,
       ('Bill #' || e.bill_id || ' paid — ' || COALESCE(e.vendor, 'vendor'))
FROM bk_expenses e
LEFT JOIN bk_bills bl ON bl.id = e.bill_id
WHERE e.bill_id IS NOT NULL
UNION ALL
SELECT e.expense_date, 'bk_expenses', e.id, 2,
       '1010', 'Operating Bank Account',
       0::numeric, e.amount,
       ('Bill #' || e.bill_id || ' paid from operating')
FROM bk_expenses e WHERE e.bill_id IS NOT NULL
UNION ALL
SELECT e.expense_date, 'bk_expenses', e.id, 3,
       COALESCE(bc.account_code, ec.account_code), COALESCE(bc.account_name, ec.account_name),
       GREATEST(e.amount - bl.amount, 0), GREATEST(bl.amount - e.amount, 0),
       ('Bill #' || e.bill_id || ' payment adjustment (paid vs. invoiced)')
FROM bk_expenses e
JOIN bk_bills bl ON bl.id = e.bill_id
LEFT JOIN bcat bc ON bc.bill_id = e.bill_id
JOIN ecat ec ON ec.expense_id = e.id
WHERE e.bill_id IS NOT NULL AND e.amount <> bl.amount
UNION ALL
-- 7) Bills: expense accrued at invoice date against A/P. Void bills are
--    excluded — a voided invoice must not inflate expenses or A/P.
SELECT COALESCE(bl.invoice_date, bl.due_date, bl.created_at::date),
       'bk_bills', bl.id, 1,
       bc.account_code, bc.account_name,
       bl.amount, 0::numeric,
       ('Bill — ' || bl.vendor || COALESCE(' #' || NULLIF(bl.invoice_number, ''), ''))
FROM bk_bills bl JOIN bcat bc ON bc.bill_id = bl.id
WHERE bl.status != 'void'
UNION ALL
SELECT COALESCE(bl.invoice_date, bl.due_date, bl.created_at::date),
       'bk_bills', bl.id, 2,
       '2100', 'Accounts Payable - Bills',
       0::numeric, bl.amount,
       ('A/P accrued — ' || bl.vendor)
FROM bk_bills bl
WHERE bl.status != 'void'
UNION ALL
-- 7b) DIRECT-BILL commission receipt: the scraper's bk_commission_ledger
--     post stands in for the carrier's commission payment (no in-app event
--     records the actual deposit): DR operating / CR the 1110 receivable at
--     the ledger entry_date. Negative rows (cancellation chargebacks) mirror
--     it. Rows on bonds with a 'commission_out' trust sweep are excluded —
--     those are agency-bill posts whose cash movement is the SWEEP lines.
SELECT cl.entry_date, 'bk_commission_ledger', cl.id, 1,
       '1010', 'Operating Bank Account',
       CASE WHEN cl.amount > 0 THEN cl.amount ELSE 0::numeric END,
       CASE WHEN cl.amount < 0 THEN -cl.amount ELSE 0::numeric END,
       ('Direct-bill commission ' || CASE WHEN cl.amount < 0 THEN 'charged back' ELSE 'received' END ||
        ' — ' || COALESCE(cl.notes, 'ledger #' || cl.id))
FROM bk_commission_ledger cl
WHERE cl.amount <> 0
  AND EXISTS (SELECT 1 FROM dbb WHERE dbb.id = cl.bond_id)
  AND NOT EXISTS (SELECT 1 FROM bk_trust_account t WHERE t.bond_id = cl.bond_id AND t.entry_type = 'commission_out')
UNION ALL
SELECT cl.entry_date, 'bk_commission_ledger', cl.id, 2,
       '1110', 'Commission Receivable',
       CASE WHEN cl.amount < 0 THEN -cl.amount ELSE 0::numeric END,
       CASE WHEN cl.amount > 0 THEN cl.amount ELSE 0::numeric END,
       ('Commission receivable ' || CASE WHEN cl.amount < 0 THEN 'restored' ELSE 'settled' END || ' — ledger #' || cl.id)
FROM bk_commission_ledger cl
WHERE cl.amount <> 0
  AND EXISTS (SELECT 1 FROM dbb WHERE dbb.id = cl.bond_id)
  AND NOT EXISTS (SELECT 1 FROM bk_trust_account t WHERE t.bond_id = cl.bond_id AND t.entry_type = 'commission_out')
UNION ALL
-- 8) Commission sweep trust → operating (see SWEEP_SQL note).
${SWEEP_SQL}
UNION ALL
-- 9) Manual journal entries (adjustments, fees, opening balances).
${MANUAL_SQL('accrual')}
`;

// CASH basis: only cash events. A collected payment is decomposed into
// commission and carrier-payable legs by CUMULATIVE rounding (leg_i =
// ROUND(cum_i × ratio) − ROUND(cum_{i-1} × ratio)): each receipt's legs
// telescope, so across any number of partial payments the commission legs sum
// to exactly ROUND(collected × commission_amt/premium) — commission_amt
// itself once fully collected — and the carrier legs sum to exactly
// premium − commission_amt, which is precisely what the remittance debits
// out of 2000. No penny residue can accumulate in 2000 by construction.
// premium = 0 guard: the entire receipt books to commission income.
// Cancellations have no cash entry until money actually moves back (a refund
// would be recorded as a manual journal or refunded payment).
const CASH_VIEW_SQL = `
CREATE OR REPLACE VIEW bk_journal_cash AS
${CAT_CTES},
  pay AS (
    -- Bond-status filter mirrors the accrual issuance/payment branches so a
    -- collected payment on a pipeline bond cannot enter the books early.
    -- Direct-bill (dbb) bonds are excluded with the SAME predicate as the
    -- accrual branches: their cash income is the bk_commission_ledger post
    -- (4b), so a historical payment row on one would double-count revenue
    -- (the API now rejects such payments; legacy rows must stay out too).
    SELECT py.id, py.bond_id, py.amount,
           COALESCE(py.collected_at::date, py.payment_date, py.created_at::date) AS entry_date,
           SUM(py.amount) OVER (
             PARTITION BY py.bond_id
             ORDER BY COALESCE(py.collected_at::date, py.payment_date, py.created_at::date), py.id
           ) AS cum
    FROM bk_bond_payments py
    JOIN bk_bonds bb ON bb.id = py.bond_id
    WHERE py.status = 'collected' AND bb.status IN ('issued','expired','cancelled')
      AND NOT EXISTS (SELECT 1 FROM dbb WHERE dbb.id = py.bond_id)
  ),
  pay_split AS (
    SELECT p.id, p.entry_date, p.amount, b.insured_name, b.bond_number, b.id AS bond_pk,
           CASE WHEN b.premium > 0
             THEN ROUND(p.cum * b.commission_amt / b.premium, 2)
                  - ROUND((p.cum - p.amount) * b.commission_amt / b.premium, 2)
             ELSE p.amount END AS comm_leg
    FROM pay p JOIN bk_bonds b ON b.id = p.bond_id
  )
-- 1) Premium collected: DR trust; CR carrier payable; CR commission income
--    (cumulative-rounding split — see header note).
SELECT ps.entry_date AS entry_date,
       'bk_bond_payments' AS source_table, ps.id AS source_id, 1 AS line_no,
       '1000' AS account_code, 'Trust Bank Account' AS account_name,
       ps.amount AS debit, 0::numeric AS credit,
       ('Premium collected — ' || ps.insured_name || ' (bond ' || COALESCE(ps.bond_number, '#' || ps.bond_pk) || ')') AS description
FROM pay_split ps
UNION ALL
SELECT ps.entry_date, 'bk_bond_payments', ps.id, 2,
       '2000', 'Carrier Premium Payable',
       0::numeric, (ps.amount - ps.comm_leg),
       ('Carrier share of receipt — ' || ps.insured_name)
FROM pay_split ps
UNION ALL
SELECT ps.entry_date, 'bk_bond_payments', ps.id, 3,
       '4000', 'Commission Income',
       0::numeric, ps.comm_leg,
       ('Commission share of receipt — ' || ps.insured_name)
FROM pay_split ps
UNION ALL
-- 2) Carrier remittance: payable settled (cash out; amounts from the remit
--    CTE so 2000 clears exactly per bond). CR trust only for the
--    trust-funded share — the LEAST-capped figure actually posted to
--    bk_trust_account — and CR operating for the remainder, so journal cash
--    matches real cash movement. Entry balances: amt = trust + remainder.
SELECT r.entry_date,
       'bk_carrier_remittances', r.id, 1,
       '2000', 'Carrier Premium Payable',
       r.amt, 0::numeric,
       ('Remittance #' || r.id || ' to carrier #' || r.carrier_id || ' (' || r.period_start || ' – ' || r.period_end || ')')
FROM remit r WHERE r.amt <> 0
UNION ALL
SELECT r.entry_date,
       'bk_carrier_remittances', r.id, 2,
       '1000', 'Trust Bank Account',
       0::numeric, r.trust_amt,
       ('Remittance #' || r.id || ' paid from trust')
FROM remit r WHERE r.trust_amt <> 0
UNION ALL
SELECT r.entry_date,
       'bk_carrier_remittances', r.id, 3,
       '1010', 'Operating Bank Account',
       0::numeric, ROUND(r.amt - r.trust_amt, 2),
       ('Remittance #' || r.id || ' non-trust share paid from operating')
FROM remit r WHERE ROUND(r.amt - r.trust_amt, 2) <> 0
UNION ALL
-- 3) Direct expenses (no bill): cash out of operating.
SELECT e.expense_date, 'bk_expenses', e.id, 1,
       ec.account_code, ec.account_name,
       e.amount, 0::numeric,
       (COALESCE(e.vendor, 'Expense') || COALESCE(' — ' || NULLIF(e.description, ''), ''))
FROM bk_expenses e JOIN ecat ec ON ec.expense_id = e.id
WHERE e.bill_id IS NULL
UNION ALL
SELECT e.expense_date, 'bk_expenses', e.id, 2,
       '1010', 'Operating Bank Account',
       0::numeric, e.amount,
       ('Paid — ' || COALESCE(e.vendor, 'expense #' || e.id))
FROM bk_expenses e WHERE e.bill_id IS NULL
UNION ALL
-- 4) Bill-payment expenses: expense recognized when CASH moves, categorized by
--    the BILL's category (falls back to the expense's own category if the bill
--    row is missing).
SELECT e.expense_date, 'bk_expenses', e.id, 1,
       COALESCE(bc.account_code, ec.account_code), COALESCE(bc.account_name, ec.account_name),
       e.amount, 0::numeric,
       ('Bill #' || e.bill_id || ' paid — ' || COALESCE(e.vendor, 'vendor'))
FROM bk_expenses e
LEFT JOIN bcat bc ON bc.bill_id = e.bill_id
JOIN ecat ec ON ec.expense_id = e.id
WHERE e.bill_id IS NOT NULL
UNION ALL
SELECT e.expense_date, 'bk_expenses', e.id, 2,
       '1010', 'Operating Bank Account',
       0::numeric, e.amount,
       ('Bill #' || e.bill_id || ' paid from operating')
FROM bk_expenses e WHERE e.bill_id IS NOT NULL
UNION ALL
-- 4b) DIRECT-BILL commission income: the carrier pays commission straight to
--     operating — there are no bk_bond_payments or trust entries for these
--     bonds, so without this branch the entire direct-bill book would report
--     ZERO cash-basis revenue. The bk_commission_ledger post (dated
--     entry_date) stands in for the carrier's payment: DR 1010 / CR 4000;
--     negative rows (cancellation chargebacks) mirror it. Agency-bill posts
--     (which have a commission_out trust sweep) are excluded — their cash
--     income arrives via the payment split + SWEEP lines.
SELECT cl.entry_date, 'bk_commission_ledger', cl.id, 1,
       '1010', 'Operating Bank Account',
       CASE WHEN cl.amount > 0 THEN cl.amount ELSE 0::numeric END,
       CASE WHEN cl.amount < 0 THEN -cl.amount ELSE 0::numeric END,
       ('Direct-bill commission ' || CASE WHEN cl.amount < 0 THEN 'charged back' ELSE 'received' END ||
        ' — ' || COALESCE(cl.notes, 'ledger #' || cl.id))
FROM bk_commission_ledger cl
WHERE cl.amount <> 0
  AND EXISTS (SELECT 1 FROM dbb WHERE dbb.id = cl.bond_id)
  AND NOT EXISTS (SELECT 1 FROM bk_trust_account t WHERE t.bond_id = cl.bond_id AND t.entry_type = 'commission_out')
UNION ALL
SELECT cl.entry_date, 'bk_commission_ledger', cl.id, 2,
       '4000', 'Commission Income',
       CASE WHEN cl.amount < 0 THEN -cl.amount ELSE 0::numeric END,
       CASE WHEN cl.amount > 0 THEN cl.amount ELSE 0::numeric END,
       ('Commission income — ledger #' || cl.id)
FROM bk_commission_ledger cl
WHERE cl.amount <> 0
  AND EXISTS (SELECT 1 FROM dbb WHERE dbb.id = cl.bond_id)
  AND NOT EXISTS (SELECT 1 FROM bk_trust_account t WHERE t.bond_id = cl.bond_id AND t.entry_type = 'commission_out')
UNION ALL
-- 5) Commission sweep trust → operating (see SWEEP_SQL note).
${SWEEP_SQL}
UNION ALL
-- 6) Manual journal entries (adjustments, fees, opening balances).
${MANUAL_SQL('cash')}
`;

// The views reference bk_expenses.bill_id / bk_bills, which are created by the
// expenses/bills module inits. Boot order is not guaranteed, so retry a few
// times instead of racing them.
async function initReportingDb(attempt = 0) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bk_reconciliations (
        id SERIAL PRIMARY KEY,
        account_code TEXT NOT NULL,
        statement_date DATE NOT NULL,
        ending_balance NUMERIC(12,2) NOT NULL,
        status TEXT DEFAULT 'in_progress',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bk_cleared_lines (
        recon_id INTEGER NOT NULL REFERENCES bk_reconciliations(id) ON DELETE CASCADE,
        account_code TEXT NOT NULL,
        line_key TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        PRIMARY KEY (recon_id, line_key)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS bk_cleared_lines_key_idx ON bk_cleared_lines(line_key)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bk_manual_journal (
        id SERIAL PRIMARY KEY,
        entry_date DATE NOT NULL,
        memo TEXT,
        basis TEXT NOT NULL DEFAULT 'both',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bk_manual_journal_lines (
        id SERIAL PRIMARY KEY,
        journal_id INTEGER NOT NULL REFERENCES bk_manual_journal(id) ON DELETE CASCADE,
        line_no INTEGER NOT NULL,
        account_code TEXT NOT NULL,
        account_name TEXT NOT NULL,
        debit NUMERIC(12,2) NOT NULL DEFAULT 0,
        credit NUMERIC(12,2) NOT NULL DEFAULT 0,
        description TEXT
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS bk_manual_journal_lines_jid_idx ON bk_manual_journal_lines(journal_id)`);
    // Close-the-books: effective closing date = MAX(closing_date). Rows are
    // append-only history; reopening deletes a row (audited). The mutation
    // guard in bookkeeping.js/bills.js/expenses.js reads this table via the
    // exported getClosingDate helper.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bk_closed_periods (
        id SERIAL PRIMARY KEY,
        closing_date DATE NOT NULL,
        closed_by TEXT,
        note TEXT,
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    // BACKFILL: expenses auto-created by bill payment BEFORE the bill_id
    // column existed are linked only by their machine-written notes text.
    // Without this, the accrual view books those rows as direct expenses
    // (section 5) while section 7 independently accrues the same bill — every
    // historical bill payment double-counts in P&L and leaves phantom,
    // never-relieved A/P in 2100. Guards: exact notes match, bill not already
    // linked to another expense, and the earliest matching expense wins.
    await pool.query(`
      UPDATE bk_expenses e SET bill_id = b.id
      FROM bk_bills b
      WHERE e.bill_id IS NULL
        AND e.notes = 'Auto-created from bill #' || b.id
        AND NOT EXISTS (SELECT 1 FROM bk_expenses e2 WHERE e2.bill_id = b.id)
        AND e.id = (SELECT MIN(e3.id) FROM bk_expenses e3
                    WHERE e3.bill_id IS NULL AND e3.notes = 'Auto-created from bill #' || b.id)
    `);

    // CREATE OR REPLACE VIEW only permits appending columns; if a previously
    // deployed version of either view had a different column list/types the
    // replace errors out. Views are derived state — a DROP loses nothing —
    // so on that specific failure drop both and recreate atomically instead
    // of leaving every /reports, /recon and export endpoint 500ing until a
    // manual DROP.
    try {
      await pool.query(ACCRUAL_VIEW_SQL);
      await pool.query(CASH_VIEW_SQL);
    } catch (e) {
      if (/cannot change|cannot drop columns|change name of view column/i.test(e.message)) {
        console.warn('[bk_reports] view shape changed — dropping and recreating journal views:', e.message);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('DROP VIEW IF EXISTS bk_journal_accrual');
          await client.query('DROP VIEW IF EXISTS bk_journal_cash');
          await client.query(ACCRUAL_VIEW_SQL);
          await client.query(CASH_VIEW_SQL);
          await client.query('COMMIT');
        } catch (e2) {
          await client.query('ROLLBACK').catch(() => {});
          throw e2;
        } finally { client.release(); }
      } else { throw e; }
    }
    console.log('[bk_reports] journal views + reconciliation tables ready');
  } catch (e) {
    // Boot-order races (expenses/bills DDL) and long-running db.js migrations
    // can outlast any fixed retry budget; giving up permanently would 500
    // every /reports, /recon, /journal and export endpoint for the life of
    // the process. Retry forever with capped backoff instead.
    const delay = Math.min(3000 + attempt * 3000, 30000);
    console.error(`[bk_reports] init attempt ${attempt + 1} failed (retrying in ${delay / 1000}s): ${e.message}`);
    setTimeout(() => initReportingDb(attempt + 1).catch(() => {}), delay);
  }
}
initReportingDb().catch(e => console.error('[bk_reports] init error:', e.message));

// ─── CHART OF ACCOUNTS ───────────────────────────────────────────────────────

async function loadAccounts() {
  const { rows } = await pool.query(`
    SELECT (5000 + id)::text AS code, name
    FROM bk_expense_categories WHERE parent_id IS NULL
    ORDER BY sort_order, name
  `);
  return [
    ...STATIC_ACCOUNTS,
    { code: '5000', name: 'Uncategorized Expense', type: 'expense' },
    ...rows.map(r => ({ code: r.code, name: r.name, type: 'expense' })),
  ];
}

bkReportsRouter.get('/reports/accounts', async (req, res) => {
  try {
    res.json({ accounts: await loadAccounts() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── TRIAL BALANCE ───────────────────────────────────────────────────────────

bkReportsRouter.get('/reports/trial-balance', async (req, res) => {
  const basis = basisOf(req);
  const as_of = dateOr(req.query.as_of, today());
  try {
    const { rows } = await pool.query(`
      WITH t AS (
        SELECT account_code, account_name, ROUND(SUM(debit) - SUM(credit), 2) AS net
        FROM ${viewFor(basis)}
        WHERE entry_date <= $1
        GROUP BY account_code, account_name
      )
      SELECT account_code AS code, account_name AS name,
        CASE WHEN net > 0 THEN net  ELSE 0 END AS debit,
        CASE WHEN net < 0 THEN -net ELSE 0 END AS credit
      FROM t WHERE net <> 0
      ORDER BY account_code
    `, [as_of]);
    const out = rows.map(r => ({ code: r.code, name: r.name, debit: parseFloat(r.debit), credit: parseFloat(r.credit) }));
    const totals = {
      debit: round2(out.reduce((s, r) => s + r.debit, 0)),
      credit: round2(out.reduce((s, r) => s + r.credit, 0)),
    };
    res.json({ as_of, basis, rows: out, totals, balanced: Math.abs(totals.debit - totals.credit) < 0.005 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── BALANCE SHEET ───────────────────────────────────────────────────────────

bkReportsRouter.get('/reports/balance-sheet', async (req, res) => {
  const basis = basisOf(req);
  const as_of = dateOr(req.query.as_of, today());
  try {
    const [{ rows: nets }, { rows: reRows }] = await Promise.all([
      pool.query(`
        SELECT account_code, account_name, ROUND(SUM(debit) - SUM(credit), 2) AS net
        FROM ${viewFor(basis)}
        WHERE entry_date <= $1
        GROUP BY account_code, account_name
        ORDER BY account_code
      `, [as_of]),
      // Equity earnings, split at the fiscal-year (Jan 1) boundary the way
      // QBO presents it: prior years accumulate as Retained Earnings, the
      // current year shows as Net Income. account_code::int >= 4000 catches
      // income AND all expense codes (including 6xxx+ from category ids
      // >= 1000, which a LIKE '5%' filter would silently drop).
      pool.query(`
        SELECT
          ROUND(COALESCE(SUM(CASE WHEN entry_date <  $2::date THEN credit - debit END), 0), 2) AS re,
          ROUND(COALESCE(SUM(CASE WHEN entry_date >= $2::date THEN credit - debit END), 0), 2) AS ni
        FROM ${viewFor(basis)}
        WHERE entry_date <= $1 AND account_code::int >= 4000
      `, [as_of, `${as_of.slice(0, 4)}-01-01`]),
    ]);
    const netMap = new Map(nets.map(r => [r.account_code, { name: r.account_name, net: parseFloat(r.net) }]));

    const bsAccount = (code, fallbackName, sign) => {
      const hit = netMap.get(code);
      return { code, name: hit?.name || fallbackName, amount: round2((hit?.net || 0) * sign) };
    };
    const assets = [
      bsAccount('1000', 'Trust Bank Account', 1),
      bsAccount('1010', 'Operating Bank Account', 1),
      bsAccount('1100', 'Accounts Receivable', 1),
      bsAccount('1110', 'Commission Receivable', 1),
    ];
    const liabilities = [
      bsAccount('2000', 'Carrier Premium Payable', -1),
      bsAccount('2100', 'Accounts Payable - Bills', -1),
      bsAccount('2200', 'Customer Refunds Payable', -1),
    ];
    const retained = parseFloat(reRows[0].re);
    const netIncome = parseFloat(reRows[0].ni);
    const equity = [
      bsAccount('3000', 'Owner Equity', -1),
      { code: '3900', name: 'Retained Earnings', amount: retained },
      { code: '3950', name: 'Net Income', amount: netIncome },
    ];
    const totalAssets = round2(assets.reduce((s, a) => s + a.amount, 0));
    const totalLE = round2(liabilities.reduce((s, a) => s + a.amount, 0) + equity.reduce((s, a) => s + a.amount, 0));
    res.json({
      as_of, basis, assets, liabilities, equity,
      totals: { assets: totalAssets, liabilities_and_equity: totalLE },
      balanced: Math.abs(totalAssets - totalLE) < 0.005,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GENERAL LEDGER ──────────────────────────────────────────────────────────

bkReportsRouter.get('/reports/general-ledger', async (req, res) => {
  const basis = basisOf(req);
  const account = String(req.query.account || '');
  // 4-6 digits: dynamic expense codes exceed 5999 once category ids reach 1000.
  if (!/^\d{4,6}$/.test(account)) return res.status(400).json({ error: 'account (numeric code) required' });
  const from = dateOr(req.query.from, '1900-01-01');
  const to = dateOr(req.query.to, today());
  const sign = signOfCode(account);
  try {
    const [{ rows: openRows }, { rows: lines }] = await Promise.all([
      pool.query(`
        SELECT ROUND(COALESCE(SUM(debit - credit), 0) * $4::int, 2) AS ob
        FROM ${viewFor(basis)}
        WHERE account_code = $1 AND entry_date < $2 AND entry_date <= $3
      `, [account, from, to, sign]),
      pool.query(`
        WITH l AS (
          SELECT entry_date, source_table, source_id, line_no, description, debit, credit
          FROM ${viewFor(basis)}
          WHERE account_code = $1 AND entry_date <= $3
        ),
        o AS (
          SELECT COALESCE(SUM(debit - credit), 0) AS ob FROM l WHERE entry_date < $2
        )
        SELECT to_char(l.entry_date, 'YYYY-MM-DD') AS date,
               l.source_table || ':' || l.source_id AS source,
               l.description, l.debit, l.credit,
               ROUND(((SELECT ob FROM o) + SUM(l.debit - l.credit) OVER (
                 ORDER BY l.entry_date, l.source_table, l.source_id, l.line_no
                 ROWS UNBOUNDED PRECEDING)) * $4::int, 2) AS balance
        FROM l
        WHERE l.entry_date >= $2
        ORDER BY l.entry_date, l.source_table, l.source_id, l.line_no
      `, [account, from, to, sign]),
    ]);
    const opening = parseFloat(openRows[0].ob);
    const outLines = lines.map(r => ({
      date: r.date, source: r.source, description: r.description,
      debit: parseFloat(r.debit), credit: parseFloat(r.credit), balance: parseFloat(r.balance),
    }));
    res.json({
      account, basis, from, to,
      opening_balance: opening,
      lines: outLines,
      closing_balance: outLines.length ? outLines[outLines.length - 1].balance : opening,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── A/R AGING ───────────────────────────────────────────────────────────────

// Unpaid bond balance per insured (premium − collected payments; bonds open
// AS OF the report date — issued/expired, plus bonds cancelled only after
// as_of) bucketed by days past the due date — the bond's optional
// due_date, falling back to effective_date + 30 (net-30). "current" = not yet
// due; "1-30" = 1-30 days past due; etc. Buckets are disjoint and sum to the
// total, which reconciles with the accrual balance-sheet 1100 figure as of
// today: cancelled bonds net to exactly zero in 1100 — the cancellation
// mirror reverses the uncollected premium and the bk_bonds_cancel_refund
// reclass moves any COLLECTED cash from 1100 into 2200 Customer Refunds
// Payable — and DIRECT-BILL bonds are excluded here exactly as they are from
// the 1100 issuance branch (their insureds owe the carrier, not us).
bkReportsRouter.get('/reports/ar-aging', async (req, res) => {
  const as_of = dateOr(req.query.as_of, today());
  try {
    const { rows } = await pool.query(`
      WITH pays AS (
        SELECT bond_id, COALESCE(SUM(amount), 0) AS collected
        FROM bk_bond_payments
        WHERE status = 'collected'
          AND COALESCE(collected_at::date, payment_date, created_at::date) <= $1
        GROUP BY bond_id
      ),
      open_bonds AS (
        SELECT b.insured_name,
               ROUND(b.premium - COALESCE(p.collected, 0), 2) AS balance,
               ($1::date - COALESCE(b.due_date, b.effective_date + 30)) AS days_past_due
        FROM bk_bonds b
        JOIN bk_carriers c ON c.id = b.carrier_id
        LEFT JOIN pays p ON p.bond_id = b.id
        -- A bond cancelled AFTER as_of was still open ON as_of: its 1100
        -- reversal is dated cancelled_at (updated_at fallback), so it still
        -- sits in the 1100 balance as of that date and must appear here for
        -- historical aging to tie to 1100. Bonds cancelled on/before as_of
        -- stay excluded (their 1100 nets to zero via reversal + refund
        -- reclass by then).
        WHERE (b.status IN ('issued','expired')
               OR (b.status = 'cancelled'
                   AND COALESCE(b.cancelled_at, b.updated_at::date) > $1))
          AND b.effective_date <= $1
          AND NOT (b.source = 'scraper' AND c.direct_bill)
      )
      SELECT insured_name,
        ROUND(SUM(CASE WHEN days_past_due <= 0                THEN balance ELSE 0 END), 2) AS current,
        ROUND(SUM(CASE WHEN days_past_due BETWEEN 1  AND 30   THEN balance ELSE 0 END), 2) AS days_1_30,
        ROUND(SUM(CASE WHEN days_past_due BETWEEN 31 AND 60   THEN balance ELSE 0 END), 2) AS days_31_60,
        ROUND(SUM(CASE WHEN days_past_due BETWEEN 61 AND 90   THEN balance ELSE 0 END), 2) AS days_61_90,
        ROUND(SUM(CASE WHEN days_past_due > 90                THEN balance ELSE 0 END), 2) AS over_90,
        ROUND(SUM(balance), 2) AS total
      FROM open_bonds
      WHERE balance <> 0
      GROUP BY insured_name
      ORDER BY total DESC, insured_name
    `, [as_of]);
    const out = rows.map(r => ({
      insured_name: r.insured_name,
      current: parseFloat(r.current),
      days_1_30: parseFloat(r.days_1_30),
      days_31_60: parseFloat(r.days_31_60),
      days_61_90: parseFloat(r.days_61_90),
      over_90: parseFloat(r.over_90),
      total: parseFloat(r.total),
    }));
    const totals = {
      current: round2(out.reduce((s, r) => s + r.current, 0)),
      days_1_30: round2(out.reduce((s, r) => s + r.days_1_30, 0)),
      days_31_60: round2(out.reduce((s, r) => s + r.days_31_60, 0)),
      days_61_90: round2(out.reduce((s, r) => s + r.days_61_90, 0)),
      over_90: round2(out.reduce((s, r) => s + r.over_90, 0)),
      total: round2(out.reduce((s, r) => s + r.total, 0)),
    };
    res.json({ as_of, rows: out, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── P&L (basis-toggling; legacy /pl untouched) ──────────────────────────────

bkReportsRouter.get('/reports/pnl', async (req, res) => {
  const basis = basisOf(req);
  const from = dateOr(req.query.from, '1900-01-01');
  const to = dateOr(req.query.to, today());
  try {
    // Numeric classification (NOT LIKE '5%'): expense codes are 5000+category
    // id and grow past 5999 once ids reach 1000.
    const { rows } = await pool.query(`
      SELECT account_code AS code, account_name AS name,
        ROUND(SUM(CASE WHEN account_code::int BETWEEN 4000 AND 4999 THEN credit - debit ELSE debit - credit END), 2) AS amount
      FROM ${viewFor(basis)}
      WHERE entry_date BETWEEN $1 AND $2
        AND account_code::int >= 4000
      GROUP BY account_code, account_name
      ORDER BY account_code
    `, [from, to]);
    const isIncome = c => { const n = parseInt(c, 10); return n >= 4000 && n <= 4999; };
    const revenue = rows.filter(r => isIncome(r.code)).map(r => ({ code: r.code, name: r.name, amount: parseFloat(r.amount) }));
    const expenses = rows.filter(r => !isIncome(r.code)).map(r => ({ code: r.code, name: r.name, amount: parseFloat(r.amount) }));
    const total_revenue = round2(revenue.reduce((s, r) => s + r.amount, 0));
    const total_expenses = round2(expenses.reduce((s, r) => s + r.amount, 0));
    res.json({
      from, to, basis,
      revenue, total_revenue,
      expenses, total_expenses,
      net_income: round2(total_revenue - total_expenses),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

const JOURNAL_PREFIX = {
  bk_bonds: 'BOND',
  bk_bonds_cancel: 'BONDX',
  bk_bonds_cancel_refund: 'BONDRF',
  bk_bond_payments: 'PAY',
  bk_carrier_remittances: 'REMIT',
  bk_expenses: 'EXP',
  bk_bills: 'BILL',
  bk_trust_account: 'SWEEP',
  bk_commission_ledger: 'DBCOMM',
  bk_manual_journal: 'ADJ',
};

async function journalRows(basis, from, to) {
  // Zero-amount lines (e.g. a zero-commission bond's 4000 leg) are dropped
  // centrally here: QBO's journal importer rejects 0.00 lines and they carry
  // no information. Removing a 0/0 line never unbalances an entry. Every
  // journal export (QBO CSV + IIF) flows through this function.
  const { rows } = await pool.query(`
    SELECT to_char(entry_date, 'YYYY-MM-DD') AS iso_date,
           to_char(entry_date, 'MM/DD/YYYY') AS us_date,
           source_table, source_id, line_no, account_code, account_name,
           debit, credit, description
    FROM ${viewFor(basis)}
    WHERE entry_date BETWEEN $1 AND $2
      AND NOT (debit = 0 AND credit = 0)
    ORDER BY entry_date, source_table, source_id, line_no
  `, [from, to]);
  return rows;
}

// Quote-only cell (no formula-injection prefix): AccountName must match the
// QBO chart of accounts VERBATIM or the import silently drops the line — and
// the values come from our own account list / category names, not untrusted
// spreadsheet payloads.
const nameCell = v => {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// QuickBooks Online journal-import CSV: one journal per source entry.
// NOTE: every AccountName must already exist in the QBO chart of accounts —
// import /export/qbo-accounts.csv (below) first.
bkReportsRouter.get('/export/qbo-journal.csv', async (req, res) => {
  const basis = basisOf(req);
  const from = dateOr(req.query.from, '1900-01-01');
  const to = dateOr(req.query.to, today());
  try {
    const rows = await journalRows(basis, from, to);
    const lines = [
      ['JournalNo', 'JournalDate', 'Memo', 'AccountName', 'Debits', 'Credits'].join(','),
      ...rows.map(r => [
        csvCell(`${JOURNAL_PREFIX[r.source_table] || 'JRN'}-${r.source_id}`),
        csvCell(r.us_date),
        csvCell(r.description),
        nameCell(r.account_name),
        parseFloat(r.debit) ? parseFloat(r.debit).toFixed(2) : '',
        parseFloat(r.credit) ? parseFloat(r.credit).toFixed(2) : '',
      ].join(',')),
    ];
    // QBO's journal importer caps files around 1,000 rows. Surface the row
    // count (filename + header) and an explicit warning header so a
    // full-history export doesn't silently exceed the importer's limit.
    res.setHeader('X-Journal-Rows', String(rows.length));
    if (rows.length > 1000) {
      res.setHeader('X-Journal-Warning', 'QBO journal import accepts roughly 1,000 rows per file - narrow the date range and export in period-sized chunks');
    }
    res.setHeader('Content-Disposition', `attachment; filename="qbo_journal_${basis}_${from}_${to}_${rows.length}rows.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(lines.join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// QBO chart-of-accounts import CSV (Name, Type, Detail Type): import/create
// these BEFORE importing the journal CSV so every AccountName resolves.
// IMPORTANT: 1100/2100 deliberately map to Other Current Asset/Liability, NOT
// to QBO's "Accounts receivable (A/R)" / "Accounts payable (A/P)" types —
// QBO's journal importer REQUIRES a customer/vendor Name on every line that
// posts to an A/R- or A/P-typed account, and our journal CSV carries no Name
// column, so A/R- and A/P-typed mappings would make nearly every BOND-, PAY-
// and BILL- journal fail to import.
const QBO_ACCT_MAP = {
  '1000': ['Bank', 'Checking'],
  '1010': ['Bank', 'Checking'],
  '1100': ['Other Current Assets', 'Other Current Assets'],
  '1110': ['Other Current Assets', 'Other Current Assets'],
  '2000': ['Other Current Liabilities', 'Other Current Liabilities'],
  '2100': ['Other Current Liabilities', 'Other Current Liabilities'],
  '2200': ['Other Current Liabilities', 'Other Current Liabilities'],
  '3000': ['Equity', "Owner's Equity"],
  '4000': ['Income', 'Service/Fee Income'],
  '4900': ['Income', 'Other Miscellaneous Income'],
};
bkReportsRouter.get('/export/qbo-accounts.csv', async (req, res) => {
  try {
    const accounts = await loadAccounts();
    const lines = [
      ['Name', 'Type', 'Detail Type'].join(','),
      ...accounts.map(a => {
        const [type, detail] = QBO_ACCT_MAP[a.code] ||
          (a.type === 'expense' ? ['Expenses', 'Other Miscellaneous Service Cost'] : ['Other Current Assets', 'Other Current Assets']);
        return [nameCell(a.name), nameCell(type), nameCell(detail)].join(',');
      }),
    ];
    res.setHeader('Content-Disposition', 'attachment; filename="qbo_accounts.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(lines.join('\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// IIF GENERAL JOURNAL export (QuickBooks Desktop). Tab-delimited; debit
// positive / credit negative; first split on TRNS, remainder on SPL.
const iifCell = v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');

bkReportsRouter.get('/export/iif', async (req, res) => {
  const basis = basisOf(req);
  const from = dateOr(req.query.from, '1900-01-01');
  const to = dateOr(req.query.to, today());
  try {
    const rows = await journalRows(basis, from, to);
    const entries = new Map();
    for (const r of rows) {
      const key = `${r.source_table}:${r.source_id}`;
      if (!entries.has(key)) entries.set(key, []);
      entries.get(key).push(r);
    }
    const out = [
      '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO',
      '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO',
      '!ENDTRNS',
    ];
    for (const lines of entries.values()) {
      const docnum = `${JOURNAL_PREFIX[lines[0].source_table] || 'JRN'}-${lines[0].source_id}`;
      lines.forEach((l, i) => {
        const amt = (parseFloat(l.debit) - parseFloat(l.credit)).toFixed(2);
        out.push([
          i === 0 ? 'TRNS' : 'SPL', '', 'GENERAL JOURNAL', l.us_date,
          iifCell(l.account_name), amt, docnum, iifCell(l.description),
        ].join('\t'));
      });
      out.push('ENDTRNS');
    }
    res.setHeader('Content-Disposition', `attachment; filename="journal_${basis}_${from}_${to}.iif"`);
    res.setHeader('Content-Type', 'text/plain');
    res.send(out.join('\r\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CLOSE THE BOOKS ─────────────────────────────────────────────────────────
//
// Effective closing date = MAX(closing_date) over bk_closed_periods. Mutation
// endpoints in bookkeeping.js / bills.js / expenses.js call getClosingDate and
// reject (409) any money-affecting change dated on or before it unless the
// request carries x-allow-closed-period: true (which is then audited as
// action=closed-period-override).

// Shared helper: accepts a pool OR a checked-out client (anything with
// .query). Tolerant of the table not existing yet (init still retrying):
// probes to_regclass first instead of catching 42P01, so it can be called
// inside an open transaction without poisoning it.
export async function getClosingDate(db) {
  const q = db && typeof db.query === 'function' ? db : pool;
  const { rows: reg } = await q.query(`SELECT to_regclass('bk_closed_periods') IS NOT NULL AS ok`);
  if (!reg[0]?.ok) return null;
  const { rows } = await q.query(`SELECT to_char(MAX(closing_date), 'YYYY-MM-DD') AS d FROM bk_closed_periods`);
  return rows[0]?.d || null;
}

bkReportsRouter.get('/close-the-books', async (req, res) => {
  try {
    const closing_date = await getClosingDate(pool);
    if (closing_date === null) {
      // Table may not exist yet (init retrying) — same shape either way.
      const { rows: reg } = await pool.query(`SELECT to_regclass('bk_closed_periods') IS NOT NULL AS ok`);
      if (!reg[0]?.ok) return res.json({ closing_date: null, history: [] });
    }
    const { rows } = await pool.query(`
      SELECT id, to_char(closing_date, 'YYYY-MM-DD') AS closing_date, closed_by, note, created_at
      FROM bk_closed_periods
      ORDER BY closing_date DESC, id DESC
    `);
    res.json({ closing_date, history: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bkReportsRouter.post('/close-the-books', async (req, res) => {
  const { closing_date, note } = req.body || {};
  if (!dateOr(closing_date, null)) return res.status(400).json({ error: 'closing_date (YYYY-MM-DD) required' });
  // ISO strings compare lexicographically == chronologically.
  if (closing_date > today()) return res.status(400).json({ error: 'closing_date cannot be in the future' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO bk_closed_periods (closing_date, closed_by, note)
      VALUES ($1, $2, $3)
      RETURNING id, to_char(closing_date, 'YYYY-MM-DD') AS closing_date, closed_by, note, created_at
    `, [closing_date, actorOf(req), (note || '').slice(0, 500) || null]);
    await logAudit(null, {
      action: 'period.close', entity: 'closed_period', entity_id: rows[0].id, actor: actorOf(req),
      detail: `Books closed through ${closing_date}${note ? ' — ' + String(note).slice(0, 200) : ''}`,
    });
    res.json({ closing_date: await getClosingDate(pool), entry: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reopen: delete one closing row. The effective closing date falls back to
// the next-latest remaining row (or null). Audited.
bkReportsRouter.delete('/close-the-books/:id', async (req, res) => {
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'Numeric id required' });
  try {
    const { rows } = await pool.query(`
      DELETE FROM bk_closed_periods WHERE id = $1
      RETURNING id, to_char(closing_date, 'YYYY-MM-DD') AS closing_date, closed_by, note
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await logAudit(null, {
      action: 'period.reopen', entity: 'closed_period', entity_id: rows[0].id, actor: actorOf(req),
      detail: `Reopened books: removed closing through ${rows[0].closing_date} (originally closed by ${rows[0].closed_by || 'unknown'})`,
    });
    res.json({ ok: true, closing_date: await getClosingDate(pool) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── MANUAL JOURNAL ENTRIES ──────────────────────────────────────────────────
//
// Bank fees, interest, owner draws, opening balances, reconciliation
// adjustments — events with no source row in the business tables. Entries are
// validated balanced (Σ debits = Σ credits) before insert and flow into both
// views via the MANUAL_SQL branch (respecting the entry's basis).

bkReportsRouter.get('/journal', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT j.*, COALESCE(json_agg(json_build_object(
        'line_no', l.line_no, 'account_code', l.account_code, 'account_name', l.account_name,
        'debit', l.debit, 'credit', l.credit, 'description', l.description
      ) ORDER BY l.line_no) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
      FROM bk_manual_journal j
      LEFT JOIN bk_manual_journal_lines l ON l.journal_id = j.id
      GROUP BY j.id ORDER BY j.entry_date DESC, j.id DESC LIMIT 200
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bkReportsRouter.post('/journal', async (req, res) => {
  const { entry_date, memo, basis, lines } = req.body || {};
  if (!dateOr(entry_date, null)) return res.status(400).json({ error: 'entry_date (YYYY-MM-DD) required' });
  const jbasis = ['both', 'accrual', 'cash'].includes(basis) ? basis : 'both';
  if (!Array.isArray(lines) || lines.length < 2) return res.status(400).json({ error: 'at least 2 lines required' });
  try {
    const accounts = await loadAccounts();
    const byCode = new Map(accounts.map(a => [a.code, a]));
    let dr = 0, cr = 0;
    const clean = [];
    for (const l of lines) {
      const acct = byCode.get(String(l.account_code || ''));
      if (!acct) return res.status(400).json({ error: `Unknown account_code: ${l.account_code}` });
      const debit = round2(Number(l.debit) || 0);
      const credit = round2(Number(l.credit) || 0);
      if (debit < 0 || credit < 0) return res.status(400).json({ error: 'debit/credit must be >= 0' });
      if (debit > 0 && credit > 0) return res.status(400).json({ error: 'a line cannot have both debit and credit' });
      if (debit === 0 && credit === 0) return res.status(400).json({ error: 'a line must have a debit or a credit' });
      dr += debit; cr += credit;
      clean.push({ code: acct.code, name: acct.name, debit, credit, description: (l.description || '').slice(0, 500) });
    }
    if (Math.abs(round2(dr) - round2(cr)) >= 0.005) {
      return res.status(400).json({ error: `Entry does not balance (debits ${round2(dr).toFixed(2)} vs credits ${round2(cr).toFixed(2)})` });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: jRows } = await client.query(`
        INSERT INTO bk_manual_journal (entry_date, memo, basis) VALUES ($1, $2, $3) RETURNING *
      `, [entry_date, memo || null, jbasis]);
      for (let i = 0; i < clean.length; i++) {
        const l = clean[i];
        await client.query(`
          INSERT INTO bk_manual_journal_lines (journal_id, line_no, account_code, account_name, debit, credit, description)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [jRows[0].id, i + 1, l.code, l.name, l.debit, l.credit, l.description || null]);
      }
      await logAudit(client, {
        action: 'journal.create', entity: 'manual_journal', entity_id: jRows[0].id, actor: actorOf(req),
        amount: round2(dr), detail: `Manual journal ${entry_date} (${jbasis}) — ${memo || clean.map(l => l.name).join(' / ')}`,
      });
      await client.query('COMMIT');
      res.json({ ...jRows[0], lines: clean });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bkReportsRouter.delete('/journal/:id', async (req, res) => {
  // Strict numeric id BEFORE any query: the value is concatenated into LIKE
  // patterns below, so an id containing '%' or '_' would wildcard the
  // locked-check and the un-clear DELETE across every manual-journal line.
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'Numeric id required' });
  const id = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    // One transaction: if the final DELETE fails, the un-clearing of
    // in-progress reconciliation lines must roll back with it.
    await client.query('BEGIN');
    // A line cleared in a COMPLETED reconciliation is part of a locked
    // statement — deleting the entry would silently break that recon's math.
    const { rows: locked } = await client.query(`
      SELECT 1 FROM bk_cleared_lines cl
      JOIN bk_reconciliations r ON r.id = cl.recon_id
      WHERE r.status = 'completed' AND cl.line_key LIKE 'bk_manual_journal:' || $1 || ':%'
      LIMIT 1
    `, [id]);
    if (locked.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Entry has lines cleared in a completed reconciliation — reopen it first' });
    }
    // Un-clear it from any in-progress reconciliations, then delete.
    await client.query(`DELETE FROM bk_cleared_lines WHERE line_key LIKE 'bk_manual_journal:' || $1 || ':%'`, [id]);
    const { rows } = await client.query(`DELETE FROM bk_manual_journal WHERE id = $1 RETURNING id, entry_date, memo`, [id]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await logAudit(client, {
      action: 'journal.delete', entity: 'manual_journal', entity_id: id, actor: actorOf(req),
      detail: `Deleted manual journal #${id} (${String(rows[0].entry_date).slice(0, 10)} — ${rows[0].memo || 'no memo'})`,
    });
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ─── BANK RECONCILIATION (statement vs. books) ───────────────────────────────
//
// Reconciles a bank account's journal lines against a real statement.
// line_key = source_table:source_id:line_no. A line cleared in a COMPLETED
// reconciliation is locked and cannot be toggled by any other reconciliation.
//
// Line source: the UNION of the accrual and cash views, deduped by line_key.
// For every DERIVED branch the 1000/1010 legs are identical on both bases
// (same key, same amount), so deduping is lossless there — but MANUAL journal
// entries with basis 'accrual' or 'cash' exist in only ONE view, and reading
// a single view would silently omit the other basis's bank lines, making the
// statement impossible to reconcile. The union covers both; when a key exists
// in both views (basis 'both' + all derived branches) the amounts agree by
// construction, so DISTINCT ON may pick either row.

const LINE_KEY = `v.source_table || ':' || v.source_id || ':' || v.line_no`;

// Deduped bank-line source. acctParam/dateParam are '$n' placeholder strings
// (never user input); filters are pushed into both union arms so the dedupe
// runs only over the requested account/period.
const BANK_LINES = (acctParam, dateParam) => `(
  SELECT DISTINCT ON (source_table, source_id, line_no)
         entry_date, source_table, source_id, line_no,
         account_code, account_name, debit, credit, description
  FROM (
    SELECT entry_date, source_table, source_id, line_no,
           account_code, account_name, debit, credit, description
    FROM bk_journal_accrual
    WHERE account_code = ${acctParam} AND entry_date <= ${dateParam}
    UNION ALL
    SELECT entry_date, source_table, source_id, line_no,
           account_code, account_name, debit, credit, description
    FROM bk_journal_cash
    WHERE account_code = ${acctParam} AND entry_date <= ${dateParam}
  ) u
  ORDER BY source_table, source_id, line_no
)`;

async function reconTotals(recon) {
  const [{ rows: cleared }, { rows: prior }] = await Promise.all([
    pool.query(
      `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS t FROM bk_cleared_lines WHERE recon_id = $1`,
      [recon.id]
    ),
    // Beginning balance = cleared lines of completed reconciliations dated
    // STRICTLY BEFORE this statement (ties broken by id). Summing ALL other
    // completed recons regardless of statement_date would let a later-dated
    // statement's cleared lines inflate an earlier statement's beginning
    // balance when reconciliations are completed out of order.
    pool.query(`
      SELECT ROUND(COALESCE(SUM(cl.amount), 0), 2) AS t
      FROM bk_cleared_lines cl
      JOIN bk_reconciliations r ON r.id = cl.recon_id
      WHERE r.status = 'completed' AND r.id <> $1 AND cl.account_code = $2
        AND (r.statement_date < $3 OR (r.statement_date = $3 AND r.id < $1))
    `, [recon.id, recon.account_code, recon.statement_date]),
  ]);
  const cleared_total = parseFloat(cleared[0].t);
  const prior_reconciled_balance = parseFloat(prior[0].t);
  const difference = round2(parseFloat(recon.ending_balance) - (prior_reconciled_balance + cleared_total));
  return { cleared_total, prior_reconciled_balance, difference };
}

bkReportsRouter.post('/recon', async (req, res) => {
  const { account_code, statement_date, ending_balance } = req.body;
  if (!/^\d{4}$/.test(String(account_code || ''))) return res.status(400).json({ error: 'account_code (4-digit code) required' });
  if (!dateOr(statement_date, null)) return res.status(400).json({ error: 'statement_date (YYYY-MM-DD) required' });
  if (!Number.isFinite(Number(ending_balance))) return res.status(400).json({ error: 'ending_balance (number) required' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO bk_reconciliations (account_code, statement_date, ending_balance)
      VALUES ($1, $2, $3) RETURNING *
    `, [String(account_code), statement_date, Number(ending_balance).toFixed(2)]);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bkReportsRouter.get('/recon', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*,
        (SELECT COUNT(*) FROM bk_cleared_lines cl WHERE cl.recon_id = r.id) AS cleared_count
      FROM bk_reconciliations r
      ORDER BY r.created_at DESC, r.id DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bkReportsRouter.get('/recon/:id', async (req, res) => {
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'Numeric id required' });
  try {
    const { rows: rRows } = await pool.query(`SELECT * FROM bk_reconciliations WHERE id = $1`, [req.params.id]);
    if (!rRows.length) return res.status(404).json({ error: 'Not found' });
    const recon = rRows[0];

    const { rows: lines } = await pool.query(`
      SELECT to_char(v.entry_date, 'YYYY-MM-DD') AS date,
             ${LINE_KEY} AS line_key,
             v.source_table, v.source_id, v.line_no,
             v.account_code, v.account_name, v.debit, v.credit, v.description,
             EXISTS (
               SELECT 1 FROM bk_cleared_lines cl
               WHERE cl.recon_id = $2 AND cl.line_key = ${LINE_KEY}
             ) AS cleared_here,
             EXISTS (
               SELECT 1 FROM bk_cleared_lines cl
               JOIN bk_reconciliations r2 ON r2.id = cl.recon_id
               WHERE r2.status = 'completed' AND r2.id <> $2 AND cl.line_key = ${LINE_KEY}
             ) AS cleared_completed
      FROM ${BANK_LINES('$1', '$3')} v
      ORDER BY v.entry_date, v.source_table, v.source_id, v.line_no
    `, [recon.account_code, recon.id, recon.statement_date]);

    const totals = await reconTotals(recon);
    res.json({
      recon,
      lines: lines.map(l => ({
        date: l.date, line_key: l.line_key,
        source: `${l.source_table}:${l.source_id}`,
        account_code: l.account_code, account_name: l.account_name,
        debit: parseFloat(l.debit), credit: parseFloat(l.credit),
        amount: round2(parseFloat(l.debit) - parseFloat(l.credit)),
        description: l.description,
        cleared: l.cleared_here || l.cleared_completed,
        locked: l.cleared_completed,
      })),
      ...totals,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bkReportsRouter.put('/recon/:id/toggle', async (req, res) => {
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'Numeric id required' });
  const { line_key } = req.body;
  if (!line_key || typeof line_key !== 'string') return res.status(400).json({ error: 'line_key required' });
  try {
    const { rows: rRows } = await pool.query(`SELECT * FROM bk_reconciliations WHERE id = $1`, [req.params.id]);
    if (!rRows.length) return res.status(404).json({ error: 'Not found' });
    const recon = rRows[0];
    if (recon.status !== 'in_progress') return res.status(409).json({ error: 'Reconciliation is not in progress' });

    // A line locked by ANY completed reconciliation cannot be toggled here.
    const { rows: locked } = await pool.query(`
      SELECT 1 FROM bk_cleared_lines cl
      JOIN bk_reconciliations r ON r.id = cl.recon_id
      WHERE r.status = 'completed' AND cl.line_key = $1
      LIMIT 1
    `, [line_key]);
    if (locked.length) return res.status(409).json({ error: 'Line already cleared in a completed reconciliation' });

    const { rowCount: removed } = await pool.query(
      `DELETE FROM bk_cleared_lines WHERE recon_id = $1 AND line_key = $2`,
      [recon.id, line_key]
    );
    if (removed) {
      const totals = await reconTotals(recon);
      return res.json({ ok: true, cleared: false, line_key, ...totals });
    }

    const { rows: vRows } = await pool.query(`
      SELECT ROUND(v.debit - v.credit, 2) AS amount
      FROM ${BANK_LINES('$2', '$3')} v
      WHERE ${LINE_KEY} = $1
    `, [line_key, recon.account_code, recon.statement_date]);
    if (!vRows.length) return res.status(404).json({ error: 'Line not found for this account/statement period' });

    await pool.query(`
      INSERT INTO bk_cleared_lines (recon_id, account_code, line_key, amount)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (recon_id, line_key) DO NOTHING
    `, [recon.id, recon.account_code, line_key, vRows[0].amount]);

    const totals = await reconTotals(recon);
    res.json({ ok: true, cleared: true, line_key, amount: parseFloat(vRows[0].amount), ...totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bkReportsRouter.put('/recon/:id/complete', async (req, res) => {
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'Numeric id required' });
  try {
    const { rows: rRows } = await pool.query(`SELECT * FROM bk_reconciliations WHERE id = $1`, [req.params.id]);
    if (!rRows.length) return res.status(404).json({ error: 'Not found' });
    const recon = rRows[0];
    if (recon.status !== 'in_progress') return res.status(409).json({ error: 'Reconciliation is not in progress' });

    const totals = await reconTotals(recon);
    if (Math.abs(totals.difference) >= 0.005) {
      return res.status(409).json({ error: `Difference must be exactly 0.00 (currently ${totals.difference.toFixed(2)})`, ...totals });
    }
    const { rows } = await pool.query(`
      UPDATE bk_reconciliations SET status = 'completed', completed_at = NOW()
      WHERE id = $1 AND status = 'in_progress' RETURNING *
    `, [recon.id]);
    if (!rows.length) return res.status(409).json({ error: 'Reconciliation is not in progress' });
    res.json({ ok: true, recon: rows[0], ...totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Undo Reconciliation (QBO parity): reopen a completed reconciliation so a
// typo'd ending balance isn't a permanent lock. Restricted to the MOST RECENT
// completed reconciliation per account — reopening an older one would pull
// the beginning balance out from under later completed statements.
bkReportsRouter.put('/recon/:id/reopen', async (req, res) => {
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'Numeric id required' });
  try {
    const { rows: rRows } = await pool.query(`SELECT * FROM bk_reconciliations WHERE id = $1`, [req.params.id]);
    if (!rRows.length) return res.status(404).json({ error: 'Not found' });
    const recon = rRows[0];
    if (recon.status !== 'completed') return res.status(409).json({ error: 'Only completed reconciliations can be reopened' });

    const { rows: newer } = await pool.query(`
      SELECT 1 FROM bk_reconciliations r
      WHERE r.account_code = $1 AND r.status = 'completed' AND r.id <> $2
        AND (r.statement_date > $3 OR (r.statement_date = $3 AND r.id > $2))
      LIMIT 1
    `, [recon.account_code, recon.id, recon.statement_date]);
    if (newer.length) return res.status(409).json({ error: 'A later completed reconciliation exists for this account — reopen that one first' });

    const { rows } = await pool.query(`
      UPDATE bk_reconciliations SET status = 'in_progress', completed_at = NULL
      WHERE id = $1 AND status = 'completed' RETURNING *
    `, [recon.id]);
    if (!rows.length) return res.status(409).json({ error: 'Reconciliation is not completed' });
    await logAudit(null, {
      action: 'recon.reopen', entity: 'reconciliation', entity_id: recon.id, actor: actorOf(req),
      amount: parseFloat(recon.ending_balance) || null,
      detail: `Reopened reconciliation #${recon.id} (${recon.account_code}, statement ${String(recon.statement_date).slice(0, 10)})`,
    });
    res.json({ ok: true, recon: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bkReportsRouter.delete('/recon/:id', async (req, res) => {
  if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'Numeric id required' });
  try {
    const { rows } = await pool.query(
      `DELETE FROM bk_reconciliations WHERE id = $1 AND status = 'in_progress' RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) {
      const { rows: chk } = await pool.query(`SELECT status FROM bk_reconciliations WHERE id = $1`, [req.params.id]);
      if (chk.length) return res.status(409).json({ error: 'Only in-progress reconciliations can be deleted' });
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
