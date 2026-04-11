import React,{useEffect,useState,useCallback} from 'react';
import {Search,Mail,MapPin,ChevronLeft,ChevronRight,Send,X,Filter,AlertTriangle,Clock,CheckCircle,Users} from 'lucide-react';

const EXPIRY_OPTIONS = [
  {value:'',label:'All'},
  {value:'90',label:'Expiring 90 days',color:'#ef4444'},
  {value:'180',label:'Expiring 180 days',color:'#f97316'},
  {value:'expired',label:'Already expired',color:'#6B6B8A'},
];

const NOTARY_TEMPLATE = `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff">
  <div style="border-bottom:3px solid #C9A84C;padding-bottom:16px;margin-bottom:24px">
    <h1 style="margin:0;font-size:22px;color:#0A0A0F;letter-spacing:2px;font-family:Arial,sans-serif">QUANTUM SURETY</h1>
    <p style="margin:4px 0 0;font-size:11px;color:#888;letter-spacing:3px;font-family:Arial,sans-serif">TEXAS LICENSED SURETY AGENCY</p>
  </div>
  <h2 style="color:#0A0A0F;font-size:20px;margin:0 0 16px">{{first_name}}, Your Texas Notary Bond Expires {{expire_date}}</h2>
  <p style="color:#333;line-height:1.7;margin:0 0 16px">As a Texas notary public, your surety bond must remain active throughout your commission period. Don't let a lapsed bond put your commission at risk.</p>
  <div style="background:#f9f6ef;border-left:4px solid #C9A84C;padding:16px 20px;margin:24px 0;border-radius:0 6px 6px 0">
    <p style="margin:0 0 10px;font-weight:bold;color:#0A0A0F">Renew with Quantum Surety — Starting at $30/year</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ Instant online issuance — certificate emailed immediately</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ RLI Insurance Company — Texas approved carrier</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ 4-year term available — bond once, done for your full commission</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ 55% commission if you refer other notaries</p>
  </div>
  <a href="https://quantumsurety.bond/quote" style="background:#C9A84C;color:#000;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;font-family:Arial,sans-serif;font-size:15px">Renew My Bond Now →</a>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0"/>
  <p style="color:#999;font-size:11px;margin:0;font-family:Arial,sans-serif">Quantum Surety LLC · Texas Licensed Surety Agency · <a href="https://quantumsurety.bond" style="color:#C9A84C">quantumsurety.bond</a> · To unsubscribe reply STOP</p>
</div>`;

export default function Notaries() {
  const [stats,setStats]=useState(null);
  const [data,setData]=useState({data:[],total:0,pages:1});
  const [page,setPage]=useState(1);
  const [search,setSearch]=useState('');
  const [city,setCity]=useState('');
  const [surety,setSurety]=useState('');
  const [expiring,setExpiring]=useState('90');
  const [hasEmail,setHasEmail]=useState(true);
  const [companies,setCompanies]=useState([]);
  const [showCampaign,setShowCampaign]=useState(false);
  const [campaignForm,setCampaignForm]=useState({subject:'{{first_name}}, Your Texas Notary Bond Expires {{expire_date}}',body:NOTARY_TEMPLATE,from_name:'Quantum Surety',from_email:'info@quantumsurety.bond'});
  const [preview,setPreview]=useState(false);
  const [audienceCount,setAudienceCount]=useState(null);
  const [sending,setSending]=useState(false);
  const [sendResult,setSendResult]=useState(null);

  useEffect(()=>{
    fetch('/api/notaries/stats').then(r=>r.json()).then(setStats);
    fetch('/api/notaries/companies').then(r=>r.json()).then(setCompanies);
  },[]);

  const load = useCallback(()=>{
    const p=new URLSearchParams({page,limit:50,search,city,surety,expiring,has_email:hasEmail?'true':''});
    fetch(`/api/notaries?${p}`).then(r=>r.json()).then(setData);
  },[page,search,city,surety,expiring,hasEmail]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{setPage(1);},[search,city,surety,expiring,hasEmail]);

  // Live audience count for campaign
  useEffect(()=>{
    if(!showCampaign) return;
    setAudienceCount(null);
    fetch('/api/notary-campaigns/count',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({filters:{surety,city,expiring}})
    }).then(r=>r.json()).then(j=>setAudienceCount(j.count));
  },[showCampaign,surety,city,expiring]);

  const sendCampaign = async() => {
    setSending(true);setSendResult(null);
    const r = await fetch('/api/notary-campaigns/send',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...campaignForm,filters:{surety,city,expiring}})
    });
    const j = await r.json();
    setSending(false);setShowCampaign(false);
    setSendResult(j);
  };

  const expiryColor = (date) => {
    if (!date) return 'var(--text-dim)';
    const d = new Date(date);
    const now = new Date();
    const days = Math.round((d-now)/(1000*60*60*24));
    if (days < 0) return '#6B6B8A';
    if (days <= 90) return '#ef4444';
    if (days <= 180) return '#f97316';
    return '#4CC97A';
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b flex-shrink-0" style={{borderColor:'var(--border)'}}>
        <div className="text-xs font-mono tracking-widest mb-1" style={{color:'var(--gold)'}}>NOTARY BONDS</div>
        <div className="flex items-end justify-between mb-4">
          <h1 className="font-display text-3xl tracking-wider text-white">Texas Notaries</h1>
          <button onClick={()=>setShowCampaign(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{background:'var(--gold)',color:'#0A0A0F'}}>
            <Send size={14}/> Send Campaign
          </button>
        </div>

        {/* Stats row */}
        {stats&&(
          <div className="grid grid-cols-5 gap-3 mb-4">
            {[
              {label:'Total Notaries',val:parseInt(stats.total).toLocaleString(),icon:Users,color:'var(--gold)'},
              {label:'With Email',val:parseInt(stats.with_email).toLocaleString(),icon:Mail,color:'#4C9AC9'},
              {label:'Expiring 90d',val:parseInt(stats.expiring_90).toLocaleString(),icon:AlertTriangle,color:'#ef4444'},
              {label:'Expiring 180d',val:parseInt(stats.expiring_180).toLocaleString(),icon:Clock,color:'#f97316'},
              {label:'Competitor Bonded',val:parseInt(stats.competitor_bonded).toLocaleString(),icon:CheckCircle,color:'#4CC97A'},
            ].map(({label,val,icon:Icon,color})=>(
              <div key={label} className="rounded-lg p-3 border" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono" style={{color:'var(--text-dim)'}}>{label.toUpperCase()}</span>
                  <Icon size={12} style={{color}}/>
                </div>
                <div className="text-xl font-display" style={{color}}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:'var(--text-dim)'}}/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name or email..."
              className="pl-8 pr-3 py-1.5 rounded-lg text-sm border outline-none w-44"
              style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/>
          </div>
          <div className="relative">
            <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:'var(--text-dim)'}}/>
            <input value={city} onChange={e=>setCity(e.target.value)} placeholder="City..."
              className="pl-8 pr-3 py-1.5 rounded-lg text-sm border outline-none w-32"
              style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/>
          </div>
          <select value={surety} onChange={e=>setSurety(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-sm border outline-none max-w-48"
            style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}>
            <option value="">All Companies</option>
            {companies.map(c=>(
              <option key={c.surety_company} value={c.surety_company}>
                {c.surety_company.slice(0,35)} ({parseInt(c.count).toLocaleString()})
              </option>
            ))}
          </select>
          <select value={expiring} onChange={e=>setExpiring(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-sm border outline-none"
            style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}>
            {EXPIRY_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={()=>setHasEmail(v=>!v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border"
            style={{background:hasEmail?'rgba(76,154,201,0.15)':'transparent',borderColor:hasEmail?'#4C9AC9':'var(--border)',color:hasEmail?'#4C9AC9':'var(--text-dim)'}}>
            Email only
          </button>
          <span className="ml-auto text-xs font-mono" style={{color:'var(--text-dim)'}}>
            {data.total.toLocaleString()} results
          </span>
        </div>
      </div>

      {sendResult&&(
        <div className="mx-6 mt-3 p-3 rounded-lg border flex items-center justify-between text-sm"
          style={{background:'#1a2e1a',borderColor:'#2a5a2a'}}>
          <span className="text-green-400">✓ Sent {sendResult.sent} · Failed {sendResult.failed}</span>
          <button onClick={()=>setSendResult(null)} style={{color:'var(--text-dim)'}}><X size={13}/></button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm" style={{tableLayout:'fixed'}}>
          <colgroup>
            <col style={{width:'18%'}}/><col style={{width:'18%'}}/><col style={{width:'12%'}}/>
            <col style={{width:'11%'}}/><col style={{width:'11%'}}/><col style={{width:'30%'}}/>
          </colgroup>
          <thead className="sticky top-0" style={{background:'var(--dark)'}}>
            <tr className="border-b" style={{borderColor:'var(--border)'}}>
              {['First Name','Last Name','City','Expires','Status','Surety Company'].map(h=>(
                <th key={h} className="text-left px-3 py-3 text-xs font-mono tracking-wider" style={{color:'var(--text-dim)'}}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.map(row=>{
              const daysLeft = row.expire_date ? Math.round((new Date(row.expire_date)-new Date())/(1000*60*60*24)) : null;
              return (
                <tr key={row.id} className="border-b hover:bg-white/5 cursor-default"
                  style={{borderColor:'var(--border)'}}>
                  <td className="px-3 py-2.5 text-white truncate">{row.first_name}</td>
                  <td className="px-3 py-2.5 text-white truncate">{row.last_name}</td>
                  <td className="px-3 py-2.5 truncate" style={{color:'var(--text-dim)'}}>{row.city}</td>
                  <td className="px-3 py-2.5 text-xs font-mono" style={{color:expiryColor(row.expire_date)}}>
                    {formatDate(row.expire_date)}
                  </td>
                  <td className="px-3 py-2.5">
                    {daysLeft!==null&&(
                      <span className="text-xs px-1.5 py-0.5 rounded font-mono"
                        style={{
                          background:daysLeft<0?'rgba(107,107,138,0.2)':daysLeft<=90?'rgba(239,68,68,0.15)':daysLeft<=180?'rgba(249,115,22,0.15)':'rgba(76,201,122,0.15)',
                          color:daysLeft<0?'#6B6B8A':daysLeft<=90?'#ef4444':daysLeft<=180?'#f97316':'#4CC97A'
                        }}>
                        {daysLeft<0?'Expired':`${daysLeft}d`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs truncate" style={{color:'var(--text-dim)'}}>{row.surety_company}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-6 py-3 border-t flex-shrink-0" style={{borderColor:'var(--border)'}}>
        <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded disabled:opacity-30" style={{color:'var(--text-dim)'}}>
          <ChevronLeft size={14}/> Prev
        </button>
        <span className="text-xs font-mono" style={{color:'var(--text-dim)'}}>Page {page} of {data.pages.toLocaleString()}</span>
        <button onClick={()=>setPage(p=>Math.min(data.pages,p+1))} disabled={page>=data.pages}
          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded disabled:opacity-30" style={{color:'var(--text-dim)'}}>
          Next <ChevronRight size={14}/>
        </button>
      </div>

      {/* Campaign modal */}
      {showCampaign&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.85)'}}>
          <div className="w-full max-w-2xl rounded-2xl border flex flex-col" style={{background:'var(--surface)',borderColor:'var(--border)',maxHeight:'90vh'}}>
            <div className="p-5 border-b flex items-center justify-between" style={{borderColor:'var(--border)'}}>
              <div className="font-display text-2xl tracking-wider text-white">Notary Campaign</div>
              <button onClick={()=>setShowCampaign(false)} style={{color:'var(--text-dim)'}}><X size={18}/></button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-4">
              {/* Audience summary */}
              <div className="rounded-lg p-4 border" style={{background:'var(--muted)',borderColor:'var(--border)'}}>
                <div className="text-xs font-mono tracking-wider mb-2" style={{color:'var(--gold)'}}>CURRENT AUDIENCE (from active filters)</div>
                <div className="flex gap-4 flex-wrap text-xs font-mono" style={{color:'var(--text-dim)'}}>
                  {expiring&&<span>Expiry: {EXPIRY_OPTIONS.find(o=>o.value===expiring)?.label}</span>}
                  {surety&&<span>Company: {surety.slice(0,30)}</span>}
                  {city&&<span>City: {city}</span>}
                  <span className="font-medium" style={{color:'var(--gold)'}}>
                    → {audienceCount===null?'Counting...':audienceCount.toLocaleString()} contacts with email
                  </span>
                </div>
              </div>

              {/* Available variables */}
              <div className="text-xs font-mono p-3 rounded-lg" style={{background:'var(--muted)',color:'var(--text-dim)'}}>
                Variables: <span style={{color:'var(--gold)'}}>{'{{first_name}}'}</span> · <span style={{color:'var(--gold)'}}>{'{{name}}'}</span> · <span style={{color:'var(--gold)'}}>{'{{expire_date}}'}</span> · <span style={{color:'var(--gold)'}}>{'{{surety_company}}'}</span>
              </div>

              {[['Subject','subject','text'],['From Name','from_name','text'],['From Email','from_email','email']].map(([label,key,type])=>(
                <div key={key}>
                  <label className="text-xs font-mono tracking-wider block mb-1.5" style={{color:'var(--text-dim)'}}>{label.toUpperCase()}</label>
                  <input type={type} value={campaignForm[key]} onChange={e=>setCampaignForm(f=>({...f,[key]:e.target.value}))}
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                    style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                </div>
              ))}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-mono tracking-wider" style={{color:'var(--text-dim)'}}>EMAIL BODY (HTML)</label>
                  <button onClick={()=>setPreview(p=>!p)} className="text-xs px-2 py-1 rounded" style={{color:'var(--gold)',background:'rgba(201,168,76,0.1)'}}>
                    {preview?'Edit':'Preview'}
                  </button>
                </div>
                {preview
                  ? <div className="rounded-lg border overflow-auto bg-white" style={{borderColor:'var(--border)',maxHeight:'280px'}}
                      dangerouslySetInnerHTML={{__html:campaignForm.body.replace(/{{first_name}}/g,'Sarah').replace(/{{name}}/g,'Sarah Johnson').replace(/{{expire_date}}/g,'July 12, 2026').replace(/{{surety_company}}/g,'Western Surety Company')}}/>
                  : <textarea value={campaignForm.body} onChange={e=>setCampaignForm(f=>({...f,body:e.target.value}))} rows={8}
                      className="w-full px-3 py-2 rounded-lg border text-xs outline-none resize-none font-mono"
                      style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                }
              </div>
            </div>

            <div className="p-5 border-t flex gap-3 justify-end" style={{borderColor:'var(--border)'}}>
              <button onClick={()=>setShowCampaign(false)} className="px-4 py-2 rounded-lg text-sm" style={{color:'var(--text-dim)'}}>Cancel</button>
              <button onClick={sendCampaign} disabled={sending||!audienceCount}
                className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{background:'var(--gold)',color:'#0A0A0F'}}>
                <Send size={13}/>
                {sending?'Sending...':`Send to ${audienceCount?.toLocaleString()||'...'} notaries`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
