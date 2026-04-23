import React,{useEffect,useState,useCallback} from 'react';
import {Search,Mail,X,Send,ChevronLeft,ChevronRight,MapPin,Check} from 'lucide-react';

const CERT_COLORS = {
  'HUB': '#C9A84C',
  'DBE': '#4C9AC9',
  'MBE': '#9A4CC9',
  'WBE': '#C94C9A',
  '8(a)': '#4CC97A',
  'NM Resident': '#C97A4C',
  'NM Veteran': '#4C9AC9',
};

const certColor = (type) => {
  for (const [key, color] of Object.entries(CERT_COLORS)) {
    if ((type||'').includes(key)) return color;
  }
  return '#6B6B8A';
};

const BLANK_BULK = {subject:'',body:'',from_name:'Quantum Surety',from_email:'info@quantumsurety.bond',sending:false,sent:0,failed:0,done:false,error:''};

export default function Contacts() {
  const [data,setData]=useState({data:[],total:0,pages:1});
  const [page,setPage]=useState(1);
  const [search,setSearch]=useState('');
  const [state,setState]=useState('');
  const [city,setCity]=useState('');
  const [hasEmail,setHasEmail]=useState(false);
  const [hasFax,setHasFax]=useState(false);
  const [selected,setSelected]=useState(null);
  const [emailForm,setEmailForm]=useState({subject:'',body:'',sending:false,sent:false,error:''});
  const [stats,setStats]=useState(null);

  // Multi-select state
  const [selectedIds,setSelectedIds]=useState(new Set());
  const [showCompose,setShowCompose]=useState(false);
  const [bulkForm,setBulkForm]=useState(BLANK_BULK);

  const load = useCallback(()=>{
    const p=new URLSearchParams({page,limit:50,search,state,has_email:hasEmail?'true':'',has_fax:hasFax?'true':''});
    if(city) p.set('city', city);
    fetch(`/api/contacts?${p}`).then(r=>r.json()).then(setData);
  },[page,search,state,city,hasEmail,hasFax]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{setPage(1);},[search,state,city,hasEmail,hasFax]);
  useEffect(()=>{
    fetch('/api/contacts/stats').then(r=>r.json()).then(setStats);
  },[]);

  const sendEmail = async()=>{
    if(!selected?.contact_email) return;
    setEmailForm(f=>({...f,sending:true,error:''}));
    try{
      const r=await fetch('/api/email/send',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({to_email:selected.contact_email,subject:emailForm.subject,body:emailForm.body})});
      const j=await r.json();
      if(j.ok) setEmailForm(f=>({...f,sending:false,sent:true}));
      else setEmailForm(f=>({...f,sending:false,error:j.error}));
    }catch(e){setEmailForm(f=>({...f,sending:false,error:e.message}));}
  };

  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelectedIds(prev=>{
      const next=new Set(prev);
      if(next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allPageSelected = data.data.length>0 && data.data.every(r=>selectedIds.has(r.id));
  const toggleSelectAll = () => {
    setSelectedIds(prev=>{
      const next=new Set(prev);
      if(allPageSelected) data.data.forEach(r=>next.delete(r.id));
      else data.data.forEach(r=>next.add(r.id));
      return next;
    });
  };

  const sendBulk = async() => {
    setBulkForm(f=>({...f,sending:true,error:''}));
    try{
      const r=await fetch('/api/email/send-selected',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ids:[...selectedIds],subject:bulkForm.subject,body:bulkForm.body,from_name:bulkForm.from_name,from_email:bulkForm.from_email})});
      const j=await r.json();
      if(j.error) setBulkForm(f=>({...f,sending:false,error:j.error}));
      else setBulkForm(f=>({...f,sending:false,sent:j.sent,failed:j.failed,done:true}));
    }catch(e){setBulkForm(f=>({...f,sending:false,error:e.message}));}
  };

  const cleanFax = (fax) => fax && fax !== 'M' && fax !== 'Y' ? fax : null;

  return (
    <div className="flex h-full" style={{position:'relative'}}>
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header + stats bar */}
        <div className="px-6 pt-6 pb-4 border-b" style={{borderColor:'var(--border)'}}>
          <div className="text-xs font-mono tracking-widest mb-1" style={{color:'var(--gold)'}}>DATABASE</div>
          <div className="flex items-end justify-between mb-4">
            <h1 className="font-display text-3xl tracking-wider text-white">Contacts</h1>
            {stats&&(
              <div className="flex gap-4">
                {[
                  {label:'Total',val:stats.total.toLocaleString(),color:'var(--gold)'},
                  {label:'Email',val:stats.with_email.toLocaleString(),color:'#4C9AC9'},
                  {label:'Phone',val:stats.with_phone.toLocaleString(),color:'#4CC97A'},
                ].map(({label,val,color})=>(
                  <div key={label} className="text-right">
                    <div className="text-xs font-mono" style={{color:'var(--text-dim)'}}>{label}</div>
                    <div className="text-lg font-display" style={{color}}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Filter row */}
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:'var(--text-dim)'}}/>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Company name..."
                className="pl-8 pr-3 py-1.5 rounded-lg text-sm border outline-none w-44"
                style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/>
            </div>
            <div className="relative">
              <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:'var(--text-dim)'}}/>
              <input value={city} onChange={e=>setCity(e.target.value)}
                placeholder="City..."
                className="pl-8 pr-3 py-1.5 rounded-lg text-sm border outline-none w-36"
                style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/>
            </div>
            <select value={state} onChange={e=>setState(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-sm border outline-none"
              style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}>
              <option value="">All States</option>
              {['TX','LA','NM','AR','OK'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <div className="flex gap-3 ml-1">
              {[
                {label:'Email only',val:hasEmail,set:setHasEmail,color:'#4C9AC9'},
                {label:'Fax only',val:hasFax,set:setHasFax,color:'#C9A84C'},
              ].map(({label,val,set,color})=>(
                <button key={label} onClick={()=>set(v=>!v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                  style={{background:val?`${color}22`:'transparent',borderColor:val?color:'var(--border)',color:val?color:'var(--text-dim)'}}>
                  <div className="w-3 h-3 rounded-sm border flex items-center justify-center"
                    style={{borderColor:val?color:'var(--text-dim)',background:val?color:'transparent'}}>
                    {val&&<div className="w-1.5 h-1.5 bg-black rounded-sm"/>}
                  </div>
                  {label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {(search||city||state||hasEmail||hasFax)&&(
                <button onClick={()=>{setSearch('');setCity('');setState('');setHasEmail(false);setHasFax(false);}}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded"
                  style={{color:'var(--text-dim)',background:'var(--muted)'}}>
                  <X size={10}/> Clear
                </button>
              )}
              <span className="text-xs font-mono" style={{color:'var(--text-dim)'}}>
                {data.total.toLocaleString()} results
              </span>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm" style={{tableLayout:'fixed'}}>
            <colgroup>
              <col style={{width:'4%'}}/>
              <col style={{width:'25%'}}/>
              <col style={{width:'12%'}}/>
              <col style={{width:'6%'}}/>
              <col style={{width:'10%'}}/>
              <col style={{width:'17%'}}/>
              <col style={{width:'13%'}}/>
              <col style={{width:'13%'}}/>
            </colgroup>
            <thead className="sticky top-0" style={{background:'var(--dark)'}}>
              <tr className="border-b" style={{borderColor:'var(--border)'}}>
                <th className="px-3 py-3">
                  <div onClick={toggleSelectAll} style={{width:14,height:14,borderRadius:3,border:'1px solid var(--border)',background:allPageSelected?'var(--gold)':'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    {allPageSelected&&<Check size={9} color="#0A0A0F"/>}
                  </div>
                </th>
                {['Company','City','ST','Cert Type','Contact','Phone','Fax'].map(h=>(
                  <th key={h} className="text-left px-3 py-3 text-xs font-mono tracking-wider" style={{color:'var(--text-dim)'}}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map(row=>(
                <tr key={row.id}
                  onClick={()=>{setSelected(row);setEmailForm({subject:'',body:'',sending:false,sent:false,error:''}); }}
                  className="border-b cursor-pointer transition-colors"
                  style={{borderColor:'var(--border)',background:selectedIds.has(row.id)?'rgba(201,168,76,0.06)':selected?.id===row.id?'var(--muted)':''}}>
                  <td className="px-3 py-2.5" onClick={e=>toggleSelect(row.id,e)}>
                    <div style={{width:14,height:14,borderRadius:3,border:`1px solid ${selectedIds.has(row.id)?'var(--gold)':'var(--border)'}`,background:selectedIds.has(row.id)?'var(--gold)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
                      {selectedIds.has(row.id)&&<Check size={9} color="#0A0A0F"/>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-white truncate">{row.company_name}</td>
                  <td className="px-3 py-2.5 truncate" style={{color:'var(--text-dim)'}}>{row.city}</td>
                  <td className="px-3 py-2.5 font-mono text-xs" style={{color:'var(--gold)'}}>{row.state}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs px-1.5 py-0.5 rounded font-mono truncate inline-block max-w-full"
                      style={{background:`${certColor(row.certification_type)}22`,color:certColor(row.certification_type)}}>
                      {row.certification_type||'—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs truncate" style={{color:row.contact_email?'#4C9AC9':'var(--text-dim)'}}>
                    {row.contact_email||row.contact_website||'—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono truncate" style={{color:'var(--text-dim)'}}>{row.phone||'—'}</td>
                  <td className="px-3 py-2.5 text-xs font-mono truncate" style={{color:cleanFax(row.fax)?'var(--gold)':'var(--text-dim)'}}>
                    {cleanFax(row.fax)||'—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-6 py-3 border-t" style={{borderColor:'var(--border)'}}>
          <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
            className="flex items-center gap-1 text-sm px-3 py-1.5 rounded disabled:opacity-30"
            style={{color:'var(--text-dim)'}}>
            <ChevronLeft size={14}/> Prev
          </button>
          <div className="flex items-center gap-2">
            {[...Array(Math.min(5,data.pages))].map((_,i)=>{
              const p = page <= 3 ? i+1 : page-2+i;
              if(p < 1 || p > data.pages) return null;
              return (
                <button key={p} onClick={()=>setPage(p)}
                  className="w-8 h-8 rounded text-xs font-mono"
                  style={{background:p===page?'var(--gold)':'transparent',color:p===page?'#0A0A0F':'var(--text-dim)'}}>
                  {p}
                </button>
              );
            })}
          </div>
          <button onClick={()=>setPage(p=>Math.min(data.pages,p+1))} disabled={page>=data.pages}
            className="flex items-center gap-1 text-sm px-3 py-1.5 rounded disabled:opacity-30"
            style={{color:'var(--text-dim)'}}>
            Next <ChevronRight size={14}/>
          </button>
        </div>
      </div>

      {/* Detail panel */}
      {selected&&!showCompose&&(
        <div className="w-88 border-l flex flex-col flex-shrink-0" style={{width:'22rem',background:'var(--surface)',borderColor:'var(--border)'}}>
          <div className="p-4 border-b flex items-start justify-between" style={{borderColor:'var(--border)'}}>
            <div className="flex-1 min-w-0 pr-2">
              <div className="font-medium text-white leading-tight truncate">{selected.company_name}</div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-xs px-1.5 py-0.5 rounded font-mono"
                  style={{background:`${certColor(selected.certification_type)}22`,color:certColor(selected.certification_type)}}>
                  {selected.certification_type}
                </span>
                <span className="text-xs font-mono" style={{color:'var(--text-dim)'}}>{selected.city}, {selected.state}</span>
              </div>
            </div>
            <button onClick={()=>setSelected(null)} style={{color:'var(--text-dim)'}}><X size={15}/></button>
          </div>
          <div className="p-4 space-y-2.5 border-b text-sm" style={{borderColor:'var(--border)'}}>
            {[
              ['Address',`${selected.address||''} ${selected.address2||''}`.trim()||'—'],
              ['City / Zip',`${selected.city||''} ${selected.zip||''}`.trim()||'—'],
              ['Phone',selected.phone||'—'],
              ['Fax',cleanFax(selected.fax)||'—'],
              ['Email',selected.contact_email||'—'],
              ['Website',selected.contact_website||'—'],
              ['NAICS',selected.naics_codes||'—'],
              ['Cert #',selected.certification_number||'—'],
            ].map(([label,val])=>(
              <div key={label} className="flex gap-2">
                <span className="text-xs font-mono w-16 flex-shrink-0 mt-0.5" style={{color:'var(--text-dim)'}}>{label}</span>
                <span className="text-xs break-all" style={{color:label==='Email'&&val!=='—'?'#4C9AC9':label==='Fax'&&val!=='—'?'var(--gold)':'var(--text)'}}>{val}</span>
              </div>
            ))}
          </div>
          <div className="p-4 flex-1 flex flex-col gap-2.5 overflow-auto">
            <div className="text-xs font-mono tracking-wider" style={{color:'var(--gold)'}}>QUICK EMAIL</div>
            {!selected.contact_email
              ? <p className="text-xs" style={{color:'var(--text-dim)'}}>No email on file.</p>
              : emailForm.sent
              ? <div className="text-sm text-green-400 font-mono">✓ Sent successfully</div>
              : <>
                  <input value={emailForm.subject} onChange={e=>setEmailForm(f=>({...f,subject:e.target.value}))}
                    placeholder="Subject..."
                    className="px-3 py-2 rounded text-sm border outline-none"
                    style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                  <textarea value={emailForm.body} onChange={e=>setEmailForm(f=>({...f,body:e.target.value}))}
                    placeholder="Email body (HTML ok)..." rows={5}
                    className="px-3 py-2 rounded text-sm border outline-none resize-none"
                    style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                  {emailForm.error&&<p className="text-xs text-red-400">{emailForm.error}</p>}
                  <button onClick={sendEmail} disabled={emailForm.sending||!emailForm.subject||!emailForm.body}
                    className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                    style={{background:'var(--gold)',color:'#0A0A0F'}}>
                    <Send size={13}/>{emailForm.sending?'Sending...':'Send Email'}
                  </button>
                </>
            }
          </div>
        </div>
      )}

      {/* Selection action bar */}
      {selectedIds.size>0&&!showCompose&&(
        <div style={{position:'absolute',bottom:56,left:0,right:0,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 24px',background:'var(--surface)',borderTop:'1px solid var(--gold)',zIndex:10}}>
          <span style={{fontSize:13,color:'var(--gold)',fontFamily:'monospace'}}>{selectedIds.size} contact{selectedIds.size!==1?'s':''} selected</span>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setSelectedIds(new Set())}
              style={{padding:'6px 14px',borderRadius:8,border:'1px solid var(--border)',background:'transparent',color:'var(--text-dim)',fontSize:12,cursor:'pointer'}}>
              Clear
            </button>
            <button onClick={()=>{setShowCompose(true);setBulkForm(BLANK_BULK);setSelected(null);}}
              style={{padding:'6px 16px',borderRadius:8,border:'none',background:'var(--gold)',color:'#0A0A0F',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
              <Mail size={13}/> Send Campaign to {selectedIds.size}
            </button>
          </div>
        </div>
      )}

      {/* Bulk compose modal */}
      {showCompose&&(
        <div style={{position:'absolute',inset:0,background:'rgba(10,10,15,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:50}}>
          <div style={{background:'var(--surface)',borderRadius:12,border:'1px solid var(--border)',width:'100%',maxWidth:600,padding:28,maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
              <div>
                <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:3,color:'var(--gold)',marginBottom:4}}>CAMPAIGN SEND</div>
                <div style={{color:'white',fontSize:18,fontWeight:600}}>Send to {selectedIds.size} Contact{selectedIds.size!==1?'s':''}</div>
              </div>
              <button onClick={()=>setShowCompose(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)'}}><X size={18}/></button>
            </div>

            {bulkForm.done ? (
              <div style={{textAlign:'center',padding:'32px 0'}}>
                <div style={{fontSize:36,marginBottom:12}}>✓</div>
                <div style={{color:'#4CC97A',fontSize:18,fontWeight:600,marginBottom:8}}>Campaign Sent</div>
                <div style={{color:'var(--text-dim)',fontSize:13}}>{bulkForm.sent} sent · {bulkForm.failed} failed</div>
                <button onClick={()=>{setShowCompose(false);setSelectedIds(new Set());}}
                  style={{marginTop:24,padding:'10px 24px',borderRadius:8,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontWeight:700}}>
                  Done
                </button>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:14}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  {[['FROM NAME','from_name'],['FROM EMAIL','from_email']].map(([label,key])=>(
                    <div key={key}>
                      <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:5}}>{label}</label>
                      <input value={bulkForm[key]} onChange={e=>setBulkForm(f=>({...f,[key]:e.target.value}))}
                        style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                    </div>
                  ))}
                </div>
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:5}}>SUBJECT</label>
                  <input value={bulkForm.subject} onChange={e=>setBulkForm(f=>({...f,subject:e.target.value}))}
                    placeholder="e.g. Is {{company_name}} Bonded for State Contracts?"
                    style={{width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:5}}>EMAIL BODY (HTML)</label>
                  <textarea value={bulkForm.body} onChange={e=>setBulkForm(f=>({...f,body:e.target.value}))} rows={10}
                    placeholder="Paste your HTML email body here. Use {{company_name}} for personalization."
                    style={{width:'100%',padding:'10px 14px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:13,outline:'none',resize:'vertical',boxSizing:'border-box',fontFamily:'monospace'}}/>
                </div>
                {bulkForm.error&&<div style={{padding:'8px 12px',borderRadius:6,background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',color:'#f87171',fontSize:12}}>{bulkForm.error}</div>}
                <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                  <button onClick={()=>setShowCompose(false)}
                    style={{padding:'10px 20px',borderRadius:8,border:'1px solid var(--border)',background:'transparent',color:'var(--text-dim)',fontSize:13,cursor:'pointer'}}>
                    Cancel
                  </button>
                  <button onClick={sendBulk} disabled={bulkForm.sending||!bulkForm.subject||!bulkForm.body}
                    style={{padding:'10px 24px',borderRadius:8,border:'none',background:'var(--gold)',color:'#0A0A0F',fontSize:14,fontWeight:700,cursor:'pointer',opacity:bulkForm.sending||!bulkForm.subject||!bulkForm.body?0.5:1,display:'flex',alignItems:'center',gap:6}}>
                    <Send size={13}/>{bulkForm.sending?'Sending...`':`Send to ${selectedIds.size}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
