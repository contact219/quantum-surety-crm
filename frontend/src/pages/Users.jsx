import React,{useEffect,useState} from 'react';
import {Plus,X,Shield,Eye,Edit2} from 'lucide-react';
import {apiFetch} from '../auth.js';

const ROLE_COLORS = {admin:'#C9A84C',sales:'#4C9AC9',readonly:'#6B6B8A'};

export default function Users() {
  const [users,setUsers]=useState([]);
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({username:'',email:'',password:'',role:'sales'});
  const [error,setError]=useState('');
  const [changePw,setChangePw]=useState({current:'',next:'',msg:''});

  const load=()=>apiFetch('/api/auth/users').then(r=>r.json()).then(setUsers).catch(()=>{});
  useEffect(()=>{load();},[]);

  const save=async()=>{
    setError('');
    const r=await apiFetch('/api/auth/users',{method:'POST',body:JSON.stringify(form)});
    const j=await r.json();
    if(!r.ok){setError(j.error);return;}
    setShowNew(false);setForm({username:'',email:'',password:'',role:'sales'});load();
  };

  const toggleActive=async(u)=>{
    await apiFetch(`/api/auth/users/${u.id}`,{method:'PATCH',body:JSON.stringify({active:!u.active})});
    load();
  };

  const changeRole=async(u,role)=>{
    await apiFetch(`/api/auth/users/${u.id}`,{method:'PATCH',body:JSON.stringify({role})});
    load();
  };

  const changePwSubmit=async()=>{
    const r=await apiFetch('/api/auth/change-password',{method:'POST',body:JSON.stringify({current_password:changePw.current,new_password:changePw.next})});
    const j=await r.json();
    setChangePw(p=>({...p,msg:j.ok?'Password changed!':j.error}));
  };

  return (
    <div style={{padding:'2rem',maxWidth:800}}>
      <div style={{marginBottom:'2rem'}}>
        <div style={{fontSize:11,fontFamily:'monospace',letterSpacing:3,color:'var(--gold)',marginBottom:4}}>SETTINGS</div>
        <h1 style={{fontFamily:'"Bebas Neue",cursive',fontSize:36,letterSpacing:3,color:'white',margin:0}}>User Management</h1>
        <div className="gold-line" style={{width:96,marginTop:12}}/>
      </div>

      {/* User list */}
      <div style={{borderRadius:12,border:'1px solid var(--border)',background:'var(--surface)',overflow:'hidden',marginBottom:24}}>
        <div style={{padding:'12px 20px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)'}}>CRM USERS</div>
          <button onClick={()=>setShowNew(true)}
            style={{display:'flex',alignItems:'center',gap:6,fontSize:12,padding:'6px 12px',borderRadius:8,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontWeight:600}}>
            <Plus size={12}/> Add User
          </button>
        </div>
        {users.map(u=>(
          <div key={u.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 20px',borderBottom:'1px solid var(--border)'}}>
            <div>
              <div style={{color:'white',fontWeight:500,fontSize:14}}>{u.username}</div>
              <div style={{color:'var(--text-dim)',fontSize:12,marginTop:2}}>{u.email}</div>
              {u.last_login&&<div style={{color:'var(--text-dim)',fontSize:11,fontFamily:'monospace',marginTop:2}}>Last login: {new Date(u.last_login).toLocaleDateString()}</div>}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <select value={u.role} onChange={e=>changeRole(u,e.target.value)}
                style={{padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--muted)',color:ROLE_COLORS[u.role]||'white',fontSize:12,fontFamily:'monospace',outline:'none'}}>
                <option value="admin">admin</option>
                <option value="sales">sales</option>
                <option value="readonly">readonly</option>
              </select>
              <button onClick={()=>toggleActive(u)}
                style={{padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',background:u.active?'rgba(76,201,122,0.1)':'rgba(107,107,138,0.1)',color:u.active?'#4CC97A':'#6B6B8A',fontSize:11,fontFamily:'monospace',cursor:'pointer'}}>
                {u.active?'Active':'Inactive'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Change password */}
      <div style={{borderRadius:12,border:'1px solid var(--border)',background:'var(--surface)',padding:20}}>
        <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--gold)',marginBottom:16}}>CHANGE YOUR PASSWORD</div>
        <div style={{display:'flex',flexDirection:'column',gap:12,maxWidth:400}}>
          {[['Current Password','current'],['New Password','next']].map(([label,key])=>(
            <div key={key}>
              <label style={{fontSize:10,fontFamily:'monospace',color:'var(--text-dim)',display:'block',marginBottom:6}}>{label.toUpperCase()}</label>
              <input type="password" value={changePw[key]} onChange={e=>setChangePw(p=>({...p,[key]:e.target.value}))}
                style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
            </div>
          ))}
          {changePw.msg&&<div style={{fontSize:12,color:changePw.msg.includes('!')?'#4CC97A':'#f87171'}}>{changePw.msg}</div>}
          <button onClick={changePwSubmit} disabled={!changePw.current||!changePw.next}
            style={{padding:'8px 16px',borderRadius:8,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,alignSelf:'flex-start'}}>
            Update Password
          </button>
        </div>
      </div>

      {/* New user modal */}
      {showNew&&(
        <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.85)'}}>
          <div style={{width:'100%',maxWidth:420,borderRadius:16,border:'1px solid var(--border)',background:'var(--surface)',padding:24}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
              <div style={{fontFamily:'"Bebas Neue",cursive',fontSize:24,letterSpacing:3,color:'white'}}>New User</div>
              <button onClick={()=>setShowNew(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)'}}><X size={18}/></button>
            </div>
            {error&&<div style={{padding:'8px 12px',borderRadius:8,background:'rgba(239,68,68,0.1)',color:'#f87171',fontSize:13,marginBottom:16}}>{error}</div>}
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              {[['Username','username','text'],['Email','email','email'],['Password','password','password']].map(([label,key,type])=>(
                <div key={key}>
                  <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>{label.toUpperCase()}</label>
                  <input type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
                    style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
                </div>
              ))}
              <div>
                <label style={{fontSize:10,fontFamily:'monospace',letterSpacing:2,color:'var(--text-dim)',display:'block',marginBottom:6}}>ROLE</label>
                <select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}
                  style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--muted)',color:'var(--text)',fontSize:13,outline:'none'}}>
                  <option value="admin">Admin — full access</option>
                  <option value="sales">Sales — can send campaigns</option>
                  <option value="readonly">Read-only — view only</option>
                </select>
              </div>
              <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:8}}>
                <button onClick={()=>setShowNew(false)} style={{padding:'8px 16px',borderRadius:8,background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',fontSize:13}}>Cancel</button>
                <button onClick={save} disabled={!form.username||!form.email||!form.password}
                  style={{padding:'8px 20px',borderRadius:8,background:'var(--gold)',color:'#0A0A0F',border:'none',cursor:'pointer',fontSize:13,fontWeight:600}}>
                  Create User
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
