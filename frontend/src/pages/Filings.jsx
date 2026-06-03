import React, { useEffect, useState, useCallback } from 'react';
import { Search, RefreshCw, FileText, Truck, CheckCircle, XCircle, Clock, Download, X, ChevronDown } from 'lucide-react';
import { apiFetch } from '../auth.js';

const STATUS_META = {
  received:  { label: 'Received',  bg: '#1a2a3a', color: '#60a5fa', border: '#1e3a5f' },
  preparing: { label: 'Preparing', bg: '#2a2a1a', color: '#fbbf24', border: '#5f4e1e' },
  mailed:    { label: 'Mailed',    bg: '#1a2a3a', color: '#a78bfa', border: '#3730a3' },
  confirmed: { label: 'Confirmed', bg: '#1a3a1e', color: '#4ade80', border: '#14532d' },
  rejected:  { label: 'Rejected',  bg: '#3a1a1a', color: '#f87171', border: '#7f1d1d' },
};

const STATUSES = ['received', 'preparing', 'mailed', 'confirmed', 'rejected'];

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric',
  });
}
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

const inputStyle = {
  padding: '7px 10px', background: 'var(--muted)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'white', fontSize: 12, outline: 'none', boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace',
  marginBottom: 4, display: 'block', letterSpacing: 1,
};
const btnStyle = (color = '#f59e0b') => ({
  padding: '6px 14px', background: color + '22', border: `1px solid ${color}44`,
  borderRadius: 6, color, fontSize: 12, fontWeight: 600, cursor: 'pointer',
});

export default function Filings() {
  const [filings, setFilings]       = useState([]);
  const [counts, setCounts]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [filterStatus, setFilter]   = useState('all');
  const [detail, setDetail]         = useState(null);
  const [updating, setUpdating]     = useState(false);
  const [trackingInput, setTracking] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [nextStatus, setNextStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (search) params.set('search', search);
      const data = await apiFetch(`/api/filings?${params}`).then(r => r.json());
      setFilings(data.filings || []);
      const cm = {};
      (data.counts || []).forEach(r => { cm[r.status] = r.n; });
      setCounts(cm);
    } finally { setLoading(false); }
  }, [filterStatus, search]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus() {
    if (!nextStatus || !detail) return;
    setUpdating(true);
    try {
      await apiFetch(`/api/filings/${detail.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          tracking_number: trackingInput || undefined,
          admin_notes: adminNotes || undefined,
        }),
      });
      setDetail(d => ({ ...d, status: nextStatus, tracking_number: trackingInput || d.tracking_number }));
      await load();
    } finally { setUpdating(false); }
  }

  function downloadCert(id, filename) {
    const token = localStorage.getItem('crm_token');
    const a = document.createElement('a');
    a.href = `/api/filings/${id}/cert`;
    a.download = filename || 'bond-cert.pdf';
    a.target = '_blank';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  const totalPending = (counts.received || 0) + (counts.preparing || 0) + (counts.mailed || 0);

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'white' }}>Filing Service</h1>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
            {totalPending} active · {counts.confirmed || 0} confirmed all-time
          </div>
        </div>
        <button onClick={load} style={btnStyle()}>
          <RefreshCw size={12} style={{ display: 'inline', marginRight: 6 }} />Refresh
        </button>
      </div>

      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {['all', ...STATUSES].map(s => {
          const meta = STATUS_META[s];
          const n = s === 'all' ? filings.length : (counts[s] || 0);
          const active = filterStatus === s;
          return (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: active ? (meta?.bg || 'var(--muted)') : 'transparent',
              color: active ? (meta?.color || 'white') : 'var(--text-dim)',
              border: active ? `1px solid ${meta?.border || 'var(--border)'}` : '1px solid transparent',
            }}>
              {meta?.label || 'All'} {n > 0 && <span style={{ opacity: 0.7 }}>({n})</span>}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 20, maxWidth: 360 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: 8, color: 'var(--text-dim)' }} />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, county…"
          style={{ ...inputStyle, width: '100%', paddingLeft: 32 }}
        />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: 'var(--text-dim)', padding: 32, textAlign: 'center' }}>Loading…</div>
      ) : filings.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: 32, textAlign: 'center' }}>
          No filings yet — they'll appear here after notaries submit through the website.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filings.map(f => {
            const meta = STATUS_META[f.status] || STATUS_META.received;
            return (
              <div key={f.id} onClick={() => { setDetail(f); setNextStatus(f.status); setTracking(f.tracking_number || ''); setAdminNotes(f.admin_notes || ''); }}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                  padding: '14px 18px', cursor: 'pointer', display: 'grid',
                  gridTemplateColumns: '1fr 140px 120px 100px 80px',
                  gap: 12, alignItems: 'center',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#f59e0b44'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'white', fontSize: 14 }}>{f.notary_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{f.notary_email}</div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{f.county} County</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{fmtTime(f.created_at)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  ${parseFloat(f.price_paid || 12.99).toFixed(2)}
                </div>
                <div>
                  <span style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                    background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
                  }}>{meta.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail drawer */}
      {detail && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.6)' }} onClick={() => setDetail(null)} />
          <div style={{
            width: 460, background: 'var(--surface)', borderLeft: '1px solid var(--border)',
            height: '100%', overflow: 'auto', padding: 28,
          }}>
            {/* Drawer header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <div style={{ fontWeight: 700, color: 'white', fontSize: 16 }}>{detail.notary_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{detail.notary_email}</div>
              </div>
              <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}>
                <X size={18} />
              </button>
            </div>

            {/* Filing details */}
            <div style={{ background: 'var(--muted)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
              {[
                ['County', detail.county + ' County'],
                ['Phone', detail.notary_phone || '—'],
                ['Bond #', detail.bond_number || '—'],
                ['Surety', detail.surety_company || '—'],
                ['Effective', fmtDate(detail.effective_date)],
                ['Expires', fmtDate(detail.expiry_date)],
                ['Paid', '$' + parseFloat(detail.price_paid || 12.99).toFixed(2)],
                ['Submitted', fmtTime(detail.created_at)],
                ['Mailed', fmtTime(detail.mailed_at)],
                ['Confirmed', fmtTime(detail.confirmed_at)],
                ['Tracking', detail.tracking_number || '—'],
              ].map(([k, v]) => v && v !== '—' ? (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-dim)' }}>{k}</span>
                  <span style={{ color: 'white', fontWeight: 500 }}>{v}</span>
                </div>
              ) : null)}
            </div>

            {/* Cert download */}
            {detail.cert_base64 && (
              <button onClick={() => downloadCert(detail.id, detail.cert_filename)}
                style={{ ...btnStyle('#60a5fa'), width: '100%', marginBottom: 20, textAlign: 'center' }}>
                <Download size={12} style={{ display: 'inline', marginRight: 6 }} />
                Download Bond Certificate PDF
              </button>
            )}

            {/* Mailing address lookup */}
            <div style={{ background: 'var(--muted)', borderRadius: 8, padding: 14, marginBottom: 20, fontSize: 12 }}>
              <div style={{ ...labelStyle, marginBottom: 8 }}>COUNTY CLERK MAILING ADDRESS</div>
              <CountyAddress county={detail.county} />
            </div>

            {/* Status update */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>UPDATE STATUS</label>
              <select value={nextStatus} onChange={e => setNextStatus(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}>
                {STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
            </div>

            {nextStatus === 'mailed' && (
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>USPS TRACKING NUMBER</label>
                <input value={trackingInput} onChange={e => setTracking(e.target.value)}
                  placeholder="9400111899223456789012"
                  style={{ ...inputStyle, width: '100%' }} />
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>ADMIN NOTES</label>
              <textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)}
                rows={3} placeholder="Internal notes…"
                style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
            </div>

            <button onClick={updateStatus} disabled={updating || nextStatus === detail.status}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
                background: updating ? '#333' : '#f59e0b', color: '#000', border: 'none', fontSize: 14,
                opacity: nextStatus === detail.status ? 0.5 : 1,
              }}>
              {updating ? 'Saving…' : `Mark as ${STATUS_META[nextStatus]?.label || nextStatus}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CountyAddress({ county }) {
  const [clerk, setClerk] = useState(null);
  useEffect(() => {
    apiFetch('/api/filings/counties').then(r => r.json()).then(list => {
      const match = list.find(c => c.county_name.toLowerCase() === county?.toLowerCase());
      setClerk(match || null);
    }).catch(() => {});
  }, [county]);

  if (!clerk || !clerk.address) return (
    <div style={{ color: 'var(--text-dim)' }}>
      {county} County Clerk<br />
      <a href={`https://www.google.com/search?q=${encodeURIComponent(county+' County Clerk Texas mailing address')}`}
         target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>
        Look up address →
      </a>
    </div>
  );

  return (
    <div style={{ color: 'white', lineHeight: 1.6 }}>
      {clerk.clerk_name && <div style={{ color: 'var(--text-dim)' }}>{clerk.clerk_name}</div>}
      <div>{county} County Clerk</div>
      <div>{clerk.address}</div>
      <div>{clerk.city}, TX {clerk.zip}</div>
      {clerk.phone && <div style={{ color: 'var(--text-dim)', marginTop: 4 }}>{clerk.phone}</div>}
    </div>
  );
}
