import React,{useEffect,useState,useCallback} from 'react';
import {Search,Mail,MapPin,ChevronLeft,ChevronRight,Send,X,Clock,CheckCircle,
        Users,Square,CheckSquare,History} from 'lucide-react';
import {apiFetch} from '../auth.js';

const EXPIRY_OPTIONS = [
  {value:'',label:'All Expiry'},
  {value:'30',label:'Expiring 30 days'},
  {value:'60',label:'Expiring 60 days'},
  {value:'90',label:'Expiring 90 days'},
  {value:'180',label:'Expiring 180 days'},
  {value:'expired',label:'Already expired'},
];

const DEALER_TEMPLATE = `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff">
  <div style="border-bottom:3px solid #C9A84C;padding-bottom:16px;margin-bottom:24px">
    <h1 style="margin:0;font-size:22px;color:#0A0A0F;letter-spacing:2px;font-family:Arial,sans-serif">QUANTUM SURETY</h1>
    <p style="margin:4px 0 0;font-size:11px;color:#888;letter-spacing:3px;font-family:Arial,sans-serif">TEXAS LICENSED SURETY AGENCY</p>
  </div>
  <h2 style="color:#0A0A0F;font-size:20px;margin:0 0 16px">{{business_name}} — Your TX Dealer Bond Renews {{expire_date}}</h2>
  <p style="color:#333;line-height:1.7;margin:0 0 16px">As a licensed Texas motor vehicle dealer, you're required to carry a surety bond as part of your annual license renewal with the TXDMV. Quantum Surety makes it fast and affordable.</p>
  <div style="background:#f9f6ef;border-left:4px solid #C9A84C;padding:16px 20px;margin:24px 0;border-radius:0 6px 6px 0">
    <p style="margin:0 0 10px;font-weight:bold;color:#0A0A0F">Texas Dealer Bond — Competitive Rates, Same-Day Issuance</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ $25,000 Motor Vehicle Dealer Bond — from $100/year</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ Certificate issued same day — emailed directly to you</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ TXDMV-approved surety carrier</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ Fast online application — 10 minutes or less</p>
  </div>
  <a href="https://quantumsurety.bond/quote" style="background:#C9A84C;color:#000;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;font-family:Arial,sans-serif;font-size:15px">Get Your Bond Quote →</a>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0"/>
  <p style="color:#999;font-size:11px;margin:0;font-family:Arial,sans-serif">Quantum Surety LLC · Texas Licensed Surety Agency · <a href="https://quantumsurety.bond" style="color:#C9A84C">quantumsurety.bond</a> · <a href="{{unsubscribe_url}}" style="color:#999">Unsubscribe</a></p>
</div>`;

const BLANK_FORM = {
  campaign_name:'',
  subject:'{{business_name}} — Your TX Dealer Bond Renews {{expire_date}}',
  body: DEALER_TEMPLATE,
  from_name:'Quantum Surety',
  from_email:'info@quantumsurety.bond',
};

const BLANK_FILTERS = { search:'', city:'', county:'', license_type:'', expiring:'60', has_email:'' };

function expiryColor(dateStr) {
  if (!dateStr) return 'var(--text-dim)';
  const d = new Date(dateStr);
  const days = Math.floor((d - new Date()) / 86400000);
  if (days < 0)   return '#ef4444';
  if (days < 30)  return '#f97316';
  if (days < 90)  return '#C9A84C';
  return '#4CC97A';
}

export default function Dealers() {
  const [stats,setStats]   = useState(null);
  const [rows,setRows]     = useState([]);
  const [total,setTotal]   = useState(0);
  const [pages,setPages]   = useState(1);
  const [page,setPage]     = useState(1);
  const [loading,setLoading] = useState(false);
  const [filters,setFilters] = useState(BLANK_FILTERS);
  const [pendingFilters,setPendingFilters] = useState(BLANK_FILTERS);

  // Campaign modal
  const [showCampaign,setShowCampaign] = useState(false);
  const [form,setForm]     = useState(BLANK_FORM);
  const [preview,setPreview] = useState(false);
  const [skipSent,setSkipSent] = useState(true);
  const [audienceCount,setAudienceCount] = useState(null);
  const [sending,setSending] = useState(false);
  const [sendResult,setSendResult] = useState(null);
  const [sendError,setSendError] = useState('');

  // History
  const [showHistory,setShowHistory] = useState(false);
  const [history,setHistory] = useState([]);

  // Selected row detail
  const [selected,setSelected] = useState(null);
  const [sentIds,setSentIds] = useState(new Set());

  const loadStats = () =>
    apiFetch('/api/dealers/stats').then(r=>r.json()).then(setStats).catch(()=>{});

  const loadRows = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ page, limit:50, ...filters });
    apiFetch(`/api/dealers?${p}`).then(r=>r.json()).then(j=>{
      setRows(j.data||[]); setTotal(j.total||0); setPages(j.pages||1);
    }).catch(()=>{}).finally(()=>setLoading(false));
  }, [page, filters]);

  const loadSentIds = () =>
    apiFetch('/api/dealer-campaigns/sent-ids').then(r=>r.json())
      .then(j=>setSentIds(new Set(j.ids||[]))).catch(()=>{});

  useEffect(()=>{ loadStats(); loadSentIds(); },[]);
  useEffect(()=>{ loadRows(); },[loadRows]);
  useEffect(()=>{ setPage(1); },[filters]);

  // Audience count when campaign modal open
  useEffect(()=>{
    if (!showCampaign) return;
    setAudienceCount(null);
    apiFetch('/api/dealer-campaigns/count',{method:'POST',body:JSON.stringify({filters,skip_sent:skipSent})})
      .then(r=>r.json()).then(j=>setAudienceCount(j.count??0)).catch(()=>setAudienceCount(0));
  },[showCampaign, filters, skipSent]);

  const applyFilters = () => { setFilters({...pendingFilters}); setPage(1); };

  const sendCampaign = async() => {
    setSending(true); setSendResult(null); setSendError('');
    try {
      const r = await apiFetch('/api/dealer-campaigns/send',{
        method:'POST',
        body:JSON.stringify({...form, filters, skip_sent:skipSent, campaign_name:form.campaign_name||form.subject}),
      });
      const j = await r.json();
      if (j.error) setSendError(j.error);
      else { setSendResult(j); loadStats(); loadSentIds(); }
    } catch(e) { setSendError(e.message); }
    setSending(false);
  };

  const loadHistory = async() => {
    const r = await apiFetch('/api/dealer-campaigns/history?limit=200');
    const j = await r.json();
    setHistory(j.rows||[]);
    setShowHistory(true);
  };

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden'}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Header */}
        <div style={{padding:'24px 24px 16px',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:4,color:'var(--gold)',marginBottom:4}}>LICENSE & PERMIT BONDS</div>
          <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:16}}>
            <h1 style={{fontFamily:'"Bebas Neue",cursive',fontSize:36,letterSpacing:4,color:'white',margin:0}}>Auto Dealers</h1>
            {stats&&(
              <div style={{display:'flex',gap:24}}>
                {[
                  {label:'Total',val:parseInt(stats.total).toLocaleString(),color:'var(--gold)'},
                  {label:'With Email',val:parseInt(stats.with_email).toLocaleString(),color:'#4C9AC9'},
                  {label:'Expiring 90d',val:parseInt(stats.expiring_90).toLocaleString(),color:'#f97316'},
                ].map(({label,val,color})=>(
                  <div key={label} style={{textAlign:'right'}}>
                    <div style={{fontSize:10,fontFamily:'monospace',color:'var(--text-dim)'}}>{label}</div>
                    <div style={{fontSize:20,fontFamily:'"Bebas Neue",cursive',letterSpacing:2,color}}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Filters */}
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            <div style={{position:'relative'}}>
              <Search size={12} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)'}}/>
              <input value={pendingFilters.search} onChange={e=>setPendingFilters(f=>({...f,search:e.target.value}))}
                onKeyDown={e=>e.key==='Enter'&&applyFilters()}
                placeholder="Business name or email..."
                style={{paddingLeft:30,paddingRight:10,paddingTop:6,paddingBottom:6,borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none',width:190}}/>
            </div>
            <div style={{position:'relative'}}>
              <MapPin size={12} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)'}}/>
              <input value={pendingFilters.city} onChange={e=>setPendingFilters(f=>({...f,city:e.target.value}))}
                onKeyDown={e=>e.key==='Enter'&&applyFilters()}
                placeholder="City..."
                style={{paddingLeft:28,paddingRight:10,paddingTop:6,paddingBottom:6,borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none',width:120}}/>
            </div>
            <input value={pendingFilters.county} onChange={e=>setPendingFilters(f=>({...f,county:e.target.value}))}
              onKeyDown={e=>e.key==='Enter'&&applyFilters()}
              placeholder="County..."
              style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none',width:110}}/>
            <select value={pendingFilters.license_type} onChange={e=>setPendingFilters(f=>({...f,license_type:e.target.value}))}
              style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none'}}>
              <option value="">All Types</option>
              <option value="New">New (Franchise)</option>
              <option value="Used">Used (Independent)</option>
            </select>
            <select value={pendingFilters.expiring} onChange={e=>setPendingFilters(f=>({...f,expiring:e.target.value}))}
              style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none'}}>
              {EXPIRY_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={applyFilters}
              style={{padding:'6px 14px',borderRadius:8,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:12,fontWeight:700}}>
              Search
            </button>
            {Object.values(filters).some(v=>v)&&(
              <button onClick={()=>{setFilters(BLANK_FILTERS);setPendingFilters(BLANK_FILTERS);}}
                style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'transparent',color:'var(--text-dim)',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
                <X size={10}/> Clear
              </button>
            )}
            <span style={{marginLeft:'auto',fontSize:11,fontFamily:'monospace',color:'var(--text-dim)'}}>
              {total.toLocaleString()} results
            </span>
          </div>
        </div>

        {/* Table */}
        <div style={{flex:1,overflowY:'auto'}}>
          <table style={{width:'100%',fontSize:12,tableLayout:'fixed',borderCollapse:'collapse'}}>
            <colgroup>
              <col style={{width:'28%'}}/><col style={{width:'12%'}}/><col style={{width:'10%'}}/>
              <col style={{width:'14%'}}/><col style={{width:'12%'}}/><col style={{width:'18%'}}/><col style={{width:'6%'}}/>
            </colgroup>
            <thead style={{position:'sticky',top:0,background:'var(--dark)'}}>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                {['Business Name','City','County','License Type','Expires','Email',''].map(h=>(
                  <th key={h} style={{textAlign:'left',padding:'10px 12px',fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',fontWeight:500}}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row=>(
                <tr key={row.id} onClick={()=>setSelected(selected?.id===row.id?null:row)}
                  style={{borderBottom:'1px solid var(--border)',cursor:'pointer',background:selected?.id===row.id?'var(--muted)':''}}>
                  <td style={{padding:'8px 12px',color:'white',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {sentIds.has(row.id)&&<span style={{fontSize:9,fontFamily:'monospace',color:'#4CC97A',marginRight:6,padding:'1px 4px',borderRadius:3,background:'rgba(76,201,122,0.15)'}}>SENT</span>}
                    {row.business_name}
                    {row.dba_name&&<span style={{fontSize:10,color:'var(--text-dim)',marginLeft:4}}>/ {row.dba_name}</span>}
                  </td>
                  <td style={{padding:'8px 12px',color:'var(--text-dim)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.city}</td>
                  <td style={{padding:'8px 12px',color:'var(--text-dim)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.county}</td>
                  <td style={{padding:'8px 12px'}}>
                    <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,fontFamily:'monospace',
                      background:(row.license_type||'').includes('New')?'rgba(76,154,201,0.15)':'rgba(201,168,76,0.15)',
                      color:(row.license_type||'').includes('New')?'#4C9AC9':'var(--gold)'}}>
                      {(row.license_type||'—').replace(' (Franchise)','').replace(' (Independent)','')}
                    </span>
                  </td>
                  <td style={{padding:'8px 12px',fontFamily:'monospace',fontSize:11,color:expiryColor(row.license_expiration)}}>
                    {row.license_expiration ? new Date(row.license_expiration).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'}
                  </td>
                  <td style={{padding:'8px 12px',fontSize:11,color:row.email?'#4C9AC9':'var(--text-dim)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {row.email||'—'}
                  </td>
                  <td style={{padding:'8px 12px'}}>
                    {row.email&&(
                      <button onClick={e=>{e.stopPropagation();setSelected(row);setShowCampaign(false);}}
                        style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',padding:2}}>
                        <Mail size={13}/>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading&&rows.length===0&&(
                <tr><td colSpan={7} style={{padding:48,textAlign:'center',color:'var(--text-dim)',fontSize:13}}>No dealers found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 24px',borderTop:'1px solid var(--border)'}}>
          <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
            style={{display:'flex',alignItems:'center',gap:4,padding:'6px 12px',borderRadius:6,border:'none',background:'transparent',color:'var(--text-dim)',cursor:'pointer',opacity:page===1?0.3:1}}>
            <ChevronLeft size={14}/> Prev
          </button>
          <div style={{display:'flex',gap:6}}>
            {[...Array(Math.min(5,pages))].map((_,i)=>{
              const p = page<=3?i+1:page-2+i;
              if (p<1||p>pages) return null;
              return <button key={p} onClick={()=>setPage(p)}
                style={{width:28,height:28,borderRadius:4,border:'none',cursor:'pointer',fontSize:11,fontFamily:'monospace',
                  background:p===page?'var(--gold)':'transparent',color:p===page?'#0A0A0F':'var(--text-dim)'}}>{p}</button>;
            })}
          </div>
          <button onClick={()=>setPage(p=>Math.min(pages,p+1))} disabled={page>=pages}
            style={{display:'flex',alignItems:'center',gap:4,padding:'6px 12px',borderRadius:6,border:'none',background:'transparent',color:'var(--text-dim)',cursor:'pointer',opacity:page>=pages?0.3:1}}>
            Next <ChevronRight size={14}/>
          </button>
        </div>
      </div>

      {/* Right sidebar */}
      <div style={{width:'20rem',flexShrink:0,borderLeft:'1px solid var(--border)',background:'var(--surface)',display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Campaign actions */}
        <div style={{padding:20,borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:3,color:'var(--gold)',marginBottom:12}}>CAMPAIGNS</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <button onClick={()=>{setShowCampaign(true);setShowHistory(false);setSelected(null);setSendResult(null);setSendError('');setForm(BLANK_FORM);}}
              style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',borderRadius:8,border:'none',background:'var(--gold)',color:'#0A0A0F',cursor:'pointer',fontSize:13,fontWeight:700}}>
              <Send size={14}/> Send Campaign
            </button>
            <button onClick={loadHistory}
              style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',borderRadius:8,border:'1px solid var(--border)',background:'transparent',color:'var(--text-dim)',cursor:'pointer',fontSize:12}}>
              <History size={13}/> Send History
            </button>
          </div>

          {/* Stats mini */}
          {stats&&(
            <div style={{marginTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {[
                {label:'Expiring 30d',val:parseInt(stats.expiring_90||0),color:'#f97316'},
                {label:'Expired',val:parseInt(stats.expired||0),color:'#ef4444'},
              ].map(({label,val,color})=>(
                <div key={label} style={{padding:'8px 10px',borderRadius:6,background:'var(--muted)',textAlign:'center'}}>
                  <div style={{fontSize:10,fontFamily:'monospace',color:'var(--text-dim)',marginBottom:2}}>{label}</div>
                  <div style={{fontSize:18,fontFamily:'"Bebas Neue",cursive',color}}>{val.toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail / Campaign form / History */}
        <div style={{flex:1,overflowY:'auto',padding:20}}>

          {/* Campaign send form */}
          {showCampaign&&!showHistory&&(
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{fontSize:11,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)'}}>COMPOSE CAMPAIGN</div>

              {sendResult?(
                <div style={{textAlign:'center',padding:'24px 0'}}>
                  <CheckCircle size={32} style={{color:'#4CC97A',margin:'0 auto 12px'}}/>
                  <div style={{color:'#4CC97A',fontSize:16,fontWeight:600,marginBottom:6}}>Sent!</div>
                  <div style={{color:'var(--text-dim)',fontSize:12}}>{sendResult.sent} sent · {sendResult.failed} failed</div>
                  <button onClick={()=>{setSendResult(null);setShowCampaign(false);}}
                    style={{marginTop:16,padding:'8px 20px',borderRadius:8,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontWeight:700,fontSize:13}}>
                    Done
                  </button>
                </div>
              ):(
                <>
                  {/* Skip sent toggle */}
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:'var(--text-dim)'}}>
                    <div onClick={()=>setSkipSent(v=>!v)}
                      style={{width:14,height:14,borderRadius:3,border:`1px solid ${skipSent?'var(--gold)':'var(--border)'}`,
                        background:skipSent?'var(--gold)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
                      {skipSent&&<div style={{width:8,height:8,background:'#0A0A0F',borderRadius:1}}/>}
                    </div>
                    Skip already contacted
                  </label>
                  <div style={{padding:'8px 12px',borderRadius:6,background:'rgba(201,168,76,0.1)',border:'1px solid rgba(201,168,76,0.2)',fontSize:12,color:'var(--gold)',textAlign:'center'}}>
                    {audienceCount===null?'Counting audience...':
                      <><Users size={11} style={{display:'inline',marginRight:4}}/>{audienceCount.toLocaleString()} dealers match current filters</>
                    }
                  </div>

                  {[['CAMPAIGN NAME','campaign_name'],['SUBJECT','subject'],['FROM NAME','from_name'],['FROM EMAIL','from_email']].map(([label,key])=>(
                    <div key={key}>
                      <label style={{fontSize:9,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:4}}>{label}</label>
                      <input value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
                        style={{width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:12,outline:'none',boxSizing:'border-box'}}/>
                    </div>
                  ))}

                  <div>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                      <label style={{fontSize:9,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)'}}>EMAIL BODY</label>
                      <div style={{display:'flex',gap:6,alignItems:'center',fontSize:10,color:'rgba(201,168,76,0.7)'}}>
                        <span>{'{{business_name}}'}</span>
                        <span>{'{{expire_date}}'}</span>
                        <button onClick={()=>setPreview(p=>!p)}
                          style={{marginLeft:4,padding:'2px 6px',borderRadius:4,background:'rgba(201,168,76,0.1)',color:'var(--gold)',border:'none',cursor:'pointer',fontSize:10}}>
                          {preview?'Edit':'Preview'}
                        </button>
                      </div>
                    </div>
                    {preview
                      ? <div style={{borderRadius:6,border:'1px solid var(--border)',overflow:'auto',background:'white',maxHeight:200}}
                          dangerouslySetInnerHTML={{__html:form.body.replace(/{{business_name}}/g,'Acme Auto').replace(/{{expire_date}}/g,'Oct 31, 2026')}}/>
                      : <textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={6}
                          style={{width:'100%',padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:11,outline:'none',resize:'vertical',fontFamily:'monospace',boxSizing:'border-box'}}/>
                    }
                  </div>

                  {sendError&&<div style={{padding:'8px 10px',borderRadius:6,background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',color:'#f87171',fontSize:12}}>{sendError}</div>}

                  <button onClick={sendCampaign} disabled={sending||!audienceCount||!form.subject||!form.body}
                    style={{padding:'10px 0',borderRadius:8,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:13,fontWeight:700,opacity:sending||!audienceCount?0.5:1}}>
                    {sending?'Sending...':`Send to ${(audienceCount||0).toLocaleString()} Dealers`}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Send history */}
          {showHistory&&(
            <div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div style={{fontSize:11,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)'}}>SEND HISTORY</div>
                <button onClick={()=>setShowHistory(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)'}}><X size={13}/></button>
              </div>
              {history.length===0
                ? <p style={{fontSize:12,color:'var(--text-dim)'}}>No sends yet.</p>
                : history.slice(0,50).map(h=>(
                    <div key={h.id} style={{padding:'8px 0',borderBottom:'1px solid var(--border)',fontSize:11}}>
                      <div style={{color:'white',fontWeight:500,marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.business_name||h.email}</div>
                      <div style={{display:'flex',justifyContent:'space-between',color:'var(--text-dim)'}}>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'60%'}}>{h.campaign_name}</span>
                        <span style={{color:h.status==='sent'?'#4CC97A':'#ef4444',fontFamily:'monospace'}}>{h.status}</span>
                      </div>
                      <div style={{color:'var(--text-dim)',fontSize:10,fontFamily:'monospace',marginTop:1}}>
                        {h.sent_at?new Date(h.sent_at).toLocaleDateString():''}
                      </div>
                    </div>
                  ))
              }
            </div>
          )}

          {/* Contact detail */}
          {selected&&!showCampaign&&!showHistory&&(
            <div>
              <div style={{display:'flex',alignItems:'start',justifyContent:'space-between',marginBottom:12}}>
                <div style={{flex:1,minWidth:0,paddingRight:8}}>
                  <div style={{color:'white',fontWeight:600,fontSize:14,marginBottom:2,lineHeight:1.3}}>{selected.business_name}</div>
                  {selected.dba_name&&<div style={{color:'var(--text-dim)',fontSize:11,marginBottom:4}}>DBA: {selected.dba_name}</div>}
                  <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,fontFamily:'monospace',
                    background:(selected.license_type||'').includes('New')?'rgba(76,154,201,0.15)':'rgba(201,168,76,0.15)',
                    color:(selected.license_type||'').includes('New')?'#4C9AC9':'var(--gold)'}}>
                    {selected.license_type||'—'}
                  </span>
                </div>
                <button onClick={()=>setSelected(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)'}}><X size={14}/></button>
              </div>
              {[
                ['License #', selected.license_number],
                ['Category',  selected.license_category],
                ['Expires',   selected.license_expiration ? new Date(selected.license_expiration).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '—'],
                ['City',      selected.city],
                ['County',    selected.county],
                ['Phone',     selected.phone],
                ['Email',     selected.email],
              ].map(([label,val])=>(
                <div key={label} style={{display:'flex',gap:8,marginBottom:6}}>
                  <span style={{fontSize:10,fontFamily:'monospace',width:64,flexShrink:0,color:'var(--text-dim)',marginTop:1}}>{label}</span>
                  <span style={{fontSize:11,color:label==='Email'&&val&&val!=='—'?'#4C9AC9':'var(--text)',wordBreak:'break-all'}}>{val||'—'}</span>
                </div>
              ))}
            </div>
          )}

          {!showCampaign&&!showHistory&&!selected&&(
            <div style={{textAlign:'center',paddingTop:32,color:'var(--text-dim)',fontSize:12}}>
              Click a dealer to view details, or use Send Campaign to reach your audience.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
