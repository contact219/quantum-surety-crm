#!/usr/bin/env python3
"""
Migrate contractors from VPS MariaDB → CRM PostgreSQL via SSH tunnel.
Runs on the CRM server (192.168.4.122), SSHs into VPS to read MySQL,
inserts into local PostgreSQL.
"""
import subprocess, csv, io, psycopg2, psycopg2.extras, sys

PG_DSN = "host=localhost port=5433 dbname=quantum_surety user=quantum_user password=Qs2024Secure!"
BATCH_SIZE = 2000

QUERY = """SELECT license_type, license_number, business_county, business_name,
                  business_address, business_city, business_state, business_zip,
                  business_phone, expire_date, owner_name, owner_phone, license_subtype
           FROM contractors"""

def main():
    print("Connecting to CRM PostgreSQL...", flush=True)
    pg = psycopg2.connect(PG_DSN)
    cur = pg.cursor()

    print("Streaming from VPS MariaDB via SSH...", flush=True)
    cmd = [
        'ssh', '-o', 'StrictHostKeyChecking=no', 'root@130.51.23.147',
        f'mysql -u bondverify -pBondVerify2026! bondverify --batch --quick -e "{QUERY}"'
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    reader = csv.reader(io.TextIOWrapper(proc.stdout, encoding='utf-8', errors='replace'), delimiter='\t')
    next(reader)  # skip header

    batch, processed = [], 0
    for row in reader:
        if len(row) < 13:
            continue
        license_type, license_number, county, biz_name, address, city, state, zip_, \
            phone, expire_date, owner_name, owner_phone, subtype = row[:13]

        expire = expire_date if expire_date and expire_date != 'NULL' and expire_date != '0000-00-00' else None
        if not license_number or license_number == 'NULL':
            continue

        batch.append((
            license_type or None, license_number, county or None, biz_name or None,
            address or None, city or None, state or 'TX', zip_ or None,
            phone or None, expire, owner_name or None, owner_phone or None, subtype or None,
        ))

        if len(batch) >= BATCH_SIZE:
            flush(cur, batch); pg.commit()
            processed += len(batch); batch = []
            print(f'  {processed:,}...', end='\r', flush=True)

    if batch:
        flush(cur, batch); pg.commit(); processed += len(batch)

    proc.wait()
    cur.execute('SELECT COUNT(*) FROM tdlr_licenses')
    total = cur.fetchone()[0]
    pg.close()
    print(f'\nDone. Migrated {processed:,} rows. Total in DB: {total:,}')

def flush(cur, batch):
    psycopg2.extras.execute_batch(cur, """
        INSERT INTO tdlr_licenses
            (license_type, license_number, business_county, business_name,
             business_address, business_city, business_state, business_zip,
             business_phone, expire_date, owner_name, owner_phone, license_subtype, updated_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, NOW())
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
            updated_at       = NOW()
    """, batch, page_size=BATCH_SIZE)

if __name__ == '__main__':
    main()
