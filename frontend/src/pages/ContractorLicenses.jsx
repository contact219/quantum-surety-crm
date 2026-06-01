import React,{useEffect,useState,useCallback} from 'react';
import {Search,ChevronLeft,ChevronRight,X,Download,RefreshCw} from 'lucide-react';
import {apiFetch} from '../auth.js';

const BOND_TYPE = 'Texas Contractor License Bond';

const STATUS_STYLE = {
  new:          {bg:'rgba(248,113,113,0.1)',color:'#f87171',border:'rgba(248,113,113,0.3)'},
  contacted:    {bg:'rgba(251,191,36,0.1)',color:'#fbbf24',border:'rgba(251,191,36,0.3)'},
  sold:         {bg:'rgba(74,222,128,0.1)',color:'#4ade80',border:'rgba(74,222,128,0.3)'},
  no_follow_up: {bg:'rgba(107,114,128,0.1)',color:'#6b7280',border:'rgba(107,114,128,0.3)'},
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric'});
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff/60000);
  if (m<60) return m+'m ago';
  const h = Math.floor(m/60);
  if (h<24) return h+'h ago';
  const d = Math.floor(h/24);
  if (d<30) return d+'d ago';
  return Math.floor(d/30)+'mo ago';
}

function exportCSV(leads) {
  const header = ['ID','Name','Email','Phone','Source','Status','Notes','Received'];
  const rows = leads.map(l=>[
    l.id, l.name, l.email||'', l.phone||'', l.source||'',
    l.status||'', (l.notes||'').replace(/\n/g,' '), fmtDate(l.lead_time||l.created_at),
  ]);
  const csv = [header,...rows]
    .map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download='contractor-licenses-'+new Date().toISOString().split('T')[0]+'.csv';
  a.click(); URL.revokeObjectURL(url);
}

export default function ContractorLicenses() {
  const [leads,setLeads]     = useState([]);
  const [stats,setStats]     = useState(null);
  const [loading,setLoading] = useState(false);
  const [search,setSearch]   = useState('');
  const [status,setStatus]   = useState('');
  const [source,setSource]   = useState('');
  const [page,setPage]       = useState(1);
  const PER_PAGE = 50;

  const [selected,setSelected]   = useState(null);
  const [editStatus,setEditStatus] = useState('');
  const [editNotes,setEditNotes]   = useState('');
  const [editSale,setEditSale]     = useState('');
  const [saving,setSaving]         = useState(false);
  const [saveMsg,setSaveMsg]       = useState('');

  const safeJson = async(r)=>{ const t=await r.text(); try{return JSON.parse(t);}catch{throw new Error(`Server error (${r.status})`);} };

  const loadStats = () =>
    apiFetch('/api/leads/contractor-stats').then(safeJson).then(setStats).catch(()=>{});

  const loadLeads = useCallback(()=>{
    setLoading(true);
    const p = new URLSearchParams({bond_type:BOND_TYPE, ...(status&&{status}), ...(search&&{search})});
    apiFetch(`/api/leads?${p}`).then(safeJson).then(j=>{
      let rows = j.leads||[];
      if (source) rows = rows.filter(r=>(r.source||'').toLowerCase().includes(source.toLowerCase()));
      setLeads(rows);
      setPage(1);
    }).catch(()=>{}).finally(()=>setLoading(false));
  },[search,status,source]);

  useEffect(()=>{ loadStats(); },[]);
  useEffect(()=>{ loadLeads(); },[loadLeads]);

  const openDetail = (r)=>{ setSelected(r); setEditStatus(r.status||'new'); setEditNotes(r.notes||''); setEditSale(r.sale_amount||''); setSaveMsg(''); };
  const closeDetail = ()=>{ setSelected(null); setSaveMsg(''); };

  const saveDetail = async()=>{
    setSaving(true); setSaveMsg('');
    try {
      const r = await apiFetch(`/api/leads/${selected.id}`,{method:'PATCH',body:JSON.stringify({status:editStatus,notes:editNotes,sale_amount:editSale||null})});
      const j = await safeJson(r);
      if (j.error) { setSaveMsg('Error: '+j.error); }
      else {
        setSaveMsg('Saved');
        setLeads(ls=>ls.map(l=>l.id===selected.id?{...l,status:editStatus,notes:editNotes,sale_amount:editSale}:l));
        setSelected(s=>({...s,status:editStatus,notes:editNotes,sale_amount:editSale}));
        loadStats();
        setTimeout(()=>setSaveMsg(''),2000);
      }
    } catch(e){ setSaveMsg('Error: '+e.message); }
    setSaving(false);
  };

  const paginated = leads.slice((page-1)*PER_PAGE, page*PER_PAGE);
  const pages = Math.max(1, Math.ceil(leads.length/PER_PAGE));

  // Unique sources for filter dropdown
  const sources = [...new Set(leads.map(l=>l.source).filter(Boolean))].sort();

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden'}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Header */}
        <div style={{padding:'24px 24px 16px',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:4,color:'var(--gold)',marginBottom:4}}>CONTRACTOR BONDS</div>
          <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:16}}>
            <h1 style={{fontFamily:'"Bebas Neue",cursive',fontSize:36,letterSpacing:4,color:'white',margin:0}}>License Lookup</h1>
            {stats&&(
              <div style={{display:'flex',gap:24}}>
                {[
                  {label:'Total',val:parseInt(stats.total||0).toLocaleString(),color:'var(--gold)'},
                  {label:'New',val:parseInt(stats.new_count||0).toLocaleString(),color:'#f87171'},
                  {label:'Contacted',val:parseInt(stats.contacted_count||0).toLocaleString(),color:'#fbbf24'},
                  {label:'Sold',val:parseInt(stats.sold_count||0).toLocaleString(),color:'#4ade80'},
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
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Name, email, or phone..."
                style={{paddingLeft:30,paddingRight:10,paddingTop:6,paddingBottom:6,borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none',width:200}}/>
            </div>
            <select value={status} onChange={e=>setStatus(e.target.value)}
              style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none'}}>
              <option value=''>All Statuses</option>
              <option value='new'>New</option>
              <option value='contacted'>Contacted</option>
              <option value='sold'>Sold</option>
              <option value='no_follow_up'>No Follow-up</option>
            </select>
            <select value={source} onChange={e=>setSource(e.target.value)}
              style={{padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:12,outline:'none',maxWidth:200}}>
              <option value=''>All Sources</option>
              {sources.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={loadLeads}
              style={{padding:'6px 10px',borderRadius:8,background:'var(--muted)',border:'none',cursor:'pointer',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:4}}>
              <RefreshCw size={12}/>
            </button>
            <button onClick={()=>exportCSV(leads)} disabled={!leads.length}
              style={{padding:'6px 10px',borderRadius:8,background:'var(--muted)',border:'none',cursor:'pointer',color:'var(--text-dim)',display:'flex',alignItems:'center',gap:4,opacity:leads.length?1:0.4}}>
              <Download size={12}/><span style={{fontSize:12}}>CSV</span>
            </button>
          </div>
        </div>

        {/* Count bar */}
        <div style={{padding:'8px 24px',borderBottom:'1px solid var(--border)',fontSize:12,color:'var(--text-dim)'}}>
          {loading ? 'Loading...' : `${leads.length.toLocaleString()} records`}
          {(search||status||source) && <span style={{marginLeft:8,color:'var(--gold)'}}>· filtered</span>}
        </div>

        {/* Table */}
        <div style={{flex:1,overflow:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{background:'var(--surface)',position:'sticky',top:0,zIndex:1}}>
                {['Company / Name','Phone','Email','Source','Status','Notes','Received'].map(h=>(
                  <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',fontWeight:400,borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((r,i)=>{
                const st = STATUS_STYLE[r.status]||STATUS_STYLE.new;
                return (
                  <tr key={r.id} onClick={()=>openDetail(r)}
                    style={{borderBottom:'1px solid var(--border)',cursor:'pointer',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--muted)'}
                    onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'transparent':'rgba(255,255,255,0.01)'}>
                    <td style={{padding:'8px 12px',color:'white',fontWeight:500,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.name||'—'}</td>
                    <td style={{padding:'8px 12px',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{r.phone||'—'}</td>
                    <td style={{padding:'8px 12px',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {r.email
                        ? <a href={`mailto:${r.email}`} onClick={e=>e.stopPropagation()} style={{color:'#4C9AC9',textDecoration:'none'}}>{r.email}</a>
                        : <span style={{color:'var(--text-dim)'}}>—</span>}
                    </td>
                    <td style={{padding:'8px 12px',color:'var(--text-dim)',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:11}}>{r.source||'—'}</td>
                    <td style={{padding:'8px 12px'}}>
                      <span style={{background:st.bg,color:st.color,border:`1px solid ${st.border}`,padding:'2px 8px',borderRadius:4,fontSize:11,fontFamily:'monospace',whiteSpace:'nowrap'}}>
                        {r.status||'new'}
                      </span>
                    </td>
                    <td style={{padding:'8px 12px',color:'var(--text-dim)',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:11}}>{(r.notes||'').split('\n')[0]||'—'}</td>
                    <td style={{padding:'8px 12px',color:'var(--text-dim)',whiteSpace:'nowrap',fontSize:11}}>{timeAgo(r.lead_time||r.created_at)}</td>
                  </tr>
                );
              })}
              {!loading&&paginated.length===0&&(
                <tr><td colSpan={7} style={{padding:'40px',textAlign:'center',color:'var(--text-dim)'}}>No contractor license leads found</td></tr>
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
            <span style={{color:'var(--text-dim)'}}>Page {page} of {pages} ({leads.length.toLocaleString()} total)</span>
            <button onClick={()=>setPage(p=>Math.min(pages,p+1))} disabled={page>=pages}
              style={{background:'var(--muted)',border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',color:'var(--text)',opacity:page>=pages?0.4:1}}>
              <ChevronRight size={14}/>
            </button>
          </div>
        )}
      </div>

      {/* Detail / edit panel */}
      {selected&&(
        <div style={{width:340,borderLeft:'1px solid var(--border)',background:'var(--surface)',display:'flex',flexDirection:'column',overflow:'hidden',flexShrink:0}}>
          <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:3,color:'var(--gold)',marginBottom:4}}>CONTRACTOR LEAD</div>
              <div style={{fontWeight:700,color:'white',fontSize:14,lineHeight:1.3}}>{selected.name}</div>
              <div style={{fontSize:11,color:'var(--text-dim)',marginTop:2}}>{fmtDate(selected.lead_time||selected.created_at)}</div>
            </div>
            <button onClick={closeDetail} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',padding:4}}><X size={16}/></button>
          </div>
          <div style={{flex:1,overflow:'auto',padding:'16px 20px',display:'flex',flexDirection:'column',gap:14}}>

            {/* Contact info */}
            {[['Phone',selected.phone],['Email',selected.email],['Source',selected.source]].map(([label,val])=> val?(
              <div key={label}>
                <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',marginBottom:3}}>{label.toUpperCase()}</div>
                <div style={{color:'white',fontSize:13}}>
                  {label==='Email'?<a href={`mailto:${val}`} style={{color:'#4C9AC9',textDecoration:'none'}}>{val}</a>:val}
                </div>
              </div>
            ):null)}

            {/* Status */}
            <div>
              <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',marginBottom:6}}>STATUS</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {['new','contacted','sold','no_follow_up'].map(s=>{
                  const st=STATUS_STYLE[s];
                  return (
                    <button key={s} onClick={()=>setEditStatus(s)}
                      style={{padding:'4px 12px',borderRadius:6,fontSize:12,cursor:'pointer',fontFamily:'monospace',
                        background:editStatus===s?st.bg:'transparent',
                        color:editStatus===s?st.color:'var(--text-dim)',
                        border:`1px solid ${editStatus===s?st.border:'var(--border)'}`,
                        transition:'all 0.15s'}}>
                      {s.replace('_',' ')}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sale amount (shown when sold) */}
            {editStatus==='sold'&&(
              <div>
                <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',marginBottom:6}}>SALE AMOUNT ($)</div>
                <input type="number" value={editSale} onChange={e=>setEditSale(e.target.value)}
                  placeholder="0.00"
                  style={{width:'100%',padding:'6px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--dark)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
              </div>
            )}

            {/* Notes */}
            <div>
              <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',marginBottom:6}}>NOTES</div>
              <textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)}
                rows={6}
                style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--dark)',color:'var(--text)',fontSize:12,outline:'none',resize:'vertical',boxSizing:'border-box',fontFamily:'monospace',lineHeight:1.5}}/>
            </div>

            {/* Save */}
            <button onClick={saveDetail} disabled={saving}
              style={{padding:'10px',borderRadius:8,background:'var(--gold)',color:'#000',fontSize:13,fontWeight:700,border:'none',cursor:'pointer',opacity:saving?0.6:1}}>
              {saving?'Saving…':'Save Changes'}
            </button>
            {saveMsg&&<div style={{fontSize:12,textAlign:'center',color:saveMsg.startsWith('Error')?'#f87171':'#4ade80'}}>{saveMsg}</div>}

            <div style={{paddingTop:8,borderTop:'1px solid var(--border)'}}>
              <a href={`https://quantumsurety.bond/get-bond?type=contractor&source=crm-license-lookup`}
                target="_blank" rel="noreferrer"
                style={{display:'block',textAlign:'center',background:'transparent',color:'var(--gold)',padding:'8px 16px',borderRadius:8,textDecoration:'none',fontSize:12,fontWeight:700,border:'1px solid var(--gold)'}}>
                Get Bond Quote →
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
