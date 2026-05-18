import React,{useEffect,useState,useCallback} from 'react';
import {Search,Phone,Mail,CheckCircle,XCircle,Edit2,RefreshCw,DollarSign,Clock,Filter,X} from 'lucide-react';
import {apiFetch} from '../auth.js';

const STATUS_STYLE = {
  new:          {bg:'#3a1a1a',color:'#f87171',border:'#7f1d1d'},
  contacted:    {bg:'#3a2e1a',color:'#fbbf24',border:'#78350f'},
  sold:         {bg:'#1a3a1e',color:'#4ade80',border:'#14532d'},
  no_follow_up: {bg:'#1e1e2a',color:'#6b7280',border:'#374151'},
};

const BOND_LABELS = {
  notary:'Texas Notary Bond',dealer:'Texas GDN Dealer Bond',gdn:'Texas GDN Dealer Bond',
  contractor:'Texas Contractor Bond',construction:'Texas Construction Bond',
  bid:'Texas Bid Bond',performance:'Texas Performance Bond',payment:'Texas Payment Bond',
  mortgage:'Texas Mortgage Broker Bond','credit-access-business':'Texas Credit Access Business Bond',
  'collection-agency':'Texas Collection Agency Bond','property-tax-consultant':'Texas Property Tax Consultant Bond',
};
function bondDisplay(raw) {
  if (!raw) return '—';
  return BOND_LABELS[raw?.toLowerCase()] || raw;
}
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
}

export default function Leads() {
  const [leads,setLeads] = useState([]);
  const [stats,setStats] = useState({});
  const [loading,setLoading] = useState(true);
  const [search,setSearch] = useState('');
  const [filterStatus,setFilterStatus] = useState('all');
  const [editing,setEditing] = useState(null);
  const [editData,setEditData] = useState({status:'new',notes:'',sale_amount:''});
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (search) params.set('search', search);
      const [leadsRes, statsRes] = await Promise.all([
        apiFetch('/api/leads?' + params),
        apiFetch('/api/leads/stats'),
      ]);
      setLeads(leadsRes.leads || []);
      setStats(statsRes || {});
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, search]);

  useEffect(() => { load(); }, [load]);

  async function quickStatus(lead, status) {
    try {
      await apiFetch('/api/leads/' + lead.id, { method:'PATCH', body:JSON.stringify({status}) });
      load();
    } catch(e) { setError(e.message); }
  }

  function openEdit(lead) {
    setEditing(lead);
    setEditData({ status: lead.status || 'new', notes: lead.notes || '', sale_amount: lead.sale_amount || '' });
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await apiFetch('/api/leads/' + editing.id, {
        method:'PATCH',
        body: JSON.stringify(editData),
      });
      setEditing(null);
      load();
    } catch(e) { setError(e.message); }
    setSaving(false);
  }

  const statCards = [
    {label:'Total',value:stats.total||0,color:'#C9A84C'},
    {label:'Today',value:stats.today||0,color:'#4C9AC9'},
    {label:'New',value:stats.new_count||0,color:'#f87171'},
    {label:'Contacted',value:stats.contacted_count||0,color:'#fbbf24'},
    {label:'Sold',value:stats.sold_count||0,color:'#4ade80'},
    {label:'Revenue',value:'$'+(parseFloat(stats.revenue||0).toFixed(0)),color:'#4ade80'},
  ];

  return (
    <div style={{padding:'24px 28px',maxWidth:1100,margin:'0 auto'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:700,color:'white',margin:0,letterSpacing:1}}>LEADS</h1>
          <div style={{fontSize:11,color:'var(--text-dim)',fontFamily:'monospace',marginTop:2}}>Form submissions & bond inquiries</div>
        </div>
        <button onClick={load} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text-dim)',fontSize:12,cursor:'pointer'}}>
          <RefreshCw size={13}/> Refresh
        </button>
      </div>

      {error && (
        <div style={{background:'#3a1a1a',border:'1px solid #7f1d1d',color:'#f87171',borderRadius:8,padding:'8px 14px',marginBottom:16,fontSize:12,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          {error} <button onClick={()=>setError('')} style={{background:'none',border:'none',color:'#f87171',cursor:'pointer'}}><X size={14}/></button>
        </div>
      )}

      {/* Stats */}
      <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
        {statCards.map(s=>(
          <div key={s.label} style={{flex:'1 1 80px',background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 16px',textAlign:'center',minWidth:80}}>
            <div style={{fontSize:24,fontWeight:700,color:s.color,fontFamily:'monospace'}}>{s.value}</div>
            <div style={{fontSize:10,color:'var(--text-dim)',marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{position:'relative',flex:'1',minWidth:200}}>
          <Search size={13} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)'}}/>
          <input
            value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search name, email, phone…"
            style={{width:'100%',paddingLeft:30,paddingRight:10,padding:'8px 10px 8px 30px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'white',fontSize:12,outline:'none',boxSizing:'border-box'}}
          />
        </div>
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
          {['all','new','contacted','sold','no_follow_up'].map(s=>(
            <button key={s} onClick={()=>setFilterStatus(s)}
              style={{padding:'6px 12px',borderRadius:6,fontSize:11,cursor:'pointer',fontFamily:'monospace',
                background:filterStatus===s?'var(--gold)':'var(--muted)',
                color:filterStatus===s?'#000':'var(--text-dim)',
                border:'1px solid '+(filterStatus===s?'var(--gold)':'var(--border)')}}>
              {s==='no_follow_up'?'Skip':s==='all'?'All':s.charAt(0).toUpperCase()+s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,overflow:'hidden'}}>
        <div style={{padding:'10px 16px',borderBottom:'1px solid var(--border)',fontSize:11,color:'var(--text-dim)',fontFamily:'monospace'}}>
          {loading ? 'Loading…' : `${leads.length} lead${leads.length!==1?'s':''}`}
        </div>
        {!loading && leads.length === 0 ? (
          <div style={{padding:40,textAlign:'center',color:'var(--text-dim)',fontSize:13}}>No leads found.</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'var(--muted)'}}>
                  {['Name','Contact','Bond Type','Received','Status','Notes','Actions'].map(h=>(
                    <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10,color:'var(--text-dim)',fontFamily:'monospace',letterSpacing:1,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead,i)=>{
                  const st = STATUS_STYLE[lead.status] || STATUS_STYLE.new;
                  return (
                    <tr key={lead.id} style={{borderTop:'1px solid var(--border)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)'}}>
                      <td style={{padding:'10px 12px',fontWeight:600,fontSize:13,color:'white',whiteSpace:'nowrap'}}>{lead.name}</td>
                      <td style={{padding:'10px 12px'}}>
                        <a href={'mailto:'+lead.email} style={{color:'#4C9AC9',fontSize:11,display:'flex',alignItems:'center',gap:4,textDecoration:'none'}}><Mail size={11}/>{lead.email}</a>
                        {lead.phone&&<a href={'tel:'+lead.phone} style={{color:'var(--text-dim)',fontSize:11,display:'flex',alignItems:'center',gap:4,textDecoration:'none',marginTop:2}}><Phone size={11}/>{lead.phone}</a>}
                      </td>
                      <td style={{padding:'10px 12px',fontSize:11,color:'var(--text-dim)',maxWidth:150}}>{bondDisplay(lead.bond_type)}</td>
                      <td style={{padding:'10px 12px',fontSize:11,color:'var(--text-dim)',whiteSpace:'nowrap'}}>{fmtTime(lead.lead_time)}</td>
                      <td style={{padding:'10px 12px'}}>
                        <span style={{padding:'3px 10px',borderRadius:12,fontSize:10,fontWeight:600,fontFamily:'monospace',background:st.bg,color:st.color,border:'1px solid '+st.border}}>
                          {lead.status==='no_follow_up'?'SKIP':lead.status?.toUpperCase()}
                        </span>
                        {lead.sale_amount&&parseFloat(lead.sale_amount)>0&&(
                          <div style={{color:'#4ade80',fontSize:10,fontFamily:'monospace',marginTop:2,display:'flex',alignItems:'center',gap:2}}><DollarSign size={9}/>{parseFloat(lead.sale_amount).toFixed(0)}</div>
                        )}
                      </td>
                      <td style={{padding:'10px 12px',fontSize:11,color:'var(--text-dim)',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{lead.notes||<span style={{color:'#374151'}}>—</span>}</td>
                      <td style={{padding:'10px 12px'}}>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                          {lead.status==='new'&&(
                            <button onClick={()=>quickStatus(lead,'contacted')} style={{padding:'4px 8px',fontSize:10,borderRadius:4,background:'#3a2e1a',color:'#fbbf24',border:'1px solid #78350f',cursor:'pointer',fontFamily:'monospace'}}>Contacted</button>
                          )}
                          {lead.status!=='sold'&&lead.status!=='no_follow_up'&&(
                            <button onClick={()=>quickStatus(lead,'sold')} style={{padding:'4px 8px',fontSize:10,borderRadius:4,background:'#1a3a1e',color:'#4ade80',border:'1px solid #14532d',cursor:'pointer',fontFamily:'monospace',display:'flex',alignItems:'center',gap:3}}>
                              <CheckCircle size={10}/>Sold
                            </button>
                          )}
                          {lead.status!=='no_follow_up'&&(
                            <button onClick={()=>quickStatus(lead,'no_follow_up')} style={{padding:'4px 8px',fontSize:10,borderRadius:4,background:'#1e1e2a',color:'#6b7280',border:'1px solid #374151',cursor:'pointer',fontFamily:'monospace',display:'flex',alignItems:'center',gap:3}}>
                              <XCircle size={10}/>Skip
                            </button>
                          )}
                          <button onClick={()=>openEdit(lead)} style={{padding:'4px 8px',fontSize:10,borderRadius:4,background:'var(--muted)',color:'var(--text-dim)',border:'1px solid var(--border)',cursor:'pointer',fontFamily:'monospace',display:'flex',alignItems:'center',gap:3}}>
                            <Edit2 size={10}/>Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}}>
          <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,padding:24,width:380,maxWidth:'90vw'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontWeight:700,fontSize:14,color:'white'}}>{editing.name}</div>
              <button onClick={()=>setEditing(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)'}}><X size={16}/></button>
            </div>
            <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:16,fontFamily:'monospace'}}>
              {editing.email} · {editing.phone||'no phone'}<br/>
              {bondDisplay(editing.bond_type)} · {fmtTime(editing.lead_time)}
            </div>

            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,color:'var(--text-dim)',fontFamily:'monospace',marginBottom:4}}>STATUS</div>
              <select value={editData.status} onChange={e=>setEditData(d=>({...d,status:e.target.value}))}
                style={{width:'100%',padding:'7px 10px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'white',fontSize:12}}>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="sold">Sold</option>
                <option value="no_follow_up">No Follow-up Needed</option>
              </select>
            </div>

            {editData.status==='sold'&&(
              <div style={{marginBottom:12}}>
                <div style={{fontSize:10,color:'var(--text-dim)',fontFamily:'monospace',marginBottom:4}}>SALE AMOUNT ($)</div>
                <input type="number" value={editData.sale_amount} onChange={e=>setEditData(d=>({...d,sale_amount:e.target.value}))}
                  placeholder="e.g. 39" style={{width:'100%',padding:'7px 10px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'white',fontSize:12,boxSizing:'border-box'}}/>
              </div>
            )}

            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:'var(--text-dim)',fontFamily:'monospace',marginBottom:4}}>NOTES</div>
              <textarea value={editData.notes} onChange={e=>setEditData(d=>({...d,notes:e.target.value}))}
                placeholder="Add notes…" rows={3}
                style={{width:'100%',padding:'7px 10px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'white',fontSize:12,resize:'none',boxSizing:'border-box'}}/>
            </div>

            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setEditing(null)} style={{padding:'7px 16px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text-dim)',fontSize:12,cursor:'pointer'}}>Cancel</button>
              <button onClick={saveEdit} disabled={saving} style={{padding:'7px 16px',background:'var(--gold)',border:'none',borderRadius:6,color:'#000',fontSize:12,fontWeight:600,cursor:'pointer',opacity:saving?0.6:1}}>
                {saving?'Saving…':'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
