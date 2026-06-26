import { useState, useEffect, useCallback, useRef } from 'react';

const API = '/api/bookkeeping';

const BOND_TYPES = ['notary','dealer_gdn','contractor','construction','bid','performance','payment','mortgage','credit-access-business','collection-agency','property-tax-consultant'];

const STATUS_COLORS = {
  issued: '#22c55e', expired: '#ef4444', cancelled: '#94a3b8', renewed: '#3b82f6', abandoned: '#f97316', saved: '#6366f1',
  pending: '#f59e0b', collected: '#22c55e', refunded: '#ef4444',
  sent: '#3b82f6', confirmed: '#22c55e',
};

function Badge({ label, color }) {
  return (
    <span style={{background: color+'22', color, border:`1px solid ${color}44`,
      borderRadius:4, padding:'2px 8px', fontSize:11, fontWeight:700, textTransform:'uppercase'}}>
      {label}
    </span>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,
        padding:28,width:560,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <h3 style={{margin:0,fontSize:16,fontWeight:700}}>{title}</h3>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:20}}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FInput({ label, ...props }) {
  return (
    <div style={{marginBottom:14}}>
      {label && <label style={{display:'block',fontSize:12,color:'var(--text-dim)',marginBottom:4}}>{label}</label>}
      <input {...props} style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',
        borderRadius:6,padding:'8px 12px',color:'white',fontSize:14,boxSizing:'border-box', ...props.style}} />
    </div>
  );
}

function FSelect({ label, options, ...props }) {
  return (
    <div style={{marginBottom:14}}>
      {label && <label style={{display:'block',fontSize:12,color:'var(--text-dim)',marginBottom:4}}>{label}</label>}
      <select {...props} style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',
        borderRadius:6,padding:'8px 12px',color:'white',fontSize:14,boxSizing:'border-box', ...props.style}}>
        {options.map(o => <option key={o.value !== undefined ? o.value : o} value={o.value !== undefined ? o.value : o}>{o.label || o}</option>)}
      </select>
    </div>
  );
}

function Btn({ children, variant='primary', ...props }) {
  const bg = variant==='primary'?'var(--gold)':variant==='danger'?'#ef4444':variant==='ghost'?'transparent':'var(--muted)';
  const color = variant==='primary'?'#0a0f1e':variant==='ghost'?'var(--text-dim)':'white';
  return (
    <button {...props} style={{background:bg,color,border:variant==='ghost'?'1px solid var(--border)':'none',
      borderRadius:6,padding:'8px 16px',cursor:props.disabled?'not-allowed':'pointer',fontSize:13,fontWeight:600,
      opacity:props.disabled?0.5:1, ...props.style}}>
      {children}
    </button>
  );
}

function Card({ children, style={} }) {
  return (
    <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:20,...style}}>
      {children}
    </div>
  );
}

function KPI({ label, value, color, isCount }) {
  const num = parseFloat(value || 0);
  const display = isCount ? Math.round(num).toString() : '$' + num.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});
  return (
    <Card style={{flex:1,minWidth:140}}>
      <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>{label}</div>
      <div style={{fontSize:26,fontWeight:800,color:color||'white'}}>{display}</div>
    </Card>
  );
}

// ─── DASHBOARD ─────────────────────────────────────────────────────────────────
function DashboardTab() {
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/dashboard?month=${month}`).then(r=>r.json()).then(d=>{setData(d);setLoading(false);}).catch(()=>setLoading(false));
  }, [month]);

  if (loading && !data) return <div style={{padding:40,textAlign:'center',color:'var(--text-dim)'}}>Loading...</div>;
  if (!data) return <div style={{padding:40,color:'#ef4444'}}>Failed to load dashboard</div>;

  const maxPremium = Math.max(...(data.trend||[]).map(t=>parseFloat(t.premium||0)), 1);

  return (
    <div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
        <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
          style={{background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 12px',color:'white',fontSize:13}} />
      </div>
      <div style={{display:'flex',gap:12,marginBottom:12,flexWrap:'wrap'}}>
        <KPI label="Premiums Collected" value={data.premiums_collected} color="var(--gold)" />
        <KPI label="Commission Earned" value={data.commission_earned} color="#22c55e" />
        <KPI label="Remittances Sent" value={data.remittances_sent} />
        <KPI label="Bonds Issued" value={data.bonds_issued} isCount />
      </div>
      <div style={{display:'flex',gap:12,marginBottom:24,flexWrap:'wrap'}}>
        <KPI label="Overdue Payments" value={data.overdue_payments} color={parseFloat(data.overdue_payments)>0?'#ef4444':undefined} isCount />
        <KPI label="Renewals Due (45d)" value={data.renewals_due} color={parseFloat(data.renewals_due)>0?'#f59e0b':undefined} isCount />
        <KPI label="Trust Balance" value={data.trust_balance} color="#22c55e" />
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
        <Card>
          <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>6-Month Trend</div>
          {data.trend?.length > 0 ? (
            <div style={{display:'flex',gap:6,alignItems:'flex-end',height:80}}>
              {data.trend.map(t => (
                <div key={t.month} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                  <div style={{width:'100%',display:'flex',gap:1,alignItems:'flex-end',height:60}}>
                    <div style={{flex:1,background:'var(--gold)',borderRadius:'2px 2px 0 0',
                      height:`${Math.max(4, Math.round((parseFloat(t.premium||0)/maxPremium)*56))}px`}} title={`Premium: $${t.premium}`} />
                    <div style={{flex:1,background:'#22c55e',borderRadius:'2px 2px 0 0',
                      height:`${Math.max(2, Math.round((parseFloat(t.commission||0)/maxPremium)*56))}px`}} title={`Commission: $${t.commission}`} />
                  </div>
                  <div style={{fontSize:9,color:'var(--text-dim)'}}>{t.month?.slice(5)}</div>
                </div>
              ))}
            </div>
          ) : <div style={{color:'var(--text-dim)',fontSize:13}}>No trend data yet</div>}
          <div style={{display:'flex',gap:12,marginTop:8}}>
            <span style={{fontSize:11,color:'var(--text-dim)'}}><span style={{color:'var(--gold)'}}>■</span> Premium</span>
            <span style={{fontSize:11,color:'var(--text-dim)'}}><span style={{color:'#22c55e'}}>■</span> Commission</span>
          </div>
        </Card>
        <Card>
          <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>By Carrier ({month})</div>
          {data.by_carrier?.length ? data.by_carrier.map(c => (
            <div key={c.carrier_name} style={{display:'flex',justifyContent:'space-between',
              padding:'6px 0',borderBottom:'1px solid var(--border)',fontSize:13}}>
              <span>{c.carrier_name}</span>
              <span style={{color:'var(--text-dim)'}}>{c.bond_count} bonds · <span style={{color:'var(--gold)'}}>${parseFloat(c.total_premium||0).toFixed(0)}</span></span>
            </div>
          )) : <div style={{color:'var(--text-dim)',fontSize:13}}>No data for this month</div>}
        </Card>
      </div>
      <Card>
        <div style={{fontSize:13,fontWeight:700,marginBottom:12}}>Recent Bonds</div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{color:'var(--text-dim)',fontSize:11,textTransform:'uppercase'}}>
              {['Insured','Type','Premium','Carrier','Status'].map(h=>(
                <th key={h} style={{textAlign:'left',padding:'6px 0'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data.recent_bonds||[]).map(b => (
              <tr key={b.id} style={{borderTop:'1px solid var(--border)'}}>
                <td style={{padding:'8px 0'}}>{b.insured_name}</td>
                <td style={{padding:'8px 0',color:'var(--text-dim)'}}>{b.bond_type}</td>
                <td style={{padding:'8px 0',color:'var(--gold)'}}>${parseFloat(b.premium||0).toFixed(2)}</td>
                <td style={{padding:'8px 0',color:'var(--text-dim)'}}>{b.carrier_name}</td>
                <td style={{padding:'8px 0'}}><Badge label={b.status} color={STATUS_COLORS[b.status]||'#94a3b8'} /></td>
              </tr>
            ))}
            {!data.recent_bonds?.length && <tr><td colSpan={5} style={{padding:'16px 0',color:'var(--text-dim)'}}>No bonds yet</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── BONDS TAB ─────────────────────────────────────────────────────────────────
function BondsTab({ carriers }) {
  const [bonds, setBonds] = useState([]);
  const [filters, setFilters] = useState({ carrier_id:'', bond_type:'', status:'', month:'', q:'' });
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [form, setForm] = useState({ bond_number:'',carrier_id:'',insured_name:'',insured_email:'',insured_phone:'',bond_type:'notary',bond_amount:'',premium:'',commission_rate:'',effective_date:'',expiration_date:'',status:'issued',notes:'' });
  const [addPaymentFor, setAddPaymentFor] = useState(null);
  const [payForm, setPayForm] = useState({ amount:'', payment_method:'card', payment_date:'', notes:'' });

  const load = useCallback(() => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,v])=>v)));
    fetch(`${API}/bonds?${p}`).then(r=>r.json()).then(setBonds).catch(()=>{});
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const autoFillRate = async (carrierId, bondType) => {
    if (!carrierId || !bondType) return;
    const r = await fetch(`${API}/carriers/${carrierId}/rate?bond_type=${bondType}`);
    const d = await r.json();
    if (d.commission_pct) setForm(f => ({...f, commission_rate: d.commission_pct}));
  };

  const save = async () => {
    const r = await fetch(`${API}/bonds`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    setShowAdd(false);
    setForm({ bond_number:'',carrier_id:'',insured_name:'',insured_email:'',insured_phone:'',bond_type:'notary',bond_amount:'',premium:'',commission_rate:'',effective_date:'',expiration_date:'',status:'issued',notes:'' });
    load();
  };

  const addPayment = async () => {
    await fetch(`${API}/payments`, { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ bond_id: addPaymentFor, ...payForm }) });
    setAddPaymentFor(null);
    setPayForm({ amount:'', payment_method:'card', payment_date:'', notes:'' });
    load();
  };

  const collectPayment = async (paymentId) => {
    if (!window.confirm('Mark this payment as collected and record trust account entries?')) return;
    const r = await fetch(`${API}/payments/${paymentId}/collect`, { method:'PUT' });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    load();
  };

  const sf = { background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13 };

  return (
    <div>
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'flex-end'}}>
        <select value={filters.carrier_id} onChange={e=>setFilters(f=>({...f,carrier_id:e.target.value}))} style={sf}>
          <option value="">All Carriers</option>
          {carriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.bond_type} onChange={e=>setFilters(f=>({...f,bond_type:e.target.value}))} style={sf}>
          <option value="">All Types</option>
          {BOND_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.status} onChange={e=>setFilters(f=>({...f,status:e.target.value}))} style={sf}>
          <option value="">All Statuses</option>
          {['issued','expired','cancelled','renewed','abandoned','saved','pending'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <input type="month" value={filters.month} onChange={e=>setFilters(f=>({...f,month:e.target.value}))} style={sf} />
        <input placeholder="Search name / bond #" value={filters.q} onChange={e=>setFilters(f=>({...f,q:e.target.value}))} style={{...sf,flex:1,minWidth:150}} />
        <Btn onClick={() => setShowAdd(true)}>+ Add Bond</Btn>
      </div>

      <Card style={{padding:0,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'var(--muted)',color:'var(--text-dim)',fontSize:11,textTransform:'uppercase'}}>
              {['Bond #','Insured','Type','Premium','Commission','Carrier Net','Carrier','Effective','Expires','Status',''].map(h=>(
                <th key={h} style={{textAlign:'left',padding:'10px 14px',whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bonds.map(b => (
              <>
                <tr key={b.id} style={{borderTop:'1px solid var(--border)',cursor:'pointer'}}
                  onClick={() => setExpanded(expanded===b.id?null:b.id)}>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>{b.bond_number||'—'}</td>
                  <td style={{padding:'10px 14px'}}>{b.insured_name}</td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>{b.bond_type}</td>
                  <td style={{padding:'10px 14px',color:'var(--gold)'}}>${parseFloat(b.premium||0).toFixed(2)}</td>
                  <td style={{padding:'10px 14px',color:'#22c55e'}}>${parseFloat(b.commission_amt||0).toFixed(2)}</td>
                  <td style={{padding:'10px 14px'}}>${parseFloat(b.carrier_remit_amt||0).toFixed(2)}</td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>{b.carrier_name}</td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{b.effective_date?.slice(0,10)}</td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{b.expiration_date?.slice(0,10)}</td>
                  <td style={{padding:'10px 14px'}}><Badge label={b.status} color={STATUS_COLORS[b.status]||'#94a3b8'} /></td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>▼</td>
                </tr>
                {expanded === b.id && (
                  <tr key={`${b.id}-exp`}><td colSpan={11} style={{background:'var(--muted)',padding:'14px 20px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                      <strong style={{fontSize:13}}>Payments for {b.insured_name}</strong>
                      <Btn onClick={() => setAddPaymentFor(b.id)} style={{fontSize:12,padding:'5px 12px'}}>+ Add Payment</Btn>
                    </div>
                    {b.payments?.length ? (
                      <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                        <thead><tr style={{color:'var(--text-dim)'}}>
                          {['Amount','Method','Date','Status',''].map(h=><th key={h} style={{textAlign:'left',padding:'4px 8px'}}>{h}</th>)}
                        </tr></thead>
                        <tbody>{b.payments.map(py=>(
                          <tr key={py.id} style={{borderTop:'1px solid var(--border)'}}>
                            <td style={{padding:'6px 8px',color:'var(--gold)'}}>${parseFloat(py.amount).toFixed(2)}</td>
                            <td style={{padding:'6px 8px',color:'var(--text-dim)'}}>{py.payment_method}</td>
                            <td style={{padding:'6px 8px',color:'var(--text-dim)'}}>{py.payment_date?.slice(0,10)||'—'}</td>
                            <td style={{padding:'6px 8px'}}><Badge label={py.status} color={STATUS_COLORS[py.status]||'#94a3b8'} /></td>
                            <td style={{padding:'6px 8px'}}>
                              {py.status==='pending' && <Btn onClick={()=>collectPayment(py.id)} style={{fontSize:11,padding:'3px 10px'}}>Collect</Btn>}
                            </td>
                          </tr>
                        ))}</tbody>
                      </table>
                    ) : <div style={{color:'var(--text-dim)',fontSize:12}}>No payments recorded</div>}
                  </td></tr>
                )}
              </>
            ))}
            {!bonds.length && <tr><td colSpan={11} style={{padding:'24px 14px',color:'var(--text-dim)',textAlign:'center'}}>No bonds found</td></tr>}
          </tbody>
        </table>
      </Card>

      {showAdd && (
        <Modal title="Add Bond" onClose={() => setShowAdd(false)}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
            <FInput label="Bond Number" value={form.bond_number} onChange={e=>setForm(f=>({...f,bond_number:e.target.value}))} />
            <FSelect label="Carrier" value={form.carrier_id}
              onChange={e=>{const v=e.target.value;setForm(f=>({...f,carrier_id:v}));autoFillRate(v,form.bond_type);}}
              options={[{value:'',label:'Select carrier'},...carriers.map(c=>({value:c.id,label:c.name}))]} />
            <FInput label="Insured Name" value={form.insured_name} onChange={e=>setForm(f=>({...f,insured_name:e.target.value}))} />
            <FInput label="Insured Email" type="email" value={form.insured_email} onChange={e=>setForm(f=>({...f,insured_email:e.target.value}))} />
            <FInput label="Phone" value={form.insured_phone} onChange={e=>setForm(f=>({...f,insured_phone:e.target.value}))} />
            <div style={{marginBottom:14}}>
              <label style={{display:'block',fontSize:12,color:'var(--text-dim)',marginBottom:4}}>Bond Type</label>
              <select value={form.bond_type}
                onChange={e=>{const v=e.target.value;setForm(f=>({...f,bond_type:v}));autoFillRate(form.carrier_id,v);}}
                style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',color:'white',fontSize:14}}>
                {BOND_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <FInput label="Bond Amount ($)" type="number" value={form.bond_amount} onChange={e=>setForm(f=>({...f,bond_amount:e.target.value}))} />
            <FInput label="Premium ($)" type="number" value={form.premium} onChange={e=>setForm(f=>({...f,premium:e.target.value}))} />
            <FInput label="Commission Rate (e.g. 0.20)" type="number" step="0.01" value={form.commission_rate} onChange={e=>setForm(f=>({...f,commission_rate:e.target.value}))} />
            <FSelect label="Status" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}
              options={['issued','expired','cancelled','renewed','abandoned','saved','pending']} />
            <FInput label="Effective Date" type="date" value={form.effective_date} onChange={e=>setForm(f=>({...f,effective_date:e.target.value}))} />
            <FInput label="Expiration Date" type="date" value={form.expiration_date} onChange={e=>setForm(f=>({...f,expiration_date:e.target.value}))} />
          </div>
          <FInput label="Notes" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
            <Btn onClick={save}>Save Bond</Btn>
          </div>
        </Modal>
      )}

      {addPaymentFor && (
        <Modal title="Add Payment" onClose={() => setAddPaymentFor(null)}>
          <FInput label="Amount ($)" type="number" value={payForm.amount} onChange={e=>setPayForm(f=>({...f,amount:e.target.value}))} />
          <FSelect label="Method" value={payForm.payment_method} onChange={e=>setPayForm(f=>({...f,payment_method:e.target.value}))}
            options={['card','ach','check','wire']} />
          <FInput label="Payment Date" type="date" value={payForm.payment_date} onChange={e=>setPayForm(f=>({...f,payment_date:e.target.value}))} />
          <FInput label="Notes" value={payForm.notes} onChange={e=>setPayForm(f=>({...f,notes:e.target.value}))} />
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={() => setAddPaymentFor(null)}>Cancel</Btn>
            <Btn onClick={addPayment}>Save Payment</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── PAYMENTS TAB ──────────────────────────────────────────────────────────────
function PaymentsTab() {
  const [payments, setPayments] = useState([]);
  const [filters, setFilters] = useState({ status:'', month:'' });
  const sf = { background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13 };

  const load = useCallback(() => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,v])=>v)));
    fetch(`${API}/payments?${p}`).then(r=>r.json()).then(setPayments).catch(()=>{});
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const collect = async (id) => {
    if (!window.confirm('Mark as collected and record trust entries?')) return;
    const r = await fetch(`${API}/payments/${id}/collect`, { method:'PUT' });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    load();
  };

  return (
    <div>
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        <select value={filters.status} onChange={e=>setFilters(f=>({...f,status:e.target.value}))} style={sf}>
          <option value="">All Statuses</option>
          {['pending','collected','refunded'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <input type="month" value={filters.month} onChange={e=>setFilters(f=>({...f,month:e.target.value}))} style={sf} />
      </div>
      <Card style={{padding:0,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'var(--muted)',color:'var(--text-dim)',fontSize:11,textTransform:'uppercase'}}>
              {['Insured','Bond Type','Bond #','Carrier','Amount','Method','Date','Status',''].map(h=>(
                <th key={h} style={{textAlign:'left',padding:'10px 14px'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payments.map(py => (
              <tr key={py.id} style={{borderTop:'1px solid var(--border)'}}>
                <td style={{padding:'10px 14px'}}>{py.insured_name}</td>
                <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>{py.bond_type}</td>
                <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>{py.bond_number||'—'}</td>
                <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>{py.carrier_name}</td>
                <td style={{padding:'10px 14px',color:'var(--gold)'}}>${parseFloat(py.amount).toFixed(2)}</td>
                <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>{py.payment_method}</td>
                <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>{py.payment_date?.slice(0,10)||'—'}</td>
                <td style={{padding:'10px 14px'}}><Badge label={py.status} color={STATUS_COLORS[py.status]||'#94a3b8'} /></td>
                <td style={{padding:'10px 14px'}}>
                  {py.status==='pending' && <Btn onClick={()=>collect(py.id)} style={{fontSize:11,padding:'4px 10px'}}>Collect</Btn>}
                </td>
              </tr>
            ))}
            {!payments.length && <tr><td colSpan={9} style={{padding:'24px 14px',color:'var(--text-dim)',textAlign:'center'}}>No payments</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── TRUST ACCOUNT ─────────────────────────────────────────────────────────────
function TrustTab() {
  const [data, setData] = useState({ entries:[], current_balance:0 });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(() => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries({from,to}).filter(([,v])=>v)));
    fetch(`${API}/trust?${p}`).then(r=>r.json()).then(setData).catch(()=>{});
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const typeColor = { premium_in:'#22c55e', commission_out:'var(--gold)', remittance_out:'#ef4444', adjustment:'#3b82f6' };
  const sf = { background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13 };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div style={{background:'var(--surface)',border:'2px solid #22c55e',borderRadius:12,padding:'12px 24px'}}>
          <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:4}}>CURRENT TRUST BALANCE</div>
          <div style={{fontSize:32,fontWeight:800,color:'#22c55e'}}>${parseFloat(data.current_balance||0).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={sf} />
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={sf} />
          <Btn variant="ghost" onClick={() => window.location.assign(`${API}/export/trust?from=${from}&to=${to}`)}>Export CSV</Btn>
        </div>
      </div>
      <Card style={{padding:0,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'var(--muted)',color:'var(--text-dim)',fontSize:11,textTransform:'uppercase'}}>
              {['Date','Type','Amount','Balance','Insured','Description'].map(h=>(
                <th key={h} style={{textAlign:'left',padding:'10px 14px'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.entries.map(e => (
              <tr key={e.id} style={{borderTop:'1px solid var(--border)'}}>
                <td style={{padding:'10px 14px',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{e.entry_date?.slice(0,10)}</td>
                <td style={{padding:'10px 14px'}}><Badge label={e.entry_type} color={typeColor[e.entry_type]||'#94a3b8'} /></td>
                <td style={{padding:'10px 14px',color:parseFloat(e.amount)>=0?'#22c55e':'#ef4444',fontWeight:600}}>
                  {parseFloat(e.amount)>=0?'+':''}{parseFloat(e.amount).toFixed(2)}
                </td>
                <td style={{padding:'10px 14px',color:'var(--gold)',fontWeight:600}}>${parseFloat(e.running_balance||0).toFixed(2)}</td>
                <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>{e.insured_name||'—'}</td>
                <td style={{padding:'10px 14px',color:'var(--text-dim)',maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.description}</td>
              </tr>
            ))}
            {!data.entries.length && <tr><td colSpan={6} style={{padding:'24px 14px',color:'var(--text-dim)',textAlign:'center'}}>No entries</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── REMITTANCES ───────────────────────────────────────────────────────────────
function RemittancesTab({ carriers }) {
  const [remittances, setRemittances] = useState([]);
  const [filters, setFilters] = useState({ carrier_id:'', status:'' });
  const [showGen, setShowGen] = useState(false);
  const [genForm, setGenForm] = useState({ carrier_id:'', period_start:'', period_end:'' });
  const [expanded, setExpanded] = useState(null);
  const [remBonds, setRemBonds] = useState({});
  const sf = { background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13 };

  const load = useCallback(() => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,v])=>v)));
    fetch(`${API}/remittances?${p}`).then(r=>r.json()).then(setRemittances).catch(()=>{});
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const loadBonds = async (id) => {
    if (remBonds[id]) return;
    const r = await fetch(`${API}/remittances/${id}/bonds`);
    const d = await r.json();
    setRemBonds(b => ({...b, [id]: d}));
  };

  const toggleExpand = (id) => {
    const next = expanded===id?null:id;
    setExpanded(next);
    if (next) loadBonds(next);
  };

  const generate = async () => {
    const r = await fetch(`${API}/remittances/generate`, { method:'POST',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(genForm) });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    setShowGen(false);
    load();
  };

  const updateStatus = async (id, status) => {
    if (!window.confirm(`Mark remittance as ${status}?`)) return;
    const r = await fetch(`${API}/remittances/${id}/status`, { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    load();
  };

  return (
    <div>
      <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'flex-end',flexWrap:'wrap'}}>
        <select value={filters.carrier_id} onChange={e=>setFilters(f=>({...f,carrier_id:e.target.value}))} style={sf}>
          <option value="">All Carriers</option>
          {carriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.status} onChange={e=>setFilters(f=>({...f,status:e.target.value}))} style={sf}>
          <option value="">All Statuses</option>
          {['pending','sent','confirmed'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <Btn onClick={() => setShowGen(true)}>⚡ Generate Remittance</Btn>
        <Btn variant="ghost" onClick={() => window.location.assign(`${API}/export/remittances`)}>Export CSV</Btn>
      </div>

      <Card style={{padding:0,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'var(--muted)',color:'var(--text-dim)',fontSize:11,textTransform:'uppercase'}}>
              {['Carrier','Period','Bonds','Premium','Commission','Net Remit','Status','Auto','Actions'].map(h=>(
                <th key={h} style={{textAlign:'left',padding:'10px 14px'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {remittances.map(r => (
              <>
                <tr key={r.id} style={{borderTop:'1px solid var(--border)',cursor:'pointer'}} onClick={()=>toggleExpand(r.id)}>
                  <td style={{padding:'10px 14px'}}>{r.carrier_name}</td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{r.period_start?.slice(0,10)} – {r.period_end?.slice(0,10)}</td>
                  <td style={{padding:'10px 14px'}}>{r.bond_count}</td>
                  <td style={{padding:'10px 14px',color:'var(--gold)'}}>${parseFloat(r.total_premium||0).toFixed(2)}</td>
                  <td style={{padding:'10px 14px',color:'#22c55e'}}>${parseFloat(r.total_commission||0).toFixed(2)}</td>
                  <td style={{padding:'10px 14px'}}>${parseFloat(r.total_remitted||0).toFixed(2)}</td>
                  <td style={{padding:'10px 14px'}}><Badge label={r.status} color={STATUS_COLORS[r.status]||'#94a3b8'} /></td>
                  <td style={{padding:'10px 14px'}}>{r.auto_generated?'⚡':'—'}</td>
                  <td style={{padding:'10px 14px'}} onClick={e=>e.stopPropagation()}>
                    {r.status==='pending' && <Btn onClick={()=>updateStatus(r.id,'sent')} style={{fontSize:11,padding:'3px 10px',marginRight:4}}>Mark Sent</Btn>}
                    {r.status==='sent' && <Btn onClick={()=>updateStatus(r.id,'confirmed')} style={{fontSize:11,padding:'3px 10px'}}>Confirm</Btn>}
                  </td>
                </tr>
                {expanded===r.id && (
                  <tr key={`${r.id}-exp`}><td colSpan={9} style={{background:'var(--muted)',padding:'14px 20px'}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:8}}>Bonds in this remittance</div>
                    {remBonds[r.id] ? (
                      remBonds[r.id].length ? (
                        <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                          <thead><tr style={{color:'var(--text-dim)'}}>
                            {['Bond #','Insured','Type','Premium','Comm','Net'].map(h=><th key={h} style={{textAlign:'left',padding:'4px 8px'}}>{h}</th>)}
                          </tr></thead>
                          <tbody>{remBonds[r.id].map(b=>(
                            <tr key={b.id} style={{borderTop:'1px solid var(--border)'}}>
                              <td style={{padding:'5px 8px',color:'var(--text-dim)'}}>{b.bond_number||'—'}</td>
                              <td style={{padding:'5px 8px'}}>{b.insured_name}</td>
                              <td style={{padding:'5px 8px',color:'var(--text-dim)'}}>{b.bond_type}</td>
                              <td style={{padding:'5px 8px',color:'var(--gold)'}}>${parseFloat(b.premium||0).toFixed(2)}</td>
                              <td style={{padding:'5px 8px',color:'#22c55e'}}>${parseFloat(b.commission_amt||0).toFixed(2)}</td>
                              <td style={{padding:'5px 8px'}}>${parseFloat(b.carrier_remit_amt||0).toFixed(2)}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      ) : <div style={{color:'var(--text-dim)'}}>No bonds</div>
                    ) : <div style={{color:'var(--text-dim)'}}>Loading...</div>}
                  </td></tr>
                )}
              </>
            ))}
            {!remittances.length && <tr><td colSpan={9} style={{padding:'24px 14px',color:'var(--text-dim)',textAlign:'center'}}>No remittances</td></tr>}
          </tbody>
        </table>
      </Card>

      {showGen && (
        <Modal title="Generate Remittance" onClose={() => setShowGen(false)}>
          <FSelect label="Carrier" value={genForm.carrier_id} onChange={e=>setGenForm(f=>({...f,carrier_id:e.target.value}))}
            options={[{value:'',label:'Select carrier'},...carriers.map(c=>({value:c.id,label:c.name}))]} />
          <FInput label="Period Start" type="date" value={genForm.period_start} onChange={e=>setGenForm(f=>({...f,period_start:e.target.value}))} />
          <FInput label="Period End" type="date" value={genForm.period_end} onChange={e=>setGenForm(f=>({...f,period_end:e.target.value}))} />
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={() => setShowGen(false)}>Cancel</Btn>
            <Btn onClick={generate}>Generate</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── CARRIERS TAB ──────────────────────────────────────────────────────────────
function CarriersTab({ carriers, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name:'', naic_code:'', contact_name:'', contact_email:'', contact_phone:'', remittance_schedule:'monthly', remittance_day:15 });
  const [rateForm, setRateForm] = useState({ bond_type:'notary', commission_pct:'', min_premium:'' });
  const [rateCarrier, setRateCarrier] = useState(null);

  const save = async () => {
    const r = await fetch(`${API}/carriers`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
    const d = await r.json();
    if (d.error) { alert(d.error); return; }
    setShowAdd(false);
    setForm({ name:'', naic_code:'', contact_name:'', contact_email:'', contact_phone:'', remittance_schedule:'monthly', remittance_day:15 });
    onRefresh();
  };

  const saveRate = async (carrierId) => {
    await fetch(`${API}/carriers/${carrierId}/rates`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rateForm) });
    setRateCarrier(null);
    setRateForm({ bond_type:'notary', commission_pct:'', min_premium:'' });
    onRefresh();
  };

  const deactivate = async (carrier) => {
    if (!window.confirm(`Deactivate ${carrier.name}?`)) return;
    await fetch(`${API}/carriers/${carrier.id}`, { method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ ...carrier, active: false }) });
    onRefresh();
  };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:16}}>
        <Btn onClick={() => setShowAdd(true)}>+ Add Carrier</Btn>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:16}}>
        {carriers.map(c => (
          <Card key={c.id}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
              <div>
                <div style={{fontWeight:700,fontSize:15}}>{c.name}</div>
                {c.naic_code && <div style={{fontSize:11,color:'var(--text-dim)'}}>NAIC #{c.naic_code}</div>}
              </div>
              <Badge label={c.active?'Active':'Inactive'} color={c.active?'#22c55e':'#94a3b8'} />
            </div>
            {c.contact_email && <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:4}}>✉ {c.contact_email}</div>}
            {c.contact_phone && <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:4}}>✆ {c.contact_phone}</div>}
            <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:12}}>Remittance: day {c.remittance_day} ({c.remittance_schedule})</div>
            {c.rates?.length > 0 && (
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:6,textTransform:'uppercase'}}>Commission Rates</div>
                {c.rates.map(r => (
                  <div key={r.id} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0',borderTop:'1px solid var(--border)'}}>
                    <span>{r.bond_type}</span>
                    <span style={{color:'var(--gold)'}}>{(parseFloat(r.commission_pct||0)*100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{display:'flex',gap:6}}>
              <Btn variant="ghost" onClick={() => setRateCarrier(c.id)} style={{fontSize:12,padding:'4px 10px'}}>+ Rate</Btn>
              {c.active && <Btn variant="danger" onClick={() => deactivate(c)} style={{fontSize:12,padding:'4px 10px'}}>Deactivate</Btn>}
            </div>
          </Card>
        ))}
        {!carriers.length && <div style={{color:'var(--text-dim)',padding:20}}>No carriers yet</div>}
      </div>

      {showAdd && (
        <Modal title="Add Carrier" onClose={() => setShowAdd(false)}>
          <FInput label="Carrier Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} />
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
            <FInput label="NAIC Code" value={form.naic_code} onChange={e=>setForm(f=>({...f,naic_code:e.target.value}))} />
            <FInput label="Contact Name" value={form.contact_name} onChange={e=>setForm(f=>({...f,contact_name:e.target.value}))} />
            <FInput label="Contact Email" type="email" value={form.contact_email} onChange={e=>setForm(f=>({...f,contact_email:e.target.value}))} />
            <FInput label="Contact Phone" value={form.contact_phone} onChange={e=>setForm(f=>({...f,contact_phone:e.target.value}))} />
            <FSelect label="Schedule" value={form.remittance_schedule} onChange={e=>setForm(f=>({...f,remittance_schedule:e.target.value}))}
              options={[{value:'monthly',label:'Monthly'},{value:'quarterly',label:'Quarterly'}]} />
            <FInput label="Day of Month" type="number" min="1" max="28" value={form.remittance_day} onChange={e=>setForm(f=>({...f,remittance_day:parseInt(e.target.value)}))} />
          </div>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
            <Btn onClick={save}>Save Carrier</Btn>
          </div>
        </Modal>
      )}

      {rateCarrier && (
        <Modal title="Add Commission Rate" onClose={() => setRateCarrier(null)}>
          <FSelect label="Bond Type" value={rateForm.bond_type} onChange={e=>setRateForm(f=>({...f,bond_type:e.target.value}))}
            options={BOND_TYPES} />
          <FInput label="Commission % (e.g. 0.20 for 20%)" type="number" step="0.01" value={rateForm.commission_pct}
            onChange={e=>setRateForm(f=>({...f,commission_pct:e.target.value}))} />
          <FInput label="Min Premium ($)" type="number" value={rateForm.min_premium}
            onChange={e=>setRateForm(f=>({...f,min_premium:e.target.value}))} />
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={() => setRateCarrier(null)}>Cancel</Btn>
            <Btn onClick={() => saveRate(rateCarrier)}>Save Rate</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── REPORTS TAB ───────────────────────────────────────────────────────────────
function ReportsTab() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7));
  const [toast, setToast] = useState(null);
  const [running, setRunning] = useState(false);
  // Expense report
  const [expFrom, setExpFrom] = useState('');
  const [expTo, setExpTo] = useState('');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  const [emailSending, setEmailSending] = useState(false);

  const setPreset = (preset) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (preset === 'this_month') {
      setExpFrom(new Date(y, m, 1).toISOString().slice(0,10));
      setExpTo(new Date(y, m+1, 0).toISOString().slice(0,10));
    } else if (preset === 'last_month') {
      setExpFrom(new Date(y, m-1, 1).toISOString().slice(0,10));
      setExpTo(new Date(y, m, 0).toISOString().slice(0,10));
    } else if (preset === 'this_year') {
      setExpFrom(`${y}-01-01`);
      setExpTo(`${y}-12-31`);
    } else if (preset === 'last_year') {
      setExpFrom(`${y-1}-01-01`);
      setExpTo(`${y-1}-12-31`);
    } else if (preset === 'q1') { setExpFrom(`${y}-01-01`); setExpTo(`${y}-03-31`);
    } else if (preset === 'q2') { setExpFrom(`${y}-04-01`); setExpTo(`${y}-06-30`);
    } else if (preset === 'q3') { setExpFrom(`${y}-07-01`); setExpTo(`${y}-09-30`);
    } else if (preset === 'q4') { setExpFrom(`${y}-10-01`); setExpTo(`${y}-12-31`);
    }
  };

  const downloadExp = (type) => {
    const p = new URLSearchParams();
    if (expFrom) p.set('from', expFrom);
    if (expTo)   p.set('to',   expTo);
    window.location.assign(`${API}/export/${type}?${p}`);
  };

  const sendExpEmail = async () => {
    if (!emailTo) return;
    setEmailSending(true);
    try {
      const r = await fetch(`${API}/expenses/email-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: emailTo, from_date: expFrom||undefined, to_date: expTo||undefined, message: emailMsg||undefined }),
      });
      const d = await r.json();
      if (d.ok) { setToast('Expense report sent!'); setShowEmailModal(false); }
      else setToast('Send failed: ' + d.error);
    } catch { setToast('Send error'); }
    setEmailSending(false);
  };

  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }
  }, [toast]);

  const runJobs = async () => {
    setRunning(true);
    try {
      const r = await fetch(`${API}/jobs/run-all`, { method:'POST' });
      const d = await r.json();
      setToast(`Done: ${d.renewal?.count||0} renewal alerts, ${d.payment?.count||0} payment alerts, ${d.remit?.generated?.length||0} auto-remittances`);
    } catch { setToast('Error running jobs'); }
    setRunning(false);
  };

  const runJob = async (path, label) => {
    const r = await fetch(`${API}/jobs/${path}`, { method:'POST' });
    const d = await r.json();
    setToast(`${label}: ${JSON.stringify(d)}`);
  };

  const [narrative, setNarrative] = useState(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [anomalies, setAnomalies] = useState(null);
  const [anomalyLoading, setAnomalyLoading] = useState(false);

  const genNarrative = async () => {
    setNarrativeLoading(true);
    try {
      const r = await fetch(`${API}/ai/narrative`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ month }) });
      setNarrative(await r.json());
    } catch {}
    setNarrativeLoading(false);
  };

  const checkAnomalies = async () => {
    setAnomalyLoading(true);
    try {
      const r = await fetch(`${API}/ai/anomalies?month=${month}`);
      setAnomalies(await r.json());
    } catch {}
    setAnomalyLoading(false);
  };

  const ANOMALY_COLORS = { high:'#ef4444', medium:'#f59e0b', low:'#6366f1' };

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
        <Card>
          <div style={{fontWeight:700,fontSize:14,marginBottom:16}}>Export Data</div>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:12,color:'var(--text-dim)',display:'block',marginBottom:6}}>Month Filter</label>
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
              style={{background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13}} />
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <Btn variant="ghost" onClick={() => window.location.assign(`${API}/export/bonds?month=${month}`)}>⬇ Bonds CSV</Btn>
            <Btn variant="ghost" onClick={() => window.location.assign(`${API}/export/commission?month=${month}`)}>⬇ Commission CSV</Btn>
            <Btn variant="ghost" onClick={() => window.location.assign(`${API}/export/remittances`)}>⬇ Remittances CSV</Btn>
            <Btn variant="ghost" onClick={() => window.location.assign(`${API}/export/trust`)}>⬇ Trust Ledger CSV</Btn>
          </div>
        </Card>
        <Card>
          <div style={{fontWeight:700,fontSize:14,marginBottom:16}}>Automation Jobs</div>
          <div style={{fontSize:13,color:'var(--text-dim)',marginBottom:16}}>Run manually or schedule via cron on VPS2.</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <Btn onClick={runJobs} disabled={running}>{running?'Running...':'⚡ Run All Jobs Now'}</Btn>
            <Btn variant="ghost" onClick={()=>runJob('renewal-scan','Renewal scan')}>Renewal Scan Only</Btn>
            <Btn variant="ghost" onClick={()=>runJob('payment-overdue-scan','Payment scan')}>Payment Overdue Scan</Btn>
            <Btn variant="ghost" onClick={()=>runJob('auto-remittance','Auto-remittance')}>Auto-Remittance</Btn>
          </div>
        </Card>

        {/* AI Monthly Narrative */}
        <Card style={{gridColumn:'1/-1'}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>???? AI Monthly Narrative</div>
          <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
            <span style={{fontSize:13,color:'var(--text-dim)'}}>Month:</span>
            <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
              style={{background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13}}/>
            <Btn onClick={genNarrative} disabled={narrativeLoading}>{narrativeLoading?'Claude is writing???':'Generate Narrative'}</Btn>
            <Btn onClick={checkAnomalies} disabled={anomalyLoading} style={{background:'#f59e0b',color:'#000'}}>{anomalyLoading?'Analyzing???':'???? Check for Anomalies'}</Btn>
          </div>

          {narrative && (
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',gap:12,marginBottom:12,flexWrap:'wrap'}}>
                {[['Revenue',`$${parseFloat(narrative.summary?.revenue||0).toFixed(2)}`,'#22c55e'],
                  ['Expenses',`$${parseFloat(narrative.summary?.total_expenses||0).toFixed(2)}`,'#ef4444'],
                  ['Net Income',`$${parseFloat(narrative.summary?.net_income||0).toFixed(2)}`,parseFloat(narrative.summary?.net_income||0)>=0?'#22c55e':'#ef4444'],
                  ['Bonds Issued',`${narrative.summary?.bond_count||0}`,'var(--gold)']].map(([l,v,c])=>(
                  <div key={l} style={{background:'var(--muted)',borderRadius:8,padding:'10px 16px',flex:1,minWidth:120,textAlign:'center'}}>
                    <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:4,textTransform:'uppercase',letterSpacing:1}}>{l}</div>
                    <div style={{fontSize:18,fontWeight:800,color:c}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{background:'rgba(99,102,241,0.08)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:8,padding:'16px 20px',fontSize:14,lineHeight:1.8,color:'white',whiteSpace:'pre-wrap'}}>
                {narrative.narrative}
              </div>
            </div>
          )}

          {anomalies && anomalies.anomalies?.length > 0 && (
            <div>
              <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:'#f59e0b'}}>??? Anomalies Detected</div>
              {anomalies.anomalies.map((a,i)=>(
                <div key={i} style={{display:'flex',gap:12,padding:'10px 14px',borderRadius:8,marginBottom:6,background:'var(--muted)',border:`1px solid ${ANOMALY_COLORS[a.severity]||'#6b7280'}22`}}>
                  <span style={{color:ANOMALY_COLORS[a.severity]||'#6b7280',fontSize:12,fontWeight:700,minWidth:50,textTransform:'uppercase'}}>{a.severity}</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:600}}>{a.message}</div>
                    <div style={{fontSize:12,color:'var(--text-dim)',marginTop:2}}>{a.action}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {anomalies && (!anomalies.anomalies?.length) && (
            <div style={{fontSize:13,color:'#22c55e',padding:'8px 14px',background:'rgba(34,197,94,0.08)',borderRadius:8,border:'1px solid rgba(34,197,94,0.3)'}}>
              ??? No anomalies detected for {month}
            </div>
          )}
        </Card>

        {/* Expense Report */}
        <Card style={{gridColumn:'1/-1'}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:16}}>Expense Report ??? Accountant Export</div>
          <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
            {[['this_month','This Month'],['last_month','Last Month'],['q1','Q1'],['q2','Q2'],['q3','Q3'],['q4','Q4'],['this_year','This Year'],['last_year','Last Year']].map(([v,l])=>(
              <button key={v} onClick={()=>setPreset(v)}
                style={{fontSize:12,padding:'5px 12px',borderRadius:6,border:'1px solid var(--border)',background:'var(--muted)',color:'white',cursor:'pointer'}}>{l}</button>
            ))}
          </div>
          <div style={{display:'flex',gap:8,marginBottom:16,alignItems:'center',flexWrap:'wrap'}}>
            <div>
              <label style={{fontSize:11,color:'var(--text-dim)',display:'block',marginBottom:3}}>From</label>
              <input type="date" value={expFrom} onChange={e=>setExpFrom(e.target.value)}
                style={{background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'6px 10px',color:'white',fontSize:13}}/>
            </div>
            <div>
              <label style={{fontSize:11,color:'var(--text-dim)',display:'block',marginBottom:3}}>To</label>
              <input type="date" value={expTo} onChange={e=>setExpTo(e.target.value)}
                style={{background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'6px 10px',color:'white',fontSize:13}}/>
            </div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <Btn variant="ghost" onClick={()=>downloadExp('expenses')}>??? Detail CSV</Btn>
            <Btn variant="ghost" onClick={()=>downloadExp('expenses-summary')}>??? Summary CSV</Btn>
            <Btn onClick={()=>setShowEmailModal(true)}>??? Email to Accountant</Btn>
          </div>
        </Card>
      </div>
      {showEmailModal && (
        <Modal title="Email Expense Report to Accountant" onClose={()=>setShowEmailModal(false)}>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:12,color:'var(--text-dim)',display:'block',marginBottom:4}}>Recipient Email</label>
            <input value={emailTo} onChange={e=>setEmailTo(e.target.value)} placeholder="accountant@example.com"
              style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',color:'white',fontSize:14,boxSizing:'border-box'}}/>
          </div>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:12,color:'var(--text-dim)',display:'block',marginBottom:4}}>Optional Note</label>
            <textarea value={emailMsg} onChange={e=>setEmailMsg(e.target.value)} rows={3}
              placeholder="Here are the expense reports for your review..."
              style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',color:'white',fontSize:14,boxSizing:'border-box',resize:'vertical'}}/>
          </div>
          <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:16}}>
            Period: {expFrom||'all'} {expTo ? `??? ${expTo}` : ''}
          </div>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <Btn variant="ghost" onClick={()=>setShowEmailModal(false)}>Cancel</Btn>
            <Btn onClick={sendExpEmail} disabled={emailSending}>{emailSending?'Sending...':'Send Report'}</Btn>
          </div>
        </Modal>
      )}
      {toast && (
        <div style={{position:'fixed',bottom:24,right:24,background:'#1e293b',border:'1px solid var(--gold)',
          color:'white',padding:'12px 20px',borderRadius:8,fontSize:13,zIndex:999,boxShadow:'0 4px 12px rgba(0,0,0,0.5)'}}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── ALERTS TAB ────────────────────────────────────────────────────────────────
function AlertsTab() {
  const [data, setData] = useState({ renewals:[], payments:[], scraper:[] });

  const load = () => fetch(`${API}/alerts`).then(r=>r.json()).then(setData).catch(()=>{});
  useEffect(() => { load(); }, []);

  const updateRenewal = async (id, status) => {
    await fetch(`${API}/alerts/renewal/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
    load();
  };

  const updatePayment = async (id, status) => {
    await fetch(`${API}/alerts/payment/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
    load();
  };

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
      <Card>
        <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Renewal Alerts ({data.renewals.length})</div>
        {data.renewals.length ? data.renewals.map(a => (
          <div key={a.id} style={{borderTop:'1px solid var(--border)',padding:'10px 0'}}>
            <div style={{fontSize:13,fontWeight:600}}>{a.insured_name}</div>
            <div style={{fontSize:11,color:'var(--text-dim)'}}>{a.bond_type} · expires {a.expiration_date?.slice(0,10)}</div>
            {a.insured_email && <div style={{fontSize:11,color:'var(--text-dim)'}}>{a.insured_email}</div>}
            <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
              <Badge label={a.status} color={STATUS_COLORS[a.status]||'#94a3b8'} />
              {a.status==='pending' && <Btn onClick={()=>updateRenewal(a.id,'sent')} style={{fontSize:11,padding:'3px 8px'}}>Mark Sent</Btn>}
              <Btn variant="ghost" onClick={()=>updateRenewal(a.id,'dismissed')} style={{fontSize:11,padding:'3px 8px'}}>Dismiss</Btn>
            </div>
          </div>
        )) : <div style={{color:'var(--text-dim)',fontSize:13}}>No renewal alerts — run renewal scan</div>}
      </Card>
      <Card>
        <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Overdue Payments ({data.payments.length})</div>
        {data.payments.length ? data.payments.map(a => (
          <div key={a.id} style={{borderTop:'1px solid var(--border)',padding:'10px 0'}}>
            <div style={{fontSize:13,fontWeight:600}}>{a.insured_name}</div>
            <div style={{fontSize:11,color:'var(--text-dim)'}}>{a.bond_type} · {a.overdue_days}d overdue · ${parseFloat(a.premium||0).toFixed(2)}</div>
            {a.insured_email && <div style={{fontSize:11,color:'var(--text-dim)'}}>{a.insured_email}</div>}
            <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
              <Badge label={a.status} color={STATUS_COLORS[a.status]||'#94a3b8'} />
              {a.status==='pending' && <Btn onClick={()=>updatePayment(a.id,'contacted')} style={{fontSize:11,padding:'3px 8px'}}>Mark Contacted</Btn>}
              <Btn variant="ghost" onClick={()=>updatePayment(a.id,'dismissed')} style={{fontSize:11,padding:'3px 8px'}}>Dismiss</Btn>
            </div>
          </div>
        )) : <div style={{color:'var(--text-dim)',fontSize:13}}>No overdue payment alerts</div>}
      </Card>
      {data.scraper?.length > 0 && (
        <Card style={{gridColumn:'1/-1'}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Scraper Flags ({data.scraper.length})</div>
          {data.scraper.map(s => (
            <div key={s.id} style={{borderTop:'1px solid var(--border)',padding:'8px 0',fontSize:12,display:'flex',gap:8,alignItems:'center'}}>
              <Badge label={s.flag} color='#f59e0b' />
              <span style={{color:'var(--text-dim)'}}>{s.external_id} · {s.scraper_source}</span>
              {s.insured_name && <span>{s.insured_name}</span>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ─── ROOT ──────────────────────────────────────────────────────────────────────

// ─── EXPENSES TAB ──────────────────────────────────────────────────────────────
function ExpensesTab() {
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState([]);
  const [filters, setFilters] = useState({ month: new Date().toISOString().slice(0,7), category_id: '', q: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [uploading, setUploading] = useState(null);
  const [form, setForm] = useState({ category_id:'', vendor:'', description:'', amount:'', expense_date: new Date().toISOString().slice(0,10), payment_method:'card', reference_number:'', notes:'' });
  const fileRef = { current: null };
  const [ocrLoading, setOcrLoading] = useState(false);
  const [catSuggestion, setCatSuggestion] = useState(null);
  const [catLoading, setCatLoading] = useState(false);
  const ocrRef = useRef(null);

  const scanReceipt = async (file) => {
    setOcrLoading(true);
    const fd = new FormData();
    fd.append('receipt', file);
    try {
      const r = await fetch(`${API}/ai/ocr`, { method:'POST', body:fd });
      const d = await r.json();
      if (d.ok && d.data) {
        const cat = categories.find(c => c.name === d.data.suggested_category);
        setForm(f => ({
          ...f,
          vendor: d.data.vendor || f.vendor,
          amount: d.data.amount ? String(d.data.amount) : f.amount,
          expense_date: d.data.date || f.expense_date,
          description: d.data.description || f.description,
          category_id: cat ? cat.id : f.category_id,
        }));
        if (cat) setCatSuggestion({ category_name: cat.name, reason: 'Detected from receipt', confidence: d.data.confidence || 0.9 });
      }
    } catch {}
    setOcrLoading(false);
  };

  const suggestCategory = async (vendor, description) => {
    if (!vendor && !description) return;
    setCatLoading(true);
    try {
      const r = await fetch(`${API}/ai/categorize`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ vendor, description }) });
      const d = await r.json();
      if (d.category_id) setCatSuggestion(d);
    } catch {}
    setCatLoading(false);
  };

  const loadAll = useCallback(() => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,v])=>v)));
    fetch(`${API}/expenses?${p}`).then(r=>r.json()).then(setExpenses).catch(()=>{});
    fetch(`${API}/expenses/summary?month=${filters.month||''}`).then(r=>r.json()).then(setSummary).catch(()=>{});
  }, [filters]);

  useEffect(() => {
    fetch(`${API}/categories`).then(r=>r.json()).then(setCategories).catch(()=>{});
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Build hierarchical category options for select
  const catOptions = () => {
    const parents = categories.filter(c => !c.parent_id);
    const children = categories.filter(c => c.parent_id);
    const opts = [];
    for (const p of parents) {
      opts.push({ value: p.id, label: p.name, isParent: true });
      for (const c of children.filter(c => c.parent_id === p.id)) {
        opts.push({ value: c.id, label: `  — ${c.name}` });
      }
    }
    return opts;
  };

  const catLabel = (exp) => {
    if (!exp.category_name) return '—';
    return exp.parent_name ? `${exp.parent_name} › ${exp.category_name}` : exp.category_name;
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ category_id:'', vendor:'', description:'', amount:'', expense_date: new Date().toISOString().slice(0,10), payment_method:'card', reference_number:'', notes:'' });
    setShowAdd(true);
  };

  const openEdit = (exp) => {
    setEditing(exp.id);
    setForm({ category_id: exp.category_id||'', vendor: exp.vendor||'', description: exp.description||'', amount: exp.amount||'', expense_date: exp.expense_date?.slice(0,10)||'', payment_method: exp.payment_method||'card', reference_number: exp.reference_number||'', notes: exp.notes||'' });
    setShowAdd(true);
  };

  const save = async () => {
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/expenses/${editing}` : `${API}/expenses`;
    await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
    setShowAdd(false);
    loadAll();
  };

  const del = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    await fetch(`${API}/expenses/${id}`, { method:'DELETE' });
    loadAll();
  };

  const uploadFiles = async (expId, files) => {
    setUploading(expId);
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    await fetch(`${API}/expenses/${expId}/documents`, { method:'POST', body: fd });
    setUploading(null);
    loadAll();
  };

  const delDoc = async (docId) => {
    if (!window.confirm('Delete this file?')) return;
    await fetch(`${API}/documents/${docId}`, { method:'DELETE' });
    loadAll();
  };

  const totalMonth = expenses.reduce((s,e)=>s+parseFloat(e.amount||0),0);
  const deductibleMonth = expenses.reduce((s,e)=>s+parseFloat(e.amount||0)*parseFloat(e.deductible_pct||100)/100,0);
  const sf = { background:'var(--muted)', border:'1px solid var(--border)', borderRadius:6, padding:'7px 10px', color:'white', fontSize:13 };
  const opts = catOptions();

  return (
    <div>
      {/* KPI row */}
      <div style={{display:'flex',gap:12,marginBottom:20,flexWrap:'wrap'}}>
        <Card style={{flex:1,minWidth:140}}>
          <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>Total This Month</div>
          <div style={{fontSize:26,fontWeight:800,color:'var(--gold)'}}>${totalMonth.toFixed(2)}</div>
        </Card>
        <Card style={{flex:1,minWidth:140}}>
          <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>Deductible</div>
          <div style={{fontSize:26,fontWeight:800,color:'#22c55e'}}>${deductibleMonth.toFixed(2)}</div>
        </Card>
        <Card style={{flex:1,minWidth:140}}>
          <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>Transactions</div>
          <div style={{fontSize:26,fontWeight:800}}>{expenses.length}</div>
        </Card>
      </div>

      {/* Summary by category */}
      {summary.length > 0 && (
        <Card style={{marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>By Category — {filters.month||'All'}</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:8}}>
            {summary.map(s=>(
              <div key={s.category} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'5px 0',borderBottom:'1px solid var(--border)'}}>
                <span style={{color:'var(--text-dim)'}}>{s.category}</span>
                <span style={{color:'var(--gold)',fontWeight:600}}>${parseFloat(s.total).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filters + add */}
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'flex-end'}}>
        <input type="month" value={filters.month} onChange={e=>setFilters(f=>({...f,month:e.target.value}))} style={sf}/>
        <select value={filters.category_id} onChange={e=>setFilters(f=>({...f,category_id:e.target.value}))} style={sf}>
          <option value="">All Categories</option>
          {opts.map(o=><option key={o.value} value={o.value} style={{fontWeight:o.isParent?700:400}}>{o.label}</option>)}
        </select>
        <input placeholder="Search vendor / description" value={filters.q} onChange={e=>setFilters(f=>({...f,q:e.target.value}))} style={{...sf,flex:1,minWidth:160}}/>
        <Btn onClick={openAdd}>+ Add Expense</Btn>
      </div>

      {/* Expenses table */}
      <Card style={{padding:0,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'var(--muted)',color:'var(--text-dim)',fontSize:11,textTransform:'uppercase'}}>
              {['Date','Vendor','Category','Amount','Deductible','Method','Ref #','Docs',''].map(h=>(
                <th key={h} style={{textAlign:'left',padding:'10px 14px',whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {expenses.map(exp => (
              <>
                <tr key={exp.id} style={{borderTop:'1px solid var(--border)',cursor:'pointer'}}
                  onClick={()=>setExpanded(expanded===exp.id?null:exp.id)}>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)',whiteSpace:'nowrap'}}>{exp.expense_date?.slice(0,10)}</td>
                  <td style={{padding:'10px 14px',fontWeight:500}}>{exp.vendor||exp.description||'—'}</td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)',fontSize:12}}>{catLabel(exp)}</td>
                  <td style={{padding:'10px 14px',color:'var(--gold)',fontWeight:600}}>${parseFloat(exp.amount).toFixed(2)}</td>
                  <td style={{padding:'10px 14px',color:'#22c55e'}}>${(parseFloat(exp.amount)*parseFloat(exp.deductible_pct||100)/100).toFixed(2)}</td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>{exp.payment_method}</td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)',fontSize:12}}>{exp.reference_number||'—'}</td>
                  <td style={{padding:'10px 14px'}}>
                    {exp.documents?.length > 0
                      ? <span style={{color:'#3b82f6',fontSize:12}}>📎 {exp.documents.length}</span>
                      : <span style={{color:'var(--text-dim)',fontSize:12}}>—</span>}
                  </td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>▼</td>
                </tr>
                {expanded === exp.id && (
                  <tr key={`${exp.id}-exp`}><td colSpan={9} style={{background:'var(--muted)',padding:'14px 20px'}}>
                    {exp.description && <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:8}}>{exp.description}</div>}
                    {exp.notes && <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:10,fontStyle:'italic'}}>{exp.notes}</div>}

                    {/* Documents */}
                    <div style={{marginBottom:10}}>
                      <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>Documents</div>
                      {exp.documents?.length > 0 ? (
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                          {exp.documents.map(doc=>(
                            <div key={doc.id} style={{display:'flex',alignItems:'center',gap:6,background:'var(--dark)',border:'1px solid var(--border)',borderRadius:6,padding:'5px 10px',fontSize:12}}>
                              <a href={`/api/bookkeeping/uploads/${doc.filename}`} target="_blank" rel="noreferrer"
                                style={{color:'#3b82f6',textDecoration:'none'}}>{doc.original_name}</a>
                              <span style={{color:'var(--text-dim)',fontSize:11}}>({Math.round((doc.file_size||0)/1024)}KB)</span>
                              <button onClick={()=>delDoc(doc.id)} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:14,lineHeight:1}}>×</button>
                            </div>
                          ))}
                        </div>
                      ) : <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:8}}>No documents</div>}
                      <label style={{cursor:'pointer'}}>
                        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv,.txt"
                          style={{display:'none'}}
                          onChange={e=>{ if(e.target.files?.length) uploadFiles(exp.id,[...e.target.files]); e.target.value=''; }}/>
                        <span style={{fontSize:12,padding:'5px 12px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'white',cursor:'pointer'}}>
                          {uploading===exp.id ? 'Uploading...' : '+ Upload Files'}
                        </span>
                      </label>
                    </div>

                    <div style={{display:'flex',gap:6,marginTop:8}}>
                      <Btn onClick={()=>openEdit(exp)} style={{fontSize:12,padding:'4px 12px'}}>Edit</Btn>
                      <Btn variant="danger" onClick={()=>del(exp.id)} style={{fontSize:12,padding:'4px 12px'}}>Delete</Btn>
                    </div>
                  </td></tr>
                )}
              </>
            ))}
            {!expenses.length && <tr><td colSpan={9} style={{padding:'24px 14px',color:'var(--text-dim)',textAlign:'center'}}>No expenses found</td></tr>}
          </tbody>
        </table>
      </Card>

      {showAdd && (
        <Modal title={editing ? 'Edit Expense' : 'Add Expense'} onClose={()=>setShowAdd(false)}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
            {/* OCR scan */}
            <div style={{marginBottom:14,gridColumn:'1/-1',display:'flex',gap:8,alignItems:'center'}}>
              <label style={{cursor:'pointer'}}>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{display:'none'}}
                  onChange={e=>{ if(e.target.files?.[0]) scanReceipt(e.target.files[0]); e.target.value=''; }}/>
                <span style={{fontSize:13,padding:'7px 14px',background:'#6366f1',color:'white',borderRadius:6,cursor:'pointer',display:'inline-block'}}>
                  {ocrLoading ? '🤖 Scanning???' : '🤖 Scan Receipt / Invoice'}
                </span>
              </label>
              {ocrLoading && <span style={{fontSize:12,color:'var(--text-dim)'}}>Claude is reading your receipt???</span>}
            </div>
            <div style={{marginBottom:14,gridColumn:'1/-1'}}>
              <label style={{display:'block',fontSize:12,color:'var(--text-dim)',marginBottom:4}}>Category</label>
              <select value={form.category_id} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))}
                style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',color:'white',fontSize:14}}>
                <option value="">??? Select category ???</option>
                {opts.map(o=><option key={o.value} value={o.value} style={{fontWeight:o.isParent?700:400}}>{o.label}</option>)}
              </select>
              {catSuggestion && (
                <div style={{marginTop:6,fontSize:12,background:'rgba(99,102,241,0.1)',border:'1px solid #6366f1',borderRadius:6,padding:'6px 10px',display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{color:'#6366f1'}}>🤖 AI: <strong>{catSuggestion.category_name}</strong></span>
                  <span style={{color:'var(--text-dim)'}}>{catSuggestion.reason}</span>
                  <button onClick={()=>{const c=categories.find(x=>x.id===catSuggestion.category_id);if(c)setForm(f=>({...f,category_id:c.id}));setCatSuggestion(null);}} style={{marginLeft:'auto',fontSize:11,padding:'2px 8px',background:'#6366f1',color:'white',border:'none',borderRadius:4,cursor:'pointer'}}>Apply</button>
                  <button onClick={()=>setCatSuggestion(null)} style={{fontSize:11,color:'var(--text-dim)',background:'none',border:'none',cursor:'pointer'}}>x</button>
                </div>
              )}
            </div>
            <FInput label="Vendor / Payee" value={form.vendor}
              onChange={e=>{setForm(f=>({...f,vendor:e.target.value}));if(e.target.value.length>2)suggestCategory(e.target.value,form.description);}}/>
            <FInput label="Amount ($)" type="number" step="0.01" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/>
            <FInput label="Date" type="date" value={form.expense_date} onChange={e=>setForm(f=>({...f,expense_date:e.target.value}))}/>
            <FSelect label="Payment Method" value={form.payment_method} onChange={e=>setForm(f=>({...f,payment_method:e.target.value}))}
              options={['card','check','ach','wire','cash','other']}/>
            <FInput label="Reference / Check #" value={form.reference_number} onChange={e=>setForm(f=>({...f,reference_number:e.target.value}))}/>
          </div>
          <FInput label="Description" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/>
          <FInput label="Notes" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancel</Btn>
            <Btn onClick={save}>{editing ? 'Save Changes' : 'Add Expense'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ????????? P&L TAB ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
function PLTab() {
  const now = new Date();
  const y = now.getFullYear();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to,   setTo]   = useState(`${y}-12-31`);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/pl?from=${from}&to=${to}`);
      setData(await r.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [from, to]);

  const presets = [
    ['This Year', `${y}-01-01`, `${y}-12-31`],
    ['Last Year', `${y-1}-01-01`, `${y-1}-12-31`],
    ['Q1', `${y}-01-01`, `${y}-03-31`],
    ['Q2', `${y}-04-01`, `${y}-06-30`],
    ['Q3', `${y}-07-01`, `${y}-09-30`],
    ['Q4', `${y}-10-01`, `${y}-12-31`],
  ];

  const sf = { background:'var(--muted)', border:'1px solid var(--border)', borderRadius:6, padding:'7px 10px', color:'white', fontSize:13 };
  const rev = data ? parseFloat(data.revenue||0) : 0;
  const exp = data ? parseFloat(data.total_expenses||0) : 0;
  const net = rev - exp;
  const margin = rev > 0 ? (net/rev*100).toFixed(1) : 0;

  return (
    <div>
      {/* Period controls */}
      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap',alignItems:'center'}}>
        {presets.map(([l,f,t])=>(
          <button key={l} onClick={()=>{setFrom(f);setTo(t);}}
            style={{fontSize:12,padding:'5px 12px',borderRadius:6,border:'1px solid var(--border)',background: from===f&&to===t?'var(--gold)':'var(--muted)',color: from===f&&to===t?'#000':'white',cursor:'pointer',fontWeight: from===f&&to===t?700:400}}>{l}</button>
        ))}
        <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={sf}/>
        <span style={{color:'var(--text-dim)'}}>???</span>
        <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={sf}/>
      </div>

      {loading && <div style={{color:'var(--text-dim)',padding:20}}>Loading???</div>}
      {data && !loading && (
        <>
          {/* KPI row */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24}}>
            {[
              ['Revenue', `$${rev.toFixed(2)}`, '#22c55e'],
              ['Expenses', `$${exp.toFixed(2)}`, '#ef4444'],
              ['Net Income', `$${net.toFixed(2)}`, net>=0?'#22c55e':'#ef4444'],
              ['Margin', `${margin}%`, net>=0?'var(--gold)':'#ef4444'],
            ].map(([l,v,c])=>(
              <Card key={l} style={{textAlign:'center'}}>
                <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:6,textTransform:'uppercase',letterSpacing:1}}>{l}</div>
                <div style={{fontSize:22,fontWeight:800,color:c}}>{v}</div>
              </Card>
            ))}
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            {/* Revenue breakdown */}
            <Card>
              <div style={{fontWeight:700,fontSize:14,marginBottom:14,color:'#22c55e'}}>Revenue ??? by Bond Type</div>
              {data.revenue_by_type?.length ? data.revenue_by_type.map(r=>(
                <div key={r.bond_type} style={{display:'flex',justifyContent:'space-between',fontSize:13,padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                  <span style={{color:'var(--text-dim)'}}>{r.bond_type||'Other'}</span>
                  <span style={{color:'#22c55e',fontWeight:600}}>${parseFloat(r.commission).toFixed(2)}</span>
                </div>
              )) : <div style={{color:'var(--text-dim)',fontSize:13}}>No bond revenue in period</div>}
              <div style={{display:'flex',justifyContent:'space-between',fontSize:13,fontWeight:700,marginTop:8,paddingTop:8,borderTop:'2px solid var(--border)'}}>
                <span>Total</span><span style={{color:'#22c55e'}}>${rev.toFixed(2)}</span>
              </div>
            </Card>

            {/* Expense breakdown */}
            <Card>
              <div style={{fontWeight:700,fontSize:14,marginBottom:14,color:'#ef4444'}}>Expenses ??? by Category</div>
              {data.expenses_by_category?.length ? data.expenses_by_category.map(e=>(
                <div key={e.category} style={{display:'flex',justifyContent:'space-between',fontSize:13,padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                  <span style={{color:'var(--text-dim)'}}>{e.category}</span>
                  <span style={{color:'#ef4444',fontWeight:600}}>${parseFloat(e.total).toFixed(2)}</span>
                </div>
              )) : <div style={{color:'var(--text-dim)',fontSize:13}}>No expenses in period</div>}
              <div style={{display:'flex',justifyContent:'space-between',fontSize:13,fontWeight:700,marginTop:8,paddingTop:8,borderTop:'2px solid var(--border)'}}>
                <span>Total</span><span style={{color:'#ef4444'}}>${exp.toFixed(2)}</span>
              </div>
            </Card>
          </div>

          {/* Net income bar */}
          <Card style={{marginTop:16}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Net Income Summary</div>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:8}}>
              <div style={{flex:1,height:24,background:'var(--muted)',borderRadius:4,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${Math.min(100,rev>0?(rev/(rev+exp)*100):0).toFixed(1)}%`,background:'#22c55e',borderRadius:4}}/>
              </div>
              <span style={{fontSize:13,color:'var(--text-dim)',minWidth:80,textAlign:'right'}}>Rev: ${rev.toFixed(0)}</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{flex:1,height:24,background:'var(--muted)',borderRadius:4,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${Math.min(100,rev>0?(exp/rev*100):0).toFixed(1)}%`,background:'#ef4444',borderRadius:4}}/>
              </div>
              <span style={{fontSize:13,color:'var(--text-dim)',minWidth:80,textAlign:'right'}}>Exp: ${exp.toFixed(0)}</span>
            </div>
            <div style={{marginTop:12,fontSize:15,fontWeight:700,color:net>=0?'#22c55e':'#ef4444'}}>
              Net: ${net.toFixed(2)} ({margin}% margin)
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ????????? BILLS TAB (A/P) ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
function BillsTab() {
  const [bills, setBills]     = useState([]);
  const [cats,  setCats]      = useState([]);
  const [filter, setFilter]   = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [uploading, setUploading] = useState(null);
  const emptyForm = { vendor:'', invoice_number:'', description:'', amount:'', invoice_date:'', due_date:'', status:'unpaid', category_id:'', notes:'' };
  const [form, setForm] = useState(emptyForm);
  const [payForm, setPayForm] = useState({ paid_date: new Date().toISOString().slice(0,10), paid_amount:'', payment_method:'card' });
  const [toast, setToast] = useState(null);

  useEffect(() => { if(toast){const t=setTimeout(()=>setToast(null),4000);return()=>clearTimeout(t);} },[toast]);

  const load = () => {
    const p = filter !== 'all' ? `?status=${filter}` : '';
    fetch(`${API}/bills${p}`).then(r=>r.json()).then(setBills).catch(()=>{});
  };
  useEffect(()=>{ fetch(`${API}/categories`).then(r=>r.json()).then(setCats).catch(()=>{}); },[]);
  useEffect(()=>{ load(); },[filter]);

  const catOpts = () => {
    const parents = cats.filter(c=>!c.parent_id);
    const children = cats.filter(c=>c.parent_id);
    const opts = [];
    for(const p of parents){
      opts.push({value:p.id,label:p.name,isParent:true});
      for(const c of children.filter(c=>c.parent_id===p.id)) opts.push({value:c.id,label:`  ??? ${c.name}`});
    }
    return opts;
  };

  const save = async () => {
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/bills/${editing}` : `${API}/bills`;
    const r = await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
    if(r.ok){setShowAdd(false);setEditing(null);setForm(emptyForm);load();}
  };

  const del = async (id) => {
    if(!window.confirm('Delete this bill?')) return;
    await fetch(`${API}/bills/${id}`,{method:'DELETE'});
    load();
  };

  const markPaid = async () => {
    const r = await fetch(`${API}/bills/${payModal.id}/pay`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payForm)});
    if(r.ok){setPayModal(null);setToast('Bill marked paid ??? expense entry created');load();}
    else setToast('Error marking paid');
  };

  const uploadDocs = async (billId, files) => {
    setUploading(billId);
    const fd = new FormData();
    for(const f of files) fd.append('files',f);
    await fetch(`${API}/bills/${billId}/documents`,{method:'POST',body:fd});
    setUploading(null);
    load();
  };

  const delDoc = async (docId) => {
    if(!window.confirm('Delete file?')) return;
    await fetch(`${API}/bill-documents/${docId}`,{method:'DELETE'});
    load();
  };

  const totalUnpaid = bills.filter(b=>b.status==='unpaid'||b.status==='overdue').reduce((s,b)=>s+parseFloat(b.amount||0),0);
  const overdue = bills.filter(b=>b.status==='overdue').length;
  const sf = {background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 10px',color:'white',fontSize:13};
  const opts = catOpts();
  const STATUS_COLORS = {unpaid:'#f59e0b',paid:'#22c55e',overdue:'#ef4444',void:'#6b7280'};

  return (
    <div>
      <div style={{display:'flex',gap:12,marginBottom:20,flexWrap:'wrap'}}>
        <Card style={{flex:1,minWidth:130}}>
          <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:4,textTransform:'uppercase',letterSpacing:1}}>Total Unpaid</div>
          <div style={{fontSize:24,fontWeight:800,color:'#f59e0b'}}>${totalUnpaid.toFixed(2)}</div>
        </Card>
        <Card style={{flex:1,minWidth:130}}>
          <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:4,textTransform:'uppercase',letterSpacing:1}}>Overdue</div>
          <div style={{fontSize:24,fontWeight:800,color:'#ef4444'}}>{overdue}</div>
        </Card>
        <Card style={{flex:1,minWidth:130}}>
          <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:4,textTransform:'uppercase',letterSpacing:1}}>Total Bills</div>
          <div style={{fontSize:24,fontWeight:800}}>{bills.length}</div>
        </Card>
      </div>

      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        {['all','unpaid','overdue','paid','void'].map(s=>(
          <button key={s} onClick={()=>setFilter(s)}
            style={{fontSize:12,padding:'5px 12px',borderRadius:6,border:'1px solid var(--border)',
              background:filter===s?STATUS_COLORS[s]||'var(--gold)':'var(--muted)',
              color:filter===s&&s!=='all'?'#fff':'white',cursor:'pointer',textTransform:'capitalize'}}>{s}</button>
        ))}
        <div style={{flex:1}}/>
        <Btn onClick={()=>{setEditing(null);setForm(emptyForm);setShowAdd(true);}}>+ Add Bill</Btn>
      </div>

      <Card style={{padding:0,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{background:'var(--muted)',color:'var(--text-dim)',fontSize:11,textTransform:'uppercase'}}>
              {['Vendor','Invoice #','Amount','Due Date','Status','Docs',''].map(h=>(
                <th key={h} style={{textAlign:'left',padding:'10px 14px',whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bills.map(b=>(
              <>
                <tr key={b.id} style={{borderTop:'1px solid var(--border)',cursor:'pointer'}} onClick={()=>setExpanded(expanded===b.id?null:b.id)}>
                  <td style={{padding:'10px 14px',fontWeight:500}}>{b.vendor}</td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)',fontSize:12}}>{b.invoice_number||'???'}</td>
                  <td style={{padding:'10px 14px',color:'var(--gold)',fontWeight:600}}>${parseFloat(b.amount).toFixed(2)}</td>
                  <td style={{padding:'10px 14px',color: b.status==='overdue'?'#ef4444':'var(--text-dim)',whiteSpace:'nowrap'}}>{b.due_date?.slice(0,10)||'???'}</td>
                  <td style={{padding:'10px 14px'}}>
                    <span style={{background:STATUS_COLORS[b.status]||'#6b7280',color:'#fff',padding:'2px 8px',borderRadius:4,fontSize:11,textTransform:'capitalize'}}>{b.status}</span>
                  </td>
                  <td style={{padding:'10px 14px'}}>
                    {b.documents?.length>0 ? <span style={{color:'#3b82f6',fontSize:12}}>???? {b.documents.length}</span> : <span style={{color:'var(--text-dim)',fontSize:12}}>???</span>}
                  </td>
                  <td style={{padding:'10px 14px',color:'var(--text-dim)'}}>???</td>
                </tr>
                {expanded===b.id && (
                  <tr key={`${b.id}-exp`}><td colSpan={7} style={{background:'var(--muted)',padding:'14px 20px'}}>
                    {b.description && <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:6}}>{b.description}</div>}
                    {b.notes && <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:8,fontStyle:'italic'}}>{b.notes}</div>}
                    <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:10}}>
                      Invoice date: {b.invoice_date?.slice(0,10)||'???'} ?? Category: {b.category_name||'Uncategorized'}
                      {b.status==='paid' && ` ?? Paid ${b.paid_date?.slice(0,10)} via ${b.payment_method} ($${parseFloat(b.paid_amount||0).toFixed(2)})`}
                    </div>

                    <div style={{marginBottom:10}}>
                      <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>Documents</div>
                      {b.documents?.length>0 ? (
                        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                          {b.documents.map(doc=>(
                            <div key={doc.id} style={{display:'flex',alignItems:'center',gap:6,background:'var(--dark)',border:'1px solid var(--border)',borderRadius:6,padding:'5px 10px',fontSize:12}}>
                              <a href={`/api/bookkeeping/bill-uploads/${doc.filename}`} target="_blank" rel="noreferrer" style={{color:'#3b82f6',textDecoration:'none'}}>{doc.original_name}</a>
                              <button onClick={()=>delDoc(doc.id)} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:14}}>??</button>
                            </div>
                          ))}
                        </div>
                      ) : <div style={{fontSize:12,color:'var(--text-dim)',marginBottom:8}}>No documents</div>}
                      <label style={{cursor:'pointer'}}>
                        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.csv" style={{display:'none'}}
                          onChange={e=>{if(e.target.files?.length)uploadDocs(b.id,[...e.target.files]);e.target.value='';}}/>
                        <span style={{fontSize:12,padding:'5px 12px',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,color:'white',cursor:'pointer'}}>
                          {uploading===b.id?'Uploading...':'+ Upload Invoice'}
                        </span>
                      </label>
                    </div>

                    <div style={{display:'flex',gap:6,marginTop:8}}>
                      {(b.status==='unpaid'||b.status==='overdue') && (
                        <Btn onClick={()=>{setPayModal(b);setPayForm({paid_date:new Date().toISOString().slice(0,10),paid_amount:b.amount,payment_method:'card'});}}
                          style={{fontSize:12,padding:'4px 12px',background:'#22c55e'}}>??? Mark Paid</Btn>
                      )}
                      <Btn onClick={()=>{setEditing(b.id);setForm({vendor:b.vendor,invoice_number:b.invoice_number||'',description:b.description||'',amount:b.amount,invoice_date:b.invoice_date?.slice(0,10)||'',due_date:b.due_date?.slice(0,10)||'',status:b.status,category_id:b.category_id||'',notes:b.notes||''});setShowAdd(true);}} style={{fontSize:12,padding:'4px 12px'}}>Edit</Btn>
                      <Btn variant="danger" onClick={()=>del(b.id)} style={{fontSize:12,padding:'4px 12px'}}>Delete</Btn>
                    </div>
                  </td></tr>
                )}
              </>
            ))}
            {!bills.length && <tr><td colSpan={7} style={{padding:'24px 14px',color:'var(--text-dim)',textAlign:'center'}}>No bills found</td></tr>}
          </tbody>
        </table>
      </Card>

      {showAdd && (
        <Modal title={editing?'Edit Bill':'Add Bill / Invoice'} onClose={()=>{setShowAdd(false);setEditing(null);setForm(emptyForm);}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
            <FInput label="Vendor / Payee" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))}/>
            <FInput label="Invoice #" value={form.invoice_number} onChange={e=>setForm(f=>({...f,invoice_number:e.target.value}))}/>
            <FInput label="Amount ($)" type="number" step="0.01" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/>
            <FInput label="Invoice Date" type="date" value={form.invoice_date} onChange={e=>setForm(f=>({...f,invoice_date:e.target.value}))}/>
            <FInput label="Due Date" type="date" value={form.due_date} onChange={e=>setForm(f=>({...f,due_date:e.target.value}))}/>
            <FSelect label="Status" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} options={['unpaid','paid','void']}/>
            <div style={{marginBottom:14,gridColumn:'1/-1'}}>
              <label style={{display:'block',fontSize:12,color:'var(--text-dim)',marginBottom:4}}>Category</label>
              <select value={form.category_id} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))}
                style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',color:'white',fontSize:14}}>
                <option value="">??? Select category ???</option>
                {opts.map(o=><option key={o.value} value={o.value} style={{fontWeight:o.isParent?700:400}}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <FInput label="Description / Notes" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>{setShowAdd(false);setEditing(null);setForm(emptyForm);}}>Cancel</Btn>
            <Btn onClick={save}>{editing?'Save Changes':'Add Bill'}</Btn>
          </div>
        </Modal>
      )}

      {payModal && (
        <Modal title={`Mark Paid ??? ${payModal.vendor}`} onClose={()=>setPayModal(null)}>
          <FInput label="Payment Date" type="date" value={payForm.paid_date} onChange={e=>setPayForm(f=>({...f,paid_date:e.target.value}))}/>
          <FInput label="Amount Paid ($)" type="number" step="0.01" value={payForm.paid_amount} onChange={e=>setPayForm(f=>({...f,paid_amount:e.target.value}))}/>
          <FSelect label="Payment Method" value={payForm.payment_method} onChange={e=>setPayForm(f=>({...f,payment_method:e.target.value}))} options={['card','check','ach','wire','cash']}/>
          <div style={{fontSize:12,color:'var(--text-dim)',margin:'8px 0',background:'var(--muted)',padding:'8px 12px',borderRadius:6}}>
            An expense entry will be created automatically in the Expenses tab.
          </div>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setPayModal(null)}>Cancel</Btn>
            <Btn onClick={markPaid} style={{background:'#22c55e'}}>Confirm Payment</Btn>
          </div>
        </Modal>
      )}

      {toast && <div style={{position:'fixed',bottom:24,right:24,background:'#1e293b',border:'1px solid var(--gold)',color:'white',padding:'12px 20px',borderRadius:8,fontSize:13,zIndex:999}}>{toast}</div>}
    </div>
  );
}

// ????????? TAX TAB ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
function TaxTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/ai/tax-estimate?year=${year}`);
      setData(await r.json());
    } catch {}
    setLoading(false);
  };
  useEffect(()=>{ load(); },[year]);

  const Q_DATES = [
    {q:'Q1 (Jan???Mar)',due:'April 15'},
    {q:'Q2 (Apr???Jun)',due:'June 16'},
    {q:'Q3 (Jul???Sep)',due:'Sept 15'},
    {q:'Q4 (Oct???Dec)',due:'Jan 15 (next year)'},
  ];

  return (
    <div>
      <div style={{display:'flex',gap:8,marginBottom:20,alignItems:'center'}}>
        <span style={{color:'var(--text-dim)',fontSize:13}}>Tax Year:</span>
        <select value={year} onChange={e=>setYear(parseInt(e.target.value))}
          style={{background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'7px 12px',color:'white',fontSize:13}}>
          {[2023,2024,2025,2026].map(y=><option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading && <div style={{color:'var(--text-dim)',padding:20}}>Calculating???</div>}
      {data && !loading && (
        <>
          {/* YTD summary */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
            {[
              ['Gross Revenue', `$${parseFloat(data.ytd?.revenue||0).toFixed(2)}`, '#22c55e'],
              ['Total Expenses', `$${parseFloat(data.ytd?.expenses||0).toFixed(2)}`, '#ef4444'],
              ['Net Income', `$${parseFloat(data.ytd?.net_income||0).toFixed(2)}`, parseFloat(data.ytd?.net_income||0)>=0?'#22c55e':'#ef4444'],
              ['Est. Total Tax', `$${parseFloat(data.ytd?.total_tax||0).toFixed(2)}`, 'var(--gold)'],
            ].map(([l,v,c])=>(
              <Card key={l} style={{textAlign:'center'}}>
                <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:4,textTransform:'uppercase',letterSpacing:1}}>{l}</div>
                <div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
              </Card>
            ))}
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
            {/* Federal tax breakdown */}
            <Card>
              <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Federal Tax Estimate ({year})</div>
              {[
                ['Net SE Income', `$${parseFloat(data.federal?.net_income||0).toFixed(2)}`],
                ['SE Tax (15.3%)', `$${parseFloat(data.federal?.se_tax||0).toFixed(2)}`],
                ['SE Tax Deduction', `-$${parseFloat(data.federal?.se_deduction||0).toFixed(2)}`],
                ['Taxable Income', `$${parseFloat(data.federal?.taxable_income||0).toFixed(2)}`],
                ['Income Tax Est.', `$${parseFloat(data.federal?.income_tax||0).toFixed(2)}`],
                ['Total Federal', `$${parseFloat(data.federal?.total_tax||0).toFixed(2)}`],
              ].map(([l,v])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:13,padding:'5px 0',borderBottom:'1px solid var(--border)'}}>
                  <span style={{color:'var(--text-dim)'}}>{l}</span>
                  <span style={{fontWeight:600}}>{v}</span>
                </div>
              ))}
              <div style={{marginTop:10,fontSize:12,color:'var(--text-dim)',fontStyle:'italic'}}>
                Estimate only. Consult your tax professional.
              </div>
            </Card>

            {/* Texas + quarterly schedule */}
            <Card>
              <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Texas Franchise Tax</div>
              <div style={{fontSize:13,background:parseFloat(data.ytd?.revenue||0)<2470000?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)',border:`1px solid ${parseFloat(data.ytd?.revenue||0)<2470000?'#22c55e':'#ef4444'}`,borderRadius:8,padding:'12px 14px',marginBottom:16,color:parseFloat(data.ytd?.revenue||0)<2470000?'#22c55e':'#ef4444'}}>
                {parseFloat(data.ytd?.revenue||0) < 2470000
                  ? '??? Revenue under $2,470,000 threshold ??? No Tax Due. Must still file PIR.'
                  : '??? Revenue over threshold ??? franchise tax applies (0.75% of taxable margin).'}
              </div>
              <div style={{fontSize:13,marginBottom:8,fontWeight:700}}>Key Filing Dates</div>
              {[
                {label:'Texas Franchise Tax / PIR', date:'May 15', color:'#f59e0b'},
                {label:'1099-NEC from RLI', date:'Jan 31', color:'#6366f1'},
                {label:'Schedule C (Form 1040)', date:'April 15', color:'#3b82f6'},
              ].map(({label,date,color})=>(
                <div key={label} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'5px 0',borderBottom:'1px solid var(--border)'}}>
                  <span style={{color:'var(--text-dim)'}}>{label}</span>
                  <span style={{color,fontWeight:700}}>{date}</span>
                </div>
              ))}
            </Card>
          </div>

          {/* Quarterly payment schedule */}
          <Card>
            <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Quarterly Estimated Payments (IRS Form 1040-ES)</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
              {(data.quarters||[]).map((q,i)=>(
                <div key={i} style={{background:'var(--muted)',borderRadius:8,padding:'12px 14px',textAlign:'center'}}>
                  <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:2,textTransform:'uppercase',letterSpacing:1}}>{Q_DATES[i]?.q||`Q${i+1}`}</div>
                  <div style={{fontSize:18,fontWeight:800,color:'var(--gold)',marginBottom:2}}>${parseFloat(q.estimated_payment||0).toFixed(0)}</div>
                  <div style={{fontSize:11,color:'var(--text-dim)'}}>Due {Q_DATES[i]?.due}</div>
                  <div style={{fontSize:11,color:'#22c55e',marginTop:4}}>Net: ${parseFloat(q.net_income||0).toFixed(0)}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:12,color:'var(--text-dim)',marginTop:12,fontStyle:'italic'}}>
              Quarterly payment = estimated annual tax ?? 4. Based on YTD actuals projected forward.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function RecurringTab() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ category_id:'', vendor:'', description:'', amount:'', frequency:'monthly', start_date: new Date().toISOString().slice(0,10), payment_method:'card', notes:'' });
  const [running, setRunning] = useState(null);
  const load = () => {
    fetch(`${API}/expenses/recurring`).then(r=>r.json()).then(setItems).catch(()=>{});
    fetch(`${API}/categories`).then(r=>r.json()).then(setCategories).catch(()=>{});
  };
  useEffect(()=>{ load(); },[]);
  const save = async () => {
    await fetch(`${API}/expenses/recurring`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
    setShowAdd(false); load();
  };
  const del = async (id) => { if(!confirm('Delete this recurring expense?')) return; await fetch(`${API}/expenses/recurring/${id}`,{method:'DELETE'}); load(); };
  const runNow = async (id) => {
    setRunning(id);
    const r = await fetch(`${API}/expenses/recurring/${id}/run`,{method:'POST'});
    const d = await r.json();
    setRunning(null);
    if(d.ok) { alert('Expense created: $' + parseFloat(d.expense?.amount||0).toFixed(2)); load(); }
    else alert(d.error||'Error');
  };
  const FREQ_COLORS = {weekly:'#f59e0b',monthly:'#6366f1',quarterly:'#22c55e',annual:'#C9A84C'};
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:13,color:'var(--text-dim)'}}>Auto-create expenses on a schedule — subscriptions, insurance, rent</div>
        <Btn onClick={()=>setShowAdd(true)}>+ Add Recurring</Btn>
      </div>
      <Card>
        {items.length===0 && <div style={{color:'var(--text-dim)',fontSize:13,textAlign:'center',padding:32}}>No recurring expenses yet</div>}
        {items.map(it=>(
          <div key={it.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:'1px solid var(--border)'}}>
            <div>
              <div style={{fontWeight:600,fontSize:14,color:'white'}}>{it.vendor}</div>
              <div style={{fontSize:12,color:'var(--text-dim)'}}>{it.description} · {it.category_name||'Uncategorized'}</div>
              <div style={{fontSize:11,color:'var(--text-dim)',marginTop:2}}>Next due: {it.next_due?.slice(0,10)} · Run {it.run_count}x</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:13,fontWeight:700,color:'#22c55e'}}>${parseFloat(it.amount).toFixed(2)}</span>
              <Badge label={it.frequency} color={FREQ_COLORS[it.frequency]||'#6B6B8A'} />
              <Btn onClick={()=>runNow(it.id)} disabled={running===it.id} style={{fontSize:11,padding:'4px 10px'}}>{running===it.id?'Running...':'Run Now'}</Btn>
              <Btn variant="ghost" onClick={()=>del(it.id)} style={{fontSize:11,padding:'4px 8px',color:'#ef4444'}}>Delete</Btn>
            </div>
          </div>
        ))}
      </Card>
      {showAdd && (
        <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.85)'}}>
          <div style={{width:'100%',maxWidth:460,borderRadius:16,border:'1px solid var(--border)',background:'var(--surface)',padding:24}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontFamily:'"Bebas Neue",cursive',fontSize:24,letterSpacing:3,color:'white'}}>Add Recurring Expense</div>
              <button onClick={()=>setShowAdd(false)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-dim)',fontSize:20}}>x</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
              <FInput label="Vendor" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} />
              <FInput label="Amount ($)" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} />
              <div style={{marginBottom:14,gridColumn:'1/-1'}}>
                <label style={{display:'block',fontSize:12,color:'var(--text-dim)',marginBottom:4}}>Description</label>
                <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}
                  style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',color:'white',fontSize:14,boxSizing:'border-box'}} />
              </div>
              <div style={{marginBottom:14}}>
                <label style={{display:'block',fontSize:12,color:'var(--text-dim)',marginBottom:4}}>Frequency</label>
                <select value={form.frequency} onChange={e=>setForm(f=>({...f,frequency:e.target.value}))}
                  style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',color:'white',fontSize:14}}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <FInput label="Start Date" type="date" value={form.start_date} onChange={e=>setForm(f=>({...f,start_date:e.target.value}))} />
              <div style={{marginBottom:14,gridColumn:'1/-1'}}>
                <label style={{display:'block',fontSize:12,color:'var(--text-dim)',marginBottom:4}}>Category</label>
                <select value={form.category_id} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))}
                  style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',color:'white',fontSize:14}}>
                  <option value="">-- Select --</option>
                  {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:8}}>
              <Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancel</Btn>
              <Btn onClick={save} disabled={!form.vendor||!form.amount}>Save</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BudgetTab() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7));
  const [data, setData] = useState({budgets:[]});
  const [categories, setCategories] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({category_id:'',budget_amount:''});
  const load = () => {
    fetch(`${API}/budgets?month=${month}`).then(r=>r.json()).then(setData).catch(()=>{});
    fetch(`${API}/categories`).then(r=>r.json()).then(setCategories).catch(()=>{});
  };
  useEffect(()=>{ load(); },[month]);
  const save = async () => {
    await fetch(`${API}/budgets`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,month})});
    setShowAdd(false); setForm({category_id:'',budget_amount:''}); load();
  };
  const del = async (id) => { await fetch(`${API}/budgets/${id}`,{method:'DELETE'}); load(); };
  const totalBudget = data.budgets.reduce((s,b)=>s+parseFloat(b.budget_amount||0),0);
  const totalActual = data.budgets.reduce((s,b)=>s+parseFloat(b.actual||0),0);
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
          style={{background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'6px 10px',color:'white',fontSize:13}} />
        <Btn onClick={()=>setShowAdd(true)}>+ Set Budget</Btn>
      </div>
      {data.budgets.length===0 ? (
        <Card><div style={{color:'var(--text-dim)',fontSize:13,textAlign:'center',padding:32}}>No budgets set for {month}. Click "Set Budget" to add category targets.</div></Card>
      ) : (
        <Card>
          {data.budgets.map(b=>{
            const pct = b.budget_amount>0 ? Math.min(100,(parseFloat(b.actual||0)/parseFloat(b.budget_amount))*100) : 0;
            const over = parseFloat(b.actual||0) > parseFloat(b.budget_amount);
            return (
              <div key={b.id} style={{marginBottom:16}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                  <span style={{fontSize:13,color:'white',fontWeight:500}}>{b.category_name}</span>
                  <div style={{display:'flex',gap:16,alignItems:'center'}}>
                    <span style={{fontSize:12,color:'var(--text-dim)'}}>Budget: ${parseFloat(b.budget_amount).toFixed(2)}</span>
                    <span style={{fontSize:13,color:'white'}}>Actual: ${parseFloat(b.actual||0).toFixed(2)}</span>
                    <span style={{fontSize:13,fontWeight:600,color:over?'#ef4444':'#22c55e'}}>{over?'+':''}{(parseFloat(b.actual||0)-parseFloat(b.budget_amount)).toFixed(2)}</span>
                    <button onClick={()=>del(b.id)} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:16}}>x</button>
                  </div>
                </div>
                <div style={{background:'var(--muted)',borderRadius:4,height:6,overflow:'hidden'}}>
                  <div style={{height:'100%',width:pct+'%',background:over?'#ef4444':'#6366f1',borderRadius:4}}/>
                </div>
              </div>
            );
          })}
          <div style={{borderTop:'1px solid var(--border)',paddingTop:12,display:'flex',justifyContent:'space-between',fontSize:13,fontWeight:600}}>
            <span>Total</span>
            <span style={{color:totalActual>totalBudget?'#ef4444':'#22c55e'}}>${totalActual.toFixed(2)} / ${totalBudget.toFixed(2)}</span>
          </div>
        </Card>
      )}
      {showAdd && (
        <div style={{position:'fixed',inset:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.85)'}}>
          <div style={{width:'100%',maxWidth:360,borderRadius:16,border:'1px solid var(--border)',background:'var(--surface)',padding:24}}>
            <div style={{fontFamily:'"Bebas Neue",cursive',fontSize:22,letterSpacing:3,color:'white',marginBottom:16}}>Set Budget — {month}</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <label style={{display:'block',fontSize:12,color:'var(--text-dim)',marginBottom:4}}>Category</label>
                <select value={form.category_id} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))}
                  style={{width:'100%',background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',color:'white',fontSize:14}}>
                  <option value="">-- Select --</option>
                  {categories.filter(c=>!c.parent_id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <FInput label="Monthly Budget ($)" type="number" value={form.budget_amount} onChange={e=>setForm(f=>({...f,budget_amount:e.target.value}))} />
            </div>
            <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:16}}>
              <Btn variant="ghost" onClick={()=>setShowAdd(false)}>Cancel</Btn>
              <Btn onClick={save} disabled={!form.category_id||!form.budget_amount}>Save</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tab1099() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const load = () => fetch(`${API}/vendors/1099?year=${year}`).then(r=>r.json()).then(setData).catch(()=>{});
  useEffect(()=>{ load(); },[year]);
  const downloadPacket = () => window.location.assign(`${API}/export/tax-packet?year=${year}`);
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{fontSize:13,color:'var(--text-dim)'}}>Vendors paid $600+ require a 1099-NEC</div>
          <select value={year} onChange={e=>setYear(Number(e.target.value))}
            style={{background:'var(--muted)',border:'1px solid var(--border)',borderRadius:6,padding:'4px 10px',color:'white',fontSize:13}}>
            {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <Btn onClick={downloadPacket}>Download Tax Packet CSV</Btn>
      </div>
      {data && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
            <Card><div style={{fontSize:11,color:'var(--text-dim)',marginBottom:4}}>1099 VENDORS</div><div style={{fontSize:28,fontWeight:700,color:'#C9A84C'}}>{data.total_1099_count}</div></Card>
            <Card><div style={{fontSize:11,color:'var(--text-dim)',marginBottom:4}}>ALL VENDORS</div><div style={{fontSize:28,fontWeight:700,color:'white'}}>{data.all_vendors?.length||0}</div></Card>
            <Card><div style={{fontSize:11,color:'var(--text-dim)',marginBottom:4}}>TOTAL PAID</div><div style={{fontSize:24,fontWeight:700,color:'#22c55e'}}>${(data.all_vendors||[]).reduce((s,v)=>s+parseFloat(v.total_paid||0),0).toFixed(2)}</div></Card>
          </div>
          {data.vendors_1099?.length > 0 ? (
            <Card style={{marginBottom:16}}>
              <div style={{fontSize:11,color:'#C9A84C',fontFamily:'monospace',letterSpacing:2,marginBottom:12}}>REQUIRES 1099-NEC (paid $600+)</div>
              {data.vendors_1099.map((v,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                  <div>
                    <div style={{color:'white',fontWeight:500}}>{v.vendor}</div>
                    <div style={{fontSize:12,color:'var(--text-dim)'}}>{v.payment_count} payments · {v.first_payment?.slice(0,10)} to {v.last_payment?.slice(0,10)}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <span style={{fontSize:15,fontWeight:700,color:'#22c55e'}}>${parseFloat(v.total_paid).toFixed(2)}</span>
                    <Badge label="1099-NEC" color="#C9A84C" />
                  </div>
                </div>
              ))}
            </Card>
          ) : (
            <Card style={{marginBottom:16}}><div style={{color:'var(--text-dim)',fontSize:13,textAlign:'center',padding:24}}>No vendors reached the $600 threshold in {year}</div></Card>
          )}
          {(data.all_vendors||[]).filter(v=>parseFloat(v.total_paid)<600).length > 0 && (
            <Card>
              <div style={{fontSize:11,color:'var(--text-dim)',fontFamily:'monospace',letterSpacing:2,marginBottom:12}}>BELOW $600 THRESHOLD</div>
              {data.all_vendors.filter(v=>parseFloat(v.total_paid)<600).map((v,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--border)',fontSize:13}}>
                  <span style={{color:'var(--text-dim)'}}>{v.vendor}</span>
                  <span style={{color:'white'}}>${parseFloat(v.total_paid).toFixed(2)}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default function Bookkeeping() {
  const TABS = ['Dashboard','Bonds','Payments','Trust Account','Remittances','Carriers','Expenses','Recurring','Bills','Budget','P&L','Tax','1099','Reports','Alerts'];
  const [tab, setTab] = useState('Dashboard');
  const [carriers, setCarriers] = useState([]);

  const loadCarriers = useCallback(() => {
    fetch(`${API}/carriers`).then(r=>r.json()).then(setCarriers).catch(()=>{});
  }, []);

  useEffect(() => { loadCarriers(); }, [loadCarriers]);

  return (
    <div style={{padding:24,maxWidth:1400,margin:'0 auto'}}>
      <div style={{marginBottom:24}}>
        <h1 style={{margin:'0 0 4px',fontSize:22,fontWeight:800}}>Bookkeeping</h1>
        <div style={{fontSize:13,color:'var(--text-dim)'}}>Bond premiums · commissions · carrier remittances · trust ledger</div>
      </div>
      <div style={{display:'flex',gap:0,marginBottom:24,borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{background:'none',border:'none',padding:'10px 14px',cursor:'pointer',
              fontSize:13,fontWeight:tab===t?700:400,
              color:tab===t?'var(--gold)':'var(--text-dim)',
              borderBottom:tab===t?'2px solid var(--gold)':'2px solid transparent',
              marginBottom:-1,transition:'color 0.15s',whiteSpace:'nowrap'}}>
            {t}
          </button>
        ))}
      </div>
      {tab==='Dashboard'     && <DashboardTab />}
      {tab==='Bonds'         && <BondsTab carriers={carriers} />}
      {tab==='Payments'      && <PaymentsTab />}
      {tab==='Trust Account' && <TrustTab />}
      {tab==='Remittances'   && <RemittancesTab carriers={carriers} />}
      {tab==='Carriers'      && <CarriersTab carriers={carriers} onRefresh={loadCarriers} />}
      {tab==='Expenses'      && <ExpensesTab />}
      {tab==='Bills'         && <BillsTab />}
      {tab==='P&L'           && <PLTab />}
      {tab==='Tax'           && <TaxTab />}
      {tab==='Reports'       && <ReportsTab />}
      {tab==='Alerts'        && <AlertsTab />}
      {tab==='Recurring'     && <RecurringTab />}
      {tab==='Budget'        && <BudgetTab />}
      {tab==='1099'          && <Tab1099 />}
    </div>
  );
}
