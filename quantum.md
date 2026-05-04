# Quantum Surety — Development Change Log

This file summarizes all features added, bugs fixed, and key files changed across the Quantum Surety CRM (`quantum-surety-crm`) and public website (`quantum-web`) projects.

---

## Features Added

### 1. Auto Dealer Module — CRM (`quantum-surety-crm`)

**What it does:** Full campaign management UI for Texas motor vehicle dealers (`auto_dealers` table), mirroring the existing Notary module.

- Browse/search/filter dealers by city, county, license type, expiry window
- Send personalized bulk email campaigns with `{{business_name}}`, `{{expire_date}}`, `{{license_type}}`, `{{city}}` merge tags
- Audience count preview before send
- Campaign send history with SENT badge overlay per dealer
- Skip Already Sent toggle (deduplication)
- Default email template pre-loaded with mybondapp.com GDN bond link

**Key files:**
- `backend/src/routes/dealer-campaigns.js` — REST routes: `/count`, `/send`, `/history`, `/sent-ids`
- `frontend/src/pages/Dealers.jsx` — Full dealer campaign UI page
- Registered in `backend/src/index.js` and `frontend/src/App.jsx`

---

### 2. Auto Dealer Drip Campaign (Automated)

**What it does:** Automated drip campaign (`drip_schedules` id=4) that fires daily via cron and emails Texas dealers with bonds expiring within 90 days. Sends up to 340/day. Deduplicates via `dealer_campaign_sends WHERE is_auto=true AND drip_id=4`.

- Drip schedule: `AUTO: GDN Dealer Bond Expiry (90d)` — contact_type=`dealer`, status=`active`, 340/day
- Subject: `{{first_name}} — Your TX Dealer Bond Renews {{expire_date}}`
- Email body: Quantum Surety branded HTML with mybondapp.com GDN link

**Key files:**
- `backend/src/routes/drip.js` — Added `dealer` branch to drip run logic (alongside existing `notary` branch)
- `fix_drip4.py` / `fix_drip4_body.py` — One-time Python scripts run on server to fix character encoding in drip subject and body (em-dash, §, $ were garbled by shell escaping)

---

### 3. GDN Bond Landing Pages — quantumsurety.bond

**What it does:** New product pages targeting Texas auto dealer bond searches. All CTAs point to `https://www.mybondapp.com/329034247/DirectNavBond?BondType=R4210CMBA2&State=TX`.

| Page | Route | Target |
|------|-------|--------|
| Texas GDN Bond (statewide) | `/bonds/gdn-bond-texas` | General TX dealer bond traffic |
| GDN Bond — Dallas | `/bonds/gdn-bond-dallas` | DFW dealerships |
| GDN Bond — Houston | `/bonds/gdn-bond-houston` | Harris County dealers |
| GDN Bond — Austin | `/bonds/gdn-bond-austin` | Austin/Travis County dealers |
| GDN Bond — San Antonio | `/bonds/gdn-bond-san-antonio` | Bexar County dealers |

Each page includes: hero section, key facts bar ($50K / from $100/yr / same-day), all 6 TxDMV dealer license types, Class A misdemeanor warning (§503.033), city-specific FAQs, CTA footer, cross-links to sibling city pages.

**Key files:**
- `client/src/pages/gdn-bond-texas.tsx`
- `client/src/pages/gdn-bond-dallas.tsx`
- `client/src/pages/gdn-bond-houston.tsx`
- `client/src/pages/gdn-bond-austin.tsx`
- `client/src/pages/gdn-bond-san-antonio.tsx`
- `client/src/App.tsx` — 5 new routes added

---

### 4. Notary Bond Renewal Landing Page — quantumsurety.bond

**What it does:** SEO page targeting "Texas notary bond renewal" searches. Captures renewal traffic separate from the main notary bond page.

- Route: `/bonds/notary-bond-renewal-texas`
- 5-step renewal checklist with timing tags
- SB693 changes section (mandatory education, journal requirement, criminal penalties, 10-year retention)
- Why renew with Quantum section (6 bullet points)
- FAQ (6 questions covering renewal timing, SB693, lapses)
- CTA: `https://www.mybondapp.com/329034247/DirectNavBond?BondType=N4208MBA2&State=TX`

**Key files:**
- `client/src/pages/notary-bond-renewal-texas.tsx`
- `client/src/App.tsx` — 1 new route added

---

### 5. GDN Bond Callout Section — Homepage

**What it does:** Added a "Texas Auto Dealer Bonds" section to the homepage, inserted between the Notary Bond section and the Get Bonded steps section. Dark slate/indigo card with $100/yr price card, 5 benefit bullets, dual CTAs (quote link + phone).

**Key files:**
- `client/src/pages/home.tsx`

---

### 6. Auto Dealer SEO Blog Posts — quantumsurety.bond

Three new blog posts targeting Texas GDN bond search traffic, all under the "Texas Auto Dealers" category:

| Post | Route |
|------|-------|
| Texas GDN Bond Requirements 2026 | `/blog/texas-gdn-bond-requirements-2026` |
| How Much Does a Texas GDN Bond Cost in 2026? | `/blog/texas-gdn-bond-cost-2026` |
| Texas Dealer License Renewal & GDN Bond Guide | `/blog/texas-dealer-license-renewal-gdn-bond` |

**Key files:**
- `client/src/pages/blog/texas-gdn-bond-requirements-2026.tsx`
- `client/src/pages/blog/texas-gdn-bond-cost-2026.tsx`
- `client/src/pages/blog/texas-dealer-license-renewal-gdn-bond.tsx`
- `client/src/pages/blog/index.tsx` — all three added to BLOG_POSTS array

---

### 7. Unsubscribe Page Rebrand

**What it does:** Replaced the plain text unsubscribe confirmation with a fully branded Quantum Surety dark-themed HTML page.

- Background: `#0A0A0F`, card: `#13131A`, gold accent: `#C9A84C`
- Confirms email removal, shows the unsubscribed address
- Footer links: Notary Bonds, Dealer Bonds, License Bonds

**Key files:**
- `backend/src/routes/unsubscribe.js`

---

### 8. Notary Drip Campaign Resumed

Drip id=3 (`AUTO: Notary Bond Expiry (90d)`) was paused and reactivated via:
```sql
UPDATE drip_schedules SET status='active' WHERE id=3;
```
- 340 emails/day, 90-day expiry window, ~12,710 total sent to date

---

## Bugs Fixed

### Bug 1 — "Unexpected token '<'" JSON Parse Error on Campaign Send

**Symptom:** `SyntaxError: Unexpected token '<', "<html><h..." is not valid JSON` when sending a dealer email campaign.

**Root cause:** The send endpoint was synchronous — looping through recipients with an 80ms delay per email exceeded the nginx 60-second proxy timeout. Nginx returned an HTML error page, which `.json()` then failed to parse.

**Fix:**
1. **Backend** (`dealer-campaigns.js`): Return `{ ok: true, queued: true, total }` immediately, then continue sending in a background async IIFE — no blocking.
2. **Frontend** (`Dealers.jsx`): Added `safeJson()` helper — reads response as text first, then `JSON.parse()`, so any HTML error produces a readable message instead of a crash.
3. **UI**: Success state updated to display "Campaign Queued! X emails sending in background" since sends now happen asynchronously.

---

### Bug 2 — "Sent! · failed" Blank Send Result Values

**Symptom:** After Bug 1 was fixed, the success message displayed "Sent! sent · failed" with blank counts.

**Root cause:** Frontend UI still referenced `sendResult.sent` and `sendResult.failed`, but the backend now returns `{ ok, queued, total }`.

**Fix:** Updated `Dealers.jsx` to read `sendResult.total` and show the new queued messaging. Also required `docker compose build --no-cache crm-frontend` to bust the stale Docker build cache serving the old compiled output.

---

### Bug 3 — Drip id=4 Character Encoding (em-dash, §, $ garbled)

**Symptom:** After creating the dealer drip via shell command, the subject displayed `?` instead of `—` and body showed `?503.033` instead of `§503.033`.

**Root cause:** The `plink` shell command that created the drip record passed JSON with Unicode special characters. Shell escaping mangled them at transmission.

**Fix:** Created `fix_drip4.py` and `fix_drip4_body.py` — Python scripts using `urllib.request` for proper UTF-8 encoding, with a psql dollar-quoting fallback for the body. Uploaded via pscp and executed on server. Both updates returned `UPDATE 1`; verified via psql query.

---

## Infrastructure Notes

### Server Deploy Pattern
```bash
# Upload file
pscp -pw "zadoL4cu!" localfile.js tsparks@192.168.4.122:/home/tsparks/

# Copy to app directory
plink -batch -pw "zadoL4cu!" tsparks@192.168.4.122 \
  "echo 'zadoL4cu!' | sudo -S cp /home/tsparks/localfile.js /usr/quantum-surety-crm/backend/src/routes/"

# Rebuild and restart
plink -batch -pw "zadoL4cu!" tsparks@192.168.4.122 \
  "cd /usr/quantum-surety-crm && echo 'zadoL4cu!' | sudo -S docker compose up -d --build"
```

### Database Query Pattern
```bash
plink -batch -pw "zadoL4cu!" tsparks@192.168.4.122 \
  "echo 'zadoL4cu!' | sudo -S docker exec scraper-postgres psql -U quantum_user -d quantum_surety -c \"<query>\""
```

### Frontend Cache Issue
When frontend files change, always rebuild with `--no-cache` to avoid Docker serving the stale compiled bundle:
```bash
docker compose build --no-cache crm-frontend && docker compose up -d
```

### Drip Cron Schedule
`POST /api/drip/run` fires at 9, 10, 11, 12 CDT daily. All `status='active'` drip schedules run per call. SES rate enforced with 80ms delay between sends.

### AWS SES
- Region: us-east-2 | From: `info@quantumsurety.bond`
- Limits: 50,000/day, 14/sec
- Bounces/complaints auto-add to `unsubscribes` via:
  - `/api/unsubscribe/webhook` — Resend events
  - `/api/unsubscribe/ses-complaint` — SES SNS notifications (complaints + hard bounces)

### Cloudflare Tunnel
CRM is internal-only (192.168.4.122:8095). A Cloudflare Tunnel exposes the backend publicly for SNS webhooks:
- Tunnel name: `quantum-crm` (ID: `16894e75-0ed7-4c84-b0d2-4148cf449b61`)
- Public URL: `https://crm-api.permitpilot.online` → `localhost:4001`
- Credentials: `/home/tsparks/.cloudflared/16894e75-0ed7-4c84-b0d2-4148cf449b61.json`
- Config: `/etc/cloudflared/config.yml`
- Service: `sudo systemctl restart cloudflared`

### Website Repository
- GitHub: `contact219/quantum` | Local: `c:\quantum-web`
- Deploy: `git add → commit → git pull origin main --rebase → git push`

### CRM Repository
- GitHub: `contact219/quantum-surety-crm` | Local: `c:\quantum-surety-crm`
- PR workflow: create branch → push → `gh pr create` (gh CLI installed via winget, authenticated as `contact219`)

---

## Current Drip Schedule Status

| ID | Name | Type | Status | Rate | Total Sent |
|----|------|------|--------|------|------------|
| 1 | AUTO: Notary Bond Expiry (90d) | notary | paused | 90/day | 0 |
| 2 | AUTO: Notary Bond Expiry (30d) | notary | paused | 2,000/day | ~1,610 |
| 3 | AUTO: Notary Bond Expiry (90d) | notary | **active** | 340/day | ~20,825 |
| 4 | AUTO: GDN Dealer Bond Expiry (90d) | dealer | **active** | 340/day | ~11,643 |

**May 2, 2026 daily send counts:** 2,354 notary · 1,360 dealer (drip fires 4x/day at 9, 10, 11, 12 CDT)

---

## SES Complaint Rate Improvements — May 4, 2026

### 10. Dealer Campaign Complaint Rate Reduction

**Problem:** GDN dealer bond campaigns were increasing the SES `Reputation.ComplaintRate` metric, risking a sending limit warning.

**Root causes identified:**
- Unsubscribe was "reply STOP" — recipients hit Spam instead
- No frequency cap — same dealer could be emailed across multiple campaigns
- 180-day expiry window targeted dealers with no urgency
- No `List-Unsubscribe` header — Gmail/Yahoo showed no native unsubscribe button
- SES complaints weren't auto-suppressed

**Changes made:**

1. **Real unsubscribe link** — `{{unsubscribe_url}}` merge tag in dealer email template resolves to a per-recipient encoded URL (`/api/unsubscribe?email=...`). Removed "reply STOP" text.

2. **`List-Unsubscribe` + `List-Unsubscribe-Post` headers** — added to every dealer campaign email. Gmail/Yahoo now render a native one-click unsubscribe button.

3. **RFC 8058 one-click POST endpoint** — `POST /api/unsubscribe` handles the POST that Gmail sends when the native unsubscribe button is clicked.

4. **60-day cooldown enforced server-side** — `dealer-campaigns.js` always excludes any dealer emailed in the last 60 days, regardless of campaign filters or `skip_sent` toggle.

5. **Default expiry filter tightened to 60 days** — `Dealers.jsx` `BLANK_FILTERS.expiring` changed from `''` (All) to `'60'` so campaigns default to targeting dealers with near-term urgency.

6. **SES SNS complaint webhook** — `POST /api/unsubscribe/ses-complaint` receives SES complaint and hard bounce events via SNS, auto-inserts addresses into `unsubscribes` table, and auto-confirms SNS topic subscriptions.

7. **Cloudflare Tunnel** — Since CRM is internal-only, a Cloudflare Tunnel was set up to expose the backend at `https://crm-api.permitpilot.online` for the SNS webhook.

8. **AWS wiring** — SES Configuration Set → SNS destination `ses-complaints-crm` → SNS topic `ses-complaints-crm` → HTTPS subscription confirmed at `https://crm-api.permitpilot.online/api/unsubscribe/ses-complaint`.

**Key files:**
- `backend/src/routes/dealer-campaigns.js`
- `backend/src/routes/unsubscribe.js`
- `frontend/src/pages/Dealers.jsx`

---

### 11. GitHub Actions Auto-Merge for Claude Branches

**What it does:** Any branch pushed with a `claude/*` prefix is automatically merged into `main` via GitHub Actions — no manual PR needed.

**Key files:**
- `.github/workflows/auto-merge-claude.yml`

---

### 12. CLAUDE.md Created

Full project documentation added at repo root covering architecture, deploy process, routes, SES setup, Cloudflare tunnel, and environment variables.

---

## Database Migration — May 2, 2026

### 9. CRM Database Migrated to quantum_surety

**What changed:** Moved all CRM tables from the shared `minority_contractors` database to a dedicated `quantum_surety` database with a purpose-built `quantum_user` role.

**Why:** The CRM was using a database named for the original scraper project (`minority_contractors`), sharing it with unrelated infrastructure. Now it has a clean, isolated DB with proper naming.

**Details:**
- 15 tables migrated: `notaries`, `auto_dealers`, `notary_campaign_sends`, `dealer_campaign_sends`, `drip_schedules`, `contractors`, `campaigns`, `campaign_sends`, `crm_contacts`, `crm_users`, `contact_status`, `email_events`, `link_clicks`, `unsubscribes`, `scraper_jobs`
- Row counts verified identical after migration (547,635 notaries, 20,688 dealers, all drip/send history intact)
- Old `minority_contractors` DB retained on server as fallback — can be dropped when ready
- `docker-compose.yml` `DATABASE_URL` updated to `postgresql://quantum_user:Qs2024Secure!@host.docker.internal:5433/quantum_surety`

**Key files:**
- `docker-compose.yml` — updated DATABASE_URL (PR [#1](https://github.com/contact219/quantum-surety-crm/pull/1))

**DB connection:**
- Host: `scraper-postgres` Docker container, port 5433
- Database: `quantum_surety`
- User: `quantum_user`
- Old DB: `minority_contractors` (user `scraper`) — still exists, no longer used by CRM
