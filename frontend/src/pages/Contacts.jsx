import React,{useEffect,useState,useCallback} from 'react';
import {Search,Mail,Phone,X,Send,ChevronLeft,ChevronRight} from 'lucide-react';

export default function Contacts() {
  const [data,setData]=useState({data:[],total:0,pages:1});
  const [page,setPage]=useState(1);
  const [search,setSearch]=useState('');
  const [state,setState]=useState('');
  const [hasEmail,setHasEmail]=useState(false);
  const [selected,setSelected]=useState(null);
  const [emailForm,setEmailForm]=useState({subject:'',body:'',sending:false,sent:false,error:''});

  const load = useCallback(()=>{
    const p=new URLSearchParams({page,limit:50,search,state,has_email:hasEmail?'true':''});
    fetch(`/api/contacts?${p}`).then(r=>r.json()).then(setData);
  },[page,search,state,hasEmail]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{setPage(1);},[search,state,hasEmail]);

  const sendEmail = async()=>{
    if(!selected?.contact_email){return;}
    setEmailForm(f=>({...f,sending:true,error:''}));
    try{
      const r=await fetch('/api/email/send',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({to_email:selected.contact_email,subject:emailForm.subject,body:emailForm.body})});
      const j=await r.json();
      if(j.ok)setEmailForm(f=>({...f,sending:false,sent:true}));
      else setEmailForm(f=>({...f,sending:false,error:j.error}));
    }catch(e){setEmailForm(f=>({...f,sending:false,error:e.message}));}
  };

  return (
    <div className="flex h-full">
      {/* List */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 border-b" style={{borderColor:'var(--border)'}}>
          <div className="text-xs font-mono tracking-widest mb-1" style={{color:'var(--gold)'}}>DATABASE</div>
          <h1 className="font-display text-3xl tracking-wider text-white mb-4">Contacts</h1>
          <div className="flex gap-3 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{color:'var(--text-dim)'}}/>
              <input value={search} onChange={e=>{setSearch(e.target.value);}}
                placeholder="Search company or city..."
                className="pl-9 pr-3 py-2 rounded-lg text-sm border outline-none w-64"
                style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}/>
            </div>
            <select value={state} onChange={e=>setState(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm border outline-none"
              style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--text)'}}>
              <option value="">All States</option>
              {['TX','LA','NM'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{color:'var(--text-dim)'}}>
              <input type="checkbox" checked={hasEmail} onChange={e=>setHasEmail(e.target.checked)} className="accent-yellow-500"/>
              Email only
            </label>
            <span className="text-sm font-mono ml-auto self-center" style={{color:'var(--text-dim)'}}>
              {data.total.toLocaleString()} contacts
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{borderColor:'var(--border)'}}>
                {['Company','City','State','Cert','Contact','Phone','Fax'].map(h=>(
                  <th key={h} className="text-left px-4 py-3 text-xs font-mono tracking-wider" style={{color:'var(--text-dim)'}}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map(row=>(
                <tr key={row.id} onClick={()=>{setSelected(row);setEmailForm({subject:'',body:'',sending:false,sent:false,error:''});}}
                  className="border-b cursor-pointer transition-colors hover:bg-white/5"
                  style={{borderColor:'var(--border)',background:selected?.id===row.id?'var(--muted)':''}}>
                  <td className="px-4 py-3 font-medium text-white max-w-xs truncate">{row.company_name}</td>
                  <td className="px-4 py-3" style={{color:'var(--text-dim)'}}>{row.city}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{color:'var(--gold)'}}>{row.state}</td>
                  <td className="px-4 py-3 text-xs" style={{color:'var(--text-dim)'}}>{row.certification_type}</td>
                  <td className="px-4 py-3 text-xs max-w-xs truncate" style={{color:row.contact_email?'#4C9AC9':'var(--text-dim)'}}>
                    {row.contact_email||row.contact_website||'—'}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono" style={{color:'var(--text-dim)'}}>{row.phone||'—'}</td>
                  <td className="px-4 py-3 text-xs font-mono" style={{color:'var(--text-dim)'}}>{row.fax&&row.fax!=='M'?row.fax:'—'}</td>
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
          <span className="text-sm font-mono" style={{color:'var(--text-dim)'}}>Page {page} of {data.pages}</span>
          <button onClick={()=>setPage(p=>Math.min(data.pages,p+1))} disabled={page===data.pages}
            className="flex items-center gap-1 text-sm px-3 py-1.5 rounded disabled:opacity-30"
            style={{color:'var(--text-dim)'}}>
            Next <ChevronRight size={14}/>
          </button>
        </div>
      </div>

      {/* Detail panel */}
      {selected&&(
        <div className="w-96 border-l flex flex-col" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
          <div className="p-5 border-b flex items-start justify-between" style={{borderColor:'var(--border)'}}>
            <div>
              <div className="font-medium text-white leading-tight">{selected.company_name}</div>
              <div className="text-xs font-mono mt-1" style={{color:'var(--gold)'}}>{selected.certification_type} · {selected.state}</div>
            </div>
            <button onClick={()=>setSelected(null)} style={{color:'var(--text-dim)'}}><X size={16}/></button>
          </div>
          <div className="p-5 space-y-3 border-b text-sm" style={{borderColor:'var(--border)'}}>
            {[
              ['Address',`${selected.address||''} ${selected.address2||''}`.trim()||'—'],
              ['City/Zip',`${selected.city||''} ${selected.zip||''}`.trim()||'—'],
              ['Phone',selected.phone||'—'],
              ['Fax',selected.fax&&selected.fax!=='M'?selected.fax:'—'],
              ['Email',selected.contact_email||'—'],
              ['Website',selected.contact_website||'—'],
              ['NAICS',selected.naics_codes||'—'],
            ].map(([label,val])=>(
              <div key={label} className="flex gap-2">
                <span className="text-xs font-mono w-16 flex-shrink-0 mt-0.5" style={{color:'var(--text-dim)'}}>{label}</span>
                <span className="text-white break-all">{val}</span>
              </div>
            ))}
          </div>

          {/* Quick email */}
          <div className="p-5 flex-1 flex flex-col gap-3">
            <div className="text-xs font-mono tracking-wider" style={{color:'var(--gold)'}}>QUICK EMAIL</div>
            {!selected.contact_email
              ? <p className="text-xs" style={{color:'var(--text-dim)'}}>No email on file for this contact.</p>
              : emailForm.sent
              ? <div className="text-sm text-green-400 font-mono">✓ Email sent successfully</div>
              : <>
                  <input value={emailForm.subject} onChange={e=>setEmailForm(f=>({...f,subject:e.target.value}))}
                    placeholder="Subject..." className="px-3 py-2 rounded text-sm border outline-none"
                    style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                  <textarea value={emailForm.body} onChange={e=>setEmailForm(f=>({...f,body:e.target.value}))}
                    placeholder="Email body (HTML supported)..." rows={6}
                    className="px-3 py-2 rounded text-sm border outline-none resize-none flex-1"
                    style={{background:'var(--muted)',borderColor:'var(--border)',color:'var(--text)'}}/>
                  {emailForm.error&&<p className="text-xs text-red-400">{emailForm.error}</p>}
                  <button onClick={sendEmail} disabled={emailForm.sending||!emailForm.subject||!emailForm.body}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                    style={{background:'var(--gold)',color:'#0A0A0F'}}>
                    <Send size={14}/>{emailForm.sending?'Sending...':'Send Email'}
                  </button>
                </>
            }
          </div>
        </div>
      )}
    </div>
  );
}
