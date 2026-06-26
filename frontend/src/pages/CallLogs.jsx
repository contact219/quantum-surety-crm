import React,{useEffect,useState,useCallback} from 'react';
import {RefreshCw,Download,PhoneIncoming,CheckCircle,XCircle,Mic,Trash2,X} from 'lucide-react';

const API = 'https://voice-agent.permitpilot.online/api/calls';

const SENTIMENT = {
  Positive:{bg:'#1a3a1e',color:'#4ade80',border:'#14532d'},
  Neutral:  {bg:'#1e1e2a',color:'#94a3b8',border:'#334155'},
  Negative: {bg:'#3a1a1a',color:'#f87171',border:'#7f1d1d'},
};
const BOND_COLOR = {
  notary:'#f59e0b',dealer:'#4C9AC9',contractor:'#a78bfa',
  mortgage:'#34d399',general:'#94a3b8',
};

function fmtTime(iso){
  if(!iso)return'—';
  return new Date(iso).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
}
function timeAgo(iso){
  if(!iso)return'';
  const diff=Date.now()-new Date(iso).getTime();
  const m=Math.floor(diff/60000);
  if(m<1)return'just now';
  if(m<60)return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24)return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function fmtDur(s){
  if(!s)return'—';
  const m=Math.floor(s/60);
  return m>0?`${m}m ${s%60}s`:`${s}s`;
}
function fmtPhone(n){
  if(!n)return'Unknown';
  const d=n.replace(/\D/g,'');
  if(d.length===11&&d[0]==='1')return`(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return n;
}
function bondLabel(b){
  if(!b)return'—';
  return b.charAt(0).toUpperCase()+b.slice(1).replace(/_/g,' ');
}
function exportCSV(calls){
  const h=['Date','Caller','Bond Type','Outcome','Sentiment','Duration','Summary','Recording'];
  const rows=calls.map(c=>[fmtTime(c.created_at),c.from_number||'',c.bond_type||'',
    c.call_successful?'Successful':'Unsuccessful',c.user_sentiment||'',fmtDur(c.duration_seconds),
    (c.call_summary||'').replace(/,/g,' '),c.recording_url||'']);
  const csv=[h,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='call-logs-'+new Date().toISOString().split('T')[0]+'.csv';
  a.click();
}

export default function CallLogs(){
  const [calls,setCalls]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [expanded,setExpanded]=useState(null);
  const [filterBond,setFilterBond]=useState('all');
  const [filterOutcome,setFilterOutcome]=useState('all');
  const [deleteTarget,setDeleteTarget]=useState(null);
  const [deleting,setDeleting]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const res=await fetch(API);
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const data=await res.json();
      setCalls(data.calls||[]);
    }catch(e){setError('Failed to load: '+e.message);}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{load();},[load]);

  const confirmDelete=useCallback(async()=>{
    if(!deleteTarget)return;
    setDeleting(true);
    try{
      const res=await fetch(`${API}/${deleteTarget.id}`,{method:'DELETE'});
      if(!res.ok)throw new Error(`HTTP ${res.status}`);
      setDeleteTarget(null);
      load();
    }catch(e){setError('Delete failed: '+e.message);}
    setDeleting(false);
  },[deleteTarget,load]);

  const bondTypes=[...new Set(calls.map(c=>c.bond_type).filter(Boolean))];
  const filtered=calls.filter(c=>{
    if(filterBond!=='all'&&c.bond_type!==filterBond)return false;
    if(filterOutcome==='successful'&&!c.call_successful)return false;
    if(filterOutcome==='unsuccessful'&&c.call_successful)return false;
    return true;
  });
  const now=new Date();
  const stats={
    total:calls.length,
    today:calls.filter(c=>{const d=new Date(c.created_at);return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate();}).length,
    successful:calls.filter(c=>c.call_successful).length,
    avgDur:calls.length?Math.round(calls.reduce((s,c)=>s+(c.duration_seconds||0),0)/calls.length):0,
  };

  return(
    <div className="page-wrap" style={{maxWidth:1300,margin:'0 auto'}}>
      <div className="page-header">
        <div>
          <div style={{fontSize:11,fontFamily:'monospace',letterSpacing:3,color:'var(--gold)',marginBottom:4}}>VOICE AGENT</div>
          <h1 style={{fontFamily:'"Bebas Neue",cursive',fontSize:36,letterSpacing:3,color:'white',margin:0}}>CALL LOGS</h1>
          <div className="gold-line" style={{width:64,marginTop:8}}/>
        </div>
        <div className="page-header-actions">
          <button onClick={()=>exportCSV(filtered)} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text-dim)',fontSize:12,cursor:'pointer'}}>
            <Download size={13}/>Export CSV
          </button>
          <button onClick={load} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text-dim)',fontSize:12,cursor:'pointer'}}>
            <RefreshCw size={13}/>Refresh
          </button>
        </div>
      </div>

      {error&&<div style={{background:'#3a1a1a',border:'1px solid #7f1d1d',color:'#f87171',borderRadius:8,padding:'8px 14px',marginBottom:16,fontSize:12}}>{error}</div>}

      <div className="r-grid-6" style={{marginBottom:20}}>
        {[
          {label:'Total Calls',value:stats.total,color:'#4C9AC9'},
          {label:'Today',value:stats.today,color:'#f59e0b'},
          {label:'Successful',value:stats.successful,color:'#4ade80'},
          {label:'Unsuccessful',value:stats.total-stats.successful,color:'#f87171'},
          {label:'Success Rate',value:stats.total?Math.round(stats.successful/stats.total*100)+'%':'—',color:'#a78bfa'},
          {label:'Avg Duration',value:fmtDur(stats.avgDur),color:'#94a3b8'},
        ].map(s=>(
          <div key={s.label} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,padding:'14px 16px',textAlign:'center'}}>
            <div style={{fontSize:26,fontWeight:700,color:s.color,fontFamily:'"Bebas Neue",cursive',letterSpacing:2}}>{s.value}</div>
            <div style={{fontSize:9,color:'var(--text-dim)',marginTop:2,fontFamily:'monospace',letterSpacing:1}}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div className="filter-row" style={{marginBottom:16}}>
        <select value={filterBond} onChange={e=>setFilterBond(e.target.value)}
          style={{padding:'8px 10px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'white',fontSize:11,minWidth:160}}>
          <option value="all">All Bond Types</option>
          {bondTypes.map(b=><option key={b} value={b}>{bondLabel(b)}</option>)}
        </select>
        <div style={{display:'flex',gap:4}}>
          {[{key:'all',label:'All'},{key:'successful',label:'Successful'},{key:'unsuccessful',label:'Unsuccessful'}].map(o=>(
            <button key={o.key} onClick={()=>setFilterOutcome(o.key)}
              style={{padding:'6px 12px',borderRadius:6,fontSize:11,cursor:'pointer',fontFamily:'monospace',
                background:filterOutcome===o.key?'var(--gold)':'var(--muted)',
                color:filterOutcome===o.key?'#000':'var(--text-dim)',
                border:'1px solid '+(filterOutcome===o.key?'var(--gold)':'var(--border)')}}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,overflow:'hidden'}}>
        <div style={{padding:'10px 16px',borderBottom:'1px solid var(--border)',fontSize:11,color:'var(--text-dim)',fontFamily:'monospace'}}>
          {loading?'Loading…':`${filtered.length} call${filtered.length!==1?'s':''}`}
        </div>
        {!loading&&filtered.length===0?(
          <div style={{padding:40,textAlign:'center',color:'var(--text-dim)',fontSize:13}}>No calls found.</div>
        ):(
          <div className="tbl-wrap">
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'var(--muted)'}}>
                  {['Date','Caller','Bond Type','Outcome','Sentiment','Duration','Summary','Recording',''].map(h=>(
                    <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10,color:'var(--text-dim)',fontFamily:'monospace',letterSpacing:1,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((call,i)=>{
                  const ss=SENTIMENT[call.user_sentiment]||SENTIMENT.Neutral;
                  const bc=BOND_COLOR[call.bond_type]||BOND_COLOR.general;
                  const isExp=expanded===call.id;
                  return(
                    <React.Fragment key={call.id}>
                      <tr onClick={()=>setExpanded(isExp?null:call.id)}
                        style={{borderTop:'1px solid var(--border)',background:i%2===0?'transparent':'rgba(255,255,255,0.01)',cursor:'pointer'}}>
                        <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                          <div style={{fontSize:12,color:'white'}}>{timeAgo(call.created_at)}</div>
                          <div style={{fontSize:10,color:'var(--text-dim)',marginTop:1,fontFamily:'monospace'}}>{fmtTime(call.created_at)}</div>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <PhoneIncoming size={12} style={{color:'var(--gold)',flexShrink:0}}/>
                            <span style={{fontSize:13,fontWeight:600,color:'white',fontFamily:'monospace'}}>{fmtPhone(call.from_number)}</span>
                          </div>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <span style={{fontSize:11,color:bc,fontWeight:600}}>{bondLabel(call.bond_type)}</span>
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          {call.call_successful
                            ?<span style={{display:'flex',alignItems:'center',gap:4,color:'#4ade80',fontSize:12}}><CheckCircle size={12}/>Successful</span>
                            :<span style={{display:'flex',alignItems:'center',gap:4,color:'#f87171',fontSize:12}}><XCircle size={12}/>Unsuccessful</span>}
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          {call.user_sentiment
                            ?<span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontFamily:'monospace',background:ss.bg,color:ss.color,border:'1px solid '+ss.border}}>{call.user_sentiment}</span>
                            :<span style={{color:'var(--text-dim)',fontSize:11}}>—</span>}
                        </td>
                        <td style={{padding:'10px 12px',fontSize:12,color:'var(--text-dim)',whiteSpace:'nowrap',fontFamily:'monospace'}}>{fmtDur(call.duration_seconds)}</td>
                        <td style={{padding:'10px 12px',fontSize:11,color:'var(--text-dim)',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                          {call.call_summary||<span style={{color:'#374151'}}>—</span>}
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          {call.recording_url
                            ?<a href={call.recording_url} target="_blank" rel="noopener noreferrer"
                                onClick={e=>e.stopPropagation()}
                                style={{display:'flex',alignItems:'center',gap:4,color:'var(--gold)',fontSize:11,textDecoration:'none'}}>
                                <Mic size={11}/>Listen
                              </a>
                            :<span style={{color:'#374151',fontSize:11}}>—</span>}
                        </td>
                        <td style={{padding:'10px 12px'}}>
                          <button onClick={e=>{e.stopPropagation();setDeleteTarget(call);}}
                            style={{display:'flex',alignItems:'center',gap:3,padding:'4px 8px',background:'#3a1a1a',border:'1px solid #7f1d1d',borderRadius:4,color:'#f87171',fontSize:10,cursor:'pointer'}}>
                            <Trash2 size={10}/>
                          </button>
                        </td>
                      </tr>
                      {isExp&&(
                        <tr style={{background:'rgba(245,158,11,0.04)',borderTop:'1px solid rgba(245,158,11,0.15)'}}>
                          <td colSpan={8} style={{padding:'12px 16px'}}>
                            <div style={{fontSize:10,fontFamily:'monospace',color:'var(--gold)',letterSpacing:2,marginBottom:6}}>CALL SUMMARY</div>
                            <div style={{fontSize:12,color:'#c9d1d9',lineHeight:1.6,maxWidth:900}}>{call.call_summary||'No summary available.'}</div>
                            {call.disconnection_reason&&(
                              <div style={{marginTop:8,fontSize:10,color:'var(--text-dim)',fontFamily:'monospace'}}>
                                Ended: {call.disconnection_reason.replace(/_/g,' ')} &middot; Cost: ${parseFloat(call.call_cost||0).toFixed(4)}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}}>
          <div style={{background:'var(--surface)',border:'1px solid #7f1d1d',borderRadius:10,padding:24,width:360,maxWidth:'90vw'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div style={{fontWeight:700,fontSize:14,color:'#f87171'}}>Delete Call Log?</div>
              <button onClick={()=>setDeleteTarget(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)'}}><X size={15}/></button>
            </div>
            <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:20,lineHeight:1.6}}>
              This will permanently delete the call from <strong style={{color:'white'}}>{fmtPhone(deleteTarget.from_number)}</strong> on {fmtTime(deleteTarget.created_at)}. This cannot be undone.
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setDeleteTarget(null)} style={{padding:'7px 16px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text-dim)',fontSize:12,cursor:'pointer'}}>Cancel</button>
              <button onClick={confirmDelete} disabled={deleting}
                style={{padding:'7px 16px',background:'#7f1d1d',border:'none',borderRadius:6,color:'#f87171',fontSize:12,fontWeight:600,cursor:'pointer',opacity:deleting?0.6:1}}>
                {deleting?'Deleting…':'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
