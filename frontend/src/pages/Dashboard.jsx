import React,{useEffect,useState} from 'react';
import {Users,Mail,Phone,TrendingUp,Bell,Play,Pause,Trash2,Plus,X,AlertTriangle,Clock,Send} from 'lucide-react';

const BAR_COLORS = ['#C9A84C','#4C9AC9','#4CC97A','#C94C9A','#9A4CC9','#4CC9C9','#C97A4C','#7AC94C'];

function BarChart({data,labelKey,valueKey,color='#C9A84C',height=120}) {
  if(!data?.length) return <div style={{height,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-dim)',fontSize:12}}>No data</div>;
  const max = Math.max(...data.map(d=>parseInt(d[valueKey]||0)));
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:4,height,paddingTop:8}}>
      {data.map((d,i)=>{
        const val = parseInt(d[valueKey]||0);
        const pct = max>0?(val/max)*100:0;
        return (
          <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2,height:'100%',justifyContent:'flex-end'}}>
            <div style={{fontSize:9,color:'var(--text-dim)',fontFamily:'monospace'}}>{val.toLocaleString()}</div>
            <div style={{width:'100%',background:color,borderRadius:'3px 3px 0 0',height:`${pct}%`,minHeight:2,opacity:0.85}}/>
            <div style={{fontSize:9,color:'var(--text-dim)',fontFamily:'monospace',textAlign:'center',overflow:'hidden',maxWidth:'100%',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>
              {(d[labelKey]||'').slice(0,6)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DonutChart({data,size=120}) {
  if(!data?.length) return null;
  const total = data.reduce((s,d)=>s+parseInt(d.count||0),0);
  let offset = 0;
  const r = 40, cx = 60, cy = 60, circ = 2*Math.PI*r;
  return (
    <div style={{display:'flex',alignItems:'center',gap:16}}>
      <svg width={size} height={size} viewBox="0 0 120 120">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--muted)" strokeWidth={18}/>
        {data.map((d,i)=>{
          const pct = parseInt(d.count||0)/total;
          const dash = pct*circ;
          const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={BAR_COLORS[i%BAR_COLORS.length]} strokeWidth={18}
            strokeDasharray={`${dash} ${circ-dash}`}
            strokeDashoffset={-offset*circ}
            style={{transform:'rotate(-90deg)',transformOrigin:'60px 60px'}}/>;
          offset += pct;
          return el;
        })}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" style={{fontSize:11,fill:'var(--text-dim)',fontFamily:'monospace'}}>
          {total.toLocaleString()}
        </text>
      </svg>
      <div style={{display:'flex',flexDirection:'column',gap:4}}>
        {data.slice(0,5).map((d,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--text-dim)'}}>
            <div style={{width:8,height:8,borderRadius:2,background:BAR_COLORS[i%BAR_COLORS.length],flexShrink:0}}/>
            <span style={{fontFamily:'monospace'}}>{(d.certification_type||d.status||'').slice(0,12)}</span>
            <span style={{color:'var(--text)',fontWeight:500}}>{parseInt(d.count||0).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats,setStats]=useState(null);
  const [analytics,setAnalytics]=useState(null);
  const [campaigns,setCampaigns]=useState([]);
  const [drips,setDrips]=useState([]);
  const [showDrip,setShowDrip]=useState(false);
  const [dripForm,setDripForm]=useState({name:'',contact_type:'notary',filters:{expiring:'90'},emails_per_day:100,subject:'',body:'',from_name:'Quantum Surety',from_email:'info@quantumsurety.bond'});
  const [alertSending,setAlertSending]=useState(false);
  const [alertResult,setAlertResult]=useState('');

  useEffect(()=>{
    fetch('/api/contacts/stats').then(r=>r.json()).then(setStats).catch(()=>{});
    fetch('/api/analytics').then(r=>r.json()).then(setAnalytics).catch(()=>{});
    fetch('/api/campaigns').then(r=>r.json()).then(setCampaigns).catch(()=>{});
    fetch('/api/drip').then(r=>r.json()).then(setDrips).catch(()=>{});
  },[]);

  const toggleDrip = async(id,status) => {
    await fetch(`/api/drip/${id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:status==='active'?'paused':'active'})});
    fetch('/api/drip').then(r=>r.json()).then(setDrips);
  };

  const deleteDrip = async(id) => {
    if(!confirm('Delete this drip schedule?')) return;
    await fetch(`/api/drip/${id}`,{method:'DELETE'});
    fetch('/api/drip').then(r=>r.json()).then(setDrips);
  };

  const saveDrip = async() => {
    await fetch('/api/drip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(dripForm)});
    setShowDrip(false);
    fetch('/api/drip').then(r=>r.json()).then(setDrips);
  };

  const sendAlert = async() => {
    setAlertSending(true);setAlertResult('');
    const r = await fetch('/api/drip/alert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to_email:'administrator@quantumsurety.bond'})});
    const j = await r.json();
    setAlertSending(false);
    setAlertResult(j.message||`Sent digest with ${j.count} notaries to ${j.sent_to}`);
  };

  const statCards = stats ? [
    {label:'Total Contacts',value:parseInt(stats.total||0).toLocaleString(),icon:Users,color:'#C9A84C'},
    {label:'With Email',value:parseInt(stats.with_email||0).toLocaleString(),icon:Mail,color:'#4C9AC9'},
    {label:'With Phone',value:parseInt(stats.with_phone||0).toLocaleString(),icon:Phone,color:'#4CC97A'},
    {label:'Campaigns',value:campaigns.length,icon:TrendingUp,color:'#C94C9A'},
  ] : [];

  return (
    <div style={{padding:'2rem',overflowY:'auto',height:'100%'}}>
      <div style={{marginBottom:'2rem'}}>
        <div style={{fontSize:11,fontFamily:'monospace',letterSpacing:3,color:'var(--gold)',marginBottom:4}}>OVERVIEW</div>
        <h1 style={{fontFamily:'"Bebas Neue",cursive',fontSize:36,letterSpacing:3,color:'white',margin:0}}>Dashboard</h1>
        <div className="gold-line" style={{width:96,marginTop:12}}/>
      </div>

      {/* Stat cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24}}>
        {statCards.map(({label,value,icon:Icon,color})=>(
          <div key={label} style={{borderRadius:12,padding:16,border:'1px solid var(--border)',background:'var(--surface)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <span style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)'}}>{label.toUpperCase()}</span>
              <Icon size={14} style={{color}}/>
            </div>
            <div style={{fontFamily:'"Bebas Neue",cursive',fontSize:28,letterSpacing:2,color}}>{value}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:24}}>
        {/* Contacts by state */}
        <div style={{borderRadius:12,padding:16,border:'1px solid var(--border)',background:'var(--surface)'}}>
          <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)',marginBottom:12}}>CONTACTS BY STATE</div>
          <BarChart data={analytics?.contractors_by_state} labelKey="state" valueKey="count" color="#C9A84C"/>
        </div>

        {/* Cert types donut */}
        <div style={{borderRadius:12,padding:16,border:'1px solid var(--border)',background:'var(--surface)'}}>
          <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)',marginBottom:12}}>CERTIFICATION TYPES</div>
          <DonutChart data={analytics?.cert_types}/>
        </div>

        {/* Notary expiry breakdown */}
        <div style={{borderRadius:12,padding:16,border:'1px solid var(--border)',background:'var(--surface)'}}>
          <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)',marginBottom:12}}>NOTARY EXPIRY PIPELINE</div>
          {analytics?.notary_expiry&&(
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {[
                {label:'Expired',val:analytics.notary_expiry.expired,color:'#6B6B8A'},
                {label:'90 days',val:analytics.notary_expiry.days_90,color:'#ef4444'},
                {label:'180 days',val:analytics.notary_expiry.days_180,color:'#f97316'},
                {label:'Future',val:analytics.notary_expiry.future,color:'#4CC97A'},
              ].map(({label,val,color})=>{
                const total = Object.values(analytics.notary_expiry).reduce((s,v)=>s+parseInt(v||0),0);
                const pct = total>0?Math.round((parseInt(val||0)/total)*100):0;
                return (
                  <div key={label}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
                      <span style={{color:'var(--text-dim)',fontFamily:'monospace'}}>{label}</span>
                      <span style={{color,fontFamily:'monospace'}}>{parseInt(val||0).toLocaleString()} ({pct}%)</span>
                    </div>
                    <div style={{height:4,background:'var(--muted)',borderRadius:2}}>
                      <div style={{height:'100%',width:`${pct}%`,background:color,borderRadius:2}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Email activity chart */}
      {analytics?.emails_sent_daily?.length>0&&(
        <div style={{borderRadius:12,padding:16,border:'1px solid var(--border)',background:'var(--surface)',marginBottom:24}}>
          <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)',marginBottom:12}}>EMAILS SENT — LAST 30 DAYS</div>
          <BarChart data={analytics.emails_sent_daily} labelKey="date" valueKey="count" color="#4C9AC9" height={100}/>
        </div>
      )}

      {/* Bottom row */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>

        {/* Drip schedules */}
        <div style={{borderRadius:12,border:'1px solid var(--border)',background:'var(--surface)',overflow:'hidden'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)'}}>DRIP SCHEDULES</div>
            <button onClick={()=>setShowDrip(true)}
              style={{display:'flex',alignItems:'center',gap:4,fontSize:11,padding:'4px 10px',borderRadius:6,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontWeight:600}}>
              <Plus size={11}/> New
            </button>
          </div>
          <div style={{padding:'8px 0'}}>
            {drips.length===0&&(
              <p style={{padding:'16px',fontSize:12,color:'var(--text-dim)',margin:0}}>No drip schedules. Create one to auto-send campaigns daily.</p>
            )}
            {drips.map(d=>(
              <div key={d.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 16px',borderBottom:'1px solid var(--border)'}}>
                <div>
                  <div style={{fontSize:13,color:'white',fontWeight:500}}>{d.name}</div>
                  <div style={{fontSize:10,fontFamily:'monospace',color:'var(--text-dim)',marginTop:2}}>
                    {d.emails_per_day}/day · {d.total_sent} sent · {d.contact_type}
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:10,fontFamily:'monospace',padding:'2px 6px',borderRadius:4,background:d.status==='active'?'#1a2e1a':'var(--muted)',color:d.status==='active'?'#4CC97A':'var(--text-dim)'}}>
                    {d.status}
                  </span>
                  <button onClick={()=>toggleDrip(d.id,d.status)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',padding:4}}>
                    {d.status==='active'?<Pause size={13}/>:<Play size={13}/>}
                  </button>
                  <button onClick={()=>deleteDrip(d.id)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',padding:4}}>
                    <Trash2 size={13}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts & recent activity */}
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {/* Daily alert */}
          <div style={{borderRadius:12,padding:16,border:'1px solid var(--border)',background:'var(--surface)'}}>
            <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)',marginBottom:12}}>DAILY ALERT</div>
            <p style={{fontSize:12,color:'var(--text-dim)',margin:'0 0 12px',lineHeight:1.6}}>
              Send yourself a daily digest of notaries expiring in 30 days — your hottest leads for the day.
            </p>
            {alertResult&&<p style={{fontSize:12,color:'#4CC97A',margin:'0 0 8px'}}>{alertResult}</p>}
            <button onClick={sendAlert} disabled={alertSending}
              style={{display:'flex',alignItems:'center',gap:6,fontSize:12,padding:'8px 16px',borderRadius:8,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontWeight:600,opacity:alertSending?0.5:1}}>
              <Bell size={13}/>{alertSending?'Sending...':'Send Today\'s Alert'}
            </button>
          </div>

          {/* Recent email events */}
          <div style={{borderRadius:12,padding:16,border:'1px solid var(--border)',background:'var(--surface)',flex:1}}>
            <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)',marginBottom:12}}>EMAIL ACTIVITY (7 DAYS)</div>
            {analytics?.recent_events?.length
              ? analytics.recent_events.map(e=>(
                <div key={e.event_type} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--border)',fontSize:12}}>
                  <span style={{fontFamily:'monospace',color:'var(--text-dim)'}}>{e.event_type}</span>
                  <span style={{color:'var(--gold)',fontFamily:'monospace'}}>{parseInt(e.count).toLocaleString()}</span>
                </div>
              ))
              : <p style={{fontSize:12,color:'var(--text-dim)',margin:0}}>No email activity yet. Send a campaign to see stats.</p>
            }
          </div>
        </div>
      </div>

      {/* Drip modal */}
      {showDrip&&(
        <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',padding:16,background:'rgba(0,0,0,0.85)'}}>
          <div style={{width:'100%',maxWidth:560,borderRadius:16,border:'1px solid var(--border)',background:'var(--surface)',display:'flex',flexDirection:'column',maxHeight:'90vh'}}>
            <div style={{padding:20,borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{fontFamily:'"Bebas Neue",cursive',fontSize:24,letterSpacing:3,color:'white'}}>New Drip Schedule</div>
              <button onClick={()=>setShowDrip(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)'}}><X size={18}/></button>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:20,display:'flex',flexDirection:'column',gap:14}}>
              <div style={{background:'var(--muted)',borderRadius:8,padding:12,fontSize:11,fontFamily:'monospace',color:'var(--text-dim)',lineHeight:1.8}}>
                Drip sends automatically every day at 1am. It skips unsubscribed contacts and contacts already sent this campaign.
                <br/>Variables: <span style={{color:'var(--gold)'}}>{'{{first_name}}'} {'{{expire_date}}'} {'{{surety_company}}'} {'{{unsubscribe_url}}'}</span>
              </div>
              {[['Schedule Name','name','text'],['Subject','subject','text'],['From Name','from_name','text'],['From Email','from_email','email']].map(([label,key,type])=>(
                <div key={key}>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,display:'block',marginBottom:6,color:'var(--text-dim)'}}>{label.toUpperCase()}</label>
                  <input type={type} value={dripForm[key]} onChange={e=>setDripForm(f=>({...f,[key]:e.target.value}))}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
              ))}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,display:'block',marginBottom:6,color:'var(--text-dim)'}}>CONTACT TYPE</label>
                  <select value={dripForm.contact_type} onChange={e=>setDripForm(f=>({...f,contact_type:e.target.value}))}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:13,outline:'none'}}>
                    <option value="notary">Notaries</option>
                    <option value="contractor">HUB/DBE Contractors</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,display:'block',marginBottom:6,color:'var(--text-dim)'}}>EMAILS PER DAY</label>
                  <input type="number" value={dripForm.emails_per_day} onChange={e=>setDripForm(f=>({...f,emails_per_day:parseInt(e.target.value)||100}))}
                    min={1} max={500}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
              </div>
              {dripForm.contact_type==='notary'&&(
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,display:'block',marginBottom:6,color:'var(--text-dim)'}}>EXPIRY FILTER</label>
                  <select value={dripForm.filters?.expiring||''} onChange={e=>setDripForm(f=>({...f,filters:{...f.filters,expiring:e.target.value}}))}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:13,outline:'none'}}>
                    <option value="">All notaries</option>
                    <option value="90">Expiring within 90 days</option>
                    <option value="180">Expiring within 180 days</option>
                    <option value="expired">Already expired</option>
                  </select>
                </div>
              )}
              <div>
                <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,display:'block',marginBottom:6,color:'var(--text-dim)'}}>EMAIL BODY (HTML)</label>
                <textarea value={dripForm.body} onChange={e=>setDripForm(f=>({...f,body:e.target.value}))} rows={8}
                  style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:11,outline:'none',resize:'vertical',fontFamily:'monospace',boxSizing:'border-box'}}/>
              </div>
            </div>
            <div style={{padding:20,borderTop:'1px solid var(--border)',display:'flex',gap:12,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowDrip(false)} style={{padding:'8px 16px',borderRadius:8,background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',fontSize:13}}>Cancel</button>
              <button onClick={saveDrip} disabled={!dripForm.name||!dripForm.subject||!dripForm.body}
                style={{padding:'8px 20px',borderRadius:8,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:13,fontWeight:600}}>
                Save Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
