# Quantum Surety CRM

Internal CRM for Quantum Surety LLC — a Texas-licensed surety agency. Manages auto dealer bond campaigns, notary campaigns, contractor outreach, pipeline tracking, and drip sequences. All email is sent via AWS SES v2.

## Architecture

**Frontend:** React + Vite, served by nginx inside Docker (`qs-crm-frontend`, port 8095)  
**Backend:** Node.js/Express (ESM), served inside Docker (`qs-crm-backend`, port 4001 → internal 4000)  
**Database:** PostgreSQL in `scraper-postgres` container (port 5433), database `quantum_surety`, user `quantum_user`  
**Email:** AWS SES v2 via `@aws-sdk/client-sesv2` — configured in `backend/src/mailer.js`  
**Public tunnel:** Cloudflare Tunnel (`quantum-crm`, tunnel ID `16894e75`) exposes backend at `https://crm-api.permitpilot.online` — used for SNS webhooks since the CRM is internal-only (192.168.4.122:8095)

## Deploy

Server: `192.168.4.122` (SSH: `tsparks`). The CRM is internal-only — not reachable from the public internet directly.

```bash
# On server: pull and rebuild
cd /usr/quantum-surety-crm
sudo git pull origin main
sudo docker compose up -d --build
```

GitHub Actions (`.github/workflows/auto-merge-claude.yml`) automatically merges any `claude/*` branch into `main` on push — no manual PR merge needed.

## Key Routes

| Route | File | Purpose |
|---|---|---|
| `/api/dealers` | `routes/dealers.js` | Auto dealer list + stats |
| `/api/dealer-campaigns` | `routes/dealer-campaigns.js` | GDN bond campaign send/history |
| `/api/notary-campaigns` | `routes/notary-campaigns.js` | Notary campaign send/history |
| `/api/campaigns` | `routes/campaigns.js` | Contractor campaigns |
| `/api/unsubscribe` | `routes/unsubscribe.js` | Unsubscribe (GET=link click, POST=RFC 8058 one-click) |
| `/api/unsubscribe/ses-complaint` | `routes/unsubscribe.js` | SES SNS webhook — auto-suppresses complaints & hard bounces |
| `/api/drip` | `routes/drip.js` | Drip sequences |
| `/api/contacts` | `routes/contacts.js` | Contractor contacts |
| `/api/ai` | `routes/ai.js` | AI email generation |
| `/api/tracking` | `routes/tracking.js` | Email open/click tracking |

## SES Complaint Suppression

SES → Configuration Set → `ses-complaints-crm` SNS destination → SNS topic `ses-complaints-crm` → HTTPS subscription to `https://crm-api.permitpilot.online/api/unsubscribe/ses-complaint`.

When SES records a complaint or hard bounce, SNS POSTs to the backend which auto-inserts the address into the `unsubscribes` table.

## Dealer Campaign Rules

- **60-day cooldown enforced server-side** — no dealer emailed within the last 60 days is included in any send, regardless of filters
- **Default expiry filter: 60 days** — campaigns target dealers whose license expires within 60 days
- **List-Unsubscribe headers** on every outgoing email so Gmail/Yahoo show native unsubscribe button
- **Unsubscribe link** (`{{unsubscribe_url}}`) injected into every dealer email template

## Database Tables (key ones)

- `auto_dealers` — TX DMV dealer records
- `dealer_campaign_sends` — dealer email send history
- `notary_campaign_sends` — notary email send history  
- `unsubscribes` — global suppression list (email, source, created_at)
- `contractors` — contractor records
- `crm_contacts` — CRM contacts linked to contractors
- `campaigns` / `campaign_sends` — contractor campaigns
- `email_events` — open/click/bounce event log

## Environment Variables (backend)

- `DATABASE_URL` — PostgreSQL connection string
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` — SES credentials
- `APP_URL` — public base URL for unsubscribe links (set to `https://quantumsurety.bond`)
- `PORT` — backend port (default 4000)
