# Server Cron Setup — Quantum Surety CRM

Every scheduled job this repo expects on the CRM VPS (130.51.22.226), in one
place. Cron lines below assume the server's timezone is **America/Chicago
(CDT/CST)** — the drip windows are business-hours-sensitive, so verify
`timedatectl` before pasting.

The CRM API listens on port 4001 on the VPS (`PORT=4001`; the code default is
4000). All `curl` examples use `http://localhost:4001`.

## CRON_SECRET — required, and jobs fail SILENTLY without it

Since the 2026-08-22 auth hardening, **every `/api` route requires a JWT**
unless the request carries a matching `X-Cron-Secret` header **and** targets
one of the endpoints on the cron allowlist in `backend/src/index.js`
(`CRON_PATHS`). The allowlist is:

| Method | Path |
|---|---|
| POST | `/api/drip/run` |
| POST | `/api/drip/alert` |
| POST | `/api/drip/auto-pipeline` |
| POST | `/api/bookkeeping/bonds/upsert-from-scraper` |
| POST | `/api/bookkeeping/jobs/*` (renewal-scan, payment-overdue-scan, auto-remittance, run-all) |
| POST | `/api/bookkeeping/expenses/recurring/run-due` |
| GET  | `/api/bookkeeping/carriers*` (list, `/:id/rate`, `/:id/rates`) |
| POST | `/api/bookkeeping/carriers` and `/api/bookkeeping/carriers/:id/rates` |

Anything else with only the cron header gets **401** — that is intentional; a
leaked cron secret cannot read contacts/leads or delete data.

Requirements:

1. The CRM server process must be started with `CRON_SECRET=<value>` in its
   environment. **If `CRON_SECRET` is unset on the server, the header path is
   disabled entirely** and every cron call 401s.
2. Every curl/script below must send the **same** value.

> **WARNING — silent failures.** A missing or mismatched secret does not crash
> anything: the API returns `401 {"error":"Unauthorized"}`, curl without `-f`
> exits 0, and the job looks like it ran. Emails silently stop going out;
> scraped bonds silently stop landing. Always use `curl -fsS` (fail on HTTP
> error) and do not mask exit codes with `|| true` / `|| echo` tails. After any
> deploy or secret rotation, verify one job by hand and check its HTTP status.

Recommended: keep the secret in a root-only env file and source it in each
cron line:

```sh
# /opt/quantum-ops/crm-cron.env  (chmod 600, root-owned)
CRON_SECRET=<same value the CRM server was started with>
```

Helper prefix used below:

```
ENV='set -a; . /opt/quantum-ops/crm-cron.env; set +a;'
```

---

## The jobs

### 1. Drip sender — 4x/day, 9:00–12:00 CDT

Sends due drip-campaign emails. Runs on the hour 9, 10, 11, 12 (sends are
deliberately restricted to the late-morning window).

```cron
0 9,10,11,12 * * *  set -a; . /opt/quantum-ops/crm-cron.env; set +a; curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" http://localhost:4001/api/drip/run >> /var/log/crm-drip.log 2>&1
```

### 2. Drip alert — daily, 12:15 CDT (after the last send slot)

Reply/engagement alert digest for the drip pipeline.

```cron
15 12 * * *  set -a; . /opt/quantum-ops/crm-cron.env; set +a; curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" http://localhost:4001/api/drip/alert >> /var/log/crm-drip.log 2>&1
```

### 3. Auto-pipeline — nightly, 2:30 AM

Moves eligible leads/contacts into drip pipelines automatically.

```cron
30 2 * * *  set -a; . /opt/quantum-ops/crm-cron.env; set +a; curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" http://localhost:4001/api/drip/auto-pipeline >> /var/log/crm-drip.log 2>&1
```

### 4. Recurring expenses run-due — daily, 1:15 AM

Materializes recurring expense templates that are due.

```cron
15 1 * * *  set -a; . /opt/quantum-ops/crm-cron.env; set +a; curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" http://localhost:4001/api/bookkeeping/expenses/recurring/run-due >> /var/log/crm-bk.log 2>&1
```

### 5. mybondapp_sync — daily, 5:05 AM

RLI portal scraper (`scripts/rli/mybondapp_sync.cjs`, deployed to
`/opt/quantum-ops/mybondapp_sync.cjs`). Posts to
`/api/bookkeeping/bonds/upsert-from-scraper` and reads/creates carriers +
rates on first run — all covered by the cron allowlist. Needs `CRON_SECRET`
plus `RLI_USERNAME`/`RLI_PASSWORD` in `/opt/quantum-ops/rli.env`. Full deploy,
env, and exit-code table: `scripts/rli/DEPLOY.md`.

```cron
5 5 * * *  set -a; . /opt/quantum-ops/rli.env; set +a; NODE_PATH=/root/node_modules node /opt/quantum-ops/mybondapp_sync.cjs >> /var/log/mybondapp-sync.log 2>&1
```

Exit codes are meaningful (1 fatal, 2 completeness alarm, 3 CRM API failure —
this is the one a missing `CRON_SECRET` produces, 4 missing env). Do not mask
them.

### 6. bk_status_sync — daily, 7:06 AM

Existing bond-status sync (`/opt/quantum-ops/bk_status_sync.cjs`, lives on the
VPS, not in this repo). Keep its line as deployed; if it calls the CRM API it
must source the same `CRON_SECRET`.

```cron
6 7 * * *  set -a; . /opt/quantum-ops/crm-cron.env; set +a; node /opt/quantum-ops/bk_status_sync.cjs >> /var/log/bk-status-sync.log 2>&1
```

### 7. rli_revenue_sync — weekly, Tuesday 6:00 AM

Weekly RLI XLS ground-truth ingest (`scripts/rli/rli_revenue_sync.py`,
deployed to `/opt/quantum-ops/rli_revenue_sync.py`). Talks to Postgres and
Zoho IMAP directly — no `X-Cron-Secret` needed. Env: `CRM_DB_PASSWORD`,
`ZOHO_ADMIN_APP_PASSWORD`, AWS SES creds (see `scripts/rli/DEPLOY.md` Part 2).

```cron
0 6 * * 2  python3 /opt/quantum-ops/rli_revenue_sync.py >> /var/log/rli-revenue-sync.log 2>&1
```

### 8. refresh_notaries — daily, 7:00 AM

Existing notary list refresh (lead-gen script on the VPS, not in this repo;
historically under `/usr/local/lead-gen/`). Writes to the DB directly — no
`X-Cron-Secret` needed. Keep the deployed line, e.g.:

```cron
0 7 * * *  /usr/local/lead-gen/refresh_notaries.sh >> /var/log/refresh-notaries.log 2>&1
```

### 9. sync_tdlr — weekly, Sunday 3:15 AM

TDLR license sync (`scripts/sync_tdlr.py`). Talks to Postgres + the bondverify
MySQL over SSH directly — no `X-Cron-Secret` needed. Env file
`/etc/quantum-surety/tdlr-sync.env` (`DATABASE_URL`, `TDLR_MYSQL_USER`,
`TDLR_MYSQL_PASSWORD`). Full docs: `scripts/TDLR_SYNC.md`.

```cron
15 3 * * 0  . /etc/quantum-surety/tdlr-sync.env && /usr/bin/python3 /opt/quantum-ops/sync_tdlr.py >> /var/log/tdlr_sync.log 2>&1
```

---

## Verifying after deploy / secret rotation

```bash
set -a; . /opt/quantum-ops/crm-cron.env; set +a

# Should print HTTP 200 and a JSON result:
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "X-Cron-Secret: $CRON_SECRET" http://localhost:4001/api/drip/alert

# Should print 401 — the secret must NOT open non-cron endpoints:
curl -sS -o /dev/null -w '%{http_code}\n' -H "X-Cron-Secret: $CRON_SECRET" http://localhost:4001/api/contacts

# Should print 401 — mixed-case paths must NOT bypass the auth gate
# (Express routes case-insensitively; the gate normalizes before checking):
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:4001/Api/contacts

# Should print 200 with an empty body — RFC 8058 one-click unsubscribe POST
# (Gmail/Yahoo send this; a 404 here means provider unsubscribes are being lost):
curl -sS -o /dev/null -w '%{http_code}\n' -X POST 'http://localhost:4001/api/unsubscribe?email=cron-test@example.invalid'

# Should print 401 — the suppression list must not be public:
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:4001/api/unsubscribe/list
```

A 401 on the first command means the server's `CRON_SECRET` is unset or does
not match. A 200 on the second means the allowlist scoping in
`backend/src/index.js` has regressed. (Remember to delete the
`cron-test@example.invalid` row from `unsubscribes` if you keep real data tidy.)
