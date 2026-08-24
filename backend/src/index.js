import express from 'express';
import cors from 'cors';
import { contactsRouter } from './routes/contacts.js';
import { emailRouter } from './routes/email.js';
import { importRouter } from './routes/import.js';
import { campaignsRouter } from './routes/campaigns.js';
import { notariesRouter } from './routes/notaries.js';
import { unsubscribeRouter } from './routes/unsubscribe.js';
import { pipelineRouter } from './routes/pipeline.js';
import { dripRouter } from './routes/drip.js';
import { aiRouter } from './routes/ai.js';
import { authRouter, requireAuth } from './routes/auth.js';
import { trackingRouter } from './routes/tracking.js';
import { analyticsRouter } from './routes/analytics.js';
import { notaryCampaignsRouter } from './routes/notary-campaigns.js';
import { dealersRouter } from './routes/dealers.js';
import { contractorsRouter } from './routes/contractors.js';
import { tdlrRouter } from './routes/tdlr.js';
import { dealerCampaignsRouter } from './routes/dealer-campaigns.js';
import { leadsRouter } from './routes/leads.js';
import { filingsRouter } from './routes/filings.js';
import { costsRouter } from './routes/costs.js';
import { bookkeepingRouter } from './routes/bookkeeping.js';
import { expensesRouter } from './routes/expenses.js';
import { billsRouter, initBills } from './routes/bills.js';
import { bkAiRouter } from './routes/bk_ai.js';
import { bkReportsRouter } from './routes/bk_reports.js';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// -- Auth gate ---------------------------------------------------------------
// Until 2026-08-22 every /api route below was unauthenticated. The CRM was kept
// private only by nginx basic auth in front of it, so anything reaching port
// 4001 directly could read the whole lead database. The JWT machinery
// (requireAuth, /api/auth/login) already existed and was simply never applied.
// Applying it in ONE place means a newly added router cannot arrive unprotected.
//
// PUBLIC_PATHS must work with no session:
//   /api/auth/login  - you have no token yet
//   /api/tracking/open|click - drip open-pixel and click redirects, fetched by
//                      the recipient's mail client. Gating these silently kills
//                      email analytics; that already happened once, for 6 weeks.
//                      /tracking/stats and /tracking/url stay JWT-gated: they
//                      return contact emails / mint tracked links.
//   /api/unsubscribe - unsubscribe page (GET), RFC 8058 one-click (POST), and
//                      the provider webhook. NOT /list — that returns the
//                      suppression table's email addresses.
const PUBLIC_PATHS = [
  /^\/api\/auth\/login$/,
  /^\/api\/tracking\/(open|click)$/,
  /^\/api\/unsubscribe(\/webhook)?$/,
];

// Cron on this host and mybondapp_sync have no browser session, so they present
// a shared secret instead of a JWT. If CRON_SECRET is unset the header path is
// disabled outright rather than falling back to something guessable.
//
// The secret is NOT a master key: it only opens the specific endpoints the
// server cron jobs and scrapers actually call (see ops/CRON_SETUP.md). A leaked
// cron secret must not read the lead database or delete records — anything
// outside this list falls through to the normal JWT check and 401s.
const CRON_SECRET = process.env.CRON_SECRET || '';
const CRON_PATHS = [
  { methods: ['POST'], re: /^\/api\/drip\/run$/ },                              // drip sender, 4x/day
  { methods: ['POST'], re: /^\/api\/drip\/alert$/ },                            // reply/bounce alert digest
  { methods: ['POST'], re: /^\/api\/drip\/auto-pipeline$/ },                    // nightly auto-pipeline
  { methods: ['POST'], re: /^\/api\/bookkeeping\/bonds\/upsert-from-scraper$/ },// mybondapp_sync.cjs
  { methods: ['POST'], re: /^\/api\/bookkeeping\/jobs\// },                     // renewal/overdue/remittance scans
  { methods: ['POST'], re: /^\/api\/bookkeeping\/expenses\/recurring\/run-due$/ },
  // The RLI scraper reads the carrier list, creates missing carriers, and posts
  // rate tables on first run:
  { methods: ['GET'], re: /^\/api\/bookkeeping\/carriers(\/|$)/ },
  { methods: ['POST'], re: /^\/api\/bookkeeping\/carriers$/ },
  { methods: ['POST'], re: /^\/api\/bookkeeping\/carriers\/[^/]+\/rates$/ },
];
const jwtGuard = requireAuth();

app.use((req, res, next) => {
  // Express 4 routes case-insensitively by default, so /Api/contacts would
  // reach the routers while a case-sensitive startsWith check here skipped the
  // gate entirely. Normalize once and use the lowercased path for every check.
  const path = req.path.toLowerCase();
  if (!path.startsWith('/api/')) return next();
  if (PUBLIC_PATHS.some((re) => re.test(path))) return next();
  if (CRON_SECRET && req.get('X-Cron-Secret') === CRON_SECRET) {
    if (CRON_PATHS.some((p) => p.methods.includes(req.method) && p.re.test(path))) {
      return next();
    }
    // Valid secret, non-cron endpoint: fall through to the JWT check below,
    // which 401s unless a real user token is also present.
  }
  return jwtGuard(req, res, () => {
    // Server-side safety net for read-only accounts. The frontend already hides
    // admin/write UI, but the API must enforce it too. Kept here (one place)
    // rather than sprinkled per-router. GET/HEAD only; the sole write a
    // readonly user keeps is changing their own password.
    if (
      req.user?.role === 'readonly' &&
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      path !== '/api/auth/change-password'
    ) {
      return res.status(403).json({
        error: 'Read-only account: this action requires write access. Ask an admin to upgrade your role.',
      });
    }
    return next();
  });
});

app.use('/api/contacts', contactsRouter);
app.use('/api/email', emailRouter);
app.use('/api/import', importRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/notaries', notariesRouter);
app.use('/api/notary-campaigns', notaryCampaignsRouter);
app.use('/api/dealers', dealersRouter);
app.use('/api/contractors', contractorsRouter);
app.use('/api/tdlr', tdlrRouter);
app.use('/api/dealer-campaigns', dealerCampaignsRouter);
app.use('/api/unsubscribe', unsubscribeRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/drip', dripRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/filings', filingsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/auth', authRouter);
app.use('/api/tracking', trackingRouter);
app.use('/api/costs', costsRouter)
app.use('/api/bookkeeping', bkReportsRouter); // mounted first: /reports, /recon, /export/qbo-journal.csv, /export/iif
app.use('/api/bookkeeping', bookkeepingRouter);
app.use('/api/bookkeeping', expensesRouter);
app.use('/api/bookkeeping', billsRouter);
app.use('/api/bookkeeping', bkAiRouter);
initBills().catch(console.error);
app.listen(process.env.PORT || 4000, () => console.log('CRM backend running'));
