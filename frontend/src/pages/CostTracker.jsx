import React,{useState,useEffect} from 'react';
import {DollarSign,Plus,Settings,ChevronDown,ChevronUp,Mail,Phone,Server,Globe,Database,Cpu,HelpCircle,Trash2,TrendingUp} from 'lucide-react';

const ICONS={ses:Mail,retellai:Phone,zohomail:Mail,claude:Cpu,vps:Server,neon:Database,domain:Globe,cloudflare:Globe,other:HelpCircle};
const COLORS={ses:'#4C9AC9',retellai:'#7C3AED',zohomail:'#E8445A',claude:'#D97706',vps:'#059669',neon:'#0EA5E9',domain:'#6366F1',cloudflare:'#F97316',other:'#6B7280'};
const MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmt(n){return '$'+(+(n||0)).toFixed(2);}
function mn(m){return MONTH_NAMES[(m||1)-1];}

function buildRows(monthData){
  if(!monthData) return[];
  const {entries=[],rates=[],auto={}}=monthData;
  const logged={};
  entries.forEach(e=>{logged[e.service_key]=e;});
  const rows=[];
  rates.forEach(r=>{
    const entry=logged[r.service_key];
    let actual=entry&&entry.actual_amount!=null?parseFloat(entry.actual_amount):null;
    let estUnits=null,estCost=null;
    if(r.service_key==='ses'){estUnits=auto.ses_emails;estCost=(auto.ses_est_cost||0)+parseFloat(r.monthly_flat||0);}
    else if(r.service_key==='retellai'){estUnits=auto.voice_minutes;estCost=(auto.voice_est_cost||0)+parseFloat(r.monthly_flat||0);}
    else if(parseFloat(r.monthly_flat)>0){estCost=parseFloat(r.monthly_flat);}
    const units=entry?.units_consumed!=null?parseFloat(entry.units_consumed):estUnits;
    const amount=actual!=null?actual:(estCost||0);
    if(amount===0&&!entry) return;
    rows.push({key:r.service_key,label:r.display_name,actual,estCost,amount,units,unit_label:r.unit_label,notes:entry?.notes,isAuto:actual===null});
  });
  return rows.sort((a,b)=>b.amount-a.amount);
}

function monthTotal(monthData){
  if(!monthData) return 0;
  const rows=buildRows(monthData);
  return rows.reduce((s,r)=>s+r.amount,0);
}

function monthColor(total){
  if(total>150) return'#EF4444';
  if(total>50) return'#F59E0B';
  return'#10B981';
}

export default function CostTracker(){
  const[summary,setSummary]=useState([]);
  const[loading,setLoading]=useState(true);
  const[showRates,setShowRates]=useState(false);
  const[showLog,setShowLog]=useState(false);
  const[saving,setSaving]=useState(false);
  const[editRate,setEditRate]=useState(null);
  const now=new Date();
  const[activeMo,setActiveMo]=useState({year:now.getFullYear(),month:now.getMonth()+1});
  const[logForm,setLogForm]=useState({service_key:'vps',year:now.getFullYear(),month:now.getMonth()+1,actual_amount:'',units_consumed:'',notes:''});

  async function load(){
    setLoading(true);
    try{
      const r=await fetch('/api/costs/summary?months=6');
      const d=await r.json();
      setSummary(Array.isArray(d)?d:[]);
    }catch(e){console.error(e);}
    setLoading(false);
  }
  useEffect(()=>{load();},[]);

  async function saveEntry(){
    setSaving(true);
    await fetch('/api/costs/entry',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...logForm,actual_amount:logForm.actual_amount!==''?parseFloat(logForm.actual_amount):null,units_consumed:logForm.units_consumed!==''?parseFloat(logForm.units_consumed):null})});
    setSaving(false);setShowLog(false);load();
  }
  async function deleteEntry(key,y,m){
    if(!confirm('Remove this logged entry?')) return;
    await fetch(`/api/costs/entry/${key}/${y}/${m}`,{method:'DELETE'});
    load();
  }
  async function saveRate(){
    setSaving(true);
    await fetch(`/api/costs/rates/${editRate.service_key}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(editRate)});
    setSaving(false);setEditRate(null);load();
  }

  const currentMo=summary.find(m=>m.year===activeMo.year&&m.month===activeMo.month);
  const serviceRows=buildRows(currentMo);
  const currentTotal=monthTotal(currentMo);
  const sixMonthTotal=summary.reduce((s,m)=>s+monthTotal(m),0);

  // Projection for current month
  let projected=currentTotal;
  if(currentMo&&currentMo.days_elapsed<currentMo.days_in_month){
    const frac=currentMo.days_in_month/currentMo.days_elapsed;
    // scale only usage-based auto items
    const usageAmt=(currentMo.auto?.ses_est_cost||0)+(currentMo.auto?.voice_est_cost||0);
    const flatAmt=currentTotal-usageAmt;
    projected=Math.round((flatAmt+usageAmt*frac)*100)/100;
  }

  const allRates=currentMo?.rates||[];
  const isCurrentMonth=activeMo.year===now.getFullYear()&&activeMo.month===now.getMonth()+1;

  return(
    <div style={{padding:'24px 28px',color:'white',maxWidth:1100,margin:'0 auto'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <div style={{fontSize:10,letterSpacing:4,color:'var(--gold)',fontFamily:'monospace',marginBottom:2}}>QUANTUM SURETY</div>
          <div style={{fontFamily:'"Bebas Neue",cursive',fontSize:34,letterSpacing:3,lineHeight:1}}>COST TRACKER</div>
          <div style={{fontSize:12,color:'var(--text-dim)',marginTop:6}}>Monthly operational spend — SES, voice, hosting, and more</div>
        </div>
        <div style={{display:'flex',gap:8,marginTop:4}}>
          <button onClick={()=>{setLogForm({service_key:'vps',year:now.getFullYear(),month:now.getMonth()+1,actual_amount:'',units_consumed:'',notes:''});setShowLog(true);}}
            style={{display:'flex',alignItems:'center',gap:6,background:'var(--gold)',color:'#0A0A0F',border:'none',borderRadius:8,padding:'9px 16px',fontWeight:700,fontSize:13,cursor:'pointer'}}>
            <Plus size={14}/>Log Cost
          </button>
          <button onClick={()=>setShowRates(v=>!v)}
            style={{display:'flex',alignItems:'center',gap:6,background:'var(--muted)',color:'var(--text-dim)',border:'1px solid var(--border)',borderRadius:8,padding:'9px 14px',fontSize:13,cursor:'pointer'}}>
            <Settings size={13}/>{showRates?<ChevronUp size={11}/>:<ChevronDown size={11}/>}
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24}}>
        {[
          {label:'Current Month',value:fmt(currentTotal),sub:isCurrentMonth?`Day ${now.getDate()} of ${currentMo?.days_in_month||30}`:'Selected month',color:'var(--gold)'},
          {label:'Projected Month End',value:fmt(projected),sub:'Usage extrapolated',color:projected>150?'#EF4444':projected>75?'#F59E0B':'#10B981'},
          {label:'6-Month Total',value:fmt(sixMonthTotal),sub:'All services',color:'#4C9AC9'},
          {label:'Emails This Month',value:(currentMo?.auto?.ses_emails||0).toLocaleString(),sub:`Est. ${fmt(currentMo?.auto?.ses_est_cost||0)} SES cost`,color:'#059669'},
        ].map(s=>(
          <div key={s.label} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontSize:10,color:'var(--text-dim)',letterSpacing:2,marginBottom:8}}>{s.label.toUpperCase()}</div>
            <div style={{fontSize:26,fontWeight:700,color:s.color,lineHeight:1}}>{s.value}</div>
            <div style={{fontSize:11,color:'var(--text-dim)',marginTop:6}}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Monthly Calendar Cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:8,marginBottom:24}}>
        {loading?[...Array(6)].map((_,i)=>(
          <div key={i} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,padding:'14px 10px',textAlign:'center',opacity:.4}}>
            <div style={{height:10,background:'var(--muted)',borderRadius:4,marginBottom:8}}/>
            <div style={{height:20,background:'var(--muted)',borderRadius:4}}/>
          </div>
        )):summary.map(m=>{
          const total=monthTotal(m);
          const isActive=activeMo.year===m.year&&activeMo.month===m.month;
          const isCurr=m.year===now.getFullYear()&&m.month===now.getMonth()+1;
          const col=monthColor(total);
          return(
            <button key={`${m.year}-${m.month}`} onClick={()=>setActiveMo({year:m.year,month:m.month})}
              style={{background:isActive?'rgba(212,175,55,0.08)':'var(--surface)',border:`1px solid ${isActive?'var(--gold)':'var(--border)'}`,borderRadius:10,padding:'12px 6px',cursor:'pointer',textAlign:'center',transition:'all 0.15s',position:'relative'}}>
              {isCurr&&<div style={{position:'absolute',top:4,right:6,width:6,height:6,borderRadius:'50%',background:'var(--gold)'}}/>}
              <div style={{fontSize:11,color:isCurr?'var(--gold)':'var(--text-dim)',fontWeight:isCurr?700:400,marginBottom:4}}>{mn(m.month)}</div>
              <div style={{fontSize:19,fontWeight:700,color:col,marginBottom:4}}>{fmt(total)}</div>
              <div style={{fontSize:10,color:'var(--text-dim)'}}>{m.entries?.length||0} logged</div>
            </button>
          );
        })}
      </div>

      {/* Service Breakdown */}
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:20}}>
        <div style={{padding:'14px 20px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontWeight:700,fontSize:14}}>
            {mn(activeMo.month)} {activeMo.year}
            {isCurrentMonth&&<span style={{marginLeft:10,fontSize:11,color:'var(--gold)',fontWeight:500,background:'rgba(212,175,55,0.1)',padding:'2px 8px',borderRadius:10}}>CURRENT</span>}
          </div>
          <div style={{fontSize:14,fontWeight:700,color:'var(--gold)'}}>{fmt(currentTotal)}</div>
        </div>
        {serviceRows.length===0&&!loading?(
          <div style={{padding:'28px 20px',textAlign:'center',color:'var(--text-dim)',fontSize:13}}>
            No costs yet for this month.{' '}
            <button onClick={()=>setShowLog(true)} style={{color:'var(--gold)',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:600}}>Log an actual cost</button>
            {' '}or configure flat rates below.
          </div>
        ):(
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                {['Service','Amount','Units','Source','Notes',''].map(h=>(
                  <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,letterSpacing:2,color:'var(--text-dim)',fontWeight:600}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {serviceRows.map(row=>{
                const Icon=ICONS[row.key]||HelpCircle;
                const col=COLORS[row.key]||'#6B7280';
                return(
                  <tr key={row.key} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                    <td style={{padding:'11px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:28,height:28,borderRadius:6,background:`${col}22`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <Icon size={13} color={col}/>
                        </div>
                        <span style={{fontSize:13,fontWeight:500}}>{row.label}</span>
                      </div>
                    </td>
                    <td style={{padding:'11px 14px',fontWeight:700,color:row.isAuto?'#94a3b8':'white',fontSize:14}}>{fmt(row.amount)}</td>
                    <td style={{padding:'11px 14px',fontSize:12,color:'var(--text-dim)'}}>
                      {row.units!=null?`${Number(row.units).toLocaleString()} ${row.unit_label||''}`.trim():'—'}
                    </td>
                    <td style={{padding:'11px 14px'}}>
                      <span style={{fontSize:10,padding:'3px 8px',borderRadius:10,letterSpacing:1,
                        background:row.isAuto?'rgba(148,163,184,0.12)':'rgba(212,175,55,0.15)',
                        color:row.isAuto?'#94a3b8':'var(--gold)'}}>
                        {row.isAuto?'AUTO-EST':'LOGGED'}
                      </span>
                    </td>
                    <td style={{padding:'11px 14px',fontSize:12,color:'var(--text-dim)',maxWidth:180}}>{row.notes||'—'}</td>
                    <td style={{padding:'11px 14px'}}>
                      {!row.isAuto&&(
                        <button onClick={()=>deleteEntry(row.key,activeMo.year,activeMo.month)}
                          style={{background:'none',border:'none',cursor:'pointer',color:'#6B7280',padding:4}}
                          title="Remove logged entry">
                          <Trash2 size={13}/>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{borderTop:'1px solid var(--border)',background:'rgba(255,255,255,0.02)'}}>
                <td style={{padding:'11px 14px',fontWeight:700,fontSize:13}}>TOTAL</td>
                <td style={{padding:'11px 14px',fontWeight:700,color:'var(--gold)',fontSize:15}}>{fmt(currentTotal)}</td>
                <td colSpan={4}/>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Rates Config */}
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:20}}>
        <button onClick={()=>setShowRates(v=>!v)}
          style={{width:'100%',background:'none',border:'none',cursor:'pointer',padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',color:'white'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <Settings size={14} color="var(--text-dim)"/>
            <span style={{fontSize:13,fontWeight:600}}>Configure Service Rates</span>
            <span style={{fontSize:11,color:'var(--text-dim)'}}>— set flat fees and per-unit rates for auto-estimation</span>
          </div>
          {showRates?<ChevronUp size={14} color="var(--text-dim)"/>:<ChevronDown size={14} color="var(--text-dim)"/>}
        </button>
        {showRates&&(
          <div style={{borderTop:'1px solid var(--border)'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--border)'}}>
                  {['Service','$/Unit','Unit','Monthly Flat','Notes',''].map(h=>(
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,letterSpacing:2,color:'var(--text-dim)',fontWeight:600}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allRates.map(r=>{
                  const isEditing=editRate?.service_key===r.service_key;
                  const inp={width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'white',padding:'5px 8px',fontSize:12};
                  return(
                    <tr key={r.service_key} style={{borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                      <td style={{padding:'9px 14px',fontSize:13,fontWeight:500}}>{r.display_name}</td>
                      {isEditing?(
                        <>
                          <td style={{padding:'6px 14px'}}><input type="number" step="0.0001" value={editRate.rate_per_unit} onChange={e=>setEditRate(v=>({...v,rate_per_unit:e.target.value}))} style={{...inp,width:70}}/></td>
                          <td style={{padding:'6px 14px',fontSize:12,color:'var(--text-dim)'}}>{r.unit_label||'—'}</td>
                          <td style={{padding:'6px 14px'}}><input type="number" step="0.01" value={editRate.monthly_flat} onChange={e=>setEditRate(v=>({...v,monthly_flat:e.target.value}))} style={{...inp,width:80}}/></td>
                          <td style={{padding:'6px 14px'}}><input value={editRate.notes||''} onChange={e=>setEditRate(v=>({...v,notes:e.target.value}))} style={{...inp,width:180}}/></td>
                          <td style={{padding:'6px 14px',display:'flex',gap:6}}>
                            <button onClick={saveRate} disabled={saving} style={{background:'var(--gold)',color:'#0A0A0F',border:'none',borderRadius:6,padding:'5px 12px',cursor:'pointer',fontSize:12,fontWeight:700}}>Save</button>
                            <button onClick={()=>setEditRate(null)} style={{background:'var(--muted)',color:'var(--text-dim)',border:'1px solid var(--border)',borderRadius:6,padding:'5px 8px',cursor:'pointer',fontSize:12}}>✕</button>
                          </td>
                        </>
                      ):(
                        <>
                          <td style={{padding:'9px 14px',fontSize:12,color:'var(--text-dim)'}}>{parseFloat(r.rate_per_unit)>0?`$${parseFloat(r.rate_per_unit)}`:'—'}</td>
                          <td style={{padding:'9px 14px',fontSize:12,color:'var(--text-dim)'}}>{r.unit_label||'—'}</td>
                          <td style={{padding:'9px 14px',fontSize:12,color:parseFloat(r.monthly_flat)>0?'white':'var(--text-dim)'}}>{parseFloat(r.monthly_flat)>0?fmt(r.monthly_flat):'—'}</td>
                          <td style={{padding:'9px 14px',fontSize:12,color:'var(--text-dim)',maxWidth:220}}>{r.notes||'—'}</td>
                          <td style={{padding:'9px 14px'}}>
                            <button onClick={()=>setEditRate({...r})} style={{background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'4px 10px',cursor:'pointer',color:'var(--text-dim)',fontSize:11}}>Edit</button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{padding:'12px 20px',borderTop:'1px solid var(--border)',fontSize:11,color:'var(--text-dim)'}}>
              Auto-estimated: SES from send DB, Retell AI from voice agent call logs. Log actuals to override estimates.
            </div>
          </div>
        )}
      </div>

      {/* Log Cost Modal */}
      {showLog&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}>
          <div style={{background:'#13131A',border:'1px solid var(--border)',borderRadius:16,padding:28,width:420,maxWidth:'90vw',boxShadow:'0 20px 60px rgba(0,0,0,0.5)'}}>
            <div style={{fontWeight:700,fontSize:16,marginBottom:18}}>Log Actual Cost</div>
            <div style={{display:'grid',gap:12}}>
              <div>
                <label style={{fontSize:10,color:'var(--text-dim)',letterSpacing:2,display:'block',marginBottom:4}}>SERVICE</label>
                <select value={logForm.service_key} onChange={e=>setLogForm(v=>({...v,service_key:e.target.value}))}
                  style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:8,color:'white',padding:'9px 12px',fontSize:13}}>
                  {allRates.map(r=><option key={r.service_key} value={r.service_key}>{r.display_name}</option>)}
                </select>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{fontSize:10,color:'var(--text-dim)',letterSpacing:2,display:'block',marginBottom:4}}>YEAR</label>
                  <input type="number" value={logForm.year} onChange={e=>setLogForm(v=>({...v,year:parseInt(e.target.value)}))}
                    style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:8,color:'white',padding:'9px 12px',fontSize:13}}/>
                </div>
                <div>
                  <label style={{fontSize:10,color:'var(--text-dim)',letterSpacing:2,display:'block',marginBottom:4}}>MONTH</label>
                  <select value={logForm.month} onChange={e=>setLogForm(v=>({...v,month:parseInt(e.target.value)}))}
                    style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:8,color:'white',padding:'9px 12px',fontSize:13}}>
                    {MONTH_NAMES.map((name,i)=><option key={i+1} value={i+1}>{name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{fontSize:10,color:'var(--text-dim)',letterSpacing:2,display:'block',marginBottom:4}}>ACTUAL AMOUNT ($)</label>
                <input type="number" step="0.01" placeholder="0.00" value={logForm.actual_amount}
                  onChange={e=>setLogForm(v=>({...v,actual_amount:e.target.value}))}
                  style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:8,color:'white',padding:'9px 12px',fontSize:13}}/>
              </div>
              <div>
                <label style={{fontSize:10,color:'var(--text-dim)',letterSpacing:2,display:'block',marginBottom:4}}>UNITS CONSUMED <span style={{color:'var(--text-dim)',fontWeight:400}}>(optional)</span></label>
                <input type="number" placeholder="e.g. 1420 emails or 38 minutes"
                  value={logForm.units_consumed} onChange={e=>setLogForm(v=>({...v,units_consumed:e.target.value}))}
                  style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:8,color:'white',padding:'9px 12px',fontSize:13}}/>
              </div>
              <div>
                <label style={{fontSize:10,color:'var(--text-dim)',letterSpacing:2,display:'block',marginBottom:4}}>NOTES</label>
                <input placeholder="e.g. from AWS billing console" value={logForm.notes}
                  onChange={e=>setLogForm(v=>({...v,notes:e.target.value}))}
                  style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:8,color:'white',padding:'9px 12px',fontSize:13}}/>
              </div>
            </div>
            <div style={{display:'flex',gap:10,marginTop:20}}>
              <button onClick={saveEntry} disabled={saving}
                style={{flex:1,background:'var(--gold)',color:'#0A0A0F',border:'none',borderRadius:8,padding:'11px',fontWeight:700,fontSize:13,cursor:'pointer'}}>
                {saving?'Saving…':'Save Entry'}
              </button>
              <button onClick={()=>setShowLog(false)}
                style={{padding:'11px 16px',background:'var(--muted)',color:'var(--text-dim)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
