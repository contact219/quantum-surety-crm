import React,{useEffect,useState,useRef} from 'react';
import {Plus,Send,Trash2,X,Eye,Copy,Users,ChevronDown,ChevronUp,BarChart2,Edit2,Check,Filter} from 'lucide-react';

const TEMPLATES = {
  hub_dbe: {
    name: 'HUB/DBE Bond Outreach',
    subject: 'Is {{company_name}} Bonded for State Contracts?',
    body: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff">
  <div style="border-bottom:3px solid #C9A84C;padding-bottom:16px;margin-bottom:24px">
    <h1 style="margin:0;font-size:22px;color:#0A0A0F;letter-spacing:2px;font-family:Arial,sans-serif">QUANTUM SURETY</h1>
    <p style="margin:4px 0 0;font-size:11px;color:#888;letter-spacing:3px;font-family:Arial,sans-serif">TEXAS LICENSED SURETY AGENCY</p>
  </div>
  <h2 style="color:#0A0A0F;font-size:20px;margin:0 0 16px">Is {{company_name}} Bonded for State Contracts?</h2>
  <p style="color:#333;line-height:1.7;margin:0 0 16px">As a certified HUB/DBE contractor, you may be required to carry surety bonds to bid on Texas state projects — and we specialize in getting certified minority and women-owned businesses bonded fast.</p>
  <div style="background:#f9f6ef;border-left:4px solid #C9A84C;padding:16px 20px;margin:24px 0;border-radius:0 6px 6px 0">
    <p style="margin:0 0 10px;font-weight:bold;color:#0A0A0F">Why Quantum Surety?</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ Same-day bond issuance</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ Competitive rates for HUB/DBE certified firms</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ No collateral required for most bonds</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ Online application — 10 minutes or less</p>
  </div>
  <p style="color:#333;line-height:1.7;margin:0 0 24px">Whether you need a performance bond, payment bond, or license & permit bond — we can help {{company_name}} get bonded and stay compliant.</p>
  <a href="https://quantumsurety.bond/quote" style="background:#C9A84C;color:#000;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;font-family:Arial,sans-serif;font-size:15px">Get Your Free Quote →</a>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0"/>
  <p style="color:#999;font-size:11px;margin:0;font-family:Arial,sans-serif">Quantum Surety LLC · Texas Licensed Surety Agency · <a href="https://quantumsurety.bond" style="color:#C9A84C">quantumsurety.bond</a> · To unsubscribe reply STOP</p>
</div>`,
  },
  notary: {
    name: 'Notary Bond (SB693)',
    subject: 'Texas SB693 Notary Bond — Get Bonded in Minutes',
    body: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff">
  <div style="border-bottom:3px solid #C9A84C;padding-bottom:16px;margin-bottom:24px">
    <h1 style="margin:0;font-size:22px;color:#0A0A0F;letter-spacing:2px;font-family:Arial,sans-serif">QUANTUM SURETY</h1>
    <p style="margin:4px 0 0;font-size:11px;color:#888;letter-spacing:3px;font-family:Arial,sans-serif">TEXAS LICENSED SURETY AGENCY</p>
  </div>
  <h2 style="color:#0A0A0F;font-size:20px;margin:0 0 16px">Texas SB693 Notary Bond — Required by Law</h2>
  <p style="color:#333;line-height:1.7;margin:0 0 16px">Senate Bill 693 requires all Texas notaries to carry a $10,000 surety bond. Quantum Surety makes it fast and affordable.</p>
  <div style="background:#f9f6ef;border-left:4px solid #C9A84C;padding:16px 20px;margin:24px 0;border-radius:0 6px 6px 0">
    <p style="margin:0 0 10px;font-weight:bold;color:#0A0A0F">Texas Notary Bond — Starting at $30/year</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ Instant online issuance</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ State-approved carrier (RLI Insurance)</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ Certificate emailed immediately</p>
    <p style="margin:4px 0;color:#333;font-size:14px">✓ 4-year term available</p>
  </div>
  <a href="https://quantumsurety.bond/quote" style="background:#C9A84C;color:#000;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;font-family:Arial,sans-serif;font-size:15px">Get Bonded Now →</a>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0"/>
  <p style="color:#999;font-size:11px;margin:0;font-family:Arial,sans-serif">Quantum Surety LLC · Texas Licensed Surety Agency · <a href="https://quantumsurety.bond" style="color:#C9A84C">quantumsurety.bond</a> · To unsubscribe reply STOP</p>
</div>`,
  },
  followup: {
    name: 'Follow-up / Re-engagement',
    subject: 'Quick question about {{company_name}}\'s bonding needs',
    body: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#ffffff">
  <p style="color:#333;line-height:1.7;margin:0 0 16px">Hi {{company_name}} team,</p>
  <p style="color:#333;line-height:1.7;margin:0 0 16px">I wanted to follow up to see if you have any upcoming state contract bids that require surety bonding.</p>
  <p style="color:#333;line-height:1.7;margin:0 0 16px">As a HUB/DBE certified contractor, you qualify for our preferred bonding rates — and we can typically issue bonds same-day so you never miss a bid deadline.</p>
  <p style="color:#333;line-height:1.7;margin:0 0 24px">Would it be helpful to get a quick quote? It takes less than 10 minutes online, no obligation.</p>
  <a href="https://quantumsurety.bond/quote" style="background:#C9A84C;color:#000;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;font-size:15px">Get a Free Quote →</a>
  <p style="color:#333;line-height:1.7;margin:24px 0 0">Best regards,<br/><strong>Ted Sparks</strong><br/>Quantum Surety LLC<br/><a href="https://quantumsurety.bond" style="color:#C9A84C">quantumsurety.bond</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
  <p style="color:#999;font-size:11px;margin:0">To unsubscribe reply STOP</p>
</div>`,
  },
};

const EMPTY_FORM = {
  name:'',subject:'',body:TEMPLATES.hub_dbe.body,
  from_name:'Quantum Surety',from_email:'info@quantumsurety.bond'
};

const CERT_OPTIONS = ['HUB','DBE','MBE','WBE','8(a)','NM Resident','NM Veteran'];

export default function Campaigns() {
  const [campaigns,setCampaigns]=useState([]);
  const [showNew,setShowNew]=useState(false);
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState(EMPTY_FORM);
  const [preview,setPreview]=useState(false);
  const [selectedTemplate,setSelectedTemplate]=useState('hub_dbe');

  // Audience builder
  const [audience,setAudience]=useState({state:'TX',cert_type:'',has_email:true,has_fax:false,city:''});
  const [audienceCount,setAudienceCount]=useState(null);
  const [showAudience,setShowAudience]=useState(null); // campaign id

  // Sending state
  const [sending,setSending]=useState(null);
  const [sendProgress,setSendProgress]=useState({sent:0,failed:0,skipped:0,total:0});
  const [sendResult,setSendResult]=useState(null);
  const [sendError,setSendError]=useState('');

  // Stats
  const [expandedStats,setExpandedStats]=useState(null);
  const [campaignSends,setCampaignSends]=useState({});

  const safeJson = async(r) => { const t=await r.text(); try{return JSON.parse(t);}catch{throw new Error(`Server error (${r.status})`);} };

  const load=()=>fetch('/api/campaigns').then(safeJson).then(setCampaigns).catch(()=>{});
  useEffect(()=>{load();},[]);

  // Live audience count
  useEffect(()=>{
    if(!showAudience) return;
    setAudienceCount(null);
    const p=new URLSearchParams({limit:1,has_email:audience.has_email?'true':'',has_fax:audience.has_fax?'true':''});
    if(audience.state) p.set('state',audience.state);
    if(audience.cert_type) p.set('cert_type',audience.cert_type);
    if(audience.city) p.set('city',audience.city);
    fetch(`/api/contacts?${p}`).then(safeJson).then(j=>setAudienceCount(j?.total??0)).catch(()=>setAudienceCount(0));
  },[audience,showAudience]);

  const applyTemplate = (key) => {
    setSelectedTemplate(key);
    const t = TEMPLATES[key];
    setForm(f=>({...f, name:t.name, subject:t.subject, body:t.body}));
  };

  const save = async() => {
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `/api/campaigns/${editing}` : '/api/campaigns';
    await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
    setShowNew(false);setEditing(null);setForm(EMPTY_FORM);setPreview(false);
    load();
  };

  const del = async(id) => {
    if(!confirm('Delete this campaign?')) return;
    await fetch(`/api/campaigns/${id}`,{method:'DELETE'});load();
  };

  const duplicate = async(c) => {
    await fetch('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...c,name:`${c.name} (copy)`,status:'draft',sent_count:0})});
    load();
  };

  const startEdit = (c) => {
    setForm({name:c.name,subject:c.subject,body:c.body,from_name:c.from_name,from_email:c.from_email});
    setEditing(c.id);setShowNew(true);setPreview(false);
  };

  const loadSends = async(id) => {
    try {
      const r = await fetch(`/api/campaigns/${id}/sends`);
      const j = await safeJson(r);
      setCampaignSends(s=>({...s,[id]:Array.isArray(j)?j:[]}));
      setExpandedStats(expandedStats===id?null:id);
    } catch(e) { console.error('loadSends',e.message); }
  };

  const sendCampaign = async(campaignId) => {
    setSending(campaignId);setSendResult(null);setSendError('');
    setSendProgress({sent:0,failed:0,skipped:0,total:audienceCount||0});

    try {
      // Fetch all contact IDs matching audience
      const allIds = [];
      let page = 1;
      const p = new URLSearchParams({limit:100,has_email:audience.has_email?'true':'',has_fax:audience.has_fax?'true':''});
      if(audience.state) p.set('state',audience.state);
      if(audience.cert_type) p.set('cert_type',audience.cert_type);
      if(audience.city) p.set('city',audience.city);

      let pages = 1;
      while(page <= pages) {
        p.set('page',page);
        const r = await fetch(`/api/contacts?${p}`);
        const j = await safeJson(r);
        pages = j.pages || 1;
        (j.data||[]).forEach(c=>allIds.push(c.id));
        page++;
        if(page > 50) break;
      }

      if(!allIds.length) { setSending(null); setSendError('No contacts matched the audience filters.'); return; }
      setSendProgress(s=>({...s,total:allIds.length}));

      let totals = {sent:0,failed:0,skipped:0};
      for(let i=0;i<allIds.length;i+=50){
        const batch = allIds.slice(i,i+50);
        const r = await fetch(`/api/email/campaign/${campaignId}/send`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({contact_ids:batch})
        });
        const j = await safeJson(r);
        if(j.error) throw new Error(j.error);
        totals.sent += j.sent||0; totals.failed += j.failed||0; totals.skipped += j.skipped||0;
        setSendProgress({...totals,total:allIds.length});
      }

      setSending(null);setShowAudience(null);
      setSendResult({campaignId,...totals});
      load();
    } catch(err) {
      setSending(null);
      setSendError(err.message);
    }
  };

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-xs font-mono tracking-widest mb-1" style={{color:'var(--gold)'}}>OUTREACH</div>
          <h1 className="font-display text-4xl tracking-wider text-white">Campaigns</h1>
          <div className="gold-line mt-3 w-24"/>
        </div>
        <button onClick={()=>{setShowNew(true);setEditing(null);setForm(EMPTY_FORM);setPreview(false);}}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
          style={{background:'var(--gold)',color:'#0A0A0F'}}>
          <Plus size={16}/> New Campaign
        </button>
      </div>

      {/* Send result banner */}
      {sendResult&&(
        <div className="mb-6 p-4 rounded-xl border flex items-center justify-between"
          style={{background:'#1a2e1a',borderColor:'#2a5a2a'}}>
          <div className="text-sm">
            <span className="text-green-400 font-medium">Campaign sent</span>
            <span className="font-mono ml-3" style={{color:'var(--text-dim)'}}>
              ✓ {sendResult.sent} sent · ✗ {sendResult.failed} failed · — {sendResult.skipped} skipped
            </span>
          </div>
          <button onClick={()=>setSendResult(null)} style={{color:'var(--text-dim)'}}><X size={14}/></button>
        </div>
      )}

      {/* Campaign list */}
      <div className="space-y-4">
        {campaigns.length===0&&(
          <div className="rounded-xl border p-12 text-center" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
            <div className="font-display text-2xl tracking-wider mb-2" style={{color:'var(--text-dim)'}}>No campaigns yet</div>
            <p className="text-sm mb-4" style={{color:'var(--text-dim)'}}>Create your first outreach campaign to start generating surety bond leads.</p>
            <button onClick={()=>setShowNew(true)} className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{background:'var(--gold)',color:'#0A0A0F'}}>
              <Plus size={14} className="inline mr-1"/> Create Campaign
            </button>
          </div>
        )}

        {campaigns.map(c=>(
          <div key={c.id} className="rounded-xl border overflow-hidden" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
            {/* Campaign header */}
            <div className="p-5 flex items-start justify-between">
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="font-medium text-white">{c.name}</div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded"
                    style={{background:c.status==='sent'?'#1a2e1a':'var(--muted)',color:c.status==='sent'?'#4CC97A':'var(--text-dim)'}}>
                    {c.status}
                  </span>
                </div>
                <div className="text-xs font-mono truncate" style={{color:'var(--text-dim)'}}>{c.subject}</div>
                <div className="text-xs mt-1.5 font-mono" style={{color:'var(--gold)'}}>
                  {c.from_name} · {c.sent_count} sent
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={()=>loadSends(c.id)} title="View stats"
                  className="p-1.5 rounded" style={{color:'var(--text-dim)'}}>
                  <BarChart2 size={14}/>
                </button>
                <button onClick={()=>startEdit(c)} title="Edit"
                  className="p-1.5 rounded" style={{color:'var(--text-dim)'}}>
                  <Edit2 size={14}/>
                </button>
                <button onClick={()=>duplicate(c)} title="Duplicate"
                  className="p-1.5 rounded" style={{color:'var(--text-dim)'}}>
                  <Copy size={14}/>
                </button>
                <button onClick={()=>del(c.id)} title="Delete"
                  className="p-1.5 rounded" style={{color:'var(--text-dim)'}}>
                  <Trash2 size={14}/>
                </button>
                <button
                  onClick={()=>setShowAudience(showAudience===c.id?null:c.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ml-1"
                  style={{background:'var(--gold)',color:'#0A0A0F'}}>
                  <Send size={12}/>
                  {showAudience===c.id?'Cancel':'Send'}
                </button>
              </div>
            </div>

            {/* Audience builder */}
            {showAudience===c.id&&(
              <div className="border-t px-5 py-4" style={{borderColor:'var(--border)',background:'var(--muted)'}}>
                <div className="text-xs font-mono tracking-wider mb-3" style={{color:'var(--gold)'}}>
                  <Filter size={10} className="inline mr-1"/>AUDIENCE FILTERS
                </div>
                <div className="flex gap-3 flex-wrap items-end mb-4">
                  {/* State */}
                  <div>
                    <div className="text-xs font-mono mb-1" style={{color:'var(--text-dim)'}}>STATE</div>
                    <select value={audience.state} onChange={e=>setAudience(a=>({...a,state:e.target.value}))}
                      className="px-2 py-1.5 rounded text-sm border outline-none"
                      style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}>
                      <option value="">All States</option>
                      {['TX','LA','NM','AR','OK'].map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  {/* Cert type */}
                  <div>
                    <div className="text-xs font-mono mb-1" style={{color:'var(--text-dim)'}}>CERT TYPE</div>
                    <select value={audience.cert_type} onChange={e=>setAudience(a=>({...a,cert_type:e.target.value}))}
                      className="px-2 py-1.5 rounded text-sm border outline-none"
                      style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}>
                      <option value="">All Types</option>
                      {CERT_OPTIONS.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  {/* City */}
                  <div>
                    <div className="text-xs font-mono mb-1" style={{color:'var(--text-dim)'}}>CITY</div>
                    <input value={audience.city} onChange={e=>setAudience(a=>({...a,city:e.target.value}))}
                      placeholder="Any city..."
                      className="px-2 py-1.5 rounded text-sm border outline-none w-32"
                      style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/>
                  </div>

                  {/* Toggles */}
                  <div className="flex gap-2">
                    {[
                      {label:'Email only',key:'has_email',color:'#4C9AC9'},
                      {label:'Fax only',key:'has_fax',color:'var(--gold)'},
                    ].map(({label,key,color})=>(
                      <button key={key}
                        onClick={()=>setAudience(a=>({...a,[key]:!a[key]}))}
                        className="px-3 py-1.5 rounded text-xs font-medium border"
                        style={{
                          background:audience[key]?`${color}22`:'transparent',
                          borderColor:audience[key]?color:'var(--border)',
                          color:audience[key]?color:'var(--text-dim)'
                        }}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Live count */}
                  <div className="ml-auto text-right">
                    <div className="text-xs font-mono" style={{color:'var(--text-dim)'}}>AUDIENCE SIZE</div>
                    <div className="text-2xl font-display" style={{color:'var(--gold)'}}>
                      {audienceCount===null?'...':(audienceCount||0).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Progress bar while sending */}
                {sending===c.id&&(
                  <div className="mb-4">
                    <div className="flex justify-between text-xs font-mono mb-1" style={{color:'var(--text-dim)'}}>
                      <span>Sending... {sendProgress.sent+sendProgress.failed+sendProgress.skipped} / {sendProgress.total}</span>
                      <span>✓{sendProgress.sent} ✗{sendProgress.failed} —{sendProgress.skipped}</span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{background:'var(--border)'}}>
                      <div className="h-full rounded-full transition-all" style={{
                        width:`${sendProgress.total?Math.round(((sendProgress.sent+sendProgress.failed+sendProgress.skipped)/sendProgress.total)*100):0}%`,
                        background:'var(--gold)'
                      }}/>
                    </div>
                  </div>
                )}

                {sendError&&showAudience===c.id&&(
                  <div className="mb-3 px-3 py-2 rounded text-xs" style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',color:'#f87171'}}>
                    {sendError}
                  </div>
                )}
                <button
                  onClick={()=>sendCampaign(c.id)}
                  disabled={sending===c.id||!audienceCount}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                  style={{background:'var(--gold)',color:'#0A0A0F'}}>
                  <Send size={13}/>
                  {sending===c.id?'Sending...':
                    `Send to ${audienceCount===null?'...':(audienceCount||0).toLocaleString()} contacts`}
                </button>
              </div>
            )}

            {/* Stats panel */}
            {expandedStats===c.id&&campaignSends[c.id]&&(
              <div className="border-t px-5 py-4" style={{borderColor:'var(--border)'}}>
                <div className="text-xs font-mono tracking-wider mb-3" style={{color:'var(--gold)'}}>SEND HISTORY</div>
                {campaignSends[c.id].length===0
                  ? <p className="text-xs" style={{color:'var(--text-dim)'}}>No sends recorded yet.</p>
                  : (
                    <div className="space-y-1 max-h-48 overflow-auto">
                      {campaignSends[c.id].slice(0,20).map(s=>(
                        <div key={s.id} className="flex items-center justify-between text-xs py-1 border-b"
                          style={{borderColor:'var(--border)'}}>
                          <span className="font-medium text-white truncate max-w-xs">{s.company_name}</span>
                          <span style={{color:'var(--text-dim)'}} className="font-mono">{s.email}</span>
                          <span className="font-mono px-1.5 py-0.5 rounded ml-2"
                            style={{background:s.status==='sent'?'#1a2e1a':'#2e1a1a',color:s.status==='sent'?'#4CC97A':'#f87171'}}>
                            {s.status}
                          </span>
                        </div>
                      ))}
                      {campaignSends[c.id].length>20&&(
                        <p className="text-xs pt-1" style={{color:'var(--text-dim)'}}>
                          ...and {campaignSends[c.id].length-20} more
                        </p>
                      )}
                    </div>
                  )
                }
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New/Edit campaign modal */}
      {showNew&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.85)'}}>
          <div className="w-full max-w-3xl rounded-2xl border flex flex-col" style={{background:'var(--surface)',borderColor:'var(--border)',maxHeight:'90vh'}}>
            <div className="p-5 border-b flex items-center justify-between flex-shrink-0" style={{borderColor:'var(--border)'}}>
              <div className="font-display text-2xl tracking-wider text-white">
                {editing?'Edit Campaign':'New Campaign'}
              </div>
              <button onClick={()=>{setShowNew(false);setEditing(null);}} style={{color:'var(--text-dim)'}}><X size={18}/></button>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-4">
              {/* Template picker — only for new */}
              {!editing&&(
                <div>
                  <div className="text-xs font-mono tracking-wider mb-2" style={{color:'var(--text-dim)'}}>START FROM TEMPLATE</div>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(TEMPLATES).map(([key,t])=>(
                      <button key={key} onClick={()=>applyTemplate(key)}
                        className="p-3 rounded-lg border text-left transition-all"
                        style={{
                          background:selectedTemplate===key?'rgba(201,168,76,0.1)':'var(--muted)',
                          borderColor:selectedTemplate===key?'var(--gold)':'var(--border)',
                        }}>
                        <div className="text-xs font-medium text-white">{t.name}</div>
                        <div className="text-xs mt-0.5 truncate" style={{color:'var(--text-dim)'}}>{t.subject.slice(0,35)}...</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Fields */}
              <div className="grid grid-cols-2 gap-3">
                {[['Campaign Name','name','text'],['Subject Line','subject','text']].map(([label,key,type])=>(
                  <div key={key} className={key==='subject'?'col-span-2':''}>
                    <label className="text-xs font-mono tracking-wider block mb-1.5" style={{color:'var(--text-dim)'}}>{label.toUpperCase()}</label>
                    <input type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                      style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                  </div>
                ))}
                {[['From Name','from_name','text'],['From Email','from_email','email']].map(([label,key,type])=>(
                  <div key={key}>
                    <label className="text-xs font-mono tracking-wider block mb-1.5" style={{color:'var(--text-dim)'}}>{label.toUpperCase()}</label>
                    <input type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                      style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                  </div>
                ))}
              </div>

              {/* Body */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-mono tracking-wider" style={{color:'var(--text-dim)'}}>EMAIL BODY (HTML · use {'{{company_name}}'} for personalization)</label>
                  <button onClick={()=>setPreview(p=>!p)}
                    className="text-xs flex items-center gap-1 px-2 py-1 rounded"
                    style={{color:'var(--gold)',background:'rgba(201,168,76,0.1)'}}>
                    <Eye size={11}/>{preview?'Edit HTML':'Preview'}
                  </button>
                </div>
                {preview
                  ? <div className="rounded-lg border overflow-auto bg-white" style={{borderColor:'var(--border)',maxHeight:'320px'}}
                      dangerouslySetInnerHTML={{__html:form.body.replace(/{{company_name}}/g,'ACME Construction LLC')}}/>
                  : <textarea value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} rows={10}
                      className="w-full px-3 py-2 rounded-lg border text-xs outline-none resize-none font-mono"
                      style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                }
              </div>
            </div>

            <div className="p-5 border-t flex gap-3 justify-end flex-shrink-0" style={{borderColor:'var(--border)'}}>
              <button onClick={()=>{setShowNew(false);setEditing(null);}}
                className="px-4 py-2 rounded-lg text-sm" style={{color:'var(--text-dim)'}}>Cancel</button>
              <button onClick={save} disabled={!form.name||!form.subject||!form.body}
                className="px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                style={{background:'var(--gold)',color:'#0A0A0F'}}>
                {editing?'Save Changes':'Save Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
