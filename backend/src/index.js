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
//   /api/tracking/*  - drip open-pixel and click redirects, fetched by the
//                      recipient's mail client. Gating these silently kills
//                      email analytics; that already happened once, for 6 weeks.
//   /api/unsubscribe - one-click unsubscribe links in mail already sent
const PUBLIC_PATHS = [
  /^\/api\/auth\/login$/,
  /^\/api\/tracking\//,
  /^\/api\/unsubscribe/,
];

// Cron on this host and mybondapp_sync have no browser session, so they present
// a shared secret instead of a JWT. If CRON_SECRET is unset the header path is
// disabled outright rather than falling back to something guessable.
const CRON_SECRET = process.env.CRON_SECRET || '';
const jwtGuard = requireAuth();

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_PATHS.some((re) => re.test(req.path))) return next();
  if (CRON_SECRET && req.get('X-Cron-Secret') === CRON_SECRET) return next();
  return jwtGuard(req, res, next);
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
app.use('/api/bookkeeping', bookkeepingRouter);
app.use('/api/bookkeeping', expensesRouter);
app.use('/api/bookkeeping', billsRouter);
app.use('/api/bookkeeping', bkAiRouter);
initBills().catch(console.error);
app.listen(process.env.PORT || 4000, () => console.log('CRM backend running'));
