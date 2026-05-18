import React,{useEffect,useState,useCallback} from 'react';
import {Search,Phone,Mail,CheckCircle,XCircle,Edit2,RefreshCw,DollarSign,X,Plus,Trash2,Download,TrendingUp,Users,Calendar} from 'lucide-react';
import {apiFetch} from '../auth.js';

const STATUS_STYLE = {
  new:          {bg:'#3a1a1a',color:'#f87171',border:'#7f1d1d'},
  contacted:    {bg:'#3a2e1a',color:'#fbbf24',border:'#78350f'},
  sold:         {bg:'#1a3a1e',color:'#4ade80',border:'#14532d'},
  no_follow_up: {bg:'#1e1e2a',color:'#6b7280',border:'#374151'},
};

const BOND_OPTIONS = [
  'Texas Notary Bond',
  'Texas GDN Dealer Bond',
  'Texas Contractor License Bond',
  'Texas Construction Bond',
  'Texas Bid Bond',
  'Texas Performance & Payment Bond',
  'Texas Payment Bond',
  'Texas Mortgage Broker Bond',
  'Texas Credit Access Business Bond',
  'Texas Collection Agency Bond',
  'Texas Property Tax Consultant Bond',
];

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return Math.floor(d / 30) + 'mo ago';
}

function startOf(period) {
  const now = new Date();
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0];
  }
  if (period === 'week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(now.getFullYear(), now.getMonth(), diff).toISOString().split('T')[0];
  }
  if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  }
  return null;
}

function exportCSV(leads) {
  const header = ['ID','Name','Email','Phone','Bond Type','Source','Status','Sale Amount','Notes','Received'];
  const rows = leads.map(l => [
    l.id, l.name, l.email, l.phone || '', l.bond_type || '', l.source || '',
    l.status || '', l.sale_amount || '', (l.notes || '').replace(/,/g, ' '),
    fmtTime(l.lead_time),
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'leads-' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

const inputStyle = {
  width: '100%', padding: '7px 10px', background: 'var(--muted)',
  border: '1px solid var(--border)', borderRadius: 6, color: 'white',
  fontSize: 12, boxSizing: 'border-box', outline: 'none',
};
const labelStyle = {
  fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace',
  marginBottom: 4, display: 'block', letterSpacing: 1,
};

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterBond, setFilterBond] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [editing, setEditing] = useState(null);
  const [editData, setEditData] = useState({ status: 'new', notes: '', sale_amount: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newData, setNewData] = useState({ name: '', email: '', phone: '', bond_type: '', source: '', notes: '' });
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (search) params.set('search', search);
      if (filterBond !== 'all') params.set('bond_type', filterBond);
      const from = startOf(dateRange);
      if (from) params.set('date_from', from);

      const [leadsRes, statsRes] = await Promise.all([
        apiFetch('/api/leads?' + params).then(r => r.json()),
        apiFetch('/api/leads/stats').then(r => r.json()),
      ]);
      setLeads(leadsRes.leads || []);
      setStats(statsRes || {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, search, filterBond, dateRange]);

  useEffect(() => { load(); }, [load]);

  async function quickStatus(lead, status) {
    try {
      await apiFetch('/api/leads/' + lead.id, { method: 'PATCH', body: JSON.stringify({ status }) });
      load();
    } catch (e) { setError(e.message); }
  }

  function openEdit(lead) {
    setEditing(lead);
    setEditData({ status: lead.status || 'new', notes: lead.notes || '', sale_amount: lead.sale_amount || '' });
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await apiFetch('/api/leads/' + editing.id, { method: 'PATCH', body: JSON.stringify(editData) });
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
    setSaving(false);
  }

  async function createLead() {
    if (!newData.name || !newData.email) { setError('Name and email are required'); return; }
    setCreating(true);
    try {
      const r = await apiFetch('/api/leads/manual', { method: 'POST', body: JSON.stringify(newData) });
      if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Failed'); }
      setNewOpen(false);
      setNewData({ name: '', email: '', phone: '', bond_type: '', source: '', notes: '' });
      load();
    } catch (e) { setError(e.message); }
    setCreating(false);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch('/api/leads/' + deleteTarget.id, { method: 'DELETE' });
      setDeleteTarget(null);
      load();
    } catch (e) { setError(e.message); }
    setDeleting(false);
  }

  const statCards = [
    { label: 'New Today', value: stats.today_new || 0, color: '#4C9AC9', icon: Calendar },
    { label: 'New This Week', value: stats.week_new || 0, color: '#C9A84C', icon: TrendingUp },
    { label: 'All New', value: stats.new_count || 0, color: '#f87171', icon: Users },
    { label: 'Contacted', value: stats.contacted_count || 0, color: '#fbbf24', icon: Mail },
    { label: 'Sold', value: stats.sold_count || 0, color: '#4ade80', icon: CheckCircle },
    { label: 'Rev This Month', value: '$' + parseFloat(stats.month_revenue || 0).toFixed(0), color: '#4ade80', icon: DollarSign },
  ];

  const DATE_TABS = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'all', label: 'All Time' },
  ];

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', letterSpacing: 3, color: 'var(--gold)', marginBottom: 4 }}>PIPELINE</div>
          <h1 style={{ fontFamily: '"Bebas Neue",cursive', fontSize: 36, letterSpacing: 3, color: 'white', margin: 0 }}>LEADS</h1>
          <div className="gold-line" style={{ width: 64, marginTop: 8 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button onClick={() => exportCSV(leads)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer' }}>
            <Download size={13} /> Export CSV
          </button>
          <button onClick={() => setNewOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--gold)', border: 'none', borderRadius: 6, color: '#000', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            <Plus size={13} /> New Lead
          </button>
          <button onClick={load}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer' }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#3a1a1a', border: '1px solid #7f1d1d', color: '#f87171', borderRadius: 8, padding: '8px 14px', marginBottom: 16, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}><X size={14} /></button>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10, marginBottom: 20 }}>
        {statCards.map(s => (
          <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.color, fontFamily: '"Bebas Neue",cursive', letterSpacing: 2 }}>{s.value}</div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'monospace', letterSpacing: 1 }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Date range tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {DATE_TABS.map(t => (
          <button key={t.key} onClick={() => setDateRange(t.key)}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'monospace',
              background: dateRange === t.key ? 'var(--gold)' : 'var(--muted)',
              color: dateRange === t.key ? '#000' : 'var(--text-dim)',
              border: '1px solid ' + (dateRange === t.key ? 'var(--gold)' : 'var(--border)'),
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: 200 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, phone…"
            style={{ ...inputStyle, paddingLeft: 30 }} />
        </div>
        <select value={filterBond} onChange={e => setFilterBond(e.target.value)}
          style={{ padding: '8px 10px', background: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, color: 'white', fontSize: 11, minWidth: 180 }}>
          <option value="all">All Bond Types</option>
          {BOND_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['all', 'new', 'contacted', 'sold', 'no_follow_up'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'monospace',
                background: filterStatus === s ? 'var(--gold)' : 'var(--muted)',
                color: filterStatus === s ? '#000' : 'var(--text-dim)',
                border: '1px solid ' + (filterStatus === s ? 'var(--gold)' : 'var(--border)'),
              }}>
              {s === 'no_follow_up' ? 'Skip' : s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {loading ? 'Loading…' : `${leads.length} lead${leads.length !== 1 ? 's' : ''}`}
        </div>
        {!loading && leads.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>No leads found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--muted)' }}>
                  {['Name', 'Contact', 'Bond Type', 'Source', 'Received', 'Status', 'Notes', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', letterSpacing: 1, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => {
                  const st = STATUS_STYLE[lead.status] || STATUS_STYLE.new;
                  return (
                    <tr key={lead.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: 13, color: 'white', whiteSpace: 'nowrap' }}>{lead.name}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <a href={'mailto:' + lead.email} style={{ color: '#4C9AC9', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}><Mail size={11} />{lead.email}</a>
                        {lead.phone && (
                          <a href={'tel:' + lead.phone} style={{ color: 'var(--text-dim)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none', marginTop: 2 }}><Phone size={11} />{lead.phone}</a>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-dim)', maxWidth: 160 }}>{lead.bond_type || '—'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{lead.source || '—'}</td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 12, color: 'white' }}>{timeAgo(lead.lead_time)}</div>
                        <div style={{ fontSize: 10, color: '#374151', marginTop: 1, fontFamily: 'monospace' }}>{fmtTime(lead.lead_time)}</div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600, fontFamily: 'monospace', background: st.bg, color: st.color, border: '1px solid ' + st.border }}>
                          {lead.status === 'no_follow_up' ? 'SKIP' : lead.status?.toUpperCase()}
                        </span>
                        {lead.sale_amount && parseFloat(lead.sale_amount) > 0 && (
                          <div style={{ color: '#4ade80', fontSize: 10, fontFamily: 'monospace', marginTop: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                            <DollarSign size={9} />{parseFloat(lead.sale_amount).toFixed(0)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-dim)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lead.notes || <span style={{ color: '#374151' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {lead.status === 'new' && (
                            <button onClick={() => quickStatus(lead, 'contacted')}
                              style={{ padding: '4px 8px', fontSize: 10, borderRadius: 4, background: '#3a2e1a', color: '#fbbf24', border: '1px solid #78350f', cursor: 'pointer', fontFamily: 'monospace' }}>
                              Contacted
                            </button>
                          )}
                          {lead.status !== 'sold' && lead.status !== 'no_follow_up' && (
                            <button onClick={() => quickStatus(lead, 'sold')}
                              style={{ padding: '4px 8px', fontSize: 10, borderRadius: 4, background: '#1a3a1e', color: '#4ade80', border: '1px solid #14532d', cursor: 'pointer', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 3 }}>
                              <CheckCircle size={10} />Sold
                            </button>
                          )}
                          {lead.status !== 'no_follow_up' && (
                            <button onClick={() => quickStatus(lead, 'no_follow_up')}
                              style={{ padding: '4px 8px', fontSize: 10, borderRadius: 4, background: '#1e1e2a', color: '#6b7280', border: '1px solid #374151', cursor: 'pointer', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 3 }}>
                              <XCircle size={10} />Skip
                            </button>
                          )}
                          <button onClick={() => openEdit(lead)}
                            style={{ padding: '4px 8px', fontSize: 10, borderRadius: 4, background: 'var(--muted)', color: 'var(--text-dim)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Edit2 size={10} />Edit
                          </button>
                          <button onClick={() => setDeleteTarget(lead)}
                            style={{ padding: '4px 8px', fontSize: 10, borderRadius: 4, background: '#3a1a1a', color: '#f87171', border: '1px solid #7f1d1d', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, width: 380, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontFamily: '"Bebas Neue",cursive', fontSize: 20, letterSpacing: 2, color: 'white' }}>{editing.name}</div>
              <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><X size={16} /></button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 16, fontFamily: 'monospace' }}>
              {editing.email} · {editing.phone || 'no phone'}<br />
              {editing.bond_type || '—'} · {fmtTime(editing.lead_time)}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>STATUS</label>
              <select value={editData.status} onChange={e => setEditData(d => ({ ...d, status: e.target.value }))}
                style={{ ...inputStyle }}>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="sold">Sold</option>
                <option value="no_follow_up">No Follow-up Needed</option>
              </select>
            </div>

            {editData.status === 'sold' && (
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>SALE AMOUNT ($)</label>
                <input type="number" value={editData.sale_amount}
                  onChange={e => setEditData(d => ({ ...d, sale_amount: e.target.value }))}
                  placeholder="e.g. 50" style={inputStyle} />
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>NOTES</label>
              <textarea value={editData.notes} onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))}
                placeholder="Add notes…" rows={3}
                style={{ ...inputStyle, resize: 'none' }} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={{ padding: '7px 16px', background: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveEdit} disabled={saving}
                style={{ padding: '7px 16px', background: 'var(--gold)', border: 'none', borderRadius: 6, color: '#000', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Lead modal */}
      {newOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, width: 420, maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: '"Bebas Neue",cursive', fontSize: 24, letterSpacing: 2, color: 'white' }}>New Lead</div>
              <button onClick={() => setNewOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}><X size={16} /></button>
            </div>

            {[
              { key: 'name', label: 'NAME *', placeholder: 'Full name', type: 'text' },
              { key: 'email', label: 'EMAIL *', placeholder: 'email@example.com', type: 'email' },
              { key: 'phone', label: 'PHONE', placeholder: '(972) 555-0100', type: 'tel' },
              { key: 'source', label: 'SOURCE', placeholder: 'e.g. referral, walk-in, cold call', type: 'text' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={labelStyle}>{f.label}</label>
                <input type={f.type} value={newData[f.key]}
                  onChange={e => setNewData(d => ({ ...d, [f.key]: e.target.value }))}
                  placeholder={f.placeholder} style={inputStyle} />
              </div>
            ))}

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>BOND TYPE</label>
              <select value={newData.bond_type} onChange={e => setNewData(d => ({ ...d, bond_type: e.target.value }))}
                style={{ ...inputStyle }}>
                <option value="">Select bond type…</option>
                {BOND_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>NOTES</label>
              <textarea value={newData.notes} onChange={e => setNewData(d => ({ ...d, notes: e.target.value }))}
                placeholder="Initial notes…" rows={3}
                style={{ ...inputStyle, resize: 'none' }} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setNewOpen(false)} style={{ padding: '7px 16px', background: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={createLead} disabled={creating}
                style={{ padding: '7px 16px', background: 'var(--gold)', border: 'none', borderRadius: 6, color: '#000', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: creating ? 0.6 : 1 }}>
                {creating ? 'Creating…' : 'Create Lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid #7f1d1d', borderRadius: 10, padding: 24, width: 360, maxWidth: '90vw' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f87171', marginBottom: 8 }}>Delete Lead?</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 20 }}>
              This will permanently delete <strong style={{ color: 'white' }}>{deleteTarget.name}</strong> ({deleteTarget.email}). This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} style={{ padding: '7px 16px', background: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={confirmDelete} disabled={deleting}
                style={{ padding: '7px 16px', background: '#7f1d1d', border: 'none', borderRadius: 6, color: '#f87171', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
