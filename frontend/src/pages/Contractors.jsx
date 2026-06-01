import React,{useEffect,useState,useCallback} from 'react';
import {Search,MapPin,ChevronLeft,ChevronRight,X} from 'lucide-react';
import {apiFetch} from '../auth.js';

const CERT_OPTIONS = [
  {value:'',label:'All Types'},
  {value:'HUB',label:'HUB'},
  {value:'DBE',label:'DBE'},
  {value:'NM Veteran',label:'NM Veteran'},
];

const STATE_OPTIONS = [
  {value:'',label:'All States'},
  {value:'TX',label:'Texas'},
  {value:'LA',label:'Louisiana'},
  {value:'NM',label:'New Mexico'},
];

const BLANK_FILTERS = { search:'', city:'', state:'TX', cert_type:'', has_email:'' };

export default function Contractors() {
  const [stats,setStats]   = useState(null);
  const [rows,setRows]     = useState([]);
  const [total,setTotal]   = useState(0);
  const [pages,setPages]   = useState(1);
  const [page,setPage]     = useState(1);
  const [loading,setLoading] = useState(false);
  const [filters,setFilters] = useState(BLANK_FILTERS);
  const [pendingFilters,setPendingFilters] = useState(BLANK_FILTERS);
  const [selected,setSelected] = useState(null);

  const safeJson = async(r) => { const t=await r.text(); try{return JSON.parse(t);}catch{throw new Error(`Server error (${r.status})`);} };

  const loadStats = () =>
    apiFetch('/api/contractors/stats').then(safeJson).then(setStats).catch(()=>{});

  const loadRows = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ page, limit:50, ...filters });
    apiFetch(`/api/contractors?${p}`).then(safeJson).then(j=>{
      setRows(j.data||[]); setTotal(j.total||0); setPages(j.pages||1);
    }).catch(()=>{}).finally(()=>setLoading(false));
  }, [page, filters]);

  useEffect(()=>{ loadStats(); },[]);
  useEffect(()=>{ loadRows(); },[loadRows]);
  useEffect(()=>{ setPage(1); },[filters]);

  const applyFilters = () => { setFilters({...pendingFilters}); setPage(1); };
  const resetFilters = () => { setPendingFilters(BLANK_FILTERS); setFilters(BLANK_FILTERS); setPage(1); };

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden'}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Header */}
        <div style={{padding:'24px 24px 16px',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:4,color:'var(--gold)',marginBottom:4}}>CONTRACTOR BONDS</div>
          <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:16}}>
            <h1 style={{fontFamily:'"Bebas Neue",cursive',fontSize:36,letterSpacing:4,color:'white',margin:0}}>Contractor Lookup</h1>
            {stats&&(
              <div style={{display:'flex',gap:24}}>
                {[
                  {label:'Total',val:parseInt(stats.total).toLocaleString(),color:'var(--gold)'},
                  {label:'Texas',val:parseInt(stats.texas).toLocaleString(),color:'#4C9AC9'},
                  {label:'With Email',val:parseInt(stats.with_email).toLocaleString(),color:'#4CC97A'},
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
                placeholder="Company, email, or phone..."
                style={{paddingLeft:30,paddingRight:10,paddingTop:6,paddingBottom:6,borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none',width:200}}/>
            </div>
            <div style={{position:'relative'}}>
              <MapPin size={12} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)'}}/>
              <input value={pendingFilters.city} onChange={e=>setPendingFilters(f=>({...f,city:e.target.value}))}
                onKeyDown={e=>e.key==='Enter'&&applyFilters()}
                placeholder="City..."
                style={{paddingLeft:30,paddingRight:10,paddingTop:6,paddingBottom:6,borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none',width:130}}/>
            </div>
            <select value={pendingFilters.state} onChange={e=>setPendingFilters(f=>({...f,state:e.target.value}))}
              style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none'}}>
              {STATE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={pendingFilters.cert_type} onChange={e=>setPendingFilters(f=>({...f,cert_type:e.target.value}))}
              style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none'}}>
              {CERT_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={pendingFilters.has_email} onChange={e=>setPendingFilters(f=>({...f,has_email:e.target.value}))}
              style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none'}}>
              <option value=''>All Contacts</option>
              <option value='true'>Has Email</option>
            </select>
            <button onClick={applyFilters}
              style={{padding:'6px 16px',borderRadius:8,background:'var(--gold)',color:'#000',fontSize:12,fontWeight:700,border:'none',cursor:'pointer'}}>
              Search
            </button>
            <button onClick={resetFilters}
              style={{padding:'6px 12px',borderRadius:8,background:'var(--muted)',color:'var(--text-dim)',fontSize:12,border:'none',cursor:'pointer'}}>
              Reset
            </button>
          </div>
        </div>

        {/* Results count */}
        <div style={{padding:'8px 24px',borderBottom:'1px solid var(--border)',fontSize:12,color:'var(--text-dim)'}}>
          {loading ? 'Loading...' : `${total.toLocaleString()} contractors`}
          {(filters.search||filters.city||(filters.state&&filters.state!=='TX')||filters.cert_type||filters.has_email) &&
            <span style={{marginLeft:8,color:'var(--gold)'}}>· filtered</span>}
        </div>

        {/* Table */}
        <div style={{flex:1,overflow:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{background:'var(--surface)',position:'sticky',top:0,zIndex:1}}>
                {['Company','City','State','Phone','Email','Cert Type','Cert #','Bond Amt'].map(h=>(
                  <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',fontWeight:400,borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={r.id} onClick={()=>setSelected(r)}
                  style={{borderBottom:'1px solid var(--border)',cursor:'pointer',background:i%2===0?'transparent':'rgba(255,255,255,0.01)',transition:'background 0.1s'}}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--muted)'}
                  onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'transparent':'rgba(255,255,255,0.01)'}>
                  <td style={{padding:'8px 12px',color:'white',fontWeight:500,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.company_name}</td>
                  <td style={{padding:'8px 12px',color:'var(--text-dim)'}}>{r.city||'—'}</td>
                  <td style={{padding:'8px 12px',color:'var(--text-dim)'}}>{r.state||'—'}</td>
                  <td style={{padding:'8px 12px',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{r.phone||'—'}</td>
                  <td style={{padding:'8px 12px',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {r.email
                      ? <a href={`mailto:${r.email}`} onClick={e=>e.stopPropagation()} style={{color:'#4C9AC9',textDecoration:'none'}}>{r.email}</a>
                      : <span style={{color:'var(--text-dim)'}}>—</span>}
                  </td>
                  <td style={{padding:'8px 12px'}}>
                    {r.certification_type&&(
                      <span style={{background:'rgba(201,168,76,0.15)',color:'var(--gold)',padding:'2px 8px',borderRadius:4,fontSize:11,fontFamily:'monospace'}}>{r.certification_type}</span>
                    )}
                  </td>
                  <td style={{padding:'8px 12px',color:'var(--text-dim)',fontFamily:'monospace',fontSize:11}}>{r.certification_number||'—'}</td>
                  <td style={{padding:'8px 12px',color:'var(--text-dim)',whiteSpace:'nowrap'}}>
                    {r.bonding_amount ? `$${parseFloat(r.bonding_amount).toLocaleString()}` : '—'}
                  </td>
                </tr>
              ))}
              {!loading&&rows.length===0&&(
                <tr><td colSpan={8} style={{padding:'40px',textAlign:'center',color:'var(--text-dim)'}}>No contractors found</td></tr>
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
            <span style={{color:'var(--text-dim)'}}>Page {page} of {pages}</span>
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
              <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:3,color:'var(--gold)',marginBottom:4}}>CONTRACTOR</div>
              <div style={{fontWeight:700,color:'white',fontSize:14,lineHeight:1.3}}>{selected.company_name}</div>
            </div>
            <button onClick={()=>setSelected(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',padding:4}}><X size={16}/></button>
          </div>
          <div style={{flex:1,overflow:'auto',padding:'16px 20px'}}>
            {[
              ['Address', [selected.address, selected.city, selected.state, selected.zip].filter(Boolean).join(', ')],
              ['Phone', selected.phone],
              ['Email', selected.email],
              ['Cert Type', selected.certification_type],
              ['Cert Number', selected.certification_number],
              ['Bond Amount', selected.bonding_amount ? `$${parseFloat(selected.bonding_amount).toLocaleString()}` : null],
              ['Bond Company', selected.bonding_company],
              ['Bond Expiration', selected.bonding_expiration ? new Date(selected.bonding_expiration).toLocaleDateString() : null],
            ].map(([label,val])=> val ? (
              <div key={label} style={{marginBottom:14}}>
                <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',marginBottom:3}}>{label.toUpperCase()}</div>
                <div style={{color:'white',fontSize:13,wordBreak:'break-all'}}>
                  {label==='Email'
                    ? <a href={`mailto:${val}`} style={{color:'#4C9AC9',textDecoration:'none'}}>{val}</a>
                    : val}
                </div>
              </div>
            ) : null)}
            <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid var(--border)'}}>
              <a href={`https://quantumsurety.bond/get-bond?type=contractor&source=crm-lookup`}
                target="_blank" rel="noreferrer"
                style={{display:'block',textAlign:'center',background:'var(--gold)',color:'#000',padding:'10px 16px',borderRadius:8,textDecoration:'none',fontSize:13,fontWeight:700,letterSpacing:1}}>
                Get Contractor Bond Quote →
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
