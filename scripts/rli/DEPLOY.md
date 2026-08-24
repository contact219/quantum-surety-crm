# RLI Pipeline Fidelity Rebuild — Deployment Notes

Two deliverables:

1. **`mybondapp_sync.cjs`** — daily portal scraper (Part 1 below)
2. **`rli_revenue_sync.py`** — weekly XLS ground-truth ingest (Part 2 below)

Deploying only one of them leaves half the pipeline on old behavior.

---

# Part 1: mybondapp_sync.cjs (daily, 5:05 AM)

Drop-in replacement for `/opt/quantum-ops/mybondapp_sync.cjs` on the CRM VPS
(130.51.22.226). Same CLI flags, same cron slot, same cookie/MFA login flow
(`.rli_session.json` resume, SMS OTP via `/tmp/rli_otp.txt`). Requires the
hardened upsert endpoint (commit `4f83db8`+, `X-Cron-Secret` support).

## What changed

**No fabrication**
- `premium` is sent exactly as parsed from the card: a number, `0`, or `null`.
  `STANDARD_PREMIUMS` substitution is gone. Unparsed/zero premium sets
  `needs_review: true` (+ `needs_review_reasons`) and is logged.
- `bond_amount` is parsed from the card only if a `Bond Amount:` line exists;
  otherwise `null`. The hardcoded `BOND_AMOUNTS` map is no longer used.
- `commission_rate` is NOT sent. The scraper sends `bond_type` and the endpoint
  applies `bk_carrier_rates`.
- Unknown bond descriptions map to `bond_type: "unknown"` + `needs_review`,
  never silently `notary`. Missing description no longer defaults to
  "Notary Bond (TX)" — the field is omitted.
- `--legacy-rates` restores exactly FOUR old behaviors if the endpoint isn't
  ready: the hardcoded bond-amount map, the `STANDARD_PREMIUMS` fallback, the
  commission-rate map, and unknown→notary. It does NOT restore the old
  "Notary Bond (TX)" default description (field stays omitted) or the em-dash
  `insured_name` placeholder (field stays omitted).

**Parsing fidelity**
- Status: ALL status lines in a card are collected; a `Bond - X` line wins over
  `Rider - X` (a rider no longer masks a cancelled bond). Chosen raw line is
  sent as `status_detail`; when multiple lines exist they're sent as
  `status_lines` (extra field, ignored server-side if unused).
- Principal names wrapped across two lines before `Principal Address:` are
  joined. The em-dash placeholder is never emitted — the field is omitted so
  the server keeps its existing value.
- Full bond description (no comma truncation), `submission_no`,
  `principal_address` (single-line join), and `insured_email`/`insured_phone`
  (when present on a card) are captured and sent.
- Drafts keep `DRAFT-{submNo}` / `DRAFT-{nameSlug}-{date}` synthetic keys.
  `submission_no` is sent on every card that has one — including cards with a
  real bond number — so the server can retire the matching `DRAFT-` ghost row.
- Saved drafts missing term dates are no longer dropped; they're sent with
  null dates + `needs_review`.

**No silent drops**
- Every card that fails parsing lands in a skipped list with its raw text.
  Report written to `/var/log/mybondapp-sync.skipped.json` (override with
  `RLI_SKIPPED_FILE`; falls back to the script directory on permission error).
  Counts (pages / cards / parsed / duplicates / skipped) printed every run.
- Chunks with a status line but NONE of the recognized field labels are
  recorded in a `suspect_chrome` list (report + log, non-alarm) — under label
  drift these could be real cards, and they no longer vanish without trace.
- Name walk-back joins are auditable: any multi-line `insured_name` join sets
  `needs_review` with reason `multiline-name-join`; common card-action lines
  (View/Renew/Print/Edit/…) are excluded from the join.
- `insured_email`/`insured_phone` come only from explicit `Email:`/`Phone:`
  label lines, and the agency's own address/phone
  (`@quantumsurety.bond`, 214-666-8718) is never emitted — a wrongly captured
  agency contact would permanently block the weekly-XLS contact backfill
  (which only fills empty fields).

**Completeness alarms (all → exit 2)**
- Pagination stops advancing (repeated page): parsed bonds are still upserted,
  then the run exits 2 — truncation is never a silent success.
- `RLI_MAX_PAGES` cap hit while a next page is still available: same — upsert,
  then exit 2. The cap check now runs BEFORE the next-page click, so no extra
  page is loaded-but-unscraped.
- The portal's own "N - M of Z Items" total is parsed on page 1 and reconciled
  at end of run: if cards seen (parsed+duplicates+skipped) fall more than one
  page short of Z, exit 2.

**Operational hardening**
- `apiRequest` checks `res.statusCode`, prints the response body on non-2xx,
  sends `X-Cron-Secret` from `CRON_SECRET`, and has a 30s request timeout
  (exit 3) so a wedged CRM server can't hang the cron run with no exit code.
  An auth failure can no longer log `Upserted: undefined` and look like success.
- Scrape exceptions no longer fall through to a "0 bonds, nothing to sync"
  success exit — they exit 1 without upserting.
- Pagination: repeated-page detection (same first bond number as previous page
  stops with a warning); hard cap raised to env `RLI_MAX_PAGES` (default 40,
  was 20). Dedupe is now global across pages, not per-page.
- Credentials from env ONLY. Missing env = exit 4 before the browser launches.
  The hardcoded Okta username/password are gone from the source.
- `puppeteer-core` resolves via `NODE_PATH` first, falling back to the old
  hardcoded `/usr/local/lead-gen/node_modules/puppeteer-core` path.

## Environment variables

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `RLI_USERNAME` | yes | — | Okta login |
| `RLI_PASSWORD` | yes | — | Okta password |
| `CRON_SECRET`  | yes (not for `--dry-run`) | — | must match CRM server's `CRON_SECRET` |
| `CRM_API`      | no | `http://localhost:4001` | base URL; `/api/bookkeeping/...` appended |
| `RLI_MAX_PAGES`| no | `40` | pagination hard cap |
| `CHROMIUM_PATH`| no | `/usr/bin/chromium-browser` | |
| `RLI_SKIPPED_FILE` | no | `/var/log/mybondapp-sync.skipped.json` | skipped-card report |

Recommended: put secrets in `/opt/quantum-ops/rli.env` (`chmod 600`, root-owned):

```
RLI_USERNAME=nice.shotwell-sparks@quantumsurety.bond
RLI_PASSWORD=<okta password>
CRON_SECRET=<same value the CRM server was started with>
```

## Deploy

From the machine holding this repo copy:

```bash
scp R:/scripts/rli/mybondapp_sync.cjs root@130.51.22.226:/opt/quantum-ops/mybondapp_sync.cjs
```

(Keep a backup first: `ssh root@130.51.22.226 'cp /opt/quantum-ops/mybondapp_sync.cjs /opt/quantum-ops/mybondapp_sync.cjs.bak-$(date +%F)'`)

Update the crontab (replaces the documented 5:05 AM line). `set -a` auto-exports
everything in the env file, so nothing in `rli.env` is silently left unexported:

```
5 5 * * *   set -a; . /opt/quantum-ops/rli.env; set +a; NODE_PATH=/root/node_modules node /opt/quantum-ops/mybondapp_sync.cjs >> /var/log/mybondapp-sync.log 2>&1
```

The job's exit code is deliberately NOT masked — exit-code-keyed alerting
(cron `MAILTO`, or your monitor watching cron job status) is the alarm channel.
If you also want a local alerts file, use a form that preserves the exit code
instead of an `|| echo` tail (which would make every failure exit 0):

```
5 5 * * *   set -a; . /opt/quantum-ops/rli.env; set +a; NODE_PATH=/root/node_modules node /opt/quantum-ops/mybondapp_sync.cjs >> /var/log/mybondapp-sync.log 2>&1; rc=$?; [ $rc -ne 0 ] && echo "mybondapp_sync exit=$rc $(date -Is)" >> /var/log/mybondapp-sync.alerts.log; exit $rc
```

Leave the 7:06 `bk_status_sync.cjs` and 7:10 `bk_revenue_report.cjs` lines untouched.

Verify before going live:

```bash
ssh root@130.51.22.226
cd /opt/quantum-ops && set -a && . ./rli.env && set +a
NODE_PATH=/root/node_modules node mybondapp_sync.cjs --dry-run   # parse only, no writes
echo $?                                                          # expect 0
```

## Exit codes (cron alerting)

| Code | Meaning | Action |
|------|---------|--------|
| 0 | success | none |
| 1 | fatal: login / navigation / scrape exception (nothing upserted) | check log; MFA re-auth if session expired |
| 2 | parse-quality / completeness alarm: zero bonds on page 1 (nothing upserted); OR — parsed bonds WERE upserted first — skipped > 10% of cards, pagination stopped advancing, `RLI_MAX_PAGES` truncated the list, or cards seen fell more than one page short of the portal's own "of Z Items" total | inspect `/tmp/rli_page1.txt` and the skipped-report JSON — portal layout drift or truncation |
| 3 | CRM API failure: non-2xx, 30s timeout, network error, or malformed upsert response | check CRM server + `CRON_SECRET` match; response body is in the log |
| 4 | missing required env vars (exits before browser launch) | fix crontab/env file |

The old script exited 0 on nearly every failure; any cron alerting keyed on
non-zero exit will start working now. Expect exit 2 on the first run if the
portal has drifted — that is the alarm doing its job.

## Rollback

```bash
ssh root@130.51.22.226 'cp /opt/quantum-ops/mybondapp_sync.cjs.bak-<DATE> /opt/quantum-ops/mybondapp_sync.cjs'
```

and restore the previous crontab line. Intermediate option: keep the new script
but add `--legacy-rates` to the cron line to restore the old fabricated
amount/premium/commission behavior while keeping the auth header, status
checking, skipped-list, and exit-code fixes. Note the OLD script has hardcoded
credentials and sends no `X-Cron-Secret` — after commit `4f83db8` on the CRM
server the old script's upserts will fail (and it would report success anyway),
so full rollback also requires reverting the endpoint hardening.

## Payload shape (per bond)

Always: `bond_number, bond_type, premium (number|0|null), bond_amount (number|null),
effective_date, expiration_date (null allowed for drafts), status, status_detail,
needs_review, carrier_id, source:"mybondapp"`.
When present on the card: `insured_name, description, submission_no,
principal_address, insured_email, insured_phone`. Omitted otherwise so the
server keeps existing values. Extras (`needs_review_reasons, status_lines`) are
ignored server-side if unhandled. `commission_rate` only with `--legacy-rates`.

**Pre-deploy check with the endpoint workstream:** confirm the hardened
endpoint accepts `bond_type: "unknown"`. If it enum-validates bond types and
rejects it, the whole batch 4xxes and this script exits 3 (loud, nothing
partially written) — but the sync is down until either `"unknown"` is added to
the enum or `--legacy-rates` is used as a stopgap.

---

# Part 2: rli_revenue_sync.py (weekly, Tuesdays 6 AM)

Drop-in replacement for the weekly Zoho-IMAP → XLS → `revenue_events` ingest.
The weekly XLS is RLI **ground truth** for financials.

## What changed

- **Corrections are now APPLIED** — the old `ON CONFLICT DO NOTHING` is now
  `DO UPDATE`: financial/term columns (`bond_type, coverage, bond_amount,
  premium, commission, effective_date, expiry_date`) are fully overwritten from
  the newest XLS snapshot. This is a behavior change to ground-truth
  financials: RLI corrections in later weekly reports now land in
  `revenue_events` instead of being silently ignored.
- **Contact fields are protected**: `principal_name / email / phone` only
  overwrite when the new snapshot has a non-blank value
  (`COALESCE(NULLIF(EXCLUDED.x,''), old)`), so a blank cell in a later report
  can't erase a previously-known email/phone (which feed lead-sold matching
  and the bk_bonds contact backfill).
- **45-day IMAP window** (`SINCE`): no more re-parsing years of mail every run;
  weekly reports re-list the whole book, so 45 days is several full snapshots.
- **Lead-sold matching**: email or phone match ONLY — the old exact-name
  fallback was dropped (wrong-lead risk on common names).
- **Reconciliation flags are per-category** (`premium_mismatch`,
  `commission_mismatch`, `bond_amount_mismatch`, `missing_in_bk_bonds`) and the
  dedupe guard includes `scraper_source`, so a new kind of divergence is never
  hidden behind an older unresolved flag; an open flag whose detail changed
  gets its `error` text refreshed instead of going stale.
- **bk_bonds commission column is introspected** (commission_amt /
  commission_amount / commission / premium×commission_rate) instead of
  hardcoded — verify against the parallel-workstream schema anyway; if no
  commission column is found, commission comparison is skipped with a warning.
- **Reconciliation is report-only** for financials: divergences go to
  `bk_scraper_recon`; the only bk_bonds writes are email/phone backfill into
  EMPTY fields.
- **Loud failures** (see exit codes below): zero report emails, zero parsed
  bonds, or a reconciliation exception no longer exit 0.
- **Review-email safety cap**: if more than `RLI_REVIEW_EMAIL_CAP` (default 25)
  new bonds are eligible for a review email — e.g. a fresh/rebuilt
  `revenue_events` table makes the whole book "new" — the send is refused
  unless `--allow-bulk-email` is passed.

## Environment variables

| Var | Required | Notes |
|-----|----------|-------|
| `CRM_DB_PASSWORD` | yes | Postgres `quantum_user` (127.0.0.1:5433/quantum_surety) |
| `ZOHO_ADMIN_APP_PASSWORD` | yes | IMAP app password for administrator@quantumsurety.bond |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | for emails | SES us-east-2 |
| `RLI_REVIEW_EMAILS` | no | `0` disables review emails (same as `--no-email`) |
| `RLI_REVIEW_EMAIL_CAP` | no | bulk-send refusal threshold (default 25) |

Loaded from `/usr/local/etc/qs-crm.env` if present (setdefault — real env wins).

## Exit codes (cron alerting)

| Code | Meaning |
|------|---------|
| 0 | success |
| 2 | ingest dead: no "MyBondApp Weekly Report" emails in the 45-day window (subject drift / delivery failure), or emails found but zero bonds parsed (attachment format drift) |
| 3 | reconciliation raised (revenue upsert WAS committed first) |

## Deploy

```bash
ssh root@130.51.22.226 'cp /opt/quantum-ops/rli_revenue_sync.py /opt/quantum-ops/rli_revenue_sync.py.bak-$(date +%F)'
scp R:/scripts/rli/rli_revenue_sync.py root@130.51.22.226:/opt/quantum-ops/rli_revenue_sync.py
```

Crontab (same slot as before; exit code not masked — see Part 1 alerting note):

```
0 6 * * 2   python3 /opt/quantum-ops/rli_revenue_sync.py >> /var/log/rli-revenue-sync.log 2>&1
```

## Verify before going live

```bash
ssh root@130.51.22.226
python3 /opt/quantum-ops/rli_revenue_sync.py --no-email
echo $?    # expect 0; check the printed reconciliation summary table
```

`--no-email` runs the full ingest + reconciliation but sends nothing. On the
FIRST run after deploy, expect a burst of "corrected" rows (the DO UPDATE
applying corrections DO NOTHING had been swallowing) and possibly many
recon flags — that's the backlog surfacing, not a malfunction.

## Rollback

```bash
ssh root@130.51.22.226 'cp /opt/quantum-ops/rli_revenue_sync.py.bak-<DATE> /opt/quantum-ops/rli_revenue_sync.py'
```

Note rollback resurrects: DO NOTHING (corrections dropped), full-history IMAP
re-parse, exact-name lead matching, and exit-0-on-everything.
