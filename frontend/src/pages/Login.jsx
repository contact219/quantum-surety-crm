import React,{useState} from 'react';
import {setAuth} from '../auth.js';

export default function Login({onLogin}) {
  const [form,setForm]=useState({username:'',password:''});
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);

  const submit = async(e) => {
    e.preventDefault();
    setLoading(true);setError('');
    try {
      const r = await fetch('/api/auth/login',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(form)
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error||'Login failed'); setLoading(false); return; }
      setAuth(j.token, j.user);
      onLogin(j.user);
    } catch(e) { setError('Connection error'); setLoading(false); }
  };

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--dark)'}}>
      <div style={{width:'100%',maxWidth:400,padding:'0 24px'}}>
        {/* Logo */}
        <div style={{textAlign:'center',marginBottom:48}}>
          <div style={{fontSize:11,fontFamily:'monospace',letterSpacing:4,color:'var(--gold)',marginBottom:8}}>QUANTUM SURETY</div>
          <div style={{fontFamily:'"Bebas Neue",cursive',fontSize:48,letterSpacing:6,color:'white',lineHeight:1}}>CRM</div>
          <div style={{height:2,background:'linear-gradient(90deg,transparent,var(--gold),transparent)',marginTop:16}}/>
        </div>

        {/* Form */}
        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:16}}>
          {error&&(
            <div style={{padding:'10px 14px',borderRadius:8,background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',color:'#f87171',fontSize:13,textAlign:'center'}}>
              {error}
            </div>
          )}
          <div>
            <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:3,color:'var(--text-dim)',display:'block',marginBottom:8}}>USERNAME OR EMAIL</label>
            <input
              type="text" value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))}
              autoFocus autoComplete="username"
              style={{width:'100%',padding:'12px 16px',borderRadius:10,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:14,outline:'none',boxSizing:'border-box'}}
            />
          </div>
          <div>
            <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:3,color:'var(--text-dim)',display:'block',marginBottom:8}}>PASSWORD</label>
            <input
              type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))}
              autoComplete="current-password"
              style={{width:'100%',padding:'12px 16px',borderRadius:10,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:14,outline:'none',boxSizing:'border-box'}}
            />
          </div>
          <button type="submit" disabled={loading||!form.username||!form.password}
            style={{padding:'14px',borderRadius:10,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:15,fontWeight:700,fontFamily:'"Bebas Neue",cursive',letterSpacing:3,opacity:loading?0.6:1,marginTop:8}}>
            {loading?'SIGNING IN...':'SIGN IN'}
          </button>
        </form>

        <p style={{textAlign:'center',marginTop:24,fontSize:11,fontFamily:'monospace',color:'var(--text-dim)'}}>
          quantumsurety.bond · CRM v1.0
        </p>
      </div>
    </div>
  );
}
