import { Router } from 'express';
import { db } from '../db.js';
import { sql } from 'drizzle-orm';
export const campaignsRouter = Router();
campaignsRouter.get('/', async(req,res)=>{
  try{const r=await db.execute(sql`SELECT * FROM campaigns ORDER BY created_at DESC`);res.json(r.rows);}
  catch(err){res.status(500).json({error:err.message});}
});
campaignsRouter.post('/', async(req,res)=>{
  const{name,subject,body,from_name,from_email}=req.body;
  if(!name||!subject||!body)return res.status(400).json({error:'name,subject,body required'});
  try{const r=await db.execute(sql`INSERT INTO campaigns(name,subject,body,from_name,from_email) VALUES(${name},${subject},${body},${from_name||'Quantum Surety'},${from_email||'info@quantumsurety.bond'}) RETURNING *`);res.json(r.rows[0]);}
  catch(err){res.status(500).json({error:err.message});}
});
campaignsRouter.put('/:id', async(req,res)=>{
  const{name,subject,body,from_name,from_email}=req.body;
  try{const r=await db.execute(sql`UPDATE campaigns SET name=${name},subject=${subject},body=${body},from_name=${from_name},from_email=${from_email} WHERE id=${parseInt(req.params.id)} RETURNING *`);res.json(r.rows[0]);}
  catch(err){res.status(500).json({error:err.message});}
});
campaignsRouter.delete('/:id', async(req,res)=>{
  try{await db.execute(sql`DELETE FROM campaigns WHERE id=${parseInt(req.params.id)}`);res.json({ok:true});}
  catch(err){res.status(500).json({error:err.message});}
});
campaignsRouter.get('/:id/sends', async(req,res)=>{
  try{const r=await db.execute(sql`SELECT cs.*,c.company_name,c.city,c.state FROM campaign_sends cs JOIN contractors c ON c.id=cs.contractor_id WHERE cs.campaign_id=${parseInt(req.params.id)} ORDER BY cs.sent_at DESC`);res.json(r.rows);}
  catch(err){res.status(500).json({error:err.message});}
});
