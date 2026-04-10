import React,{useState,useRef} from 'react';
import {Upload,CheckCircle,AlertCircle} from 'lucide-react';

export default function ImportPage() {
  const [dragging,setDragging]=useState(false);
  const [file,setFile]=useState(null);
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const ref=useRef();

  const handleFile=f=>{setFile(f);setResult(null);setError('');};
  const onDrop=e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f?.name.endsWith('.csv'))handleFile(f);};

  const doImport=async()=>{
    if(!file)return;
    setLoading(true);setError('');
    const fd=new FormData();fd.append('file',file);
    try{
      const r=await fetch('/api/import/csv',{method:'POST',body:fd});
      const j=await r.json();
      if(j.ok)setResult(j);else setError(j.error);
    }catch(e){setError(e.message);}
    setLoading(false);
  };

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <div className="text-xs font-mono tracking-widest mb-1" style={{color:'var(--gold)'}}>DATA</div>
        <h1 className="font-display text-4xl tracking-wider text-white">Import CSV</h1>
        <div className="gold-line mt-3 w-24"/>
      </div>

      <div className="rounded-xl border p-6 mb-6" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
        <div className="text-xs font-mono tracking-wider mb-3" style={{color:'var(--text-dim)'}}>EXPECTED COLUMNS</div>
        <div className="font-mono text-xs leading-6" style={{color:'var(--gold)'}}>
          company_name, address, city, state, zip, phone, contact_email, contact_website, certification_type, certification_number, naics_codes
        </div>
        <p className="text-xs mt-3" style={{color:'var(--text-dim)'}}>
          Tip: Export directly from the scraper using <code className="font-mono" style={{color:'var(--gold)'}}>node src/scripts/export-marketing.js TX</code>
        </p>
      </div>

      <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={onDrop}
        onClick={()=>ref.current.click()}
        className="rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-all"
        style={{borderColor:dragging?'var(--gold)':'var(--border)',background:dragging?'rgba(201,168,76,0.05)':'var(--surface)'}}>
        <input ref={ref} type="file" accept=".csv" className="hidden" onChange={e=>handleFile(e.target.files[0])}/>
        <Upload size={32} className="mx-auto mb-3" style={{color:file?'var(--gold)':'var(--text-dim)'}}/>
        {file
          ? <div><div className="font-medium text-white">{file.name}</div><div className="text-xs mt-1" style={{color:'var(--text-dim)'}}>{(file.size/1024).toFixed(1)} KB</div></div>
          : <div><div className="text-sm font-medium" style={{color:'var(--text-dim)'}}>Drop CSV here or click to browse</div></div>
        }
      </div>

      {file&&!result&&(
        <button onClick={doImport} disabled={loading}
          className="mt-4 w-full py-3 rounded-xl font-medium text-sm disabled:opacity-50 transition-all"
          style={{background:'var(--gold)',color:'#0A0A0F'}}>
          {loading?'Importing...':'Import Contacts'}
        </button>
      )}

      {error&&(
        <div className="mt-4 p-4 rounded-xl border flex items-start gap-3" style={{background:'#2e1a1a',borderColor:'#5a2020'}}>
          <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0"/>
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}

      {result&&(
        <div className="mt-4 p-6 rounded-xl border" style={{background:'#1a2e1a',borderColor:'#2a5a2a'}}>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle size={18} className="text-green-400"/>
            <span className="font-medium text-green-400">Import Complete</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[['Inserted',result.inserted,'#4CC97A'],['Skipped',result.skipped,'var(--text-dim)'],['Total',result.total,'var(--gold)']].map(([label,val,color])=>(
              <div key={label} className="text-center">
                <div className="text-2xl font-display" style={{color}}>{val}</div>
                <div className="text-xs font-mono mt-1" style={{color:'var(--text-dim)'}}>{label.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
