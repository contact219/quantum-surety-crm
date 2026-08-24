#!/usr/bin/env python3
"""
RLI MyBondApp weekly report -> revenue ledger + ground-truth reconciliation.

Fetches 'MyBondApp Weekly Report' emails from administrator@ (Zoho IMAP,
last 45 days only), parses the .xls attachment, upserts revenue_events
(idempotent by bond_no, corrections APPLIED via ON CONFLICT DO UPDATE),
reconciles the RLI ground-truth financials against bk_bonds (report-only
divergence flags into bk_scraper_recon, plus email/phone backfill into
empty bk_bonds contact fields), marks matching CRM leads sold (email or
phone match only), and sends review-request emails (via SES) for any
newly inserted bonds whose email wasn't caught by the daily scraper.

The weekly XLS is RLI GROUND TRUTH for financials. This script never
auto-corrects bk_bonds premium/commission/bond_amount — it only reports
divergences; correcting bk_bonds belongs to the CRM upsert path.

Cron: 0 6 * * 2  (Tuesdays 6 AM CT; reports arrive Monday evenings)
Flags: --no-email  (or env RLI_REVIEW_EMAILS=0) skips review emails.
       --allow-bulk-email  overrides the review-email safety cap
       (default 25, env RLI_REVIEW_EMAIL_CAP) for legitimate bulk sends.

Exit codes (for cron alerting):
  0 = success
  2 = ingest dead: no weekly-report emails found in the window, or emails
      found but zero bonds parsed (subject drift / attachment format drift)
  3 = reconciliation failed (revenue upsert WAS committed before this)
"""
import argparse
import email
import imaplib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

import boto3
import psycopg2
import xlrd


def _load_env(path="/usr/local/etc/qs-crm.env"):
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
    except OSError:
        pass


_load_env()
DB = dict(host="127.0.0.1", port=5433, dbname="quantum_surety",
          user="quantum_user", password=os.environ["CRM_DB_PASSWORD"])
IMAP_USER = "administrator@quantumsurety.bond"
IMAP_PASS = os.environ["ZOHO_ADMIN_APP_PASSWORD"]

GOOGLE_REVIEW   = "https://g.page/r/CaL6vCTM_zl7EAE/review"
SES_FROM        = "Nice Shotwell-Sparks <nice.shotwell-sparks@quantumsurety.bond>"
SES_REPLY       = "nice.shotwell-sparks@quantumsurety.bond"
# Path to the seen-bonds list maintained by rli_review_trigger.cjs
SEEN_BONDS_FILE = "/var/www/bondverify/rli_seen_bonds.json"

# Only fetch mail this recent. Weekly reports re-list the whole book, so 45
# days gives multiple overlapping snapshots without re-parsing years of mail.
IMAP_SINCE_DAYS = 45

# Financial tolerance: anything over one cent is a divergence.
CENT = Decimal("0.01")

DDL = """
CREATE TABLE IF NOT EXISTS revenue_events (
  id SERIAL PRIMARY KEY,
  bond_no TEXT UNIQUE NOT NULL,
  principal_name TEXT,
  email TEXT,
  phone TEXT,
  bond_type TEXT,
  coverage TEXT,
  bond_amount NUMERIC,
  premium NUMERIC,
  commission NUMERIC,
  effective_date DATE,
  expiry_date DATE,
  source TEXT DEFAULT 'rli_weekly',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE revenue_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE TABLE IF NOT EXISTS bk_scraper_recon (
  id SERIAL PRIMARY KEY,
  scraper_source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  flag TEXT NOT NULL,
  error TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
"""

UPSERT_SQL = """
    INSERT INTO revenue_events (bond_no, principal_name, email, phone, bond_type,
        coverage, bond_amount, premium, commission, effective_date, expiry_date)
    VALUES (%(bond_no)s, %(principal_name)s, %(email)s, %(phone)s, %(bond_type)s,
        %(coverage)s, %(bond_amount)s, %(premium)s, %(commission)s,
        %(effective_date)s, %(expiry_date)s)
    ON CONFLICT (bond_no) DO UPDATE SET
        -- Contact/identity fields: a BLANK cell in a newer snapshot must not
        -- erase a previously-known value (parse_xls yields '' for empty cells,
        -- and these feed lead-sold matching + bk_bonds contact backfill).
        principal_name = COALESCE(NULLIF(EXCLUDED.principal_name, ''), revenue_events.principal_name),
        email          = COALESCE(NULLIF(EXCLUDED.email, ''),          revenue_events.email),
        phone          = COALESCE(NULLIF(EXCLUDED.phone, ''),          revenue_events.phone),
        -- Financial/term fields: a real XLS value is ground truth and always
        -- wins, but a BLANK/unparseable cell (parse_xls yields None) must
        -- never erase a previously-known ground-truth number.
        bond_type      = COALESCE(NULLIF(EXCLUDED.bond_type, ''), revenue_events.bond_type),
        coverage       = COALESCE(NULLIF(EXCLUDED.coverage, ''),  revenue_events.coverage),
        bond_amount    = COALESCE(EXCLUDED.bond_amount,    revenue_events.bond_amount),
        premium        = COALESCE(EXCLUDED.premium,        revenue_events.premium),
        commission     = COALESCE(EXCLUDED.commission,     revenue_events.commission),
        effective_date = COALESCE(EXCLUDED.effective_date, revenue_events.effective_date),
        expiry_date    = COALESCE(EXCLUDED.expiry_date,    revenue_events.expiry_date),
        updated_at     = NOW()
    WHERE (revenue_events.principal_name, revenue_events.email, revenue_events.phone,
           revenue_events.bond_type, revenue_events.coverage, revenue_events.bond_amount,
           revenue_events.premium, revenue_events.commission,
           revenue_events.effective_date, revenue_events.expiry_date)
      IS DISTINCT FROM
          (COALESCE(NULLIF(EXCLUDED.principal_name, ''), revenue_events.principal_name),
           COALESCE(NULLIF(EXCLUDED.email, ''),          revenue_events.email),
           COALESCE(NULLIF(EXCLUDED.phone, ''),          revenue_events.phone),
           COALESCE(NULLIF(EXCLUDED.bond_type, ''), revenue_events.bond_type),
           COALESCE(NULLIF(EXCLUDED.coverage, ''),  revenue_events.coverage),
           COALESCE(EXCLUDED.bond_amount,    revenue_events.bond_amount),
           COALESCE(EXCLUDED.premium,        revenue_events.premium),
           COALESCE(EXCLUDED.commission,     revenue_events.commission),
           COALESCE(EXCLUDED.effective_date, revenue_events.effective_date),
           COALESCE(EXCLUDED.expiry_date,    revenue_events.expiry_date))
    RETURNING (xmax = 0) AS inserted
"""

# Per-category flag values (premium_mismatch / commission_mismatch /
# bond_amount_mismatch / missing_in_bk_bonds) so a NEW category of divergence
# is never suppressed by an older unresolved flag of a different category.
# Guard includes scraper_source. If an open flag of the SAME category exists
# but the detail has changed, RECON_UPDATE_SQL refreshes it instead of letting
# it go stale.
RECON_UPDATE_SQL = """
    UPDATE bk_scraper_recon
       SET error = %(error)s, created_at = NOW()
     WHERE scraper_source = %(source)s
       AND external_id = %(external_id)s
       AND flag = %(flag)s
       AND NOT COALESCE(resolved, FALSE)
       AND error IS DISTINCT FROM %(error)s
"""

RECON_INSERT_SQL = """
    INSERT INTO bk_scraper_recon (scraper_source, external_id, flag, error)
    SELECT %(source)s, %(external_id)s, %(flag)s, %(error)s
    WHERE NOT EXISTS (
        SELECT 1 FROM bk_scraper_recon
        WHERE scraper_source = %(source)s
          AND external_id = %(external_id)s
          AND flag = %(flag)s
          AND NOT COALESCE(resolved, FALSE)
    )
"""

_IMAP_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def imap_since_date(days=IMAP_SINCE_DAYS):
    """RFC 3501 date (locale-independent) for IMAP SEARCH SINCE."""
    d = datetime.now(timezone.utc) - timedelta(days=days)
    return f"{d.day:02d}-{_IMAP_MONTHS[d.month - 1]}-{d.year}"


def parse_xls(payload, results):
    wb = xlrd.open_workbook(file_contents=payload)
    sh = wb.sheet_by_index(0)
    headers = [str(sh.cell_value(0, c)).strip() for c in range(sh.ncols)]
    col = {h: i for i, h in enumerate(headers)}

    def cell(r, name):
        i = col.get(name)
        return sh.cell_value(r, i) if i is not None else ""

    def num(v):
        try:
            return round(float(v), 2)
        except (TypeError, ValueError):
            return None

    def xdate(v):
        try:
            return xlrd.xldate_as_datetime(float(v), wb.datemode).date().isoformat()
        except Exception:
            return None

    for r in range(1, sh.nrows):
        bond_no = str(cell(r, "BondNo")).strip()
        if not bond_no:
            continue
        results[bond_no] = dict(
            bond_no=bond_no,
            principal_name=str(cell(r, "PrincipalName")).strip(),
            email=str(cell(r, "EmailAddress")).strip().lower(),
            phone=re.sub(r"\D", "", str(cell(r, "PhoneNumber"))),
            bond_type=str(cell(r, "Description")).strip(),
            coverage=str(cell(r, "TypeofBondCoverage")).strip(),
            bond_amount=num(cell(r, "BondAmount")),
            premium=num(cell(r, "TotalPremium")),
            commission=num(cell(r, "TotalCommission")),
            effective_date=xdate(cell(r, "EffectiveDate")),
            expiry_date=xdate(cell(r, "ExpiryDate")),
        )


def send_review_email(ses_client, bond_no, principal_name, recipient_email, bond_type):
    first = (principal_name or "there").split()[0].capitalize()
    bond_label = bond_type or "Texas Notary Bond"
    subject = f"Thanks for your bond, {first} — one quick favor"

    html = f"""<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#1e293b;line-height:1.7;font-size:14px;">
  <p style="font-size:15px;">Hi {first},</p>
  <p>Thank you for choosing Quantum Surety for your {bond_label}. Your bond certificate was just issued — you're all set and protected.</p>
  <p>I have one small favor to ask. If the process was smooth and you'd recommend us, would you mind leaving a quick Google review? It takes about 60 seconds and makes a real difference for a small business like ours.</p>
  <p style="text-align:center;margin:32px 0;">
    <a href="{GOOGLE_REVIEW}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:6px;font-weight:700;font-size:15px;display:inline-block;">Leave a Google Review &#9733;</a>
  </p>
  <p style="color:#475569;">Either way — it was a pleasure earning your business. If you ever need another bond or have questions, I'm always reachable at <a href="tel:+12146668718" style="color:#2563eb;">(214) 666-8718</a> or just reply to this email.</p>
  <p style="margin-top:28px;">Warm regards,<br><strong>Nice Shotwell-Sparks</strong><br>
  <span style="color:#64748b;font-size:13px;">Quantum Surety LLC · TDI License #3480229<br>
  <a href="tel:+12146668718" style="color:#2563eb;">(214) 666-8718</a> · nice.shotwell-sparks@quantumsurety.bond</span></p>
  <div style="border-top:1px solid #e2e8f0;margin-top:24px;padding-top:14px;font-size:11px;color:#94a3b8;">
    Quantum Surety LLC · <a href="https://quantumsurety.bond" style="color:#94a3b8;">quantumsurety.bond</a>
  </div>
</div>"""

    text = (
        f"Hi {first},\n\nThank you for choosing Quantum Surety for your {bond_label}. "
        f"Your bond certificate was just issued — you're all set.\n\n"
        f"One small favor: if the process was smooth, would you mind leaving a quick Google review?\n\n"
        f"{GOOGLE_REVIEW}\n\n"
        f"Either way — pleasure earning your business.\n\n"
        f"Nice Shotwell-Sparks\nQuantum Surety LLC · TDI License #3480229\n(214) 666-8718 · nice.shotwell-sparks@quantumsurety.bond"
    )

    ses_client.send_email(
        Source=SES_FROM,
        Destination={"ToAddresses": [recipient_email]},
        ReplyToAddresses=[SES_REPLY],
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {
                "Html": {"Data": html, "Charset": "UTF-8"},
                "Text": {"Data": text, "Charset": "UTF-8"},
            },
        },
        Tags=[{"Name": "campaign", "Value": "review-request-xls"}],
    )


def load_seen_bonds():
    """Load bond IDs already handled by the daily puppeteer scraper."""
    try:
        with open(SEEN_BONDS_FILE) as f:
            return set(json.load(f))
    except Exception:
        return set()


def _dec(v):
    """Normalize DB/py numerics to Decimal(cents); None stays None."""
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v)).quantize(CENT)
    except (InvalidOperation, ValueError):
        return None


def _field_div(name, xls_val, bk_val):
    """Return a divergence detail string, or None if within one cent.
    Comparison only runs when the XLS (ground truth) has a value; a NULL
    bk_bonds value against a real XLS value IS a divergence."""
    x, b = _dec(xls_val), _dec(bk_val)
    if x is None:
        return None
    if b is None or (x - b).copy_abs() > CENT:
        return f"{name}: xls={x} bk={b if b is not None else 'NULL'}"
    return None


def reconcile_bk_bonds(cur):
    """Ground-truth reconciliation: compare revenue_events (RLI weekly XLS)
    against bk_bonds by bond number. REPORT-ONLY for financials — divergences
    are flagged into bk_scraper_recon, never written into bk_bonds. The one
    write allowed here is backfilling insured_email/insured_phone into
    bk_bonds rows where those fields are empty."""

    # 1) Contact backfill: only fills empty/NULL targets, never overwrites.
    cur.execute("""
        UPDATE bk_bonds b
           SET insured_email = r.email
          FROM revenue_events r
         WHERE b.bond_number = r.bond_no
           AND (b.insured_email IS NULL OR TRIM(b.insured_email) = '')
           AND r.email IS NOT NULL AND r.email <> ''
    """)
    emails_backfilled = cur.rowcount
    cur.execute("""
        UPDATE bk_bonds b
           SET insured_phone = r.phone
          FROM revenue_events r
         WHERE b.bond_number = r.bond_no
           AND (b.insured_phone IS NULL OR TRIM(b.insured_phone) = '')
           AND r.phone IS NOT NULL AND r.phone <> ''
    """)
    phones_backfilled = cur.rowcount

    # 2) Divergence detection. bk_bonds' commission column name is not part of
    #    the upsert-endpoint contract (which carries commission_rate), so
    #    introspect the schema instead of assuming commission_amt exists —
    #    a bad guess here would kill reconciliation every run.
    cur.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'bk_bonds'
           AND column_name IN ('commission_amt', 'commission_amount',
                               'commission', 'commission_rate', 'premium')
    """)
    cols = {r[0] for r in cur.fetchall()}
    if "commission_amt" in cols:
        comm_expr = "b.commission_amt"
    elif "commission_amount" in cols:
        comm_expr = "b.commission_amount"
    elif "commission" in cols:
        comm_expr = "b.commission"
    elif "commission_rate" in cols and "premium" in cols:
        comm_expr = "(b.premium * b.commission_rate)"  # derived dollar amount
    else:
        comm_expr = None
        print("[rli-sync] WARNING: no commission column found on bk_bonds — "
              "commission comparison skipped")

    cur.execute(f"""
        SELECT r.bond_no, r.premium, r.commission, r.bond_amount,
               b.bond_number, b.premium,
               {comm_expr if comm_expr else 'NULL'}, b.bond_amount
          FROM revenue_events r
          LEFT JOIN bk_bonds b ON b.bond_number = r.bond_no
         ORDER BY r.bond_no
    """)
    rows = cur.fetchall()

    counts = {"missing_in_bk_bonds": 0, "premium": 0, "commission": 0,
              "bond_amount": 0}
    flagged = []  # (bond_no, flag, detail)
    for (bond_no, r_prem, r_comm, r_amt,
         bk_no, b_prem, b_comm, b_amt) in rows:
        if bk_no is None:
            counts["missing_in_bk_bonds"] += 1
            flagged.append((bond_no, "missing_in_bk_bonds",
                            "bond in RLI weekly XLS but absent from bk_bonds"))
            continue
        d = _field_div("premium", r_prem, b_prem)
        if d:
            counts["premium"] += 1
            flagged.append((bond_no, "premium_mismatch", d))
        if comm_expr is not None:
            d = _field_div("commission", r_comm, b_comm)
            if d:
                counts["commission"] += 1
                flagged.append((bond_no, "commission_mismatch", d))
        d = _field_div("bond_amount", r_amt, b_amt)
        if d:
            counts["bond_amount"] += 1
            flagged.append((bond_no, "bond_amount_mismatch", d))

    # 3) Persist flags — one row per (source, bond, category). Existing open
    #    flags of the same category get their detail refreshed when it changed;
    #    otherwise the NOT EXISTS guard prevents duplicates.
    new_flags = 0
    refreshed_flags = 0
    for bond_no, flag, detail in flagged:
        params = dict(source="xls_reconcile", external_id=bond_no,
                      flag=flag, error=detail)
        cur.execute(RECON_UPDATE_SQL, params)
        refreshed_flags += cur.rowcount
        cur.execute(RECON_INSERT_SQL, params)
        new_flags += cur.rowcount

    # 4) Summary table.
    print("[rli-sync] ---- ground-truth reconciliation (XLS vs bk_bonds) ----")
    print(f"[rli-sync] {'category':<24} {'count':>6}")
    print(f"[rli-sync] {'missing_in_bk_bonds':<24} {counts['missing_in_bk_bonds']:>6}")
    print(f"[rli-sync] {'premium_mismatch':<24} {counts['premium']:>6}")
    print(f"[rli-sync] {'commission_mismatch':<24} {counts['commission']:>6}")
    print(f"[rli-sync] {'bond_amount_mismatch':<24} {counts['bond_amount']:>6}")
    print(f"[rli-sync] {'emails_backfilled':<24} {emails_backfilled:>6}")
    print(f"[rli-sync] {'phones_backfilled':<24} {phones_backfilled:>6}")
    print(f"[rli-sync] {'new_flags_written':<24} {new_flags:>6}")
    print(f"[rli-sync] {'flags_detail_refreshed':<24} {refreshed_flags:>6}")
    for bond_no, flag, detail in flagged:
        print(f"[rli-sync]   {bond_no} [{flag}]: {detail}")
    print("[rli-sync] ---- end reconciliation ----")


def main():
    ap = argparse.ArgumentParser(description="RLI weekly XLS revenue sync")
    ap.add_argument("--no-email", action="store_true",
                    help="skip sending review-request emails")
    ap.add_argument("--allow-bulk-email", action="store_true",
                    help="override the review-email safety cap "
                         "(RLI_REVIEW_EMAIL_CAP, default 25)")
    args = ap.parse_args()
    send_emails = not args.no_email and os.environ.get("RLI_REVIEW_EMAILS", "1") != "0"

    rows = {}
    since = imap_since_date()
    m = imaplib.IMAP4_SSL("imap.zoho.com")
    m.login(IMAP_USER, IMAP_PASS)
    m.select("INBOX", readonly=True)
    typ, data = m.search(None, f'(SINCE {since} SUBJECT "MyBondApp Weekly Report")')
    ids = data[0].split()
    print(f"[rli-sync] {len(ids)} weekly report emails since {since}")
    attachments_seen = 0
    parse_errors = 0
    for mid in ids:
        typ, md = m.fetch(mid, "(BODY.PEEK[])")
        msg = email.message_from_bytes(md[0][1])
        for part in msg.walk():
            if part.get_filename() and part.get_filename().lower().endswith(".xls"):
                attachments_seen += 1
                try:
                    parse_xls(part.get_payload(decode=True), rows)
                except Exception as e:
                    parse_errors += 1
                    print(f"[rli-sync] parse error {part.get_filename()}: {e}")
    m.logout()
    print(f"[rli-sync] {len(rows)} unique bonds parsed "
          f"({attachments_seen} .xls attachment(s), {parse_errors} parse error(s))")

    # The weekly ingest going quiet is a FAILURE, not an empty success —
    # cron alerting keys on the exit code.
    if not ids:
        print(f"[rli-sync] FATAL: no 'MyBondApp Weekly Report' emails since {since} — "
              "subject drift, delivery failure, or wrong mailbox. Exiting 2.")
        sys.exit(2)
    if not rows:
        print(f"[rli-sync] FATAL: {len(ids)} report email(s) but 0 bonds parsed "
              f"({attachments_seen} attachment(s), {parse_errors} parse error(s)) — "
              "attachment format drift. Exiting 2.")
        sys.exit(2)

    conn = psycopg2.connect(**DB)
    cur = conn.cursor()
    cur.execute(DDL)
    inserted = 0
    updated = 0
    newly_inserted = []
    for b in rows.values():
        cur.execute(UPSERT_SQL, b)
        row = cur.fetchone()
        if row is None:
            continue  # existing row, nothing changed (DO UPDATE ... WHERE)
        if row[0]:
            inserted += 1
            newly_inserted.append(b)
        else:
            updated += 1
    conn.commit()
    print(f"[rli-sync] {inserted} new revenue events, {updated} corrected")

    # Mark matching leads sold — email or phone match ONLY. The old exact-name
    # third fallback was dropped: common names (e.g. two different
    # "Maria Garcia" leads) were getting the wrong lead marked sold.
    # NOTE: sale_amount stores our COMMISSION on the bond (agency revenue),
    # not the premium the customer paid.
    cur.execute("""
        UPDATE leads l SET status='sold', sale_amount=r.commission, updated_at=NOW()
        FROM revenue_events r
        WHERE l.status <> 'sold' AND (
              (l.email <> '' AND r.email <> '' AND LOWER(l.email) = r.email)
           OR (l.phone <> '' AND r.phone <> '' AND regexp_replace(l.phone,'\\D','','g') = r.phone)
        )
    """)
    print(f"[rli-sync] {cur.rowcount} leads marked sold")
    conn.commit()

    # Ground-truth reconciliation against bk_bonds (report-only + contact backfill)
    recon_failed = False
    try:
        reconcile_bk_bonds(cur)
        conn.commit()
    except Exception as e:
        conn.rollback()
        recon_failed = True
        print(f"[rli-sync] reconciliation ERROR (revenue upsert already committed): {e}")

    cur.close()
    conn.close()

    # Send review emails for newly inserted bonds not already caught by the daily scraper
    if not newly_inserted:
        print("[rli-sync] no new bonds — skipping review emails")
    elif not send_emails:
        print(f"[rli-sync] review emails disabled (--no-email / RLI_REVIEW_EMAILS=0) — "
              f"{len(newly_inserted)} new bond(s) not emailed")
    else:
        seen_bonds = load_seen_bonds()
        eligible = [b for b in newly_inserted
                    if b["bond_no"] not in seen_bonds and b.get("email")]
        skipped_seen = sum(1 for b in newly_inserted if b["bond_no"] in seen_bonds)
        skipped_no_email = len(newly_inserted) - len(eligible) - skipped_seen
        print(f"[rli-sync] review-email candidates: {len(eligible)} "
              f"({skipped_seen} already handled by scraper, {skipped_no_email} no email)")

        # First-run / rebuilt-table guard: an empty revenue_events makes EVERY
        # bond in the window "newly inserted" — never blast the whole book.
        cap = int(os.environ.get("RLI_REVIEW_EMAIL_CAP", "25"))
        if len(eligible) > cap and not args.allow_bulk_email:
            print(f"[rli-sync] SAFETY: {len(eligible)} review emails eligible "
                  f"(cap {cap}) — refusing to send. Fresh/rebuilt revenue_events? "
                  "Re-run with --allow-bulk-email if this bulk send is intended.")
        else:
            ses_client = boto3.client(
                "ses",
                region_name="us-east-2",
                aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
                aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
            )
            review_sent = 0
            for b in eligible:
                try:
                    send_review_email(ses_client, b["bond_no"], b["principal_name"],
                                      b["email"], b["bond_type"])
                    print(f"[rli-sync] review email → {b['principal_name']} <{b['email']}>")
                    review_sent += 1
                    time.sleep(0.9)
                except Exception as e:
                    print(f"[rli-sync] review email error for {b['bond_no']}: {e}")
            print(f"[rli-sync] {review_sent} review email(s) sent via XLS backstop")

    if recon_failed:
        print("[rli-sync] exiting 3: reconciliation failed (see error above)")
        sys.exit(3)


if __name__ == "__main__":
    main()
