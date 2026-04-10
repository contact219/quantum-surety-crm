import React,{useEffect,useState} from 'react';
import {Plus,Send,Trash2,X,Eye} from 'lucide-react';

const TEMPLATE = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a2e">Is {{company_name}} Bonded for State Contracts?</h2>
  <p>As a certified HUB/DBE contractor, you may be required to carry surety bonds to bid on Texas state projects.</p>
  <p><strong>Quantum Surety</strong> specializes in fast, affordable bonding for certified minority and women-owned contractors:</p>
  <ul>
    <li>✅ Same-day bond issuance</li>
    <li>✅ Competitive rates for HUB/DBE firms</li>
    <li>✅ No collateral required for most bonds</li>
    <li>✅ Online application — 10 minutes or less</li>
  </ul>
  <p><a href="https://quantumsurety.bond/quote" style="background:#C9A84C;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;margin-top:8px">Get Your Free Quote →</a></p>
  <p style="color:#666;font-size:12px;margin-top:24px">Quantum Surety LLC · Texas Licensed Surety Agency · <a href="https://quantumsurety.bond">quantumsurety.bond</a></p>
</div>`;

export default function Campaigns() {
  const [campaigns,setCampaigns]=useState([]);
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({name:'',subject:'',body:TEMPLATE,from_name:'Quantum Surety',from_email:'info@quantumsurety.bond'});
  const [preview,setPreview]=useState(false);
  const [sending,setSending]=useState(null);
  const [sendResult,setSendResult]=useState(null);

  const load=()=>fetch('/api/campaigns').then(r=>r.json()).then(setCampaigns);
  useEffect(()=>{load();},[]);

  const save=async()=>{
    await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
    setShowNew(false);setForm({name:'',subject:'',body:TEMPLATE,from_name:'Quantum Surety',from_email:'info@quantumsurety.bond'});
    load();
  };

  const del=async(id)=>{
    if(!confirm('Delete campaign?'))return;
    await fetch(`/api/campaigns/${id}`,{method:'DELETE'});load();
  };

  const quickSend=async(c)=>{
    const ids=prompt('Enter comma-separated contact IDs to send to (or leave blank to cancel):');
    if(!ids)return;
    const contact_ids=ids.split(',').map(s=>parseInt(s.trim())).filter(Boolean);
    setSending(c.id);setSendResult(null);
    const r=await fetch(`/api/email/campaign/${c.id}/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contact_ids})});
    const j=await r.json();
    setSending(null);setSendResult(j);
    load();
  };

  return (
    <div className="p-8">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-xs font-mono tracking-widest mb-1" style={{color:'var(--gold)'}}>OUTREACH</div>
          <h1 className="font-display text-4xl tracking-wider text-white">Campaigns</h1>
          <div className="gold-line mt-3 w-24"/>
        </div>
        <button onClick={()=>setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
          style={{background:'var(--gold)',color:'#0A0A0F'}}>
          <Plus size={16}/> New Campaign
        </button>
      </div>

      {sendResult&&(
        <div className="mb-6 p-4 rounded-lg border text-sm" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
          ✓ Sent: {sendResult.sent} | Failed: {sendResult.failed} | Skipped: {sendResult.skipped}
          <button onClick={()=>setSendResult(null)} className="ml-4 text-xs" style={{color:'var(--text-dim)'}}>Dismiss</button>
        </div>
      )}

      <div className="space-y-4">
        {campaigns.length===0&&<p className="text-sm" style={{color:'var(--text-dim)'}}>No campaigns yet. Create your first one.</p>}
        {campaigns.map(c=>(
          <div key={c.id} className="rounded-xl border p-5" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-white">{c.name}</div>
                <div className="text-xs font-mono mt-1" style={{color:'var(--text-dim)'}}>{c.subject}</div>
                <div className="text-xs mt-2 font-mono" style={{color:'var(--gold)'}}>
                  From: {c.from_name} &lt;{c.from_email}&gt;
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-2 py-0.5 rounded" style={{background:'var(--muted)',color:'var(--text-dim)'}}>
                  {c.sent_count} sent
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded" style={{background:c.status==='sent'?'#1a2e1a':'var(--muted)',color:c.status==='sent'?'#4CC97A':'var(--text-dim)'}}>
                  {c.status}
                </span>
                <button onClick={()=>quickSend(c)} disabled={sending===c.id}
                  className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium disabled:opacity-40"
                  style={{background:'var(--gold)',color:'#0A0A0F'}}>
                  <Send size={12}/>{sending===c.id?'Sending...':'Send'}
                </button>
                <button onClick={()=>del(c.id)} style={{color:'var(--text-dim)'}}><Trash2 size={14}/></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* New campaign modal */}
      {showNew&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{background:'rgba(0,0,0,0.8)'}}>
          <div className="w-full max-w-2xl rounded-2xl border flex flex-col max-h-screen overflow-auto" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
            <div className="p-6 border-b flex items-center justify-between" style={{borderColor:'var(--border)'}}>
              <div className="font-display text-2xl tracking-wider text-white">New Campaign</div>
              <button onClick={()=>setShowNew(false)} style={{color:'var(--text-dim)'}}><X size={18}/></button>
            </div>
            <div className="p-6 space-y-4 flex-1 overflow-auto">
              {[['Campaign Name','name','text'],['Subject Line','subject','text'],['From Name','from_name','text'],['From Email','from_email','email']].map(([label,key,type])=>(
                <div key={key}>
                  <label className="text-xs font-mono tracking-wider block mb-1.5" style={{color:'var(--text-dim)'}}>{label.toUpperCase()}</label>
                  <input type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                    style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                </div>
              ))}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-mono tracking-wider" style={{color:'var(--text-dim)'}}>EMAIL BODY (HTML)</label>
                  <button onClick={()=>setPreview(p=>!p)} className="text-xs flex items-center gap-1" style={{color:'var(--gold)'}}>
                    <Eye size={12}/>{preview?'Edit':'Preview'}
                  </button>
                </div>
                {preview
                  ? <div className="rounded-lg border p-4 bg-white text-black text-sm" style={{borderColor:'var(--border)'}} dangerouslySetInnerHTML={{__html:form.body.replace(/{{company_name}}/g,'ACME Construction LLC')}}/>
                  : <textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={12}
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none font-mono"
                      style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                }
              </div>
            </div>
            <div className="p-6 border-t flex gap-3 justify-end" style={{borderColor:'var(--border)'}}>
              <button onClick={()=>setShowNew(false)} className="px-4 py-2 rounded-lg text-sm" style={{color:'var(--text-dim)'}}>Cancel</button>
              <button onClick={save} className="px-6 py-2 rounded-lg text-sm font-medium" style={{background:'var(--gold)',color:'#0A0A0F'}}>Save Campaign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
