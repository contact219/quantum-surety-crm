import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';
export const importRouter = Router();
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
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
