#!/usr/bin/env python3
"""
sync_tdlr.py — production, cron-schedulable TDLR license sync.

Replaces the one-shot migrate_tdlr.py (kept for history). Reads the
`contractors` table from the VPS MariaDB over SSH (mysql --batch), parses it
CORRECTLY (unescaping mysql batch escapes), and add-or-updates rows in the CRM
PostgreSQL `tdlr_licenses` table keyed on license_number. The full source is
buffered in memory before writing (required for dedupe and the sanity guard;
~tens of MB at current table size). All writes — upserts AND sweep — happen in
ONE transaction committed at the end, so a mid-run failure leaves the table
exactly as it was. After a full clean load it sweeps: rows not seen this run
are marked is_active=false (never deleted); rows seen again are reactivated.
The sweep is SKIPPED whenever any source line was rejected this run (a
rejected line may be a live license; deactivating it would be wrong) — the
skip reason is recorded in tdlr_sync_log.error. Every run is recorded in
tdlr_sync_log; runs left in status 'running' for over 6 hours (hard kill,
cron timeout) are marked 'abandoned' at the start of the next run.
Self-migrating: required DDL (last_seen_at, is_active, tdlr_sync_log) is
applied at start with IF NOT EXISTS guards.

DATA FIDELITY NOTES (known, intentional deviations from byte-fidelity):
  * Empty-string fields are stored as SQL NULL (`'' -> NULL`) for every
    nullable column. This is a deliberate normalization: the CRM treats '' and
    NULL as "no value" and the API/UI filter on NULL-ness. business_state is
    stored faithfully (NULL stays NULL — no 'TX' is fabricated here; the
    column's DDL DEFAULT applies only to rows inserted without the column).
  * mysql --batch prints SQL NULL and a field whose genuine string value is
    exactly 'NULL' identically; the exact 4-char string 'NULL' is therefore
    mapped to SQL NULL. A business literally named "NULL" is indistinguishable
    from a missing value at the transport level ("NULLING CO" etc. are safe).
  * NUL bytes (escaped \\0 in the batch stream) are dropped: PostgreSQL text
    cannot store NUL. Fields containing NUL land altered by that one byte.
  * Lines that are not valid UTF-8 are REJECTED (logged to the reject log),
    never silently mangled with replacement characters.
  * Rows with a missing/empty license_type are rejected: the DDL declares
    license_type TEXT NOT NULL, and inserting NULL would abort the whole run.

REQUIRED environment variables (no fallbacks — missing values exit loudly):
  DATABASE_URL         PostgreSQL DSN/URL for the CRM database,
                       e.g. postgres://user:pass@localhost:5433/quantum_surety
  TDLR_MYSQL_USER      MySQL user on the VPS
  TDLR_MYSQL_PASSWORD  MySQL password (delivered to the remote mysql client
                       via MYSQL_PWD read from stdin — never on a command line)

OPTIONAL environment variables (defaults shown):
  TDLR_SSH_HOST        130.51.23.147
  TDLR_SSH_USER        root
  TDLR_MYSQL_DB        bondverify
  TDLR_SANITY_RATIO    0.8   (abort if source rows < ratio * current active)
  TDLR_REJECT_LOG      <script dir>/tdlr_sync_rejects.log

Flags:
  --dry-run   parse the source and report counts; write NOTHING to the DB
  --limit N   stop after N accepted rows (testing). Implies: no sanity guard,
              no sweep (a partial load must never deactivate rows).

Exit codes: 0 success (or clean dry-run), 1 failure, 2 aborted_sanity.

Dependencies: Python stdlib + psycopg2 only.
"""

import argparse
import os
import re
import shlex
import subprocess
import sys
import tempfile
from datetime import datetime

import psycopg2
import psycopg2.extras

BATCH_SIZE = 2000
EXPECTED_COLUMNS = 13
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

QUERY = (
    "SELECT license_type, license_number, business_county, business_name, "
    "business_address, business_city, business_state, business_zip, "
    "business_phone, expire_date, owner_name, owner_phone, license_subtype "
    "FROM contractors"
)

DDL_STATEMENTS = [
    "ALTER TABLE tdlr_licenses ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP",
    "ALTER TABLE tdlr_licenses ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true",
    """CREATE TABLE IF NOT EXISTS tdlr_sync_log (
         id           SERIAL PRIMARY KEY,
         started_at   TIMESTAMP,
         finished_at  TIMESTAMP,
         source_count INT,
         upserted     INT,
         deactivated  INT,
         reactivated  INT,
         rejected     INT,
         status       TEXT,
         error        TEXT
       )""",
]

UPSERT_SQL = """
    INSERT INTO tdlr_licenses
        (license_type, license_number, business_county, business_name,
         business_address, business_city, business_state, business_zip,
         business_phone, expire_date, owner_name, owner_phone, license_subtype,
         updated_at, last_seen_at, is_active)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, NOW(), NOW(), true)
    ON CONFLICT (license_number) DO UPDATE SET
        license_type     = EXCLUDED.license_type,
        business_county  = EXCLUDED.business_county,
        business_name    = EXCLUDED.business_name,
        business_address = EXCLUDED.business_address,
        business_city    = EXCLUDED.business_city,
        business_state   = EXCLUDED.business_state,
        business_zip     = EXCLUDED.business_zip,
        business_phone   = EXCLUDED.business_phone,
        expire_date      = EXCLUDED.expire_date,
        owner_name       = EXCLUDED.owner_name,
        owner_phone      = EXCLUDED.owner_phone,
        license_subtype  = EXCLUDED.license_subtype,
        updated_at       = NOW(),
        last_seen_at     = NOW(),
        is_active        = true
"""

# mysql --batch escapes exactly these in field data: NUL, tab, newline, backslash.
_BATCH_ESCAPES = {"\\0": "", "\\t": "\t", "\\n": "\n", "\\\\": "\\"}
_BATCH_ESCAPE_RE = re.compile(r"\\[0tn\\]")


def unescape_batch_field(field):
    """Decode mysql --batch escape sequences in one field.

    Must run AFTER splitting the line on real tab characters: separators are
    raw tabs, while tab/newline/NUL/backslash inside data arrive escaped.
    A single regex pass guarantees '\\\\t' decodes to backslash + 't', not
    backslash + TAB.
    """
    if "\\" not in field:
        return field
    return _BATCH_ESCAPE_RE.sub(lambda m: _BATCH_ESCAPES[m.group(0)], field)


def env_or_die(name):
    value = os.environ.get(name)
    if not value:
        print(f"FATAL: required environment variable {name} is not set.", file=sys.stderr)
        sys.exit(1)
    return value


def parse_args():
    p = argparse.ArgumentParser(description="Sync TDLR licenses from VPS MariaDB into CRM PostgreSQL.")
    p.add_argument("--dry-run", action="store_true", help="parse and report counts; write nothing")
    p.add_argument("--limit", type=int, default=None, metavar="N",
                   help="stop after N accepted rows (testing; disables sanity guard and sweep)")
    return p.parse_args()


def open_source_stream(ssh_host, ssh_user, mysql_db, mysql_user, mysql_password, stderr_file):
    """Start the remote mysql --batch dump. The password travels over the SSH
    channel on stdin and is read into MYSQL_PWD by the remote shell — it never
    appears on any local or remote command line."""
    remote_cmd = (
        "IFS= read -r MYSQL_PWD && export MYSQL_PWD && "
        "exec mysql -u {user} {db} --batch --quick -e {query}".format(
            user=shlex.quote(mysql_user),
            db=shlex.quote(mysql_db),
            query=shlex.quote(QUERY),
        )
    )
    cmd = [
        "ssh",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        f"{ssh_user}@{ssh_host}",
        remote_cmd,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=stderr_file)
    proc.stdin.write((mysql_password + "\n").encode("utf-8"))
    proc.stdin.close()
    return proc


def parse_stream(stdout, limit, reject):
    """Parse the mysql --batch byte stream.

    Returns (rows, duplicate_count). rows is an OrderedDict-like dict keyed by
    license_number (last occurrence wins), values are 13-tuples ready for the
    upsert. Rejected lines go through reject(line, reason). No truncation:
    a line with the wrong column count is rejected whole, never sliced.
    """
    rows = {}
    duplicates = 0
    line_no = 0
    header_seen = False

    for raw in stdout:
        line_no += 1
        # Rows are terminated by a real newline; newlines inside data arrive
        # escaped as \n, so line-based reading is safe. Strip only the
        # terminator (a bare \r is legal data — mysql does not escape it).
        # Decode STRICT: a non-UTF-8 line is rejected and logged, never
        # silently mangled into U+FFFD replacement characters.
        try:
            line = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            readable = raw.decode("utf-8", errors="replace")
            if readable.endswith("\n"):
                readable = readable[:-1]
            reject(line_no, readable, f"invalid UTF-8: {exc}")
            continue
        if line.endswith("\n"):
            line = line[:-1]

        if not header_seen:
            header_cols = line.split("\t")
            if len(header_cols) != EXPECTED_COLUMNS:
                raise RuntimeError(
                    f"unexpected header ({len(header_cols)} columns, expected "
                    f"{EXPECTED_COLUMNS}): {line[:200]!r}"
                )
            header_seen = True
            continue

        if line == "":
            continue

        # Field separators are RAW tabs; tabs inside data are escaped (\t),
        # so splitting on the real tab character before unescaping is exact.
        raw_fields = line.split("\t")
        if len(raw_fields) != EXPECTED_COLUMNS:
            reject(line_no, line, f"expected {EXPECTED_COLUMNS} columns, got {len(raw_fields)}")
            continue

        # Unescape each field, then map the literal string NULL (mysql's
        # representation of SQL NULL) to None — for EVERY column.
        fields = [unescape_batch_field(f) for f in raw_fields]
        fields = [None if f == "NULL" else f for f in fields]

        (license_type, license_number, county, biz_name, address, city, state,
         zip_, phone, expire_date, owner_name, owner_phone, subtype) = fields

        if not license_number or not license_number.strip():
            reject(line_no, line, "missing license_number")
            continue
        license_number = license_number.strip()

        # license_type is TEXT NOT NULL in the DDL: a NULL here would abort
        # the entire upsert transaction, so reject the row instead.
        if not license_type or not license_type.strip():
            reject(line_no, line, "missing license_type")
            continue

        if expire_date == "0000-00-00":
            expire_date = None
        elif expire_date is not None and not DATE_RE.match(expire_date):
            reject(line_no, line, f"unparseable expire_date {expire_date!r}")
            continue
        elif expire_date is not None:
            # Shape-valid but calendar-invalid dates (e.g. 2015-06-00 or
            # 2026-02-30, emittable by MariaDB under legacy sql_mode) would
            # otherwise abort the whole transaction at the Postgres cast.
            y, m, d = (int(p) for p in expire_date.split("-"))
            if m == 0 or d == 0:
                expire_date = None
            else:
                try:
                    datetime(y, m, d)
                except ValueError:
                    reject(line_no, line, f"impossible expire_date {expire_date!r}")
                    continue

        if license_number in rows:
            duplicates += 1

        # '' -> NULL normalization is intentional (see module docstring).
        # business_state is stored faithfully: an upstream NULL/empty state
        # stays NULL — no 'TX' is ever fabricated in the sync path.
        rows[license_number] = (
            license_type, license_number, county or None, biz_name or None,
            address or None, city or None, state or None, zip_ or None,
            phone or None, expire_date, owner_name or None, owner_phone or None,
            subtype or None,
        )

        if limit is not None and len(rows) >= limit:
            break

    if not header_seen:
        raise RuntimeError("no output received from remote mysql (empty stream)")

    return rows, duplicates


def main():
    args = parse_args()

    ssh_host = os.environ.get("TDLR_SSH_HOST", "130.51.23.147")
    ssh_user = os.environ.get("TDLR_SSH_USER", "root")
    mysql_db = os.environ.get("TDLR_MYSQL_DB", "bondverify")
    mysql_user = env_or_die("TDLR_MYSQL_USER")
    mysql_password = env_or_die("TDLR_MYSQL_PASSWORD")
    database_url = env_or_die("DATABASE_URL")
    sanity_ratio = float(os.environ.get("TDLR_SANITY_RATIO", "0.8"))

    script_dir = os.path.dirname(os.path.abspath(__file__))
    reject_path = os.environ.get("TDLR_REJECT_LOG",
                                 os.path.join(script_dir, "tdlr_sync_rejects.log"))

    reject_records = []

    def reject(line_no, line, reason):
        reject_records.append((line_no, reason, line))

    print(f"[{datetime.now().isoformat(timespec='seconds')}] TDLR sync starting "
          f"(dry_run={args.dry_run}, limit={args.limit})", flush=True)

    pg = psycopg2.connect(database_url)
    cur = pg.cursor()

    sync_log_id = None
    run_started_at = None
    exit_code = 0

    try:
        if not args.dry_run:
            # Self-migrate schema (all guarded, safe on live DB).
            for ddl in DDL_STATEMENTS:
                cur.execute(ddl)
            pg.commit()

            # A hard kill (SIGKILL, cron timeout) can leave a run stuck at
            # 'running' forever; reap anything older than 6 hours so /meta
            # never reports a dead run as the latest sync indefinitely.
            cur.execute(
                "UPDATE tdlr_sync_log SET status='abandoned', finished_at=NOW() "
                "WHERE status='running' AND started_at < NOW() - INTERVAL '6 hours'"
            )
            cur.execute(
                "INSERT INTO tdlr_sync_log (started_at, status) VALUES (NOW(), 'running') "
                "RETURNING id, started_at"
            )
            sync_log_id, run_started_at = cur.fetchone()
            pg.commit()

        # ---- fetch + parse source ------------------------------------------
        with tempfile.TemporaryFile() as stderr_file:
            proc = open_source_stream(ssh_host, ssh_user, mysql_db,
                                      mysql_user, mysql_password, stderr_file)
            try:
                rows, duplicates = parse_stream(proc.stdout, args.limit, reject)
            finally:
                if args.limit is not None:
                    proc.kill()
                proc.stdout.close()
                proc.wait()

            if args.limit is None and proc.returncode != 0:
                stderr_file.seek(0)
                err = stderr_file.read().decode("utf-8", errors="replace").strip()
                raise RuntimeError(
                    f"ssh/mysql exited with code {proc.returncode}: {err[:2000]}"
                )

        source_count = len(rows)
        rejected = len(reject_records)

        if reject_records:
            with open(reject_path, "a", encoding="utf-8") as f:
                f.write(f"# run {datetime.now().isoformat(timespec='seconds')} "
                        f"— {rejected} rejected line(s)\n")
                for line_no, reason, line in reject_records:
                    f.write(f"line {line_no}\t{reason}\t{line}\n")
            print(f"  {rejected} rejected line(s) written to {reject_path}", flush=True)

        print(f"  source rows: {source_count:,} (duplicate license_numbers "
              f"collapsed: {duplicates:,}, rejected: {rejected:,})", flush=True)

        # ---- current active count (for sanity guard / reporting) -----------
        active_count = None
        try:
            cur.execute("SELECT COUNT(*) FROM tdlr_licenses WHERE is_active IS DISTINCT FROM false")
            active_count = cur.fetchone()[0]
        except psycopg2.Error:
            pg.rollback()  # is_active may not exist yet on a dry-run before first real run
            try:
                cur.execute("SELECT COUNT(*) FROM tdlr_licenses")
                active_count = cur.fetchone()[0]
            except psycopg2.Error as exc:
                # 42P01 undefined_table: dry runs skip DDL, and the table may
                # not exist at all yet — report a clean zero, don't traceback.
                if exc.pgcode != "42P01":
                    raise
                pg.rollback()
                active_count = 0
        print(f"  currently active in DB: {active_count:,}", flush=True)

        guard_trips = (active_count > 0
                       and source_count < sanity_ratio * active_count)

        # ---- dry run: report and stop --------------------------------------
        if args.dry_run:
            print("  DRY RUN — nothing written.")
            if args.limit is None:
                print(f"  sanity guard would {'TRIP (run would abort)' if guard_trips else 'pass'} "
                      f"(threshold {sanity_ratio:.0%} of {active_count:,})")
            return

        # ---- sanity guard ---------------------------------------------------
        if args.limit is None and guard_trips:
            msg = (f"source row count {source_count} is below {sanity_ratio:.0%} of "
                   f"current active count {active_count}; refusing to sync/sweep")
            cur.execute(
                "UPDATE tdlr_sync_log SET finished_at=NOW(), source_count=%s, "
                "rejected=%s, status='aborted_sanity', error=%s WHERE id=%s",
                (source_count, rejected, msg, sync_log_id))
            pg.commit()
            print(f"ABORTED (sanity guard): {msg}", file=sys.stderr, flush=True)
            exit_code = 2
            return

        # ---- reactivation count (rows currently inactive that reappear) -----
        license_numbers = list(rows.keys())
        reactivated = 0
        if license_numbers:
            cur.execute(
                "SELECT COUNT(*) FROM tdlr_licenses "
                "WHERE is_active = false AND license_number = ANY(%s)",
                (license_numbers,))
            reactivated = cur.fetchone()[0]

        # ---- upsert (ONE transaction: upserts + sweep + log commit together;
        # a mid-run failure rolls back everything, never mixed-vintage data) --
        upserted = 0
        batch = []
        for values in rows.values():
            batch.append(values)
            if len(batch) >= BATCH_SIZE:
                psycopg2.extras.execute_batch(cur, UPSERT_SQL, batch, page_size=BATCH_SIZE)
                upserted += len(batch)
                batch = []
                print(f"  upserted {upserted:,}...", end="\r", flush=True)
        if batch:
            psycopg2.extras.execute_batch(cur, UPSERT_SQL, batch, page_size=BATCH_SIZE)
            upserted += len(batch)
        print(f"  upserted {upserted:,} rows          ", flush=True)

        # ---- sweep (full, CLEAN loads only) ----------------------------------
        # A rejected source line may correspond to a license that is still live
        # upstream; sweeping would wrongly deactivate it. So the sweep only
        # runs when every source line parsed, and the skip is recorded in the
        # sync log so it is visible in /meta.
        deactivated = 0
        sweep_note = None
        if args.limit is not None:
            sweep_note = "sweep skipped: --limit given (partial load)"
        elif rejected > 0:
            sweep_note = (f"sweep skipped: {rejected} rejected line(s) — "
                          f"rejected rows must not be deactivated (see reject log)")
        else:
            cur.execute(
                "UPDATE tdlr_licenses SET is_active=false, updated_at=NOW() "
                "WHERE (last_seen_at IS NULL OR last_seen_at < %s) "
                "AND is_active IS DISTINCT FROM false",
                (run_started_at,))
            deactivated = cur.rowcount
            print(f"  swept: {deactivated:,} deactivated, {reactivated:,} reactivated", flush=True)
        if sweep_note:
            print(f"  {sweep_note}", flush=True)

        cur.execute(
            "UPDATE tdlr_sync_log SET finished_at=NOW(), source_count=%s, upserted=%s, "
            "deactivated=%s, reactivated=%s, rejected=%s, status='success', error=%s "
            "WHERE id=%s",
            (source_count, upserted, deactivated, reactivated, rejected, sweep_note,
             sync_log_id))
        pg.commit()  # single atomic commit: upserts + sweep + success log
        print(f"[{datetime.now().isoformat(timespec='seconds')}] TDLR sync complete: "
              f"{upserted:,} upserted, {deactivated:,} deactivated, "
              f"{reactivated:,} reactivated, {rejected:,} rejected.", flush=True)

    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — record any failure in the sync log
        pg.rollback()
        if sync_log_id is not None:
            try:
                # The load is one transaction, so after rollback exactly zero
                # rows were committed this run — record that, not NULL.
                cur.execute(
                    "UPDATE tdlr_sync_log SET finished_at=NOW(), status='failed', "
                    "upserted=0, deactivated=0, error=%s WHERE id=%s",
                    (f"{type(exc).__name__}: {exc}"[:4000], sync_log_id))
                pg.commit()
            except psycopg2.Error:
                pg.rollback()
        print(f"FAILED: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        exit_code = 1
    finally:
        pg.close()
        if exit_code != 0:
            sys.exit(exit_code)


if __name__ == "__main__":
    main()
