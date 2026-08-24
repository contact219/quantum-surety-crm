# TDLR License Sync (`scripts/sync_tdlr.py`)

Cron-schedulable replacement for the one-shot `migrate_tdlr.py` (which is kept
untouched for history). Each run:

1. **Self-migrates** the schema: `ALTER TABLE tdlr_licenses ADD COLUMN IF NOT
   EXISTS last_seen_at / is_active` and `CREATE TABLE IF NOT EXISTS
   tdlr_sync_log` (all additive, safe on the live DB; also appended to
   `create_tdlr_table.sql`).
2. Opens an SSH pipe to the VPS and streams `mysql --batch` output of the
   `contractors` table.
3. **Parses correctly**: lines are split on real tab characters first, then
   each field is unescaped (`\t`→TAB, `\n`→newline, `\\`→backslash, `\0`
   stripped) — the escaping `mysql --batch` applies, which the old script's
   `csv.reader` never undid. The literal string `NULL` becomes SQL NULL for
   **every** column (the old script left the text "NULL" in phone/name/etc.,
   producing `tel:NULL` links in the UI). Lines with the wrong column count
   are never truncated or silently skipped — they are written to a reject log
   with a reason.
4. **Upserts** on `license_number`, setting `updated_at = NOW()`,
   `last_seen_at = NOW()`, `is_active = true`.
5. After a **full successful** load, **sweeps**: any row whose `last_seen_at`
   predates the run start is set `is_active = false` (rows are never deleted).
   Rows that reappear upstream are automatically reactivated by the upsert;
   the count of reactivations is recorded.
6. Records the whole run in `tdlr_sync_log`
   (`running` → `success` / `failed` / `aborted_sanity`).

## Required environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | CRM PostgreSQL URL, e.g. `postgres://quantum_user:...@localhost:5433/quantum_surety` |
| `TDLR_MYSQL_USER` | yes | — | MySQL user on the VPS |
| `TDLR_MYSQL_PASSWORD` | yes | — | Sent over the SSH channel on stdin and exported as `MYSQL_PWD` on the remote side — never appears on any command line |
| `TDLR_SSH_HOST` | no | `130.51.23.147` | |
| `TDLR_SSH_USER` | no | `root` | |
| `TDLR_MYSQL_DB` | no | `bondverify` | |
| `TDLR_SANITY_RATIO` | no | `0.8` | Sanity-guard threshold (see below) |
| `TDLR_REJECT_LOG` | no | `<script dir>/tdlr_sync_rejects.log` | Rejected source lines are appended here with line number and reason |

A missing required variable exits immediately with a clear message — there are
no hardcoded fallbacks (the old script's embedded passwords are gone).

SSH runs with `BatchMode=yes` and `StrictHostKeyChecking=accept-new`; make sure
the cron user has a key authorized on the VPS.

## Flags

- `--dry-run` — fetch and parse the source, report row/reject/duplicate counts
  and whether the sanity guard would trip. Writes **nothing** (no DDL, no
  upserts, no sync-log row).
- `--limit N` — stop after N accepted rows, for testing. A limited run skips
  the sanity guard **and the sweep** (a partial load must never deactivate the
  rest of the table).

Exit codes: `0` success or dry-run, `1` failure, `2` sanity abort — so cron
mail / monitoring can distinguish them.

## Sanity guard

Before writing, the script compares the parsed source row count against the
current active count in Postgres. If the source has fewer than
`TDLR_SANITY_RATIO` (default 80%) of the currently active rows — e.g. the
upstream scraper half-failed and the table is short — the run stops with
status `aborted_sanity`, **no upserts and no sweep happen**, and the reason is
stored in `tdlr_sync_log.error`. This prevents a bad upstream pull from mass-
deactivating the dataset.

## Sweep semantics

- The run start timestamp is taken from the sync-log insert (`started_at`).
- Every source row touched by the upsert gets `last_seen_at = NOW()`.
- After all upserts commit, one UPDATE sets `is_active = false` where
  `last_seen_at` is NULL or older than `started_at` and the row is not already
  inactive. Nothing is ever deleted, so historical licenses stay queryable.
- A previously deactivated license that reappears upstream is set back to
  `is_active = true` by the upsert; the run's `reactivated` count is logged.

## First run / backfilling `is_active`

No manual backfill is needed:

- `ADD COLUMN is_active BOOLEAN DEFAULT true` marks every existing row active
  immediately (PostgreSQL fills the default for existing rows).
- `last_seen_at` starts NULL everywhere. The **first full successful sync**
  stamps `last_seen_at` on every row still present upstream, and its sweep
  then deactivates exactly the rows the upstream source no longer has — this
  first sweep *is* the backfill. Expect a one-time larger `deactivated` count
  in `tdlr_sync_log` for that run; review it with:

  ```sql
  SELECT * FROM tdlr_sync_log ORDER BY id DESC LIMIT 5;
  SELECT COUNT(*) FROM tdlr_licenses WHERE is_active = false;
  ```

  If you want a preview before committing to it, run `--dry-run` first.

## Scheduling

TDLR data does not churn daily — weekly is plenty. Suggested crontab (Sunday
03:15, CRM server), with secrets sourced from a root-only env file:

```cron
15 3 * * 0 . /etc/quantum-surety/tdlr-sync.env && /usr/bin/python3 /path/to/scripts/sync_tdlr.py >> /var/log/tdlr_sync.log 2>&1
```

`/etc/quantum-surety/tdlr-sync.env` (chmod 600):

```sh
export DATABASE_URL='postgres://quantum_user:...@localhost:5433/quantum_surety'
export TDLR_MYSQL_USER='bondverify'
export TDLR_MYSQL_PASSWORD='...'
```

## Monitoring

Every run leaves a `tdlr_sync_log` row. A `status` of `running` that never
resolves means the process died hard (e.g. OOM/kill) — check the cron log.
`failed` rows carry the exception text in `error`; `aborted_sanity` rows carry
the count comparison that tripped the guard. Rejected source lines accumulate
in the reject log with line numbers and reasons for later inspection.
