import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Mail, Upload, FileText } from 'lucide-react';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import Campaigns from './pages/Campaigns.jsx';
import ImportPage from './pages/Import.jsx';
import Notaries from './pages/Notaries.jsx';

const nav = [
  {to:'/',icon:LayoutDashboard,label:'Dashboard'},
  {to:'/contacts',icon:Users,label:'Contacts'},
  {to:'/campaigns',icon:Mail,label:'Campaigns'},
  {to:'/notaries',icon:FileText,label:'Notary Bonds'},
  {to:'/import',icon:Upload,label:'Import'},
];

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
        <div className="px-5 py-6 border-b" style={{borderColor:'var(--border)'}}>
          <div className="text-xs font-mono tracking-widest mb-1" style={{color:'var(--gold)'}}>QUANTUM SURETY</div>
          <div className="font-display text-2xl tracking-wider text-white">CRM</div>
          <div className="gold-line mt-3"/>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({to,icon:Icon,label})=>(
            <NavLink key={to} to={to} end={to==='/'}
              className={({isActive})=>`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all`}
              style={({isActive})=>({background:isActive?'var(--muted)':'transparent',color:isActive?'white':'var(--text-dim)',borderLeft:isActive?'2px solid var(--gold)':'2px solid transparent'})}>
              <Icon size={16}/>{label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t text-xs font-mono" style={{borderColor:'var(--border)',color:'var(--text-dim)'}}>quantumsurety.bond</div>
      </aside>
      <main className="flex-1 overflow-auto" style={{background:'var(--dark)'}}>
        <Routes>
          <Route path="/" element={<Dashboard/>}/>
          <Route path="/contacts" element={<Contacts/>}/>
          <Route path="/campaigns" element={<Campaigns/>}/>
          <Route path="/notaries" element={<Notaries/>}/>
          <Route path="/import" element={<ImportPage/>}/>
        </Routes>
      </main>
    </div>
  );
}
