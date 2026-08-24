import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';

export const tdlrRouter = Router();

/* ---------------------------------------------------------------- helpers */

// The legacy loader stored the literal 4-char string "NULL" in some text
// columns. NULLIF(col, 'NULL') cleans that at read time without touching
// stored data. It is a fixed string literal in the template, not user input.
//
// is_active / tdlr_sync_log are created by the sync workstream; every query
// that references them either falls back (42703 undefined_column) or is
// wrapped in try/catch so this API works before AND after that migration.

const isUndefinedColumn = (err) =>
  err?.code === '42703' || err?.cause?.code === '42703';

// SELECT column list shared by the list route and the CSV export.
// When withActive=false the is_active column does not exist yet, so every
// row is reported as active.
const selectCols = (withActive) => sql`
  id,
  NULLIF(license_type, 'NULL') AS license_type,
  license_number,
  NULLIF(license_subtype, 'NULL') AS license_subtype,
  NULLIF(business_name, 'NULL') AS business_name,
  NULLIF(business_county, 'NULL') AS business_county,
  NULLIF(business_address, 'NULL') AS business_address,
  NULLIF(business_city, 'NULL') AS business_city,
  NULLIF(business_state, 'NULL') AS business_state,
  NULLIF(business_zip, 'NULL') AS business_zip,
  NULLIF(business_phone, 'NULL') AS business_phone,
  expire_date,
  NULLIF(owner_name, 'NULL') AS owner_name,
  NULLIF(owner_phone, 'NULL') AS owner_phone,
  updated_at,
  ${withActive ? sql`COALESCE(is_active, true)` : sql`true`} AS is_active
`;

// WHERE-clause fragments shared by list, count, and export. All user input
// goes through sql template parameters.
function buildConds(q, withActive) {
  const {
    search = '', county = '', license_type = '',
    expiring = '', has_phone = '', include_inactive = '',
  } = q;

  const activeCond = (withActive && include_inactive !== 'true')
    ? sql`AND COALESCE(is_active, true) = true` : sql``;
  const searchCond = search
    ? sql`AND (business_name ILIKE ${'%' + search + '%'} OR owner_name ILIKE ${'%' + search + '%'} OR license_number ILIKE ${'%' + search + '%'})` : sql``;
  const countyCond = county ? sql`AND business_county ILIKE ${'%' + county + '%'}` : sql``;
  const typeCond = license_type ? sql`AND license_type ILIKE ${'%' + license_type + '%'}` : sql``;
  const phoneCond = has_phone === 'true'
    ? sql`AND NULLIF(NULLIF(business_phone, ''), 'NULL') IS NOT NULL` : sql``;
  const expCond = expiring === '30'      ? sql`AND expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`
                : expiring === '60'      ? sql`AND expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'`
                : expiring === '90'      ? sql`AND expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'`
                : expiring === '180'     ? sql`AND expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '180 days'`
                : expiring === 'expired' ? sql`AND expire_date < CURRENT_DATE`
                : sql``;

  return sql`${activeCond} ${searchCond} ${countyCond} ${typeCond} ${phoneCond} ${expCond}`;
}

const pad2 = (n) => String(n).padStart(2, '0');

function csvField(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // DATE columns arrive as local-midnight Date objects; use local parts so
    // the calendar date never shifts across timezones.
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// res.write with backpressure: wait for 'drain' when the kernel buffer fills.
// Also settles on 'close'/'error' — if the client disconnects while the
// buffer is full, 'drain' never fires and the await would otherwise hang
// forever (the caller's res.destroyed check then exits the loop).
function writeChunk(res, chunk) {
  return new Promise((resolve) => {
    if (res.write(chunk)) return resolve();
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      res.off('error', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
    res.once('error', done);
  });
}

/* ------------------------------------------------------------- GET /meta */
// Last sync info + data freshness. Tolerates tdlr_sync_log / is_active /
// updated_at not existing yet (the sync workstream creates them): every
// probe is independently caught and the field stays null.
tdlrRouter.get('/meta', async (req, res) => {
  const meta = {
    last_sync: null,        // latest tdlr_sync_log row (finished_at, status, counts, sync_age_days)
    last_updated_at: null,  // MAX(updated_at) over tdlr_licenses
    total_count: null,
    active_count: null,
    inactive_count: null,
    freshness_days: null,   // whole days since MAX(updated_at), computed in SQL
  };

  try {
    const r = await db.execute(sql`
      SELECT *, (CURRENT_DATE - finished_at::date) AS sync_age_days
      FROM tdlr_sync_log
      ORDER BY id DESC
      LIMIT 1
    `);
    if (r.rows.length) meta.last_sync = r.rows[0];
  } catch (err) {
    console.warn('TDLR meta: tdlr_sync_log unavailable:', err.message);
  }

  try {
    const r = await db.execute(sql`
      SELECT MAX(updated_at) AS last_updated_at,
             COUNT(*) AS total_count,
             COUNT(*) FILTER (WHERE COALESCE(is_active, true) = true)  AS active_count,
             COUNT(*) FILTER (WHERE COALESCE(is_active, true) = false) AS inactive_count,
             (CURRENT_DATE - MAX(updated_at)::date) AS freshness_days
      FROM tdlr_licenses
    `);
    Object.assign(meta, r.rows[0]);
  } catch (err) {
    if (!isUndefinedColumn(err)) {
      console.warn('TDLR meta: tdlr_licenses probe failed:', err.message);
    } else {
      try {
        const r = await db.execute(sql`
          SELECT MAX(updated_at) AS last_updated_at,
                 COUNT(*) AS total_count,
                 COUNT(*) AS active_count,
                 0 AS inactive_count,
                 (CURRENT_DATE - MAX(updated_at)::date) AS freshness_days
          FROM tdlr_licenses
        `);
        Object.assign(meta, r.rows[0]);
      } catch (err2) {
        console.warn('TDLR meta: tdlr_licenses fallback failed:', err2.message);
      }
    }
  }

  res.json(meta);
});

/* ------------------------------------------------------------ GET /stats */
tdlrRouter.get('/stats', async (req, res) => {
  const runStats = async (withActive) => {
    const activeCond = (withActive && req.query.include_inactive !== 'true')
      ? sql`AND COALESCE(is_active, true) = true` : sql``;
    return Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') as expiring_30,
          COUNT(*) FILTER (WHERE expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days') as expiring_60,
          COUNT(*) FILTER (WHERE expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days') as expiring_90,
          COUNT(*) FILTER (WHERE expire_date < CURRENT_DATE) as expired,
          COUNT(*) FILTER (WHERE NULLIF(NULLIF(business_phone, ''), 'NULL') IS NOT NULL) as with_phone
        FROM tdlr_licenses WHERE 1=1 ${activeCond}
      `),
      db.execute(sql`
        SELECT license_type, COUNT(*) as count FROM tdlr_licenses
        WHERE license_type IS NOT NULL AND license_type != '' AND license_type != 'NULL' ${activeCond}
        GROUP BY license_type ORDER BY count DESC LIMIT 12
      `),
      db.execute(sql`
        SELECT business_county, COUNT(*) as count FROM tdlr_licenses
        WHERE business_county IS NOT NULL AND business_county != '' AND business_county != 'NULL' ${activeCond}
        GROUP BY business_county ORDER BY count DESC LIMIT 10
      `),
    ]);
  };

  try {
    let totals, top_types, top_counties;
    try {
      [totals, top_types, top_counties] = await runStats(true);
    } catch (err) {
      if (!isUndefinedColumn(err)) throw err;
      [totals, top_types, top_counties] = await runStats(false);
    }

    // Sync freshness fields; null-tolerant while the sync workstream's
    // schema pieces do not exist yet.
    let last_synced = null;
    let last_updated_at = null;
    try {
      const r = await db.execute(sql`
        SELECT finished_at FROM tdlr_sync_log ORDER BY id DESC LIMIT 1
      `);
      if (r.rows.length) last_synced = r.rows[0].finished_at;
    } catch { /* table not created yet */ }
    try {
      const r = await db.execute(sql`SELECT MAX(updated_at) AS m FROM tdlr_licenses`);
      last_updated_at = r.rows[0]?.m ?? null;
    } catch { /* column not created yet */ }

    res.json({
      ...totals.rows[0],
      top_types: top_types.rows,
      top_counties: top_counties.rows,
      last_synced,
      last_updated_at,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ------------------------------------------------------- GET /export.csv */
// Full server-side CSV export honoring the same filters as the list route.
// Streams sequential keyset pages of 5000 rows (WHERE id > last-seen id) —
// never buffers the whole table, and unlike OFFSET paging it never skips
// rows when a concurrent sync sweep deactivates rows mid-export.
const EXPORT_COLS = [
  'id', 'license_number', 'license_type', 'license_subtype',
  'business_name', 'business_county', 'business_address', 'business_city',
  'business_state', 'business_zip', 'business_phone', 'expire_date',
  'owner_name', 'owner_phone', 'is_active',
];
const EXPORT_PAGE = 5000;

tdlrRouter.get('/export.csv', async (req, res) => {
  const fetchPage = (withActive, afterId) => db.execute(sql`
    SELECT ${selectCols(withActive)}
    FROM tdlr_licenses WHERE id > ${afterId} ${buildConds(req.query, withActive)}
    ORDER BY id ASC
    LIMIT ${EXPORT_PAGE}
  `);

  try {
    // Probe the first page before sending headers so schema fallback and
    // hard failures can still return a clean JSON error.
    let withActive = true;
    let page;
    try {
      page = await fetchPage(true, 0);
    } catch (err) {
      if (!isUndefinedColumn(err)) throw err;
      withActive = false;
      page = await fetchPage(false, 0);
    }
    let lastId = 0;

    const today = new Date();
    const stamp = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tdlr_licenses_${stamp}.csv"`);

    await writeChunk(res, EXPORT_COLS.join(',') + '\r\n');

    for (;;) {
      if (res.destroyed) return; // client went away — stop querying
      let buf = '';
      for (const row of page.rows) {
        buf += EXPORT_COLS.map((c) => csvField(row[c])).join(',') + '\r\n';
        lastId = row.id;
      }
      if (buf) await writeChunk(res, buf);
      if (page.rows.length < EXPORT_PAGE) break;
      page = await fetchPage(withActive, lastId);
    }
    res.end();
  } catch (err) {
    console.error('TDLR export error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.destroy(err); // truncate mid-stream rather than emit a corrupt "complete" file
  }
});

/* ------------------------------------------------------------- GET / list */
tdlrRouter.get('/', async (req, res) => {
  try {
    // Clamp pagination: NaN/0/negative/huge values must never reach SQL.
    const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (pageNum - 1) * lim;

    const fetchList = (withActive) => {
      const conds = buildConds(req.query, withActive);
      return Promise.all([
        db.execute(sql`
          SELECT ${selectCols(withActive)}
          FROM tdlr_licenses WHERE 1=1 ${conds}
          ORDER BY expire_date ASC NULLS LAST, id ASC
          LIMIT ${lim} OFFSET ${offset}
        `),
        db.execute(sql`
          SELECT COUNT(*) as count FROM tdlr_licenses WHERE 1=1 ${conds}
        `),
      ]);
    };

    let rows, cnt;
    try {
      [rows, cnt] = await fetchList(true);
    } catch (err) {
      if (!isUndefinedColumn(err)) throw err;
      [rows, cnt] = await fetchList(false); // is_active not migrated yet
    }

    res.json({
      data: rows.rows,
      total: parseInt(cnt.rows[0].count),
      page: pageNum,
      pages: Math.ceil(parseInt(cnt.rows[0].count) / lim),
    });
  } catch (err) {
    console.error('TDLR query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
