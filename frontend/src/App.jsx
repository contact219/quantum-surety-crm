import React,{useState,useEffect} from 'react';
import {Routes,Route,NavLink,useLocation,useNavigate} from 'react-router-dom';
import {LayoutDashboard,Users,Mail,Upload,FileText,LogOut,Shield,Menu,X} from 'lucide-react';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import Campaigns from './pages/Campaigns.jsx';
import ImportPage from './pages/Import.jsx';
import Notaries from './pages/Notaries.jsx';
import Login from './pages/Login.jsx';
import UsersPage from './pages/Users.jsx';
import {getToken,getUser,clearAuth} from './auth.js';

// GA4 tracking
const GA4_ID = 'G-QGDQ6JDMMH';
function loadGA4() {
  if (document.getElementById('ga4-script')) return;
  const s = document.createElement('script');
  s.id = 'ga4-script';
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){window.dataLayer.push(arguments);};
  window.gtag('js', new Date());
  window.gtag('config', GA4_ID);
}

const nav = [
  {to:'/',icon:LayoutDashboard,label:'Dashboard',roles:['admin','sales','readonly']},
  {to:'/contacts',icon:Users,label:'Contacts',roles:['admin','sales','readonly']},
  {to:'/campaigns',icon:Mail,label:'Campaigns',roles:['admin','sales']},
  {to:'/notaries',icon:FileText,label:'Notary Bonds',roles:['admin','sales','readonly']},
  {to:'/import',icon:Upload,label:'Import',roles:['admin']},
  {to:'/users',icon:Shield,label:'Users',roles:['admin']},
];

export default function App() {
  const [user,setUser]=useState(getUser());
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const location = useLocation();

  useEffect(()=>{
    if(user) { loadGA4(); window.gtag?.('event','page_view',{page_path:location.pathname}); }
  },[location,user]);

  if (!user || !getToken()) {
    return <Login onLogin={u=>{setUser(u); loadGA4();}}/>;
  }

  const logout=()=>{ clearAuth(); setUser(null); };
  const userNav = nav.filter(n=>n.roles.includes(user.role));

  const Sidebar = ()=>(
    <aside style={{width:224,flexShrink:0,display:'flex',flexDirection:'column',borderRight:'1px solid var(--border)',background:'var(--surface)',height:'100%'}}>
      <div style={{padding:'24px 20px',borderBottom:'1px solid var(--border)'}}>
        <div style={{fontSize:10,fontFamily:'monospace',letterSpacing:4,color:'var(--gold)',marginBottom:4}}>QUANTUM SURETY</div>
        <div style={{fontFamily:'"Bebas Neue",cursive',fontSize:28,letterSpacing:4,color:'white'}}>CRM</div>
        <div className="gold-line" style={{marginTop:12}}/>
      </div>
      <nav style={{flex:1,padding:'12px 8px',display:'flex',flexDirection:'column',gap:2}}>
        {userNav.map(({to,icon:Icon,label})=>(
          <NavLink key={to} to={to} end={to==='/'}
            onClick={()=>setSidebarOpen(false)}
            style={({isActive})=>({
              display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:8,
              fontSize:13,fontWeight:500,textDecoration:'none',transition:'all 0.15s',
              background:isActive?'var(--muted)':'transparent',
              color:isActive?'white':'var(--text-dim)',
              borderLeft:isActive?'2px solid var(--gold)':'2px solid transparent',
            })}>
            <Icon size={15}/>{label}
          </NavLink>
        ))}
      </nav>
      <div style={{padding:'12px 8px',borderTop:'1px solid var(--border)'}}>
        <div style={{padding:'8px 12px',fontSize:11,fontFamily:'monospace',color:'var(--text-dim)',marginBottom:4}}>
          <span style={{color:user.role==='admin'?'var(--gold)':user.role==='sales'?'#4C9AC9':'#6B6B8A'}}>{user.role}</span> · {user.username}
        </div>
        <button onClick={logout}
          style={{display:'flex',alignItems:'center',gap:8,width:'100%',padding:'8px 12px',borderRadius:8,background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',fontSize:13}}>
          <LogOut size={14}/> Sign Out
        </button>
      </div>
    </aside>
  );

  return (
    <div style={{display:'flex',height:'100vh',overflow:'hidden',position:'relative'}}>
      {/* Desktop sidebar */}
      <div style={{display:'none'}} className="desktop-sidebar">
        <Sidebar/>
      </div>

      {/* Mobile overlay sidebar */}
      {sidebarOpen&&(
        <div style={{position:'fixed',inset:0,zIndex:100,display:'flex'}}>
          <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.7)'}} onClick={()=>setSidebarOpen(false)}/>
          <div style={{position:'relative',zIndex:1,width:224}}>
            <Sidebar/>
          </div>
        </div>
      )}

      {/* Always-visible sidebar on desktop via CSS */}
      <style>{`
        @media(min-width:768px){
          .desktop-sidebar{display:flex !important;}
          .mobile-header{display:none !important;}
        }
        @media(max-width:767px){
          .desktop-sidebar{display:none !important;}
          .mobile-header{display:flex !important;}
        }
      `}</style>

      <Sidebar/>

      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {/* Mobile header */}
        <div className="mobile-header" style={{display:'none',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderBottom:'1px solid var(--border)',background:'var(--surface)',flexShrink:0}}>
          <button onClick={()=>setSidebarOpen(true)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)'}}>
            <Menu size={20}/>
          </button>
          <div style={{fontFamily:'"Bebas Neue",cursive',fontSize:20,letterSpacing:3,color:'white'}}>QUANTUM SURETY CRM</div>
          <div style={{width:20}}/>
        </div>

        <main style={{flex:1,overflow:'auto',background:'var(--dark)'}}>
          <Routes>
            <Route path="/" element={<Dashboard/>}/>
            <Route path="/contacts" element={<Contacts/>}/>
            <Route path="/campaigns" element={user.role!=='readonly'?<Campaigns/>:<div style={{padding:32,color:'var(--text-dim)'}}>Access restricted</div>}/>
            <Route path="/notaries" element={<Notaries/>}/>
            <Route path="/import" element={user.role==='admin'?<ImportPage/>:<div style={{padding:32,color:'var(--text-dim)'}}>Admin only</div>}/>
            <Route path="/users" element={user.role==='admin'?<UsersPage/>:<div style={{padding:32,color:'var(--text-dim)'}}>Admin only</div>}/>
          </Routes>
        </main>
      </div>
    </div>
  );
}
