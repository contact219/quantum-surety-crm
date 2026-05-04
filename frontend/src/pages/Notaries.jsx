import React,{useEffect,useState,useCallback,useRef} from 'react';
import {Search,Mail,MapPin,ChevronLeft,ChevronRight,Send,X,AlertTriangle,Clock,
        CheckCircle,Users,Zap,History,Square,CheckSquare,Pause,Play,RefreshCw} from 'lucide-react';

const EXPIRY_OPTIONS = [
  {value:'',label:'All Expiry'},
  {value:'30',label:'Expiring 30 days'},
  {value:'60',label:'Expiring 60 days'},
  {value:'90',label:'Expiring 90 days'},
  {value:'180',label:'Expiring 180 days'},
  {value:'expired',label:'Already expired'},
  {value:'custom',label:'Custom date range...'},
];

const AUTO_EXPIRY_OPTIONS = [
  {value:'30',label:'Expiring within 30 days'},
  {value:'60',label:'Expiring within 60 days'},
  {value:'90',label:'Expiring within 90 days'},
  {value:'180',label:'Expiring within 180 days'},
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
    <p style="margin:4px 0;color:#333;font-size:14px">✓ 4-year term available — bond once for your full commission</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ 55% commission if you refer other notaries</p>
  </div>
  <a href="https://quantumsurety.bond/get-bond?type=notary" style="background:#C9A84C;color:#000;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;font-family:Arial,sans-serif;font-size:15px">Renew My Bond Now →</a>
  <p style="margin:16px 0 0;color:#555;font-size:14px;font-family:Arial,sans-serif">Prefer to talk? Call us: <a href="tel:+19723799216" style="color:#C9A84C;font-weight:bold">972-379-9216</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0"/>
  <p style="color:#999;font-size:11px;margin:0;font-family:Arial,sans-serif">Quantum Surety LLC · Texas Licensed Surety Agency · <a href="https://quantumsurety.bond" style="color:#C9A84C">quantumsurety.bond</a> · <a href="{{unsubscribe_url}}" style="color:#999">Unsubscribe</a></p>
</div>`;

const BLANK_FORM = {
  campaign_name:'',
  subject:'{{first_name}}, Your Texas Notary Bond Expires {{expire_date}}',
  body:NOTARY_TEMPLATE,
  from_name:'Quantum Surety',
  from_email:'info@quantumsurety.bond',
};

// Reusable campaign form fields
function CampaignFields({form,setForm,preview,setPreview}) {
  return (
    <>
      {[['CAMPAIGN NAME (optional)','campaign_name'],['SUBJECT','subject'],['FROM NAME','from_name'],['FROM EMAIL','from_email']].map(([label,key])=>(
        <div key={key}>
          <label className="text-xs font-mono tracking-wider block mb-1.5" style={{color:'var(--text-dim)'}}>{label}</label>
          <input value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
            style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
        </div>
      ))}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-mono tracking-wider" style={{color:'var(--text-dim)'}}>EMAIL BODY (HTML)</label>
          <div className="flex items-center gap-2 text-xs" style={{color:'var(--text-dim)'}}>
            <span style={{color:'rgba(201,168,76,0.7)'}}>{'{{first_name}}'}</span>
            <span style={{color:'rgba(201,168,76,0.7)'}}>{'{{expire_date}}'}</span>
            <span style={{color:'rgba(201,168,76,0.7)'}}>{'{{surety_company}}'}</span>
            <button onClick={()=>setPreview(p=>!p)} className="ml-1 px-2 py-1 rounded"
              style={{color:'var(--gold)',background:'rgba(201,168,76,0.1)'}}>
              {preview?'Edit':'Preview'}
            </button>
          </div>
        </div>
        {preview
          ? <div style={{borderRadius:'0.5rem',border:'1px solid var(--border)',overflow:'auto',background:'white',maxHeight:'240px'}}
              dangerouslySetInnerHTML={{__html:form.body
                .replace(/{{first_name}}/g,'Sarah')
                .replace(/{{expire_date}}/g,'July 12, 2026')
                .replace(/{{surety_company}}/g,'Western Surety Company')}}/>
          : <textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={7}
              className="w-full px-3 py-2 rounded-lg border text-xs outline-none resize-none font-mono"
              style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
        }
      </div>
    </>
  );
}

export default function Notaries() {
  // Table state
  const [stats,setStats]=useState(null);
  const [rows,setRows]=useState([]);
  const [total,setTotal]=useState(0);
  const [pages,setPages]=useState(1);
  const [page,setPage]=useState(1);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  // Filter state
  const [search,setSearch]=useState('');
  const [city,setCity]=useState('');
  const [surety,setSurety]=useState('');
  const [expiring,setExpiring]=useState('60');
  const [hasEmail,setHasEmail]=useState(false);
  const [dateFrom,setDateFrom]=useState('');
  const [dateTo,setDateTo]=useState('');
  const [companies,setCompanies]=useState([]);
  const searchTimer=useRef(null);

  // Selection state
  const [selected,setSelected]=useState(new Set());
  const [sentIds,setSentIds]=useState(new Set());

  // Campaign modal state
  const [showCampaign,setShowCampaign]=useState(false);
  const [campaignTab,setCampaignTab]=useState('filtered');
  const [campaignForm,setCampaignForm]=useState(BLANK_FORM);
  const [preview,setPreview]=useState(false);
  const [skipSent,setSkipSent]=useState(true);
  const [audienceCount,setAudienceCount]=useState(null);
  const [sending,setSending]=useState(false);
  const [sendResult,setSendResult]=useState(null);

  // Auto-campaign state
  const [autoConfig,setAutoConfig]=useState(null);
  const [autoForm,setAutoForm]=useState({
    expiring_days:'90',
    emails_per_day:50,
    subject:'{{first_name}}, Your Texas Notary Bond Expires {{expire_date}}',
    body:NOTARY_TEMPLATE,
    from_name:'Quantum Surety',
    from_email:'info@quantumsurety.bond',
  });
  const [autoPreview,setAutoPreview]=useState(false);

  // History state
  const [showHistory,setShowHistory]=useState(false);
  const [history,setHistory]=useState([]);
  const [histTotal,setHistTotal]=useState(0);
  const [histLoading,setHistLoading]=useState(false);

  // Initial loads
  useEffect(()=>{
    fetch('/api/notaries/stats').then(r=>r.json()).then(setStats).catch(()=>{});
    fetch('/api/notaries/companies').then(r=>r.json()).then(setCompanies).catch(()=>{});
    refreshSentIds();
    fetch('/api/notary-campaigns/auto').then(r=>r.json()).then(j=>{
      if(!j) return;
      setAutoConfig(j);
      const f=j.filters||{};
      setAutoForm(prev=>({...prev,
        subject:j.subject||prev.subject,
        body:j.body||prev.body,
        from_name:j.from_name||prev.from_name,
        from_email:j.from_email||prev.from_email,
        emails_per_day:j.emails_per_day||50,
        expiring_days:f.expiring||'90',
      }));
    }).catch(()=>{});
  },[]);

  const refreshSentIds=()=>{
    fetch('/api/notary-campaigns/sent-ids')
      .then(r=>r.json())
      .then(j=>setSentIds(new Set(j.ids||[])))
      .catch(()=>{});
  };

  // Load history when panel opens
  useEffect(()=>{
    if(!showHistory) return;
    setHistLoading(true);
    fetch('/api/notary-campaigns/history?limit=200')
      .then(r=>r.json())
      .then(j=>{setHistory(j.rows||[]);setHistTotal(j.total||0);setHistLoading(false);})
      .catch(()=>setHistLoading(false));
  },[showHistory]);

  const getFilters=useCallback(()=>{
    const f={surety,city};
    if(expiring==='custom'){if(dateFrom) f.date_from=dateFrom; if(dateTo) f.date_to=dateTo;}
    else f.expiring=expiring;
    return f;
  },[surety,city,expiring,dateFrom,dateTo]);

  const load=useCallback(()=>{
    setLoading(true); setError('');
    const p=new URLSearchParams({
      page,limit:50,search,city,surety,
      expiring:expiring==='custom'?'':expiring,
      has_email:hasEmail?'true':'',
      ...(expiring==='custom'?{date_from:dateFrom,date_to:dateTo}:{}),
    });
    fetch(`/api/notaries?${p}`)
      .then(r=>{if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();})
      .then(j=>{setRows(Array.isArray(j.data)?j.data:[]);setTotal(j.total||0);setPages(j.pages||1);setLoading(false);})
      .catch(e=>{setError(e.message);setRows([]);setLoading(false);});
  },[page,search,city,surety,expiring,hasEmail,dateFrom,dateTo]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{setPage(1);},[search,city,surety,expiring,hasEmail,dateFrom,dateTo]);

  const handleSearchChange=e=>{const v=e.target.value;clearTimeout(searchTimer.current);searchTimer.current=setTimeout(()=>setSearch(v),400);};
  const handleCityChange=e=>{const v=e.target.value;clearTimeout(searchTimer.current);searchTimer.current=setTimeout(()=>setCity(v),400);};

  // Audience count (filtered tab)
  useEffect(()=>{
    if(!showCampaign||campaignTab!=='filtered') return;
    setAudienceCount(null);
    fetch('/api/notary-campaigns/count',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({filters:getFilters(),skip_sent:skipSent}),
    }).then(r=>r.json()).then(j=>setAudienceCount(j.count||0)).catch(()=>setAudienceCount(0));
  },[showCampaign,campaignTab,surety,city,expiring,dateFrom,dateTo,skipSent]);

  // Selection helpers
  const toggleSelect=id=>{
    setSelected(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n;});
  };
  const toggleSelectAll=()=>{
    const withEmail=rows.filter(r=>r.email);
    const allSel=withEmail.length>0&&withEmail.every(r=>selected.has(r.id));
    setSelected(s=>{const n=new Set(s);withEmail.forEach(r=>allSel?n.delete(r.id):n.add(r.id));return n;});
  };
  const clearSelected=()=>setSelected(new Set());

  const openCampaign=tab=>{
    setCampaignTab(tab||(selected.size>0?'selected':'filtered'));
    setShowCampaign(true);setSendResult(null);setPreview(false);setAutoPreview(false);
  };

  // Send handlers
  const sendFiltered=async()=>{
    setSending(true);setSendResult(null);
    try{
      const r=await fetch('/api/notary-campaigns/send',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...campaignForm,filters:getFilters(),skip_sent:skipSent}),
      });
      const j=await r.json();
      setSendResult(j);refreshSentIds();
    }catch(e){setSendResult({error:e.message});}
    setSending(false);setShowCampaign(false);
  };

  const sendSelected=async()=>{
    setSending(true);setSendResult(null);
    try{
      const r=await fetch('/api/notary-campaigns/send-selected',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...campaignForm,ids:[...selected]}),
      });
      const j=await r.json();
      setSendResult(j);clearSelected();refreshSentIds();
    }catch(e){setSendResult({error:e.message});}
    setSending(false);setShowCampaign(false);
  };

  const saveAuto=async()=>{
    setSending(true);
    try{
      const r=await fetch('/api/notary-campaigns/auto',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(autoForm),
      });
      const j=await r.json();
      setAutoConfig(j);
      setSendResult({ok:true,message:`Auto-campaign saved — will send to notaries expiring within ${autoForm.expiring_days} days`});
    }catch(e){setSendResult({error:e.message});}
    setSending(false);setShowCampaign(false);
  };

  const toggleAutoStatus=async()=>{
    if(!autoConfig) return;
    const newStatus=autoConfig.status==='active'?'paused':'active';
    try{
      await fetch(`/api/drip/${autoConfig.id}/status`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({status:newStatus}),
      });
      setAutoConfig(c=>({...c,status:newStatus}));
    }catch(e){console.error(e);}
  };

  // Helpers
  const expiryColor=date=>{
    if(!date) return 'var(--text-dim)';
    const days=Math.round((new Date(date)-new Date())/(864e5));
    if(days<0) return '#6B6B8A';
    if(days<=90) return '#ef4444';
    if(days<=180) return '#f97316';
    return '#4CC97A';
  };
  const formatDate=d=>{
    if(!d) return '—';
    try{return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
    catch{return d;}
  };
  const daysLeft=date=>{
    if(!date) return null;
    return Math.round((new Date(date)-new Date())/(864e5));
  };

  const allEmailOnPage=rows.filter(r=>r.email);
  const allPageSelected=allEmailOnPage.length>0&&allEmailOnPage.every(r=>selected.has(r.id));

  const selectedOnPage=rows.filter(r=>selected.has(r.id));

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-4 border-b flex-shrink-0" style={{borderColor:'var(--border)'}}>
        <div className="text-xs font-mono tracking-widest mb-1" style={{color:'var(--gold)'}}>NOTARY BONDS</div>
        <div className="flex items-end justify-between mb-4">
          <h1 className="font-display text-3xl tracking-wider text-white">Texas Notaries</h1>
          <div className="flex items-center gap-2">
            <button onClick={()=>setShowHistory(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border"
              style={{borderColor:'var(--border)',color:'var(--text-dim)'}}>
              <History size={13}/> History
            </button>
            <button onClick={()=>openCampaign('auto')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border"
              style={{
                borderColor:autoConfig&&autoConfig.status==='active'?'rgba(76,201,122,0.5)':'var(--border)',
                color:autoConfig&&autoConfig.status==='active'?'#4CC97A':'var(--text-dim)',
                background:autoConfig&&autoConfig.status==='active'?'rgba(76,201,122,0.08)':'transparent',
              }}>
              <Zap size={13}/> Auto
              {autoConfig&&autoConfig.status==='active'&&<span className="ml-1 w-1.5 h-1.5 rounded-full bg-green-400"/>}
            </button>
            {selected.size>0&&(
              <button onClick={()=>openCampaign('selected')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border"
                style={{background:'rgba(201,168,76,0.12)',borderColor:'var(--gold)',color:'var(--gold)'}}>
                <Send size={13}/> Send to {selected.size} selected
              </button>
            )}
            <button onClick={()=>openCampaign('filtered')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
              style={{background:'var(--gold)',color:'#0A0A0F'}}>
              <Send size={13}/> Send Campaign
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats&&(
          <div className="grid grid-cols-5 gap-3 mb-4">
            {[
              {label:'Total',val:parseInt(stats.total||0).toLocaleString(),icon:Users,color:'var(--gold)'},
              {label:'With Email',val:parseInt(stats.with_email||0).toLocaleString(),icon:Mail,color:'#4C9AC9'},
              {label:'Expiring 90d',val:parseInt(stats.expiring_90||0).toLocaleString(),icon:AlertTriangle,color:'#ef4444'},
              {label:'Expiring 180d',val:parseInt(stats.expiring_180||0).toLocaleString(),icon:Clock,color:'#f97316'},
              {label:'Competitor',val:parseInt(stats.competitor_bonded||0).toLocaleString(),icon:CheckCircle,color:'#4CC97A'},
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
            <input defaultValue={search} onChange={handleSearchChange} placeholder="Name or email..."
              className="pl-8 pr-3 py-1.5 rounded-lg text-sm border outline-none w-44"
              style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/>
          </div>
          <div className="relative">
            <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:'var(--text-dim)'}}/>
            <input defaultValue={city} onChange={handleCityChange} placeholder="City..."
              className="pl-8 pr-3 py-1.5 rounded-lg text-sm border outline-none w-32"
              style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/>
          </div>
          <select value={surety} onChange={e=>setSurety(e.target.value)}
            className="px-2 py-1.5 rounded-lg text-sm border outline-none"
            style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)',maxWidth:'200px'}}>
            <option value="">All Companies</option>
            {companies.map(c=>(
              <option key={c.surety_company} value={c.surety_company}>
                {(c.surety_company||'').slice(0,32)} ({parseInt(c.count||0).toLocaleString()})
              </option>
            ))}
          </select>
          <select value={expiring}
            onChange={e=>{setExpiring(e.target.value);if(e.target.value!=='custom'){setDateFrom('');setDateTo('');}}}
            className="px-2 py-1.5 rounded-lg text-sm border outline-none"
            style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}>
            {EXPIRY_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {expiring==='custom'&&(
            <>
              <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
                className="px-2 py-1.5 rounded-lg text-sm border outline-none"
                style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/>
              <span className="text-xs" style={{color:'var(--text-dim)'}}>→</span>
              <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
                className="px-2 py-1.5 rounded-lg text-sm border outline-none"
                style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/>
            </>
          )}
          <button onClick={()=>setHasEmail(v=>!v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
            style={{background:hasEmail?'rgba(76,154,201,0.15)':'transparent',borderColor:hasEmail?'#4C9AC9':'var(--border)',color:hasEmail?'#4C9AC9':'var(--text-dim)'}}>
            Email only
          </button>
          {(search||city||surety||expiring||hasEmail)&&(
            <button onClick={()=>{setSearch('');setCity('');setSurety('');setExpiring('');setHasEmail(false);setDateFrom('');setDateTo('');}}
              className="flex items-center gap-1 text-xs px-2 py-1.5 rounded"
              style={{color:'var(--text-dim)',background:'var(--muted)'}}>
              <X size={10}/> Clear
            </button>
          )}
          {selected.size>0&&(
            <button onClick={clearSelected}
              className="flex items-center gap-1 text-xs px-2 py-1.5 rounded"
              style={{color:'var(--gold)',background:'rgba(201,168,76,0.1)'}}>
              <X size={10}/> {selected.size} selected
            </button>
          )}
          <span className="ml-auto text-xs font-mono" style={{color:'var(--text-dim)'}}>
            {loading?'Loading...':total.toLocaleString()+' results'}
          </span>
        </div>
      </div>

      {/* Auto-campaign status bar */}
      {autoConfig&&autoConfig.status==='active'&&(
        <div className="mx-6 mt-3 px-4 py-2 rounded-lg border flex items-center justify-between flex-shrink-0"
          style={{background:'rgba(76,201,122,0.06)',borderColor:'rgba(76,201,122,0.25)'}}>
          <div className="flex items-center gap-2 text-xs">
            <Zap size={12} style={{color:'#4CC97A'}}/>
            <span style={{color:'#4CC97A'}}>Auto-campaign active</span>
            <span style={{color:'var(--text-dim)'}}>
              · Expiring {autoConfig.filters?.expiring||90}d window
              · {autoConfig.emails_per_day}/day limit
              · {(autoConfig.total_sent||0).toLocaleString()} sent total
              {autoConfig.last_run&&<> · Last run {formatDate(autoConfig.last_run)}</>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>openCampaign('auto')} className="text-xs px-2 py-1 rounded"
              style={{color:'var(--text-dim)',background:'var(--muted)'}}>Configure</button>
            <button onClick={toggleAutoStatus} className="flex items-center gap-1 text-xs px-2 py-1 rounded"
              style={{color:'#f97316',background:'rgba(249,115,22,0.1)'}}>
              <Pause size={10}/> Pause
            </button>
          </div>
        </div>
      )}

      {/* Send result banner */}
      {sendResult&&(
        <div className="mx-6 mt-3 p-3 rounded-lg border flex items-center justify-between text-sm flex-shrink-0"
          style={{background:sendResult.error?'#2e1a1a':'#1a2e1a',borderColor:sendResult.error?'#5a2a2a':'#2a5a2a'}}>
          <span style={{color:sendResult.error?'#f87171':'#4ade80'}}>
            {sendResult.error?`Error: ${sendResult.error}`:
             sendResult.message?`✓ ${sendResult.message}`:
             `✓ Sent ${sendResult.sent} · Failed ${sendResult.failed} · Total ${sendResult.total}`}
          </span>
          <button onClick={()=>setSendResult(null)} style={{color:'var(--text-dim)'}}><X size={13}/></button>
        </div>
      )}

      {error&&(
        <div className="mx-6 mt-3 p-3 rounded-lg text-sm flex-shrink-0" style={{background:'#2e1a1a',color:'#f87171'}}>
          Error: {error}
        </div>
      )}

      {/* ── Table ── */}
      <div style={{flex:1,overflowY:'auto'}}>
        <table className="w-full text-sm" style={{tableLayout:'fixed'}}>
          <colgroup>
            <col style={{width:'32px'}}/>
            <col style={{width:'11%'}}/><col style={{width:'11%'}}/><col style={{width:'9%'}}/>
            <col style={{width:'20%'}}/><col style={{width:'10%'}}/><col style={{width:'7%'}}/><col/>
          </colgroup>
          <thead style={{position:'sticky',top:0,background:'var(--dark)',zIndex:1}}>
            <tr className="border-b" style={{borderColor:'var(--border)'}}>
              <th className="px-2 py-3">
                <button onClick={toggleSelectAll} style={{display:'flex',color:'var(--text-dim)'}}>
                  {allPageSelected
                    ? <CheckSquare size={13} style={{color:'var(--gold)'}}/>
                    : <Square size={13}/>}
                </button>
              </th>
              {['First Name','Last Name','City','Email','Expires','Days','Surety Company'].map(h=>(
                <th key={h} className="text-left px-3 py-3 text-xs font-mono tracking-wider" style={{color:'var(--text-dim)'}}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading&&rows.map((row,idx)=>{
              const dl=daysLeft(row.expire_date);
              const color=expiryColor(row.expire_date);
              const isSel=selected.has(row.id);
              const wasSent=sentIds.has(row.id);
              return (
                <tr key={row.id||idx}
                  onClick={()=>row.email&&toggleSelect(row.id)}
                  className="border-b transition-colors"
                  style={{borderColor:'var(--border)',background:isSel?'rgba(201,168,76,0.06)':'transparent',cursor:row.email?'pointer':'default'}}>
                  <td className="px-2 py-2.5">
                    {row.email&&(
                      <span style={{color:isSel?'var(--gold)':'var(--text-dim)',display:'flex'}}>
                        {isSel?<CheckSquare size={13}/>:<Square size={13}/>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-white truncate">{row.first_name||'—'}</td>
                  <td className="px-3 py-2.5 text-white truncate">{row.last_name||'—'}</td>
                  <td className="px-3 py-2.5 truncate" style={{color:'var(--text-dim)'}}>{row.city||'—'}</td>
                  <td className="px-3 py-2.5 text-xs truncate">
                    <span style={{color:row.email?'#4C9AC9':'var(--text-dim)'}}>{row.email||'—'}</span>
                    {wasSent&&row.email&&(
                      <span className="ml-1.5 px-1 py-0.5 rounded font-mono"
                        style={{background:'rgba(76,201,122,0.12)',color:'#4CC97A',fontSize:'9px',letterSpacing:'0.05em'}}>SENT</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono" style={{color}}>{formatDate(row.expire_date)}</td>
                  <td className="px-3 py-2.5">
                    {dl!==null&&(
                      <span className="text-xs px-1.5 py-0.5 rounded font-mono"
                        style={{
                          background:dl<0?'rgba(107,107,138,0.2)':dl<=90?'rgba(239,68,68,0.15)':dl<=180?'rgba(249,115,22,0.15)':'rgba(76,201,122,0.15)',
                          color:dl<0?'#6B6B8A':dl<=90?'#ef4444':dl<=180?'#f97316':'#4CC97A',
                        }}>
                        {dl<0?'Expired':`${dl}d`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs truncate" style={{color:'var(--text-dim)'}}>{row.surety_company||'—'}</td>
                </tr>
              );
            })}
            {loading&&<tr><td colSpan={8} className="px-3 py-8 text-center text-sm" style={{color:'var(--text-dim)'}}>Loading...</td></tr>}
            {!loading&&rows.length===0&&<tr><td colSpan={8} className="px-3 py-8 text-center text-sm" style={{color:'var(--text-dim)'}}>No results found</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-6 py-3 border-t flex-shrink-0" style={{borderColor:'var(--border)'}}>
        <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded disabled:opacity-30"
          style={{color:'var(--text-dim)'}}>
          <ChevronLeft size={14}/> Prev
        </button>
        <span className="text-xs font-mono" style={{color:'var(--text-dim)'}}>
          Page {page} of {pages.toLocaleString()}
        </span>
        <button onClick={()=>setPage(p=>Math.min(pages,p+1))} disabled={page>=pages}
          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded disabled:opacity-30"
          style={{color:'var(--text-dim)'}}>
          Next <ChevronRight size={14}/>
        </button>
      </div>

      {/* ── Campaign Modal ── */}
      {showCampaign&&(
        <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem',background:'rgba(0,0,0,0.85)'}}>
          <div style={{width:'100%',maxWidth:'700px',borderRadius:'1rem',border:'1px solid var(--border)',background:'var(--surface)',display:'flex',flexDirection:'column',maxHeight:'92vh'}}>

            {/* Modal header */}
            <div className="px-6 pt-5 pb-0 flex items-center justify-between flex-shrink-0">
              <div className="font-display text-2xl tracking-wider text-white">Notary Campaign</div>
              <button onClick={()=>setShowCampaign(false)} style={{color:'var(--text-dim)'}}><X size={18}/></button>
            </div>

            {/* Tabs */}
            <div className="flex px-6 mt-4 border-b flex-shrink-0" style={{borderColor:'var(--border)'}}>
              {[
                {id:'selected',label:`Send to Selected${selected.size>0?` (${selected.size})`:''}`,icon:CheckSquare,disabled:selected.size===0},
                {id:'filtered',label:'Send to Filtered',icon:Users,disabled:false},
                {id:'auto',label:'Auto-Campaign',icon:Zap,disabled:false},
              ].map(tab=>(
                <button key={tab.id} onClick={()=>!tab.disabled&&setCampaignTab(tab.id)}
                  className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors"
                  style={{
                    borderBottomColor:campaignTab===tab.id?'var(--gold)':'transparent',
                    color:campaignTab===tab.id?'var(--gold)':tab.disabled?'var(--border)':'var(--text-dim)',
                    cursor:tab.disabled?'not-allowed':'pointer',
                    marginBottom:'-1px',
                  }}>
                  <tab.icon size={13}/>{tab.label}
                </button>
              ))}
            </div>

            {/* Modal body */}
            <div style={{flex:1,overflowY:'auto',padding:'1.25rem',display:'flex',flexDirection:'column',gap:'1rem'}}>

              {/* ── SELECTED TAB ── */}
              {campaignTab==='selected'&&(
                <>
                  <div className="rounded-lg p-4 border" style={{background:'var(--muted)',borderColor:'var(--border)'}}>
                    <div className="text-xs font-mono tracking-wider mb-2" style={{color:'var(--gold)'}}>
                      SELECTED CONTACTS — {selected.size} total
                    </div>
                    <div style={{maxHeight:'130px',overflowY:'auto'}}>
                      {selectedOnPage.length>0
                        ? selectedOnPage.map(r=>(
                          <div key={r.id} className="flex items-center gap-3 py-1.5 border-b text-xs" style={{borderColor:'var(--border)'}}>
                            <span className="text-white w-32 truncate">{r.first_name} {r.last_name}</span>
                            <span className="flex-1 truncate" style={{color:'#4C9AC9'}}>{r.email}</span>
                            <span className="font-mono w-24 text-right" style={{color:expiryColor(r.expire_date)}}>{formatDate(r.expire_date)}</span>
                            <button onClick={e=>{e.stopPropagation();toggleSelect(r.id);}} style={{color:'var(--text-dim)'}}>
                              <X size={10}/>
                            </button>
                          </div>
                        ))
                        : <p className="text-xs" style={{color:'var(--text-dim)'}}>Selected contacts on other pages will still be included.</p>
                      }
                    </div>
                    {selected.size>selectedOnPage.length&&(
                      <p className="text-xs mt-2" style={{color:'var(--text-dim)'}}>
                        +{selected.size-selectedOnPage.length} contacts from other pages also included
                      </p>
                    )}
                  </div>
                  <CampaignFields form={campaignForm} setForm={setCampaignForm} preview={preview} setPreview={setPreview}/>
                </>
              )}

              {/* ── FILTERED TAB ── */}
              {campaignTab==='filtered'&&(
                <>
                  <div className="rounded-lg p-4 border" style={{background:'var(--muted)',borderColor:'var(--border)'}}>
                    <div className="text-xs font-mono tracking-wider mb-2" style={{color:'var(--gold)'}}>AUDIENCE — CURRENT FILTERS</div>
                    <div className="text-xs font-mono flex flex-wrap gap-x-4 gap-y-1" style={{color:'var(--text-dim)'}}>
                      {expiring&&expiring!=='custom'&&<span>Expiry: {EXPIRY_OPTIONS.find(o=>o.value===expiring)?.label}</span>}
                      {expiring==='custom'&&<span>Expiry: {dateFrom||'any'} → {dateTo||'any'}</span>}
                      {surety&&<span>Company: {surety.slice(0,28)}</span>}
                      {city&&<span>City: {city}</span>}
                      {!expiring&&!surety&&!city&&<span>No filters — all notaries with email</span>}
                      <span style={{color:'var(--gold)'}}>
                        → {audienceCount===null?'Counting...':(audienceCount||0).toLocaleString()} contacts
                      </span>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input type="checkbox" checked={skipSent} onChange={e=>setSkipSent(e.target.checked)} className="accent-yellow-500"/>
                    <span style={{color:'var(--text-dim)'}}>Skip contacts already sent a campaign (recommended)</span>
                  </label>
                  <CampaignFields form={campaignForm} setForm={setCampaignForm} preview={preview} setPreview={setPreview}/>
                </>
              )}

              {/* ── AUTO CAMPAIGN TAB ── */}
              {campaignTab==='auto'&&(
                <>
                  {/* Current status */}
                  {autoConfig&&(
                    <div className="rounded-lg p-4 border flex items-center justify-between" style={{
                      background:autoConfig.status==='active'?'rgba(76,201,122,0.07)':'var(--muted)',
                      borderColor:autoConfig.status==='active'?'rgba(76,201,122,0.3)':'var(--border)',
                    }}>
                      <div>
                        <div className="text-xs font-mono tracking-wider mb-1"
                          style={{color:autoConfig.status==='active'?'#4CC97A':'var(--text-dim)'}}>
                          {autoConfig.status==='active'?'● AUTO-CAMPAIGN ACTIVE':'○ AUTO-CAMPAIGN PAUSED'}
                        </div>
                        <div className="text-xs" style={{color:'var(--text-dim)'}}>
                          {(autoConfig.total_sent||0).toLocaleString()} total sent
                          {autoConfig.last_run&&<> · Last run {formatDate(autoConfig.last_run)}</>}
                        </div>
                      </div>
                      <button onClick={toggleAutoStatus}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
                        style={{
                          background:autoConfig.status==='active'?'rgba(249,115,22,0.15)':'rgba(76,201,122,0.15)',
                          color:autoConfig.status==='active'?'#f97316':'#4CC97A',
                        }}>
                        {autoConfig.status==='active'?<><Pause size={11}/> Pause</>:<><Play size={11}/> Activate</>}
                      </button>
                    </div>
                  )}

                  <div className="rounded-lg p-4 border text-xs leading-relaxed" style={{background:'rgba(201,168,76,0.05)',borderColor:'rgba(201,168,76,0.2)',color:'var(--text-dim)'}}>
                    Auto-campaign runs daily via the drip scheduler. It sends your email to notaries whose bonds expire
                    within the selected window — automatically skipping anyone already contacted and honoring unsubscribes.
                    Saving below replaces any existing auto-campaign configuration.
                  </div>

                  {/* Auto config fields */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-mono tracking-wider block mb-1.5" style={{color:'var(--text-dim)'}}>EXPIRY WINDOW</label>
                      <select value={autoForm.expiring_days} onChange={e=>setAutoForm(f=>({...f,expiring_days:e.target.value}))}
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                        style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}>
                        {AUTO_EXPIRY_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-mono tracking-wider block mb-1.5" style={{color:'var(--text-dim)'}}>MAX EMAILS / DAY</label>
                      <input type="number" min={1} max={500} value={autoForm.emails_per_day}
                        onChange={e=>setAutoForm(f=>({...f,emails_per_day:parseInt(e.target.value)||50}))}
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                        style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                    </div>
                  </div>

                  {[['SUBJECT','subject'],['FROM NAME','from_name'],['FROM EMAIL','from_email']].map(([label,key])=>(
                    <div key={key}>
                      <label className="text-xs font-mono tracking-wider block mb-1.5" style={{color:'var(--text-dim)'}}>{label}</label>
                      <input value={autoForm[key]} onChange={e=>setAutoForm(f=>({...f,[key]:e.target.value}))}
                        className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                        style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                    </div>
                  ))}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-mono tracking-wider" style={{color:'var(--text-dim)'}}>EMAIL BODY (HTML)</label>
                      <button onClick={()=>setAutoPreview(p=>!p)} className="text-xs px-2 py-1 rounded"
                        style={{color:'var(--gold)',background:'rgba(201,168,76,0.1)'}}>
                        {autoPreview?'Edit':'Preview'}
                      </button>
                    </div>
                    {autoPreview
                      ? <div style={{borderRadius:'0.5rem',border:'1px solid var(--border)',overflow:'auto',background:'white',maxHeight:'220px'}}
                          dangerouslySetInnerHTML={{__html:autoForm.body
                            .replace(/{{first_name}}/g,'Sarah')
                            .replace(/{{expire_date}}/g,'July 12, 2026')
                            .replace(/{{surety_company}}/g,'Western Surety Company')}}/>
                      : <textarea value={autoForm.body} onChange={e=>setAutoForm(f=>({...f,body:e.target.value}))} rows={6}
                          className="w-full px-3 py-2 rounded-lg border text-xs outline-none resize-none font-mono"
                          style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                    }
                  </div>
                </>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t flex gap-3 justify-end flex-shrink-0" style={{borderColor:'var(--border)'}}>
              <button onClick={()=>setShowCampaign(false)} className="px-4 py-2 rounded-lg text-sm" style={{color:'var(--text-dim)'}}>
                Cancel
              </button>
              {campaignTab==='selected'&&(
                <button onClick={sendSelected} disabled={sending||selected.size===0}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                  style={{background:'var(--gold)',color:'#0A0A0F'}}>
                  <Send size={13}/>
                  {sending?'Sending...':`Send to ${selected.size} contact${selected.size!==1?'s':''}`}
                </button>
              )}
              {campaignTab==='filtered'&&(
                <button onClick={sendFiltered} disabled={sending||!audienceCount}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                  style={{background:'var(--gold)',color:'#0A0A0F'}}>
                  <Send size={13}/>
                  {sending?'Sending...':`Send to ${(audienceCount||0).toLocaleString()} notaries`}
                </button>
              )}
              {campaignTab==='auto'&&(
                <button onClick={saveAuto} disabled={sending}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                  style={{background:'var(--gold)',color:'#0A0A0F'}}>
                  <Zap size={13}/>
                  {sending?'Saving...':'Save & Activate Auto-Campaign'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── History Drawer ── */}
      {showHistory&&(
        <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',justifyContent:'flex-end',background:'rgba(0,0,0,0.6)'}}
          onClick={e=>{if(e.target===e.currentTarget)setShowHistory(false);}}>
          <div style={{width:'100%',maxWidth:'620px',background:'var(--surface)',borderLeft:'1px solid var(--border)',display:'flex',flexDirection:'column',height:'100%'}}>
            <div className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0" style={{borderColor:'var(--border)'}}>
              <div>
                <div className="font-display text-xl tracking-wider text-white">Campaign History</div>
                <div className="text-xs font-mono mt-0.5" style={{color:'var(--text-dim)'}}>{histTotal.toLocaleString()} total sends</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={()=>{setShowHistory(false);setTimeout(()=>setShowHistory(true),50);}}
                  className="p-1.5 rounded" style={{color:'var(--text-dim)'}}>
                  <RefreshCw size={14}/>
                </button>
                <button onClick={()=>setShowHistory(false)} style={{color:'var(--text-dim)'}}><X size={18}/></button>
              </div>
            </div>
            <div style={{flex:1,overflowY:'auto'}}>
              {histLoading?(
                <div className="p-8 text-center text-sm" style={{color:'var(--text-dim)'}}>Loading...</div>
              ):history.length===0?(
                <div className="p-8 text-center text-sm" style={{color:'var(--text-dim)'}}>No campaigns sent yet</div>
              ):(
                <table className="w-full text-xs">
                  <thead style={{position:'sticky',top:0,background:'var(--surface)',zIndex:1}}>
                    <tr className="border-b" style={{borderColor:'var(--border)'}}>
                      {['Name','Email','Campaign','Sent At','Status'].map(h=>(
                        <th key={h} className="text-left px-4 py-2.5 font-mono tracking-wider" style={{color:'var(--text-dim)'}}>{h.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h=>(
                      <tr key={h.id} className="border-b" style={{borderColor:'var(--border)'}}>
                        <td className="px-4 py-2.5 text-white truncate" style={{maxWidth:'120px'}}>
                          {h.first_name?`${h.first_name} ${h.last_name||''}`.trim():'—'}
                        </td>
                        <td className="px-4 py-2.5 truncate" style={{color:'#4C9AC9',maxWidth:'140px'}}>{h.email}</td>
                        <td className="px-4 py-2.5 truncate" style={{color:'var(--text-dim)',maxWidth:'130px'}}>{h.campaign_name||'—'}</td>
                        <td className="px-4 py-2.5 font-mono whitespace-nowrap" style={{color:'var(--text-dim)'}}>
                          {h.sent_at?new Date(h.sent_at+'Z').toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}):'—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="px-1.5 py-0.5 rounded font-mono"
                            style={{
                              background:h.status==='sent'?'rgba(76,201,122,0.12)':'rgba(239,68,68,0.12)',
                              color:h.status==='sent'?'#4CC97A':'#ef4444',
                            }}>{h.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
