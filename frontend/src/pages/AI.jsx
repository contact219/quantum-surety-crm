import React,{useState} from 'react';
import {Sparkles,TrendingUp,Mail,MessageSquare,Shield,BarChart2,Target,Users,AlertCircle,Bell,Zap,Copy,Check,ChevronDown,ChevronUp} from 'lucide-react';
import {apiFetch} from '../auth.js';

const FEATURES = [
  {id:'score',icon:TrendingUp,label:'Lead Scorer',color:'#C9A84C',desc:'Score any contact 1-100 for conversion likelihood'},
  {id:'generate',icon:Sparkles,label:'Campaign Generator',color:'#4C9AC9',desc:'Generate complete email campaigns from a brief'},
  {id:'subject',icon:Target,label:'Subject Optimizer',color:'#4CC97A',desc:'Generate 10 optimized subject line variants'},
  {id:'objection',icon:MessageSquare,label:'Objection Handler',color:'#C94C9A',desc:'Draft perfect responses to customer objections'},
  {id:'reply',icon:Mail,label:'Reply Classifier',color:'#9A4CC9',desc:'Classify and prioritize email replies'},
  {id:'intelligence',icon:BarChart2,label:'Market Intelligence',color:'#4CC9C9',desc:'AI analysis of your entire market opportunity'},
  {id:'enrich',icon:Users,label:'Contact Enricher',color:'#C97A4C',desc:'Enrich sparse contractor profiles with AI insights'},
  {id:'unsubscribe',icon:AlertCircle,label:'Unsubscribe Analyzer',color:'#ef4444',desc:'Analyze patterns in unsubscribes'},
  {id:'briefing',icon:Bell,label:'Daily Briefing',color:'#f97316',desc:'Send AI-written daily briefing to your email'},
  {id:'bulk-score',icon:Zap,label:'Bulk Lead Scoring',color:'#C9A84C',desc:'Score your top 20 hottest leads automatically'},
];

function CopyBtn({text}) {
  const [copied,setCopied]=useState(false);
  return (
    <button onClick={()=>{navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),2000);}}
      style={{padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text-dim)',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
      {copied?<><Check size={11}/>Copied</>:<><Copy size={11}/>Copy</>}
    </button>
  );
}

function ResultBox({data,loading}) {
  const [expanded,setExpanded]=useState(true);
  if(loading) return <div style={{padding:24,textAlign:'center',color:'var(--text-dim)',fontSize:13}}>
    <div style={{marginBottom:8}}>🤖 Claude is thinking...</div>
    <div style={{fontSize:11,fontFamily:'monospace'}}>Analyzing with claude-sonnet-4-5</div>
  </div>;
  if(!data) return null;
  const text = typeof data === 'string' ? data : JSON.stringify(data,null,2);
  return (
    <div style={{borderTop:'1px solid var(--border)',marginTop:16}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0 8px'}}>
        <span style={{fontSize:11,fontFamily:'monospace',color:'var(--gold)'}}>AI RESPONSE</span>
        <div style={{display:'flex',gap:8}}>
          <CopyBtn text={text}/>
          <button onClick={()=>setExpanded(e=>!e)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)'}}>
            {expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
          </button>
        </div>
      </div>
      {expanded&&(
        typeof data === 'object' ? (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {/* Subject line highlight */}
            {data.subject&&<div style={{padding:12,borderRadius:8,background:'rgba(201,168,76,0.1)',border:'1px solid rgba(201,168,76,0.3)'}}>
              <div style={{fontSize:10,fontFamily:'monospace',color:'var(--gold)',marginBottom:4}}>SUBJECT LINE</div>
              <div style={{color:'white',fontWeight:500}}>{data.subject}</div>
              {data.preview&&<div style={{fontSize:12,color:'var(--text-dim)',marginTop:4}}>{data.preview}</div>}
            </div>}
            {/* Score highlight */}
            {data.score!==undefined&&<div style={{display:'flex',gap:16,alignItems:'center'}}>
              <div style={{width:72,height:72,borderRadius:'50%',border:`4px solid ${data.score>=70?'#4CC97A':data.score>=40?'#f97316':'#ef4444'}`,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column'}}>
                <div style={{fontSize:22,fontWeight:700,color:'white'}}>{data.score}</div>
                <div style={{fontSize:9,color:'var(--text-dim)'}}>/ 100</div>
              </div>
              <div>
                <div style={{color:'white',fontSize:14,fontWeight:500,marginBottom:4}}>{data.action}</div>
                <div style={{color:'var(--text-dim)',fontSize:13}}>{data.reason}</div>
              </div>
            </div>}
            {/* Alt subjects */}
            {data.alt_subjects&&<div>
              <div style={{fontSize:10,fontFamily:'monospace',color:'var(--text-dim)',marginBottom:8}}>ALTERNATIVE SUBJECTS</div>
              {data.alt_subjects.map((s,i)=><div key={i} style={{padding:'6px 10px',borderRadius:6,background:'var(--muted)',marginBottom:4,fontSize:13,color:'var(--text)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>{s}</span><CopyBtn text={s}/>
              </div>)}
            </div>}
            {/* Variations for subject optimizer */}
            {data.variations&&<div>
              {data.variations.map((v,i)=><div key={i} style={{padding:10,borderRadius:8,border:'1px solid var(--border)',marginBottom:8,background:'var(--muted)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                  <span style={{color:'white',fontSize:13,fontWeight:500}}>{v.subject}</span>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span style={{fontSize:11,fontFamily:'monospace',color:'#4CC97A'}}>{v.predicted_open_rate}</span>
                    <CopyBtn text={v.subject}/>
                  </div>
                </div>
                <div style={{fontSize:11,color:'var(--text-dim)'}}>{v.trigger} · {v.explanation}</div>
              </div>)}
            </div>}
            {/* Opportunities for market intel */}
            {data.opportunities&&<div>
              {data.opportunities.map((o,i)=><div key={i} style={{padding:12,borderRadius:8,border:'1px solid var(--border)',marginBottom:8,background:'var(--muted)'}}>
                <div style={{color:'var(--gold)',fontWeight:500,marginBottom:4}}>{o.title}</div>
                <div style={{color:'var(--text)',fontSize:13,marginBottom:4}}>{o.description}</div>
                <div style={{display:'flex',gap:16,fontSize:12}}>
                  <span style={{color:'#4CC97A'}}>💰 {o.potential_revenue}</span>
                  <span style={{color:'var(--text-dim)'}}>→ {o.action}</span>
                </div>
              </div>)}
              {data.monthly_revenue_potential&&<div style={{padding:12,borderRadius:8,background:'rgba(76,201,122,0.1)',border:'1px solid rgba(76,201,122,0.3)',fontSize:14,color:'#4CC97A',fontWeight:500}}>
                📊 Monthly Revenue Potential: {data.monthly_revenue_potential}
              </div>}
            </div>}
            {/* Classification result */}
            {data.classification&&<div style={{padding:12,borderRadius:8,background:'var(--muted)',border:'1px solid var(--border)'}}>
              <div style={{display:'flex',gap:12,marginBottom:8}}>
                <span style={{padding:'4px 10px',borderRadius:6,fontSize:12,fontWeight:600,
                  background:data.classification==='INTERESTED'?'rgba(76,201,122,0.2)':data.classification==='NOT_INTERESTED'?'rgba(239,68,68,0.2)':'rgba(107,107,138,0.2)',
                  color:data.classification==='INTERESTED'?'#4CC97A':data.classification==='NOT_INTERESTED'?'#ef4444':'var(--text-dim)'}}>
                  {data.classification}
                </span>
                <span style={{padding:'4px 10px',borderRadius:6,fontSize:12,background:'var(--surface)',color:data.priority==='HIGH'?'#ef4444':data.priority==='MEDIUM'?'#f97316':'var(--text-dim)'}}>
                  {data.priority} PRIORITY
                </span>
              </div>
              {data.suggested_response&&<div>
                <div style={{fontSize:10,fontFamily:'monospace',color:'var(--text-dim)',marginBottom:4}}>SUGGESTED RESPONSE</div>
                <div style={{color:'var(--text)',fontSize:13,lineHeight:1.6}}>{data.suggested_response}</div>
              </div>}
            </div>}
            {/* HTML preview for campaign/personalize */}
            {(data.html||data.response)&&<div>
              <div style={{fontSize:10,fontFamily:'monospace',color:'var(--text-dim)',marginBottom:6}}>EMAIL PREVIEW</div>
              <div style={{borderRadius:8,border:'1px solid var(--border)',overflow:'auto',background:'white',maxHeight:300}}
                dangerouslySetInnerHTML={{__html:data.html||data.response}}/>
              <div style={{marginTop:8,display:'flex',gap:8}}>
                <CopyBtn text={data.html||data.response}/>
              </div>
            </div>}
            {/* Raw JSON for everything else */}
            {!data.subject&&!data.score&&!data.variations&&!data.opportunities&&!data.classification&&!data.html&&!data.response&&(
              <pre style={{fontSize:11,fontFamily:'monospace',color:'var(--text)',background:'var(--muted)',padding:12,borderRadius:8,overflow:'auto',maxHeight:300,margin:0}}>
                {JSON.stringify(data,null,2)}
              </pre>
            )}
          </div>
        ) : (
          <pre style={{fontSize:12,fontFamily:'monospace',color:'var(--text)',background:'var(--muted)',padding:12,borderRadius:8,overflow:'auto',maxHeight:300,margin:0,whiteSpace:'pre-wrap'}}>
            {text}
          </pre>
        )
      )}
    </div>
  );
}

export default function AI() {
  const [active,setActive]=useState('generate');
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);
  const [error,setError]=useState('');

  // Form states
  const [generateForm,setGenerateForm]=useState({brief:'',contact_type:'notary',tone:'professional but urgent'});
  const [scoreForm,setScoreForm]=useState({first_name:'',city:'Houston',state:'TX',expire_date:'',surety_company:'Western Surety Company c/o CNA',contact_type:'notary',email:'test@example.com'});
  const [subjectForm,setSubjectForm]=useState({subject:'',contact_type:'notary',campaign_goal:'maximize open rate'});
  const [objectionForm,setObjectionForm]=useState({objection:'',contact_name:'',contact_type:'notary'});
  const [replyForm,setReplyForm]=useState({reply_text:'',contact_email:''});
  const [enrichForm,setEnrichForm]=useState({company_name:'',city:'',state:'TX',certification_type:'HUB',naics_codes:''});

  const call = async(endpoint, body) => {
    setLoading(true);setResult(null);setError('');
    try {
      const r = await apiFetch(`/api/ai/${endpoint}`,{method:'POST',body:JSON.stringify(body)});
      const j = await r.json();
      if(j.error) setError(j.error);
      else setResult(j);
    } catch(e){ setError(e.message); }
    setLoading(false);
  };

  const feature = FEATURES.find(f=>f.id===active);

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden'}}>
      {/* Feature list sidebar */}
      <div style={{width:220,flexShrink:0,borderRight:'1px solid var(--border)',background:'var(--surface)',overflowY:'auto',padding:'16px 8px'}}>
        <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:3,color:'var(--gold)',padding:'0 8px 12px'}}>AI FEATURES</div>
        {FEATURES.map(f=>(
          <button key={f.id} onClick={()=>{setActive(f.id);setResult(null);setError('');}}
            style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:8,border:'none',cursor:'pointer',textAlign:'left',marginBottom:2,
              background:active===f.id?'var(--muted)':'transparent',
              borderLeft:active===f.id?`2px solid ${f.color}`:'2px solid transparent'}}>
            <f.icon size={14} style={{color:f.color,flexShrink:0}}/>
            <div>
              <div style={{fontSize:12,fontWeight:500,color:active===f.id?'white':'var(--text-dim)'}}>{f.label}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Main content */}
      <div style={{flex:1,overflowY:'auto',padding:32}}>
        <div style={{maxWidth:720}}>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}>
            {feature&&<feature.icon size={20} style={{color:feature.color}}/>}
            <h1 style={{fontFamily:'"Bebas Neue",cursive',fontSize:32,letterSpacing:3,color:'white',margin:0}}>{feature?.label}</h1>
          </div>
          <p style={{color:'var(--text-dim)',fontSize:13,marginBottom:24,marginTop:0}}>{feature?.desc}</p>

          {/* Forms */}
          {active==='generate'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>CAMPAIGN BRIEF</label>
                <textarea value={generateForm.brief} onChange={e=>setGenerateForm(f=>({...f,brief:e.target.value}))} rows={3}
                  placeholder="e.g. Target Houston notaries with Western Surety bonds expiring in 60 days, emphasize same-day renewal..."
                  style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none',resize:'vertical',boxSizing:'border-box'}}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>CONTACT TYPE</label>
                  <select value={generateForm.contact_type} onChange={e=>setGenerateForm(f=>({...f,contact_type:e.target.value}))}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none'}}>
                    <option value="notary">Texas Notaries</option>
                    <option value="contractor">HUB/DBE Contractors</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>TONE</label>
                  <select value={generateForm.tone} onChange={e=>setGenerateForm(f=>({...f,tone:e.target.value}))}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none'}}>
                    <option>professional but urgent</option>
                    <option>friendly and conversational</option>
                    <option>formal and authoritative</option>
                    <option>empathetic and helpful</option>
                  </select>
                </div>
              </div>
              <button onClick={()=>call('generate-campaign',generateForm)} disabled={loading||!generateForm.brief}
                style={{padding:'12px 24px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:14,fontWeight:700,alignSelf:'flex-start',opacity:loading||!generateForm.brief?0.5:1}}>
                {loading?'Generating...':'✨ Generate Campaign'}
              </button>
            </div>
          )}

          {active==='score'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                {[['First Name / Company','first_name'],['City','city'],['Expiry Date (YYYY-MM-DD)','expire_date'],['Current Carrier','surety_company']].map(([label,key])=>(
                  <div key={key}>
                    <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>{label.toUpperCase()}</label>
                    <input value={scoreForm[key]} onChange={e=>setScoreForm(f=>({...f,[key]:e.target.value}))}
                      style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                  </div>
                ))}
              </div>
              <div>
                <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>TYPE</label>
                <select value={scoreForm.contact_type} onChange={e=>setScoreForm(f=>({...f,contact_type:e.target.value}))}
                  style={{padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none'}}>
                  <option value="notary">Notary</option>
                  <option value="contractor">Contractor</option>
                </select>
              </div>
              <button onClick={()=>call('score-lead',{contact:scoreForm})} disabled={loading}
                style={{padding:'12px 24px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:14,fontWeight:700,alignSelf:'flex-start',opacity:loading?0.5:1}}>
                {loading?'Scoring...':'📊 Score This Lead'}
              </button>
            </div>
          )}

          {active==='bulk-score'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{padding:16,borderRadius:10,background:'var(--surface)',border:'1px solid var(--border)',fontSize:13,color:'var(--text-dim)',lineHeight:1.7}}>
                Scores your top 20 hottest leads from the database — notaries expiring within 180 days or contractors with email addresses. Uses Claude to analyze each contact and rank by conversion likelihood.
              </div>
              <div>
                <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>CONTACT TYPE</label>
                <select id="bulk-type" style={{padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none'}}>
                  <option value="notary">Notaries (expiring 180 days)</option>
                  <option value="contractor">HUB/DBE Contractors</option>
                </select>
              </div>
              <button onClick={()=>call('score-bulk',{contact_type:document.getElementById('bulk-type').value,limit:50})} disabled={loading}
                style={{padding:'12px 24px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:14,fontWeight:700,alignSelf:'flex-start',opacity:loading?0.5:1}}>
                {loading?'Scoring 20 leads...':'⚡ Score Top Leads'}
              </button>
            </div>
          )}

          {active==='subject'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>CURRENT SUBJECT LINE</label>
                <input value={subjectForm.subject} onChange={e=>setSubjectForm(f=>({...f,subject:e.target.value}))}
                  placeholder="e.g. Your Texas Notary Bond Expires Soon"
                  style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>CONTACT TYPE</label>
                  <select value={subjectForm.contact_type} onChange={e=>setSubjectForm(f=>({...f,contact_type:e.target.value}))}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none'}}>
                    <option value="notary">Notaries</option>
                    <option value="contractor">Contractors</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>GOAL</label>
                  <select value={subjectForm.campaign_goal} onChange={e=>setSubjectForm(f=>({...f,campaign_goal:e.target.value}))}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none'}}>
                    <option>maximize open rate</option>
                    <option>drive clicks to quote page</option>
                    <option>re-engagement</option>
                    <option>urgency/renewal</option>
                  </select>
                </div>
              </div>
              <button onClick={()=>call('optimize-subject',subjectForm)} disabled={loading||!subjectForm.subject}
                style={{padding:'12px 24px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:14,fontWeight:700,alignSelf:'flex-start',opacity:loading||!subjectForm.subject?0.5:1}}>
                {loading?'Optimizing...':'🎯 Generate 10 Variants'}
              </button>
            </div>
          )}

          {active==='objection'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>CUSTOMER OBJECTION</label>
                <textarea value={objectionForm.objection} onChange={e=>setObjectionForm(f=>({...f,objection:e.target.value}))} rows={3}
                  placeholder='e.g. "I am happy with my current carrier and do not need to switch"'
                  style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none',resize:'vertical',boxSizing:'border-box'}}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>CONTACT NAME</label>
                  <input value={objectionForm.contact_name} onChange={e=>setObjectionForm(f=>({...f,contact_name:e.target.value}))}
                    placeholder="Sarah Johnson"
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>TYPE</label>
                  <select value={objectionForm.contact_type} onChange={e=>setObjectionForm(f=>({...f,contact_type:e.target.value}))}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none'}}>
                    <option value="notary">Notary</option>
                    <option value="contractor">Contractor</option>
                  </select>
                </div>
              </div>
              <button onClick={()=>call('handle-objection',objectionForm)} disabled={loading||!objectionForm.objection}
                style={{padding:'12px 24px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:14,fontWeight:700,alignSelf:'flex-start',opacity:loading||!objectionForm.objection?0.5:1}}>
                {loading?'Writing response...':'💬 Generate Response'}
              </button>
            </div>
          )}

          {active==='reply'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>EMAIL REPLY TEXT</label>
                <textarea value={replyForm.reply_text} onChange={e=>setReplyForm(f=>({...f,reply_text:e.target.value}))} rows={4}
                  placeholder="Paste the customer's reply email here..."
                  style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none',resize:'vertical',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>CONTACT EMAIL</label>
                <input value={replyForm.contact_email} onChange={e=>setReplyForm(f=>({...f,contact_email:e.target.value}))}
                  placeholder="contact@example.com"
                  style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
              </div>
              <button onClick={()=>call('classify-reply',replyForm)} disabled={loading||!replyForm.reply_text}
                style={{padding:'12px 24px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:14,fontWeight:700,alignSelf:'flex-start',opacity:loading||!replyForm.reply_text?0.5:1}}>
                {loading?'Classifying...':'📧 Classify Reply'}
              </button>
            </div>
          )}

          {active==='intelligence'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{padding:16,borderRadius:10,background:'var(--surface)',border:'1px solid var(--border)',fontSize:13,color:'var(--text-dim)',lineHeight:1.7}}>
                Claude will analyze your entire database — 547K notaries, 19K contractors, competitor carrier distribution, and email activity — to identify your top opportunities and revenue potential.
              </div>
              <button onClick={()=>call('market-intelligence',{})} disabled={loading}
                style={{padding:'12px 24px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:14,fontWeight:700,alignSelf:'flex-start',opacity:loading?0.5:1}}>
                {loading?'Analyzing market...':'📊 Run Market Analysis'}
              </button>
            </div>
          )}

          {active==='enrich'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                {[['Company Name','company_name'],['City','city'],['NAICS Code','naics_codes']].map(([label,key])=>(
                  <div key={key}>
                    <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>{label.toUpperCase()}</label>
                    <input value={enrichForm[key]} onChange={e=>setEnrichForm(f=>({...f,[key]:e.target.value}))}
                      style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                  </div>
                ))}
                <div>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>CERT TYPE</label>
                  <select value={enrichForm.certification_type} onChange={e=>setEnrichForm(f=>({...f,certification_type:e.target.value}))}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13,outline:'none'}}>
                    <option>HUB</option><option>DBE</option><option>MBE</option><option>WBE</option><option>8(a)</option>
                  </select>
                </div>
              </div>
              <button onClick={()=>call('enrich-contact',enrichForm)} disabled={loading||!enrichForm.company_name}
                style={{padding:'12px 24px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:14,fontWeight:700,alignSelf:'flex-start',opacity:loading||!enrichForm.company_name?0.5:1}}>
                {loading?'Enriching...':'🔍 Enrich Profile'}
              </button>
            </div>
          )}

          {active==='unsubscribe'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{padding:16,borderRadius:10,background:'var(--surface)',border:'1px solid var(--border)',fontSize:13,color:'var(--text-dim)',lineHeight:1.7}}>
                Claude will analyze all unsubscribe records in your database and identify patterns — timing, campaign types, segments — and recommend improvements to reduce unsubscribe rates.
              </div>
              <button onClick={()=>call('analyze-unsubscribes',{})} disabled={loading}
                style={{padding:'12px 24px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:14,fontWeight:700,alignSelf:'flex-start',opacity:loading?0.5:1}}>
                {loading?'Analyzing...':'🔍 Analyze Unsubscribes'}
              </button>
            </div>
          )}

          {active==='briefing'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{padding:16,borderRadius:10,background:'var(--surface)',border:'1px solid var(--border)',fontSize:13,color:'var(--text-dim)',lineHeight:1.7}}>
                Claude pulls live data from your database — expiring notaries, emails sent, hot leads — and writes a personalized daily briefing email sent to <strong style={{color:'white'}}>administrator@quantumsurety.bond</strong>.
              </div>
              <button onClick={()=>call('daily-briefing',{})} disabled={loading}
                style={{padding:'12px 24px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:14,fontWeight:700,alignSelf:'flex-start',opacity:loading?0.5:1}}>
                {loading?'Generating briefing...':'📨 Send Daily Briefing Now'}
              </button>
            </div>
          )}

          {error&&(
            <div style={{marginTop:16,padding:'10px 14px',borderRadius:8,background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',color:'#f87171',fontSize:13}}>
              {error}
            </div>
          )}

          <ResultBox data={result} loading={loading}/>
        </div>
      </div>
    </div>
  );
}
