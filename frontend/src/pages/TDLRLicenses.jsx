import React,{useEffect,useState,useCallback} from 'react';
import {Search,MapPin,ChevronLeft,ChevronRight,X,Download,RefreshCw,Phone} from 'lucide-react';
import {apiFetch} from '../auth.js';

const EXPIRY_OPTIONS = [
  {value:'',label:'All Expiry'},
  {value:'30',label:'Expiring 30 days'},
  {value:'60',label:'Expiring 60 days'},
  {value:'90',label:'Expiring 90 days'},
  {value:'180',label:'Expiring 180 days'},
  {value:'expired',label:'Already expired'},
];

function expiryColor(dateStr) {
  if (!dateStr) return 'var(--text-dim)';
  const days = Math.floor((new Date(dateStr) - new Date()) / 86400000);
  if (days < 0)   return '#ef4444';
  if (days < 30)  return '#f97316';
  if (days < 90)  return '#C9A84C';
  return '#4CC97A';
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}

function daysUntil(d) {
  if (!d) return null;
  return Math.floor((new Date(d) - new Date()) / 86400000);
}

function exportCSV(rows) {
  const header = ['License #','License Type','Subtype','Business Name','Owner','County','City','State','Zip','Phone','Owner Phone','Expires'];
  const data = rows.map(r=>[
    r.license_number, r.license_type, r.license_subtype||'',
    r.business_name||'', r.owner_name||'', r.business_county||'',
    r.business_city||'', r.business_state||'', r.business_zip||'',
    r.business_phone||'', r.owner_phone||'', fmtDate(r.expire_date),
  ]);
  const csv = [header,...data].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download='tdlr-licenses-'+new Date().toISOString().split('T')[0]+'.csv';
  a.click(); URL.revokeObjectURL(url);
}

const BLANK_FILTERS = {search:'',county:'',license_type:'',expiring:'90',has_phone:''};

export default function TDLRLicenses() {
  const [stats,setStats]   = useState(null);
  const [rows,setRows]     = useState([]);
  const [total,setTotal]   = useState(0);
  const [pages,setPages]   = useState(1);
  const [page,setPage]     = useState(1);
  const [loading,setLoading] = useState(false);
  const [filters,setFilters] = useState(BLANK_FILTERS);
  const [pending,setPending] = useState(BLANK_FILTERS);
  const [selected,setSelected] = useState(null);

  const safeJson = async(r)=>{ const t=await r.text(); try{return JSON.parse(t);}catch{throw new Error(`Server error (${r.status})`);} };

  const loadStats = () =>
    apiFetch('/api/tdlr/stats').then(safeJson).then(setStats).catch(()=>{});

  const loadRows = useCallback(()=>{
    setLoading(true);
    const p = new URLSearchParams({page, limit:50, ...filters});
    apiFetch(`/api/tdlr?${p}`).then(safeJson).then(j=>{
      setRows(j.data||[]); setTotal(j.total||0); setPages(j.pages||1);
    }).catch(()=>{}).finally(()=>setLoading(false));
  },[page, filters]);

  useEffect(()=>{ loadStats(); },[]);
  useEffect(()=>{ loadRows(); },[loadRows]);
  useEffect(()=>{ setPage(1); },[filters]);

  const applyFilters = () => { setFilters({...pending}); setPage(1); };
  const resetFilters = () => { setPending(BLANK_FILTERS); setFilters(BLANK_FILTERS); setPage(1); };

  const inputStyle = {paddingTop:6,paddingBottom:6,paddingRight:10,borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none'};

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden'}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Header */}
        <div style={{padding:'24px 24px 16px',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:4,color:'var(--gold)',marginBottom:4}}>TDLR · TEXAS DEPT OF LICENSING & REGULATION</div>
          <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:16}}>
            <h1 style={{fontFamily:'"Bebas Neue",cursive',fontSize:36,letterSpacing:4,color:'white',margin:0}}>License Registry</h1>
            {stats&&(
              <div style={{display:'flex',gap:20}}>
                {[
                  {label:'Total',val:parseInt(stats.total||0).toLocaleString(),color:'var(--gold)'},
                  {label:'Exp 90d',val:parseInt(stats.expiring_90||0).toLocaleString(),color:'#f97316'},
                  {label:'Expired',val:parseInt(stats.expired||0).toLocaleString(),color:'#ef4444'},
                  {label:'Has Phone',val:parseInt(stats.with_phone||0).toLocaleString(),color:'#4CC97A'},
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
              <input value={pending.search} onChange={e=>setPending(f=>({...f,search:e.target.value}))}
                onKeyDown={e=>e.key==='Enter'&&applyFilters()}
                placeholder="Business, owner, or license #..."
                style={{...inputStyle,paddingLeft:30,width:210}}/>
            </div>
            <div style={{position:'relative'}}>
              <MapPin size={12} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)'}}/>
              <input value={pending.county} onChange={e=>setPending(f=>({...f,county:e.target.value}))}
                onKeyDown={e=>e.key==='Enter'&&applyFilters()}
                placeholder="County..."
                style={{...inputStyle,paddingLeft:30,width:130}}/>
            </div>
            <input value={pending.license_type} onChange={e=>setPending(f=>({...f,license_type:e.target.value}))}
              onKeyDown={e=>e.key==='Enter'&&applyFilters()}
              placeholder="License type..."
              style={{...inputStyle,paddingLeft:10,width:160}}/>
            <select value={pending.expiring} onChange={e=>setPending(f=>({...f,expiring:e.target.value}))}
              style={{...inputStyle,paddingLeft:10}}>
              {EXPIRY_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={pending.has_phone} onChange={e=>setPending(f=>({...f,has_phone:e.target.value}))}
              style={{...inputStyle,paddingLeft:10}}>
              <option value=''>All Contacts</option>
              <option value='true'>Has Phone</option>
            </select>
            <button onClick={applyFilters}
              style={{padding:'6px 16px',borderRadius:8,background:'var(--gold)',color:'#000',fontSize:12,fontWeight:700,border:'none',cursor:'pointer'}}>
              Search
            </button>
            <button onClick={resetFilters}
              style={{padding:'6px 12px',borderRadius:8,background:'var(--muted)',color:'var(--text-dim)',fontSize:12,border:'none',cursor:'pointer'}}>
              Reset
            </button>
            <button onClick={()=>exportCSV(rows)} disabled={!rows.length}
              style={{padding:'6px 10px',borderRadius:8,background:'var(--muted)',border:'none',cursor:'pointer',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:4,opacity:rows.length?1:0.4}}>
              <Download size={12}/><span style={{fontSize:12}}>CSV</span>
            </button>
            <button onClick={()=>{ loadStats(); loadRows(); }}
              style={{padding:'6px 10px',borderRadius:8,background:'var(--muted)',border:'none',cursor:'pointer',color:'var(--text-dim)'}}>
              <RefreshCw size={12}/>
            </button>
          </div>
        </div>

        {/* Count */}
        <div style={{padding:'8px 24px',borderBottom:'1px solid var(--border)',fontSize:12,color:'var(--text-dim)',display:'flex',gap:16,alignItems:'center'}}>
          <span>{loading ? 'Loading…' : `${total.toLocaleString()} licenses`}</span>
          {(filters.search||filters.county||filters.license_type||filters.expiring||filters.has_phone)&&
            <span style={{color:'var(--gold)'}}>· filtered</span>}
        </div>

        {/* Table */}
        <div style={{flex:1,overflow:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{background:'var(--surface)',position:'sticky',top:0,zIndex:1}}>
                {['Business / Owner','License Type','License #','County','City','Phone','Expires'].map(h=>(
                  <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',fontWeight:400,borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>{
                const days = daysUntil(r.expire_date);
                const expColor = expiryColor(r.expire_date);
                return (
                  <tr key={r.id} onClick={()=>setSelected(r)}
                    style={{borderBottom:'1px solid var(--border)',cursor:'pointer',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--muted)'}
                    onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'transparent':'rgba(255,255,255,0.01)'}>
                    <td style={{padding:'8px 12px',maxWidth:200}}>
                      <div style={{color:'white',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.business_name||'—'}</div>
                      {r.owner_name&&r.owner_name!==r.business_name&&(
                        <div style={{color:'var(--text-dim)',fontSize:11,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.owner_name}</div>
                      )}
                    </td>
                    <td style={{padding:'8px 12px',color:'var(--text-dim)',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.license_type}</td>
                    <td style={{padding:'8px 12px',color:'var(--text-dim)',fontFamily:'monospace',fontSize:11,whiteSpace:'nowrap'}}>{r.license_number}</td>
                    <td style={{padding:'8px 12px',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{r.business_county||'—'}</td>
                    <td style={{padding:'8px 12px',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{r.business_city||'—'}</td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>
                      {r.business_phone
                        ? <a href={`tel:${r.business_phone}`} onClick={e=>e.stopPropagation()} style={{color:'#4CC97A',textDecoration:'none',display:'flex',alignItems:'center',gap:4}}>
                            <Phone size={10}/>{r.business_phone}
                          </a>
                        : <span style={{color:'var(--text-dim)'}}>—</span>}
                    </td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>
                      <span style={{color:expColor,fontFamily:'monospace',fontSize:11}}>
                        {fmtDate(r.expire_date)}
                        {days!==null&&<span style={{marginLeft:4,fontSize:10,opacity:0.7}}>
                          {days<0?`${Math.abs(days)}d ago`:days===0?'today':`${days}d`}
                        </span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!loading&&rows.length===0&&(
                <tr><td colSpan={7} style={{padding:'40px',textAlign:'center',color:'var(--text-dim)'}}>No licenses found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages>1&&(
          <div style={{padding:'12px 24px',borderTop:'1px solid var(--border)',display:'flex',alignItems:'center',gap:12,fontSize:12}}>
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1}
              style={{background:'var(--muted)',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',color:'var(--text)',opacity:page<=1?0.4:1}}>
              <ChevronLeft size={14}/>
            </button>
            <span style={{color:'var(--text-dim)'}}>Page {page} of {pages} ({total.toLocaleString()} total)</span>
            <button onClick={()=>setPage(p=>Math.min(pages,p+1))} disabled={page>=pages}
              style={{background:'var(--muted)',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',color:'var(--text)',opacity:page>=pages?0.4:1}}>
              <ChevronRight size={14}/>
            </button>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected&&(
        <div style={{width:320,borderLeft:'1px solid var(--border)',background:'var(--surface)',display:'flex',flexDirection:'column',overflow:'hidden',flexShrink:0}}>
          <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:3,color:'var(--gold)',marginBottom:4}}>TDLR LICENSE</div>
              <div style={{fontWeight:700,color:'white',fontSize:14,lineHeight:1.3}}>{selected.business_name||selected.owner_name}</div>
              <div style={{fontSize:11,color:'var(--text-dim)',marginTop:2}}>{selected.license_type}</div>
            </div>
            <button onClick={()=>setSelected(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',padding:4}}><X size={16}/></button>
          </div>
          <div style={{flex:1,overflow:'auto',padding:'16px 20px',display:'flex',flexDirection:'column',gap:14}}>
            {[
              ['License #', selected.license_number],
              ['Subtype', selected.license_subtype],
              ['Owner', selected.owner_name],
              ['Address', [selected.business_address, selected.business_city, selected.business_state, selected.business_zip].filter(Boolean).join(', ')],
              ['County', selected.business_county],
              ['Business Phone', selected.business_phone],
              ['Owner Phone', selected.owner_phone],
            ].map(([label,val])=> val?(
              <div key={label}>
                <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',marginBottom:3}}>{label.toUpperCase()}</div>
                <div style={{color:'white',fontSize:13,wordBreak:'break-all'}}>
                  {label.includes('Phone')
                    ? <a href={`tel:${val}`} style={{color:'#4CC97A',textDecoration:'none',display:'flex',alignItems:'center',gap:6}}><Phone size={12}/>{val}</a>
                    : val}
                </div>
              </div>
            ):null)}

            {/* Expiry callout */}
            {selected.expire_date&&(()=>{
              const days = daysUntil(selected.expire_date);
              const color = expiryColor(selected.expire_date);
              return (
                <div style={{background:`${color}18`,border:`1px solid ${color}44`,borderRadius:8,padding:'12px 14px'}}>
                  <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color,marginBottom:4}}>LICENSE EXPIRY</div>
                  <div style={{color,fontFamily:'"Bebas Neue",cursive',fontSize:22,letterSpacing:2}}>{fmtDate(selected.expire_date)}</div>
                  <div style={{color,fontSize:12,marginTop:2}}>
                    {days<0?`Expired ${Math.abs(days)} days ago`:days===0?'Expires today':`${days} days remaining`}
                  </div>
                </div>
              );
            })()}

            <a href={`https://quantumsurety.bond/get-bond?type=contractor&source=crm-tdlr`}
              target="_blank" rel="noreferrer"
              style={{display:'block',textAlign:'center',background:'var(--gold)',color:'#000',padding:'10px 16px',borderRadius:8,textDecoration:'none',fontSize:13,fontWeight:700,letterSpacing:1,marginTop:4}}>
              Get Contractor Bond Quote →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
