import React,{useEffect,useState} from 'react';
import {Users,Mail,Phone,TrendingUp} from 'lucide-react';
export default function Dashboard() {
  const [stats,setStats]=useState(null);
  const [campaigns,setCampaigns]=useState([]);
  useEffect(()=>{
    fetch('/api/contacts/stats').then(r=>r.json()).then(setStats);
    fetch('/api/campaigns').then(r=>r.json()).then(setCampaigns);
  },[]);
  const cards = stats?[
    {label:'Total Contacts',value:stats.total.toLocaleString(),icon:Users,color:'#C9A84C'},
    {label:'With Email',value:stats.with_email.toLocaleString(),icon:Mail,color:'#4C9AC9'},
    {label:'With Phone',value:stats.with_phone.toLocaleString(),icon:Phone,color:'#4CC97A'},
    {label:'Campaigns',value:campaigns.length,icon:TrendingUp,color:'#C94C9A'},
  ]:[];
  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="text-xs font-mono tracking-widest mb-1" style={{color:'var(--gold)'}}>OVERVIEW</div>
        <h1 className="font-display text-4xl tracking-wider text-white">Dashboard</h1>
        <div className="gold-line mt-3 w-24"/>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(({label,value,icon:Icon,color})=>(
          <div key={label} className="rounded-xl p-5 border" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono tracking-wider" style={{color:'var(--text-dim)'}}>{label.toUpperCase()}</span>
              <Icon size={16} style={{color}}/>
            </div>
            <div className="text-3xl font-display tracking-wider" style={{color}}>{value}</div>
          </div>
        ))}
      </div>
      {stats?.by_state&&(
        <div className="rounded-xl border p-6 mb-6" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
          <div className="text-xs font-mono tracking-widest mb-4" style={{color:'var(--gold)'}}>BY STATE</div>
          <div className="space-y-3">
            {stats.by_state.slice(0,6).map(({state,count})=>(
              <div key={state} className="flex items-center gap-4">
                <span className="font-mono text-sm w-8 text-white">{state}</span>
                <div className="flex-1 h-1.5 rounded-full" style={{background:'var(--muted)'}}>
                  <div className="h-full rounded-full" style={{width:`${Math.round((count/stats.total)*100)}%`,background:'var(--gold)'}}/>
                </div>
                <span className="text-sm font-mono w-20 text-right" style={{color:'var(--text-dim)'}}>{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="rounded-xl border p-6" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
        <div className="text-xs font-mono tracking-widest mb-4" style={{color:'var(--gold)'}}>RECENT CAMPAIGNS</div>
        {campaigns.length===0
          ?<p className="text-sm" style={{color:'var(--text-dim)'}}>No campaigns yet.</p>
          :campaigns.slice(0,5).map(c=>(
            <div key={c.id} className="flex items-center justify-between py-3 border-b last:border-0" style={{borderColor:'var(--border)'}}>
              <div>
                <div className="text-sm font-medium text-white">{c.name}</div>
                <div className="text-xs font-mono mt-0.5" style={{color:'var(--text-dim)'}}>{c.subject}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono" style={{color:'var(--text-dim)'}}>{c.sent_count} sent</span>
                <span className="text-xs px-2 py-0.5 rounded font-mono" style={{background:c.status==='sent'?'#1a2e1a':'var(--muted)',color:c.status==='sent'?'#4CC97A':'var(--text-dim)'}}>{c.status}</span>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}
