import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';
export const importRouter = Router();
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
// Auto dealer CSV import
importRouter.post('/dealers', upload.single('file'), async (req,res) => {
  if (!req.file) return res.status(400).json({error:'No file'});
  try {
    const records = parse(req.file.buffer.toString('utf8'),{columns:true,skip_empty_lines:true,trim:true,bom:true});
    let inserted=0,skipped=0;
    for (const r of records) {
      const name = r['Business Name']||r['business_name']||'';
      if (!name){skipped++;continue;}
      const expRaw = r['License Expiration']||r['license_expiration']||'';
      let expDate = null;
      if (expRaw) {
        // Parse MM/DD/YYYY
        const parts = expRaw.split('/');
        if (parts.length===3) expDate = `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
      }
      const email = r['Email']||r['email']||'';
      const phone = (r['Phone']||r['phone']||'').replace(/[^\d\-\(\)\s\+]/g,'');
      try {
        await db.execute(sql`
          INSERT INTO auto_dealers
            (business_name,dba_name,license_number,license_category,license_type,
             license_status,license_expiration,address1,address2,city,state,zip,phone,fax,email,county)
          VALUES
            (${name},
             ${r['DBA Name']||r['dba_name']||''},
             ${r['License Number']||r['license_number']||''},
             ${r['License Type (Category)']||r['license_category']||r['License Category']||''},
             ${r['New/Used']||r['license_type']||r['License Type (New/Used)']||''},
             ${r['License Status']||r['license_status']||'Active'},
             ${expDate}::date,
             ${r['Physical Address Line 1']||r['address1']||''},
             ${r['Physical Address Line 2']||r['address2']||''},
             ${r['Physical City']||r['city']||''},
             ${r['Physical State']||r['state']||'TX'},
             ${r['Physical Zip']||r['zip']||''},
             ${phone},
             ${r['Fax']||r['fax']||''},
             ${email},
             ${r['County']||r['county']||''})
          ON CONFLICT DO NOTHING
        `);
        inserted++;
      } catch(e){skipped++;}
    }
    res.json({ok:true,inserted,skipped,total:records.length});
  } catch(err){res.status(500).json({error:err.message});}
});

importRouter.post('/csv', upload.single('file'), async (req,res) => {
  if (!req.file) return res.status(400).json({error:'No file'});
  try {
    const records = parse(req.file.buffer.toString('utf8'),{columns:true,skip_empty_lines:true,trim:true});
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let inserted=0,skipped=0;
    for (const r of records) {
      const name = r.company_name||r['Company Name']||r['VENDOR NAME']||'';
      if (!name){skipped++;continue;}
      const state = r.state||r['State']||r['STATE']||'';
      const web = r.contact_email||r.contact_website||r.website||'';
      const sid = r.source_id||`IMPORT-${Date.now()}-${inserted}`;
      try {
        await db.execute(sql`INSERT INTO contractors(company_name,address,city,state,zip,phone,fax,email,website,certification_type,certification_number,naics_codes,source_id) VALUES(${name},${r.address||''},${r.city||''},${state},${r.zip||''},${r.phone||''},${r.fax||''},${emailRx.test(web)?web:''},${web},${r.certification_type||''},${r.certification_number||''},${r.naics_codes||''},${sid}) ON CONFLICT(source_id) DO NOTHING`);
        inserted++;
      } catch(e){skipped++;}
    }
    res.json({ok:true,inserted,skipped,total:records.length});
  } catch(err){res.status(500).json({error:err.message});}
});
