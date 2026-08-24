/**
 * mybondapp_sync.cjs — RLI BondList → CRM Bookkeeping sync (fidelity rebuild)
 *
 * Drop-in replacement for /opt/quantum-ops/mybondapp_sync.cjs.
 * Same CLI, same cron contract, same cookie/MFA flow. Changes:
 *   - No fabricated financials (see DEPLOY.md). --legacy-rates restores old maps.
 *   - No silent drops: unparseable cards are written to a skipped-list JSON.
 *   - apiRequest checks HTTP status and sends X-Cron-Secret.
 *   - Credentials come from env ONLY.
 *
 * Usage:
 *   node mybondapp_sync.cjs                # normal run
 *   node mybondapp_sync.cjs --dry-run      # parse only, no API writes
 *   node mybondapp_sync.cjs --visible      # show browser window
 *   node mybondapp_sync.cjs --all          # include expired/cancelled bonds
 *   node mybondapp_sync.cjs --legacy-rates # restore old fabricated amount/premium/rate behavior
 *
 * Required env: RLI_USERNAME, RLI_PASSWORD, CRON_SECRET (not needed for --dry-run)
 * Optional env: CRM_API (default http://localhost:4001), RLI_MAX_PAGES (default 40),
 *               CHROMIUM_PATH, RLI_SKIPPED_FILE
 *
 * Exit codes (for cron alerting):
 *   0 = success
 *   1 = fatal error (login, navigation, scrape exception)
 *   2 = parse-quality / completeness alarm: zero bonds on page 1, skipped > 10%
 *       of cards, pagination stopped advancing, RLI_MAX_PAGES cap truncated the
 *       list, or fewer cards seen than the portal's own "of Z Items" total
 *   3 = CRM API failure (non-2xx, timeout, network error, upsert failure)
 *   4 = missing required environment variables
 */

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (_) { puppeteer = require('/usr/local/lead-gen/node_modules/puppeteer-core'); }
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const DRY_RUN      = process.argv.includes('--dry-run');
const VISIBLE      = process.argv.includes('--visible');
const ALL          = process.argv.includes('--all');
const LEGACY_RATES = process.argv.includes('--legacy-rates');

// ── Env validation (loud exit BEFORE launching the browser) ───────────────────
const RLI_USERNAME = process.env.RLI_USERNAME;
const RLI_PASSWORD = process.env.RLI_PASSWORD;
const CRON_SECRET  = process.env.CRON_SECRET;
const CRM_API      = process.env.CRM_API || 'http://localhost:4001';
const MAX_PAGES    = Math.max(1, parseInt(process.env.RLI_MAX_PAGES || '40', 10) || 40);

{
  const missing = [];
  if (!RLI_USERNAME) missing.push('RLI_USERNAME');
  if (!RLI_PASSWORD) missing.push('RLI_PASSWORD');
  if (!CRON_SECRET && !DRY_RUN) missing.push('CRON_SECRET');
  if (missing.length) {
    console.error(`✗ Missing required environment variables: ${missing.join(', ')}`);
    console.error('  Set them in the crontab line (or export before running). Aborting before browser launch.');
    process.exit(4);
  }
}

const CHROMIUM      = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';
const SESSION_FILE  = path.join(__dirname, '.rli_session.json');
const SURETY_URL    = 'https://myportal.rlicorp.com/en/surety/overview';
const BOND_LIST_URL = 'https://rlisurety.rlicorp.com/Agency/BondList';
const SKIPPED_FILE  = process.env.RLI_SKIPPED_FILE || '/var/log/mybondapp-sync.skipped.json';
const OTP_FILE      = '/tmp/rli_otp.txt';

// ── Bond type map ─────────────────────────────────────────────────────────────
// Unknown descriptions now map to 'unknown' + needs_review (never silently notary).
function mapBondType(description) {
  const d = (description || '').toLowerCase();
  if (d.includes('notary'))                        return 'notary';
  if (d.includes('dealer') || d.includes('gdn'))   return 'dealer_gdn';
  if (d.includes('contractor'))                    return 'contractor';
  if (d.includes('mortgage'))                      return 'mortgage';
  if (d.includes('collection'))                    return 'collection-agency';
  if (d.includes('credit access'))                 return 'credit-access-business';
  if (d.includes('property tax'))                  return 'property-tax-consultant';
  return 'unknown';
}

// Legacy maps — used ONLY with --legacy-rates (old fabrication behavior).
const BOND_AMOUNTS = {
  notary: 10000, dealer_gdn: 25000, contractor: 10000, mortgage: 50000,
  'collection-agency': 10000, 'credit-access-business': 10000, 'property-tax-consultant': 5000,
};
const STANDARD_PREMIUMS = {
  notary: 50, dealer_gdn: 300, contractor: 100, mortgage: 250,
  'collection-agency': 100, 'credit-access-business': 150, 'property-tax-consultant': 100,
};
const RLI_COMMISSION = 0.20;
const COMMISSION_RATES = { notary: 0.55, dealer_gdn: 0.30 };

// ── HTTP helper ───────────────────────────────────────────────────────────────
// Fails loudly on non-2xx (prints body) and sends X-Cron-Secret from env.
function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    let base;
    try { base = new URL(CRM_API); }
    catch (e) { const err = new Error(`Invalid CRM_API URL: ${CRM_API}`); err.api = true; return reject(err); }
    const payload = body ? JSON.stringify(body) : null;
    const mod = base.protocol === 'https:' ? https : http;
    const options = {
      hostname: base.hostname,
      port: base.port || (base.protocol === 'https:' ? 443 : 80),
      path: `/api/bookkeeping${urlPath}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(CRON_SECRET ? { 'X-Cron-Secret': CRON_SECRET } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = mod.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(
            `API ${method} ${urlPath} failed: HTTP ${res.statusCode}\n  Body: ${String(data).substring(0, 800)}`
          );
          err.api = true;
          return reject(err);
        }
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', e => { e.api = true; reject(e); });
    // A wedged CRM server must not hang the cron run forever (no exit code at
    // all defeats exit-code alerting). Timeout destroys the socket; the
    // resulting 'error' event carries api=true so main() maps it to exit 3.
    req.setTimeout(30000, () => {
      req.destroy(Object.assign(new Error(`CRM API timeout (30s): ${method} ${urlPath}`), { api: true }));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Carrier setup ─────────────────────────────────────────────────────────────
async function ensureRliCarrier() {
  const carriers = await apiRequest('GET', '/carriers');
  const rli = (Array.isArray(carriers) ? carriers : []).find(c =>
    c.name.toLowerCase().includes('rli')
  );
  if (rli) { console.log(`✓ RLI carrier (id=${rli.id})`); return rli.id; }

  const created = await apiRequest('POST', '/carriers', {
    name: 'RLI Insurance Company', naic_code: '13056',
    contact_email: 'suretyinfo@rli.com', remittance_schedule: 'monthly', remittance_day: 15,
  });
  // Seed the real per-type rates (server-side rates are authoritative now that
  // the scraper no longer sends commission_rate) — a flat fallback here would
  // silently misprice notary (0.55) and dealer_gdn (0.30) commissions.
  for (const bond_type of Object.keys(STANDARD_PREMIUMS)) {
    const commission_pct = COMMISSION_RATES[bond_type] || RLI_COMMISSION;
    await apiRequest('POST', `/carriers/${created.id}/rates`, { bond_type, commission_pct });
  }
  console.log(`✓ RLI carrier created (id=${created.id})`);
  return created.id;
}

// ── Cookie helpers ─────────────────────────────────────────────────────────────
const COOKIE_ALLOWED = new Set(['name','value','domain','path','expires','httpOnly','secure','sameSite','url']);
function cleanCookies(raw) {
  return raw
    .filter(c => !c.partitionKey)
    .map(c => Object.fromEntries(Object.entries(c).filter(([k]) => COOKIE_ALLOWED.has(k))));
}

async function saveAllCookies(page) {
  const client = await page.target().createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');
  await client.detach();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
  console.log(`  → Session saved (${cookies.length} cookies)`);
}

// ── MFA handler ───────────────────────────────────────────────────────────────
async function handleMfa(page) {
  console.log('  → MFA screen. Selecting Phone (SMS) factor...');

  const mfaInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter(b => b.textContent.trim() === 'Select');
    return {
      count: btns.length,
      pageText: document.body.innerText.substring(0, 800),
    };
  }).catch(() => ({ count: 0, pageText: '' }));
  console.log(`  MFA Select buttons: ${mfaInfo.count}`);
  console.log(`  MFA page preview: ${mfaInfo.pageText.replace(/\s+/g, ' ').substring(0, 300)}`);

  // Click the last Select button (Phone factor — Email is first)
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter(b => b.textContent.trim() === 'Select');
    const phone = btns[btns.length - 1];
    if (phone) { phone.click(); return true; }
    return false;
  });
  console.log(`  → Phone Select clicked: ${clicked}`);
  if (!clicked) throw new Error('MFA: no Select button found');

  await page.waitForFunction(
    () => document.body.innerText.includes('voice call') || document.body.innerText.includes('Send code'),
    { timeout: 30000 }
  ).catch(() => {});

  // Click Submit to actually SEND the SMS
  const sentSms = await page.evaluate(() => {
    const btn = document.querySelector('input[type="submit"], button[type="submit"]');
    if (btn) { btn.click(); return btn.value || btn.textContent.trim(); }
    return null;
  });
  console.log(`  → Send SMS button: ${sentSms}`);
  await new Promise(r => setTimeout(r, 5000));

  const otpSel = [
    'input[name="answer"]', 'input[name="passcode"]', 'input[name="code"]',
    'input[name="credentials.passcode"]', 'input[autocomplete="one-time-code"]',
    'input[type="tel"]', 'input[type="number"]', 'input[type="text"]',
  ].join(', ');

  const hasOtp = await page.waitForSelector(otpSel, { timeout: 30000 })
    .then(() => true).catch(() => false);

  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input'))
      .filter(i => i.type !== 'hidden')
      .map(i => `${i.type}[name=${i.name}]`)
  ).catch(() => []);
  console.log(`  Inputs after SMS: ${inputs.join(', ') || 'none'}`);

  if (!hasOtp) {
    if (page.url().includes('myportal.rlicorp.com')) {
      console.log('  → Already on myportal — MFA bypassed');
      return;
    }
    throw new Error('MFA: no OTP input appeared after Send SMS — check phone number config');
  }

  if (fs.existsSync(OTP_FILE)) fs.unlinkSync(OTP_FILE);

  console.log('');
  console.log('  ══════════════════════════════════════════════════════');
  console.log('  SMS sent. Enter the code in a NEW SSH window:');
  console.log(`    echo "123456" > ${OTP_FILE}`);
  console.log('  Waiting up to 10 minutes...');
  console.log('  ══════════════════════════════════════════════════════');
  console.log('');

  let otp = null;
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    if (page.url().includes('myportal.rlicorp.com')) {
      console.log('  → Redirected to myportal (magic link / auto-auth)');
      return;
    }
    if (fs.existsSync(OTP_FILE)) {
      otp = fs.readFileSync(OTP_FILE, 'utf8').trim().replace(/\D/g, '');
      fs.unlinkSync(OTP_FILE);
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!otp) throw new Error(`MFA timeout: no code provided in ${OTP_FILE} within 10 minutes`);

  console.log(`  → Entering OTP (${otp.length} digits)...`);
  const otpEl = await page.$(otpSel);
  if (otpEl) {
    await otpEl.click({ clickCount: 3 });
    await otpEl.type(otp, { delay: 80 });
  }

  // Tick "remember device"
  await page.evaluate(() => {
    const cb = document.querySelector('input[name="rememberDevice"], input[type="checkbox"]');
    if (cb && !cb.checked) cb.click();
  }).catch(() => {});

  // Submit
  await page.evaluate(() => {
    const btn = [
      document.querySelector('input[value="Verify"]'),
      document.querySelector('button[type="submit"]'),
      ...Array.from(document.querySelectorAll('button')).filter(b => /verify|submit/i.test(b.textContent)),
    ].filter(Boolean)[0];
    if (btn) btn.click();
  });
  try { await page.keyboard.press('Enter'); } catch (_) {}

  console.log('  → OTP submitted — waiting for myportal redirect...');
  await page.waitForFunction(
    () => window.location.href.includes('myportal.rlicorp.com'),
    { timeout: 45000 }
  );
  console.log('  ✓ MFA complete — on myportal');
}

// ── Session establishment ─────────────────────────────────────────────────────
// Returns with page on myportal.rlicorp.com
async function ensureSession(page) {
  // Step 1: try saved cookies first
  if (fs.existsSync(SESSION_FILE)) {
    const cookies = cleanCookies(JSON.parse(fs.readFileSync(SESSION_FILE)));
    if (cookies.length > 0) await page.setCookie(...cookies);
    await page.goto(SURETY_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 2000));
    if (page.url().includes('myportal.rlicorp.com')) {
      console.log('  ✓ Resumed saved session');
      await saveAllCookies(page);
      return;
    }
    console.log(`  ✗ Session expired (at ${page.url().substring(0, 60)})`);
  }

  // Step 2: fill credentials
  console.log('  → Logging in (SP-initiated SSO)...');
  const onAuthPage = page.url().includes('auth.rlicorp.com') || page.url().includes('okta');
  if (!onAuthPage) {
    await page.goto(SURETY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  const emailSel = '#okta-signin-username, input[name="identifier"], input[type="email"]';
  await page.waitForSelector(emailSel, { timeout: 20000 });
  await page.type(emailSel, RLI_USERNAME, { delay: 40 });

  const nextBtn = await page.$('input[value="Next"]');
  if (nextBtn) {
    await nextBtn.click();
    await new Promise(r => setTimeout(r, 2000));
  }

  const passSel = '#okta-signin-password, input[type="password"]';
  await page.waitForSelector(passSel, { timeout: 10000 });
  await page.type(passSel, RLI_PASSWORD, { delay: 40 });

  await page.evaluate(() => {
    const btn =
      document.querySelector('#okta-signin-submit') ||
      document.querySelector('input[value="Verify"]') ||
      document.querySelector('input[value="Sign in"]') ||
      document.querySelector('button[type="submit"]') ||
      Array.from(document.querySelectorAll('button')).find(b => /^(verify|sign in)$/i.test(b.textContent.trim()));
    if (btn) btn.click();
  });
  try { await page.keyboard.press('Enter'); } catch (_) {}
  console.log('  → Credentials submitted');

  // Step 3: poll for myportal or MFA screen (up to 8 minutes)
  const deadline = Date.now() + 8 * 60 * 1000;
  let pollCount = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    pollCount++;
    const url = page.url();
    if (pollCount === 1) {
      try { await page.screenshot({ path: '/tmp/rli_login_debug.png', fullPage: true }); } catch (_) {}
    }

    if (url.includes('myportal.rlicorp.com')) {
      console.log('  ✓ Login complete (no MFA)');
      break;
    }

    let btns = [];
    try {
      btns = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button, [role="button"], a'))
          .map(x => x.textContent.trim())
      );
    } catch (_) {}

    console.log(`  Poll: ${url.substring(8, 58)} | ${btns.slice(0, 5).join(', ') || 'loading...'}`);

    if (btns.some(b => b === 'Select')) {
      await handleMfa(page);
      break;
    }
  }

  const finalUrl = page.url();
  if (!finalUrl.includes('myportal.rlicorp.com')) {
    throw new Error(`Login failed: expected myportal, at ${finalUrl}`);
  }

  await saveAllCookies(page);
}

// ── Navigate to BondList (handles SSO redirect from myportal) ─────────────────
async function navigateToBondList(page) {
  console.log('  → Navigating to BondList...');
  await page.goto(BOND_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  let url = page.url();
  console.log(`  BondList nav result: ${url.substring(0, 70)}`);

  if (url.includes('rlisurety.rlicorp.com')) {
    await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
    return;
  }

  if (url.includes('myportal.rlicorp.com')) {
    console.log('  → On myportal — waiting for SPA then clicking My Bond Center...');
    await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .find(b => b.textContent.trim() === 'My Bond Center');
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log(`  → My Bond Center clicked: ${clicked}`);

    if (clicked) {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
      url = page.url();
      console.log(`  After click: ${url.substring(0, 70)}`);
    }

    if (!url.includes('rlisurety.rlicorp.com')) {
      console.log('  → Trying surety overview → BondList path...');
      await page.goto(SURETY_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await new Promise(r => setTimeout(r, 3000));
      await page.goto(BOND_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 4000));
      url = page.url();
      console.log(`  Final URL: ${url.substring(0, 70)}`);
    }
  }

  if (!url.includes('rlisurety.rlicorp.com')) {
    throw new Error(`Could not reach BondList — at ${url}`);
  }
  await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
}

// ── Bond card parser ──────────────────────────────────────────────────────────
function toIso(dateStr) {
  const [m, d, y] = dateStr.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const STATUS_TEST_RE =
  /(?:Rider|Bond)\s*[-–—]\s*(?:Active|Issued|Abandoned|Cancelled|Expired|Pending|Saved)/i;

// Lines that are field labels / page chrome — never part of a principal name.
const LABEL_LINE_RE = new RegExp(
  '^(?:' + [
    'Bond No', 'Subm(?:ission)?\\s*No', 'Term', 'Rider Effective',
    'Bond Description', '(?:Bond\\s+)?Premium', 'Principal Address',
    'Bond Amount', 'Effective', 'Expir', 'Agency', 'Agent',
    'Quantum Surety', 'MBA$', 'J\\d{4,}', 'Email', 'Phone',
    // Card action buttons/links — anchored with $ so real names starting with
    // these words (e.g. "Edith Smith") are NOT swallowed.
    'View(?:\\s+(?:Bond|Details?))?$', 'Renew(?:\\s+Bond)?$', 'Print$',
    'Edit$', 'Continue$', 'Delete$', 'Download$', 'Copy$', 'Cancel$',
  ].join('|') + ')', 'i'
);
function isLabelLine(l) {
  return LABEL_LINE_RE.test(l) || STATUS_TEST_RE.test(l);
}

// Does this text chunk look like an actual bond card (vs page chrome from the split)?
function looksLikeCard(lines) {
  return lines.some(l =>
    /^Bond No:/i.test(l) || /^Principal Address:/i.test(l) ||
    /^Term:/i.test(l) || /^Bond Description:/i.test(l) ||
    /^Subm(?:ission)?\s*No[:.]/i.test(l)
  );
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/;

// Our own contact details appear in page/card chrome; never emit them as the
// insured's contact (a wrong scraper-written email permanently blocks the
// weekly-XLS ground-truth backfill, which only fills EMPTY fields).
const AGENCY_EMAIL_RE = /@quantumsurety\.bond$/i;
const AGENCY_PHONES   = new Set(['2146668718']);
function normPhone(p) { return p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); }

/**
 * Parses one page of BondList innerText.
 * Returns { bonds, skipped, suspects } — skipped entries carry { reason, raw }.
 * suspects are chunks with a status line but NONE of the recognized field
 * labels: probably chrome, but under label drift they could be real cards, so
 * they are recorded (non-alarm) instead of vanishing without trace.
 * NOTHING that looks like a bond card is silently dropped.
 */
function parseBondCards(text) {
  const bonds = [];
  const skipped = [];
  const suspects = [];

  for (const card of text.split(/(?:^|\n)MBA\n/)) {
    const lines = card.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (!looksLikeCard(lines)) {
      if (STATUS_TEST_RE.test(card)) {
        suspects.push({ reason: 'status-but-no-fields', raw: card.trim() });
      }
      continue; // page chrome, not a card
    }

    const review = [];  // needs_review reasons

    // ── Status: collect ALL matches; prefer the "Bond - X" line over "Rider - X"
    const statusLines = lines.filter(l => STATUS_TEST_RE.test(l));
    if (!statusLines.length) {
      skipped.push({ reason: 'no-status-line', raw: card.trim() });
      continue;
    }
    // Among "Bond - X" lines, a terminal status (Cancelled/Expired/Abandoned)
    // wins over Active/Issued — renewal/history cards can carry both, and
    // recording a cancelled bond as issued posts phantom commission.
    const bondLines = statusLines.filter(l => /\bBond\s*[-–—]\s*/i.test(l));
    const terminalLine = bondLines.find(l => /Cancelled|Expired|Abandoned/i.test(l));
    const statusLine = terminalLine || bondLines[0] || statusLines[0];
    if (bondLines.length > 1 && terminalLine && terminalLine !== bondLines[0]) {
      review.push('conflicting-status-lines');
    }
    const isSaved = /Saved/i.test(statusLine);

    // ── Submission number (always captured; lets the server retire DRAFT rows)
    const submLine = lines.find(l => /^Subm(?:ission)?\s*No[:.]/i.test(l));
    const submissionNo = submLine
      ? submLine.replace(/^Subm(?:ission)?\s*No[:.]/i, '').trim() || null
      : null;

    // ── Principal name: join consecutive non-label lines before "Principal Address:"
    let insuredName = null;
    const paIdx = lines.findIndex(l => /^Principal Address:/i.test(l));
    if (paIdx > 0) {
      const nameParts = [];
      for (let i = paIdx - 1; i >= 0 && nameParts.length < 3; i--) {
        const cand = lines[i];
        if (!cand || isLabelLine(cand) || cand.startsWith('—')) break;
        nameParts.unshift(cand);
      }
      if (nameParts.length) insuredName = nameParts.join(' ');
      // Any multi-line join is auditable: chrome/action lines not covered by
      // LABEL_LINE_RE could have been absorbed into the name.
      if (nameParts.length > 1) review.push('multiline-name-join');
    }
    // Never emit the em-dash placeholder; null/omitted keeps the server's value.
    if (insuredName && /^[—–-]+$/.test(insuredName)) insuredName = null;

    // ── Term dates
    let effectiveDate = null, expirationDate = null;
    const termLine = lines.find(l => /^Term:/i.test(l));
    if (termLine) {
      const dm = termLine.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
      if (dm) { effectiveDate = toIso(dm[1]); expirationDate = toIso(dm[2]); }
      else {
        const single = termLine.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (single) effectiveDate = toIso(single[1]);
      }
    }
    const riderLine = lines.find(l => /^Rider Effective:/i.test(l));
    if (riderLine) {
      const dm = riderLine.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      if (dm) effectiveDate = toIso(dm[1]);
    }

    // ── Bond number (real, or synthetic DRAFT-* for Saved cards)
    const bondNoLine = lines.find(l => /^Bond No:/i.test(l));
    let bondNumber = bondNoLine ? bondNoLine.replace(/^Bond No:\s*/i, '').trim() : null;
    if (bondNumber && bondNumber.startsWith('—')) bondNumber = null;
    if (!bondNumber) {
      if (!isSaved) {
        skipped.push({ reason: 'no-bond-number-non-saved', raw: card.trim() });
        continue;
      }
      // Saved/draft bonds: stable synthetic key (same scheme as before)
      if (submissionNo) {
        bondNumber = 'DRAFT-' + submissionNo;
      } else {
        const nameSlug = (insuredName || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase() || 'UNKNOWN';
        const dk = (effectiveDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
        bondNumber = 'DRAFT-' + nameSlug + '-' + dk;
        review.push('draft-synthetic-key-no-submission-no');
      }
    }

    // ── Dates policy: non-saved bonds need both dates; saved drafts may lack them
    if (!effectiveDate || !expirationDate) {
      if (!isSaved) {
        skipped.push({ reason: 'missing-term-dates', raw: card.trim() });
        continue;
      }
      review.push('draft-missing-term-dates');
    }

    // ── Description: FULL text, no comma truncation, no fabricated default
    const descLine = lines.find(l => /^Bond Description:/i.test(l));
    const description = descLine ? descLine.replace(/^Bond Description:\s*/i, '').trim() : null;
    if (!description) review.push('missing-description');

    // ── Bond type: unknown → 'unknown' + needs_review (never silently notary)
    let bondType = mapBondType(description);
    if (bondType === 'unknown') review.push('unknown-bond-type');

    // ── Premium: parsed value ONLY — no STANDARD_PREMIUMS substitution
    let premium = null;
    const premLine = lines.find(l => /^(?:Bond\s+)?Premium:/i.test(l));
    if (premLine) {
      const m = premLine.match(/\$\s*([\d.,]+)/);
      if (m) premium = parseFloat(m[1].replace(/,/g, ''));
    }
    if (premium === null || Number.isNaN(premium)) {
      premium = null;
      review.push('premium-not-parsed');
    } else if (premium === 0) {
      review.push('premium-zero');
    }

    // ── Bond amount: only if actually present on the card
    let bondAmount = null;
    const amtLine = lines.find(l => /^Bond Amount:/i.test(l));
    if (amtLine) {
      const m = amtLine.match(/\$?\s*([\d.,]+)/);
      if (m) bondAmount = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isNaN(bondAmount)) bondAmount = null;
    }

    // ── Principal address: single-line join (label remainder + following lines)
    let principalAddress = null;
    if (paIdx >= 0) {
      const parts = [];
      const remainder = lines[paIdx].replace(/^Principal Address:\s*/i, '').trim();
      if (remainder) parts.push(remainder);
      for (let i = paIdx + 1; i < lines.length && parts.length < 6; i++) {
        if (isLabelLine(lines[i])) break;
        parts.push(lines[i]);
      }
      if (parts.length) principalAddress = parts.join(', ');
    }

    // ── Email / phone: ONLY from an explicit label line (never a bare match
    //    anywhere in the chunk — chrome can contain the AGENCY's contact),
    //    and never our own agency email/phone.
    let insuredEmail = null, insuredPhone = null;
    const emailLine = lines.find(l => /^E-?mail(?:\s*Address)?:/i.test(l));
    if (emailLine) {
      const m = emailLine.match(EMAIL_RE);
      if (m && !AGENCY_EMAIL_RE.test(m[0])) insuredEmail = m[0];
    }
    const phoneLine = lines.find(l => /^Phone(?:\s*(?:No|Number))?[:.]/i.test(l));
    if (phoneLine) {
      const m = phoneLine.match(PHONE_RE);
      if (m && !AGENCY_PHONES.has(normPhone(m[0]))) insuredPhone = m[0].trim();
    }

    // ── Legacy fabrication mode (only with --legacy-rates)
    let commissionRate;
    if (LEGACY_RATES) {
      if (bondType === 'unknown') bondType = 'notary';
      if (bondAmount === null) bondAmount = BOND_AMOUNTS[bondType] || 10000;
      if (!premium) premium = STANDARD_PREMIUMS[bondType] || 50;
      commissionRate = COMMISSION_RATES[bondType] || RLI_COMMISSION;
    }

    const bond = {
      bond_number:     bondNumber,
      bond_type:       bondType,
      premium,                          // as parsed: number, 0, or null — never fabricated
      bond_amount:     bondAmount,      // null when not on the card
      effective_date:  effectiveDate,
      expiration_date: expirationDate,
      status:          /Expired/i.test(statusLine)   ? 'expired'
                     : /Abandoned/i.test(statusLine) ? 'abandoned'
                     : /Cancelled/i.test(statusLine) ? 'cancelled'
                     : /Saved/i.test(statusLine)     ? 'saved'
                     : /Pending/i.test(statusLine)   ? 'pending'
                     : 'issued',
      status_detail:   statusLine,
      needs_review:    review.length > 0,
    };
    // Optional fields: OMIT when absent so the server keeps existing values.
    if (insuredName)              bond.insured_name       = insuredName;
    if (description)              bond.description        = description;
    if (submissionNo)             bond.submission_no      = submissionNo;
    if (principalAddress)         bond.principal_address  = principalAddress;
    if (insuredEmail)             bond.insured_email      = insuredEmail;
    if (insuredPhone)             bond.insured_phone      = insuredPhone;
    if (commissionRate !== undefined) bond.commission_rate = commissionRate; // --legacy-rates only
    if (statusLines.length > 1)   bond.status_lines       = statusLines;
    if (review.length)            bond.needs_review_reasons = review;

    bonds.push(bond);
  }
  return { bonds, skipped, suspects };
}

// ── Paginated BondList scraper ────────────────────────────────────────────────
async function scrapeAllBonds(bondPage, stats) {
  const allBonds = [];
  const seen = new Set();   // dedupe across ALL pages
  let pageNum = 1;
  let prevFirstBondNo = null;

  // Apply All Bonds filter
  const hasFilter = await bondPage.$('#submissionTypeFilter').then(el => !!el).catch(() => false);
  if (hasFilter) {
    await bondPage.select('#submissionTypeFilter', 'all_bonds');
    console.log('  → Applied All Bonds filter — waiting for AJAX...');
    await bondPage.waitForNetworkIdle({ timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 5000));
  } else {
    console.log('  ⚠ #submissionTypeFilter not found — scraping all bonds');
  }

  while (true) {
    console.log(`  Scanning page ${pageNum}...`);
    await bondPage.waitForNetworkIdle({ timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));

    const text = await bondPage.evaluate(() => document.body.innerText);

    if (pageNum === 1) {
      const countLine = text.split('\n').find(l => /\d+ - \d+ of \d+ Items/i.test(l));
      console.log(`  Count: ${countLine || 'not found'}`);
      // Portal's own total (Z) — the cheapest, strongest completeness check.
      if (countLine) {
        const cm = countLine.match(/(\d+)\s*-\s*(\d+) of (\d+) Items/i);
        if (cm) {
          stats.portalTotal = parseInt(cm[3], 10);
          stats.pageSize = Math.max(1, parseInt(cm[2], 10) - parseInt(cm[1], 10) + 1);
        }
      }
      const filterVal = await bondPage.evaluate(() => {
        const s = document.querySelector('#submissionTypeFilter');
        return s ? s.value : 'N/A';
      }).catch(() => 'err');
      console.log(`  Filter value: ${filterVal}`);
      try { fs.writeFileSync('/tmp/rli_page1.txt', text); } catch (_) {}
    }

    const { bonds, skipped, suspects } = parseBondCards(text);

    // Portal drift alarm: zero bonds on page 1
    if (pageNum === 1) stats.page1Count = bonds.length;

    // Repeated-page detection FIRST — a repeated page's skipped/suspect
    // entries must not be double-counted in the >10% alarm numerator.
    const firstBondNo = bonds.length ? bonds[0].bond_number : null;
    if (pageNum > 1 && firstBondNo && firstBondNo === prevFirstBondNo) {
      console.log(`  ⚠ Page ${pageNum} repeats page ${pageNum - 1} (first bond ${firstBondNo}) — pagination is not advancing. Stopping.`);
      stats.paginationRepeat = true;
      break;
    }
    prevFirstBondNo = firstBondNo;

    for (const s of skipped) stats.skipped.push({ page: pageNum, ...s });
    for (const s of suspects) stats.suspects.push({ page: pageNum, ...s });

    let added = 0;
    for (const b of bonds) {
      if (seen.has(b.bond_number)) { stats.duplicates++; continue; }
      seen.add(b.bond_number);
      allBonds.push(b);
      added++;
    }
    console.log(`    Found ${bonds.length} bonds on page ${pageNum} (${added} new, ${skipped.length} skipped, total: ${allBonds.length})`);

    // Find next-page button. Cap check happens BEFORE clicking so hitting
    // RLI_MAX_PAGES never loads an extra page that is then not scraped.
    const atCap = pageNum >= MAX_PAGES;
    const pagResult = await bondPage.evaluate((doClick) => {
      const paginationEls = Array.from(document.querySelectorAll('li.pagination, li.pagination *'))
        .map(el => `${el.tagName}[${el.className}]="${el.textContent.trim()}"`);

      const nextEl = Array.from(document.querySelectorAll('a'))
        .find(a => {
          const t = a.textContent.trim();
          return t === '›' || t === '»' || t === 'Next';
        });

      if (!nextEl) return { found: false, reason: 'no <a> with › text', paginationEls };
      const li = nextEl.closest('li');
      if (li && (li.classList.contains('disabled') || li.classList.contains('inactive'))) {
        return { found: false, reason: 'li.disabled', paginationEls };
      }
      if (doClick) nextEl.click();
      return { found: true, paginationEls };
    }, !atCap);

    if (pageNum === 1 || !pagResult.found) {
      console.log(`  Pagination els: ${(pagResult.paginationEls || []).join(' | ').substring(0, 200)}`);
    }

    if (!pagResult.found) {
      console.log(`  Pagination: ${pagResult.reason}`);
      break;
    }
    if (atCap) {
      console.log(`  ⚠ Hit RLI_MAX_PAGES cap (${MAX_PAGES}) with a next page still available — list TRUNCATED. Stopping without clicking next.`);
      stats.maxPagesTruncated = true;
      break;
    }
    console.log('  Pagination: next clicked');
    pageNum++;
    await new Promise(r => setTimeout(r, 4000));
    await bondPage.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
  }

  stats.pages = pageNum;
  return allBonds;
}

// ── Skipped-list report ───────────────────────────────────────────────────────
function writeSkippedFile(stats, parsedCount) {
  const report = {
    generated_at: new Date().toISOString(),
    pages: stats.pages,
    parsed: parsedCount,
    duplicates: stats.duplicates,
    skipped_count: stats.skipped.length,
    suspect_chrome_count: stats.suspects.length,
    pagination_repeat: !!stats.paginationRepeat,
    max_pages_truncated: !!stats.maxPagesTruncated,
    portal_total: stats.portalTotal,
    skipped: stats.skipped,
    suspect_chrome: stats.suspects,
  };
  const targets = [SKIPPED_FILE, path.join(__dirname, 'mybondapp-sync.skipped.json')];
  for (const target of targets) {
    try {
      fs.writeFileSync(target, JSON.stringify(report, null, 2));
      console.log(`  Skipped-card report written: ${target}`);
      return;
    } catch (e) {
      console.log(`  ⚠ Could not write skipped report to ${target}: ${e.message}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══ mybondapp → CRM Bookkeeping Sync ═══');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | All: ${ALL} | Legacy rates: ${LEGACY_RATES} | Max pages: ${MAX_PAGES}`);

  let carrierId;
  if (!DRY_RUN) {
    try {
      carrierId = await ensureRliCarrier();
    } catch (err) {
      console.error(`✗ CRM API unreachable or rejected request: ${err.message}`);
      process.exit(3);
    }
  }

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: !VISIBLE,
    defaultViewport: VISIBLE ? null : { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const stats = {
    pages: 0, skipped: [], suspects: [], duplicates: 0, page1Count: null,
    paginationRepeat: false, maxPagesTruncated: false, portalTotal: null, pageSize: null,
  };
  let allBonds = [];
  try {
    const page = await browser.newPage();

    // Also listen for new tabs opened by "My Bond Center" click
    let newTabPage = null;
    browser.on('targetcreated', async target => {
      if (target.type() === 'page') newTabPage = await target.page();
    });

    await ensureSession(page);
    await navigateToBondList(page);

    const bondPage = newTabPage || page;
    const bondUrl  = bondPage.url();
    console.log(`  Active bond page: ${bondUrl.substring(0, 70)}`);

    if (!bondUrl.includes('rlisurety.rlicorp.com')) {
      throw new Error(`Bond page is not rlisurety: ${bondUrl}`);
    }

    await saveAllCookies(page);

    allBonds = await scrapeAllBonds(bondPage, stats);
  } catch (err) {
    console.error('✗ Scrape error:', err.message);
    await browser.close().catch(() => {});
    process.exit(1); // fail loudly — do NOT upsert a partial/failed scrape
  }
  await browser.close().catch(() => {});

  // ── Counts + skipped report ─────────────────────────────────────────────────
  const totalCards = allBonds.length + stats.duplicates + stats.skipped.length;
  const needsReview = allBonds.filter(b => b.needs_review).length;
  console.log('');
  console.log(`  Pages scanned:    ${stats.pages}`);
  console.log(`  Cards seen:       ${totalCards}`);
  console.log(`  Bonds parsed:     ${allBonds.length} (${needsReview} flagged needs_review)`);
  console.log(`  Duplicates:       ${stats.duplicates}`);
  console.log(`  Skipped (unparseable): ${stats.skipped.length}`);
  for (const s of stats.skipped) {
    console.log(`    ⚠ page ${s.page} [${s.reason}]: ${s.raw.replace(/\s+/g, ' ').substring(0, 100)}`);
  }
  if (stats.suspects.length) {
    console.log(`  Suspect chrome chunks (status line but no field labels — check for label drift): ${stats.suspects.length}`);
    for (const s of stats.suspects) {
      console.log(`    ? page ${s.page} [${s.reason}]: ${s.raw.replace(/\s+/g, ' ').substring(0, 100)}`);
    }
  }
  writeSkippedFile(stats, allBonds.length);

  // ── Portal drift / completeness alarms (exit 2 so cron alerting fires) ──────
  const driftAlarms = [];
  if (stats.page1Count === 0) {
    driftAlarms.push('ZERO bonds parsed on page 1 — portal layout drift suspected. Inspect /tmp/rli_page1.txt.');
  }
  if (stats.paginationRepeat) {
    driftAlarms.push(`Pagination stopped advancing after page ${stats.pages} — pages beyond it were NOT scraped.`);
  }
  if (stats.maxPagesTruncated) {
    driftAlarms.push(`RLI_MAX_PAGES cap (${MAX_PAGES}) hit with a next page still available — bond list TRUNCATED. Raise RLI_MAX_PAGES.`);
  }
  if (totalCards > 0 && stats.skipped.length / totalCards > 0.10) {
    driftAlarms.push(`Skipped ${stats.skipped.length}/${totalCards} cards (>10%) — parser drift suspected. See skipped report.`);
  }
  // Reconcile against the portal's own "N - M of Z Items" total (one page slack).
  if (stats.portalTotal !== null && totalCards < stats.portalTotal - (stats.pageSize || 20)) {
    driftAlarms.push(`Portal reports ${stats.portalTotal} items but only ${totalCards} cards were seen (parsed+dupes+skipped) — list truncated or half-rendered.`);
  }
  const driftAlarm = driftAlarms.length ? driftAlarms.join(' | ') : null;

  if (stats.page1Count === 0) {
    console.error(`\n✗ ALARM: ${driftAlarm}`);
    process.exit(2); // nothing trustworthy to upsert
  }

  if (!allBonds.length) {
    console.log('  Nothing to sync.');
    process.exit(driftAlarm ? 2 : 0);
  }

  if (DRY_RUN) {
    console.log('\n── DRY RUN — bonds that would be upserted ──');
    allBonds.forEach((b, i) =>
      console.log(`  ${i + 1}. ${b.bond_number} | ${b.insured_name || '(no name)'} | ${b.bond_type} | prem=${b.premium === null ? 'null' : '$' + b.premium} | ${b.effective_date || '?'}→${b.expiration_date || '?'} | ${b.status}${b.needs_review ? ' | REVIEW: ' + (b.needs_review_reasons || []).join(',') : ''}`)
    );
    console.log('\n(Remove --dry-run to sync)');
    if (driftAlarm) { console.error(`\n✗ ALARM: ${driftAlarm}`); process.exit(2); }
    return;
  }

  const payload = allBonds.map(b => ({ ...b, carrier_id: carrierId, source: 'mybondapp' }));
  console.log(`\n  Upserting ${payload.length} bonds...`);
  let result;
  try {
    result = await apiRequest('POST', '/bonds/upsert-from-scraper', payload);
  } catch (err) {
    console.error(`✗ Upsert FAILED: ${err.message}`);
    process.exit(3);
  }
  console.log(`  ✓ Upserted: ${result.upserted} | Flagged: ${result.flagged}`);
  if (result.upserted === undefined) {
    console.error('✗ Upsert response missing "upserted" — endpoint contract mismatch. Body above.');
    process.exit(3);
  }

  try {
    const renewal = await apiRequest('POST', '/jobs/renewal-scan', {});
    if (renewal.count > 0) console.log(`  ✓ ${renewal.count} renewal alerts generated`);
  } catch (err) {
    console.error(`✗ Renewal scan failed: ${err.message}`);
    process.exit(3);
  }

  if (driftAlarm) {
    console.error(`\n✗ ALARM (data synced, but review needed): ${driftAlarm}`);
    process.exit(2);
  }

  console.log('\n═══ Sync complete ═══');
})().catch(err => {
  console.error('✗ Fatal:', err && err.stack ? err.stack : err);
  process.exit(err && err.api ? 3 : 1);
});
