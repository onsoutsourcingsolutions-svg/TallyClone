import { useEffect, useMemo, useState } from 'react';
import { api, useApp } from '../state.jsx';
import { ItemExcelPanel } from './ItemExcel.jsx';
import { inr } from '../fmt.js';

/* ---------- shared bits ---------- */
function Err({ e }) { return e ? <div className="errbox">{e}</div> : null; }

const SECTION_LABEL = {
  shareholders_funds: 'Equity — Shareholders’ Funds', noncurrent_liab: 'Non-current liabilities',
  current_liab: 'Current liabilities', noncurrent_assets: 'Non-current assets',
  current_assets: 'Current assets', direct_income: 'P&L — Direct income', indirect_income: 'P&L — Indirect income',
  direct_expense: 'P&L — Direct expenses', indirect_expense: 'P&L — Indirect expenses', tax_expense: 'P&L — Tax',
};

export function LedgerForm({ onSaved, edit, onCancel }) {
  const { company, notify } = useApp();
  const chart = company.chart || [];
  const [err, setErr] = useState('');
  const [gstState, setGstState] = useState({ loading: false, data: null, error: '' });
  const [f, setF] = useState({
    name: '', group_code: 'sundry_debtors', opening_balance: '', opening_type: 'Dr',
    address: '', gstin: '', pan: '', credit_days: '', credit_limit: '',
    bank_name: '', ifsc: '', account_no: '',
    ...(edit || {}),
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const groups = useMemo(() => {
    const secs = [];
    const order = ['shareholders_funds', 'noncurrent_liab', 'current_liab', 'noncurrent_assets', 'current_assets', 'direct_income', 'indirect_income', 'direct_expense', 'indirect_expense', 'tax_expense'];
    for (const s of order) {
      const list = chart.filter((g) => (g.bs || g.pl) === s);
      if (list.length) secs.push({ label: SECTION_LABEL[s] || s, list });
    }
    return secs;
  }, [chart]);

  const [captcha, setCaptcha] = useState({ id: '', img: '', loading: false, value: '' });

  const verifyGst = async () => {
    const g = String(f.gstin || '').trim().toUpperCase();
    if (!g) { setErr('Enter GSTIN first — e.g. 27ABCDE1234F1Z5'); return; }
    setGstState({ loading: true, data: null, error: '' });
    setErr('');
    try {
      const j = await api('/gst/verify?gstin=' + encodeURIComponent(g));
      if (!j.ok) throw new Error(j.error || 'GST verification failed');
      setGstState({ loading: false, data: j, error: '' });
      if (j.pan && !f.pan) setF(prev => ({ ...prev, pan: j.pan }));
      if (j.details) {
        const d = j.details;
        if (d.trade_name || d.legal_name) {
          notify(`GSTIN ✓ ${j.state_name || ''} — ${d.trade_name || d.legal_name} found. Click to apply.`);
        } else {
          notify(`GSTIN ✓ ${j.state_name} — format valid${j.verified ? '' : ' (live details unavailable offline)'}`);
        }
      } else {
        notify(`GSTIN ✓ ${j.state_name} — valid. ${j.message || ''}`);
        // auto-fetch captcha if needs live
        if (j.needs_captcha) fetchCaptcha();
      }
    } catch (e) {
      setGstState({ loading: false, data: null, error: e.message });
      setErr(e.message);
    }
  };

  const fetchCaptcha = async () => {
    setCaptcha(c => ({ ...c, loading: true }));
    setErr('');
    try {
      const j = await api('/gst/captcha');
      if (!j.ok) throw new Error(j.error || 'Could not get captcha from GST portal');
      setCaptcha({ id: j.captcha_id, img: j.data_uri || `data:${j.mime};base64,${j.image_base64}`, loading: false, value: '' });
      notify('Captcha loaded from GST portal — enter the 6 characters');
    } catch (e) {
      setCaptcha(c => ({ ...c, loading: false }));
      setErr(e.message);
    }
  };

  const verifyWithCaptcha = async () => {
    const g = String(f.gstin || '').trim().toUpperCase();
    if (!g) { setErr('Enter GSTIN first'); return; }
    if (!captcha.value.trim()) { setErr('Enter captcha shown in image'); return; }
    setGstState({ loading: true, data: null, error: '' });
    setErr('');
    try {
      const j = await api('/gst/verify', { method: 'POST', body: { gstin: g, captcha: captcha.value.trim(), captcha_id: captcha.id } });
      if (!j.ok) throw new Error(j.error || 'GST verification with captcha failed');
      setGstState({ loading: false, data: j, error: '' });
      if (j.pan && !f.pan) setF(prev => ({ ...prev, pan: j.pan }));
      if (j.details) {
        const d = j.details;
        notify(`GSTIN Live ✓ ${d.trade_name || d.legal_name} — ${j.state_name} — fetched from GST portal`);
      }
      setCaptcha({ id: '', img: '', loading: false, value: '' });
    } catch (e) {
      setGstState({ loading: false, data: gstState.data, error: e.message });
      setErr(e.message);
      // on invalid captcha, auto refresh
      if (/captcha/i.test(e.message)) fetchCaptcha();
    }
  };

  const applyGstDetails = (useTrade = true) => {
    const d = gstState.data;
    if (!d) return;
    const det = d.details || {};
    const nameToUse = useTrade ? (det.trade_name || det.legal_name) : (det.legal_name || det.trade_name);
    const updates = {};
    if (nameToUse && !f.name.trim()) updates.name = nameToUse;
    else if (nameToUse) updates.name = nameToUse; // always apply if user clicks
    if (det.address) updates.address = det.address;
    if (d.pan) updates.pan = d.pan;
    if (Object.keys(updates).length) {
      setF(prev => ({ ...prev, ...updates }));
      notify('Auto-filled from GSTIN ✓');
    }
  };

  const save = async () => {
    setErr('');
    try {
      if (!f.name.trim()) return setErr('Name is required.');
      const body = { ...f, opening_balance: f.opening_balance || 0 };
      if (edit) await api('/accounts/' + edit.id, { method: 'PATCH', body });
      else await api('/accounts', { body });
      notify(edit ? 'Ledger updated ✓' : 'Ledger created ✓');
      onSaved();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="card">
      <h3>{edit ? 'Edit ledger — ' + edit.name : 'New ledger'}</h3>
      <Err e={err} />
      <label className="f"><span>Name *</span><input value={f.name} onChange={set('name')} placeholder="e.g. Rahul Traders / HDFC Bank / Rent Paid" /></label>
      <label className="f"><span>Group (Ind AS / Schedule III classification) *</span>
        <select value={f.group_code} onChange={set('group_code')}>
          {groups.map((s) => (
            <optgroup key={s.label} label={s.label}>
              {s.list.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="frow">
        <label className="f"><span>Opening balance (as on books begin)</span>
          <div className="frow2">
            <input value={f.opening_balance} onChange={set('opening_balance')} placeholder="0.00" disabled={!!edit && edit.has_postings} />
            <select value={f.opening_type} onChange={set('opening_type')}><option value="Dr">Debit</option><option value="Cr">Credit</option></select>
          </div>
        </label>
        {f.group_code === 'bank_accounts' && (
          <label className="f"><span>Bank name (optional)</span><input value={f.bank_name} onChange={set('bank_name')} placeholder="HDFC Bank" /></label>
        )}
      </div>
      {f.group_code === 'bank_accounts' && (
        <div className="frow">
          <label className="f"><span>A/c no.</span><input value={f.account_no} onChange={set('account_no')} /></label>
          <label className="f"><span>IFSC</span><input value={f.ifsc} onChange={set('ifsc')} /></label>
        </div>
      )}
      {(f.group_code === 'sundry_debtors' || f.group_code === 'sundry_creditors') && (
        <>
          <div className="frow">
            <label className="f" style={{ minWidth: 260 }}><span>Party GSTIN — type & Verify to auto-pull from GST portal</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={f.gstin} onChange={set('gstin')} placeholder="27ABCDE1234F1Z5" style={{ textTransform: 'uppercase' }} />
                <button className="btn sm" onClick={verifyGst} disabled={gstState.loading} title="Verify GSTIN & pull company name, address, PAN, state, registration date">
                  {gstState.loading ? 'Checking…' : '🔍 Verify & Auto-fill'}
                </button>
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Enter GSTIN → Verify → company name, address, PAN auto-filled from GST portal (state, trade name, legal name, registration date)</div>
            </label>
            <label className="f"><span>PAN (auto from GSTIN)</span><input value={f.pan} onChange={set('pan')} placeholder="ABCDE1234F" style={{ textTransform: 'uppercase' }} /></label>
          </div>

          {gstState.data && (
            <div style={{ border: '1px solid var(--gold-line-soft)', borderRadius: 8, padding: 10, marginBottom: 10, background: 'var(--gold-soft)' }}>
              <div style={{ fontSize: 12.5 }}>
                <b style={{ color: 'var(--ok)' }}>✓ GSTIN Valid — {gstState.data.state_name} ({gstState.data.state_code}) · PAN {gstState.data.pan} {gstState.data.verified ? '· Verified LIVE from GST portal' : '· Format valid'}</b>
                {gstState.data.details && (
                  <>
                    <div style={{ marginTop: 6 }}><b>Legal:</b> {gstState.data.details.legal_name || '—'} · <b>Trade:</b> {gstState.data.details.trade_name || '—'}</div>
                    {gstState.data.details.address && <div className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{gstState.data.details.address}</div>}
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                      {gstState.data.details.status && <>Status: {gstState.data.details.status} · </>}
                      {gstState.data.details.registration_date && <>Reg. Date: {gstState.data.details.registration_date} · </>}
                      {gstState.data.details.taxpayer_type && <>Type: {gstState.data.details.taxpayer_type}</>}
                      {gstState.data.details.pincode && <> · Pincode: {gstState.data.details.pincode}</>}
                      {gstState.data.details.business_nature && <><br/>Nature: {gstState.data.details.business_nature}</>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <button className="btn sm" onClick={() => applyGstDetails(true)}>Use Trade Name + Address</button>
                      <button className="btn ghost sm" onClick={() => applyGstDetails(false)}>Use Legal Name + Address</button>
                    </div>
                  </>
                )}
                {!gstState.data.details && (
                  <div style={{ marginTop: 8 }}>
                    <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>{gstState.data.message}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="btn sm" onClick={fetchCaptcha} disabled={captcha.loading}>{captcha.loading ? 'Loading captcha...' : '🔐 Get Captcha & Fetch Live'}</button>
                      {captcha.img && (
                        <>
                          <img src={captcha.img} alt="GST captcha" style={{ height: 38, border: '1px solid #ccc', borderRadius: 4, background: '#fff' }} />
                          <input value={captcha.value} onChange={(e) => setCaptcha(c => ({ ...c, value: e.target.value }))} placeholder="Enter 6 chars" style={{ width: 110, textTransform: 'uppercase' }} maxLength={6} />
                          <button className="btn sm" onClick={verifyWithCaptcha} disabled={gstState.loading}>{gstState.loading ? 'Fetching...' : '✓ Fetch Live Details'}</button>
                          <button className="btn ghost sm" onClick={fetchCaptcha}>↻ Refresh</button>
                        </>
                      )}
                    </div>
                    <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>Live data comes directly from services.gst.gov.in — requires internet + captcha. If portal is down, you can still save with offline validation.</div>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Show captcha even if no gstState yet but user clicked */}
          {!gstState.data && captcha.img && (
            <div style={{ border: '1px dashed var(--gold-line-soft)', borderRadius: 8, padding: 10, marginBottom: 10, background: '#fffbe6' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12 }}>GST Portal Captcha:</span>
                <img src={captcha.img} alt="GST captcha" style={{ height: 38, border: '1px solid #ccc', borderRadius: 4, background: '#fff' }} />
                <input value={captcha.value} onChange={(e) => setCaptcha(c => ({ ...c, value: e.target.value }))} placeholder="Enter 6 chars" style={{ width: 110, textTransform: 'uppercase' }} maxLength={6} />
                <button className="btn sm" onClick={verifyWithCaptcha} disabled={gstState.loading}>{gstState.loading ? 'Fetching...' : '✓ Fetch Live'}</button>
                <button className="btn ghost sm" onClick={fetchCaptcha}>↻ Refresh</button>
              </div>
            </div>
          )}
          {gstState.error && <div className="errbox">{gstState.error}</div>}

          <div className="frow">
            <label className="f"><span>Party address (auto-filled from GSTIN)</span><input value={f.address} onChange={set('address')} placeholder="Auto-pulled from GST portal after Verify" /></label>
            <label className="f"><span>Credit days</span><input value={f.credit_days} onChange={set('credit_days')} placeholder="30" /></label>
            <label className="f"><span>Credit limit</span><input value={f.credit_limit} onChange={set('credit_limit')} /></label>
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={save}>{edit ? 'Update' : 'Create ledger'}</button>
        {onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

export function LedgersTab() {
  const { notify } = useApp();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const load = async (query = q) => {
    const j = await api('/accounts?with_balances=1' + (query ? '&q=' + encodeURIComponent(query) : ''));
    setRows(j.rows);
  };
  useEffect(() => { load('').catch((e) => notify(e.message)); }, []);
  const del = async (a) => {
    if (!window.confirm(`Delete ledger "${a.name}"? (only allowed if it has no transactions)`)) return;
    try { await api('/accounts/' + a.id, { method: 'DELETE' }); notify('Deleted'); load(); }
    catch (e) { notify(e.message); }
  };
  const debitPositive = (a) => (a.type === 'Liability' || a.type === 'Income');
  return (
    <div>
      <div className="pagetitle">
        <div><div className="crumb">Masters · Accounts</div><h1>Ledgers</h1></div>
        <button className="btn" onClick={() => { setAdding(!adding); setEditing(null); }}>{adding ? 'Close' : '+ New ledger'}</button>
      </div>
      {adding && !editing && <LedgerForm onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
      {editing && <LedgerForm edit={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}
      <div className="card">
        <div className="frow" style={{ marginBottom: 10 }}>
          <input placeholder="Search ledgers…" value={q} onChange={(e) => setQ(e.target.value)} onKeyUp={(e) => e.key === 'Enter' && load(q)} />
          <button className="btn ghost" onClick={() => load(q)}>Find</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid">
            <thead><tr><th>Ledger</th><th>Group</th><th>Type</th><th className="tright">Balance</th><th></th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={5} className="empty">Loading…</td></tr>}
              {rows && rows.length === 0 && <tr><td colSpan={5} className="empty">No ledgers found.</td></tr>}
              {rows && rows.map((a) => {
                const crFav = debitPositive(a);
                const bal = a.balance || 0;
                return (
                  <tr key={a.id}>
                    <td><b>{a.name}</b></td>
                    <td className="muted">{a.group_code.replace(/_/g, ' ')}</td>
                    <td><span className="badge">{a.type}</span></td>
                    <td className="tright num">
                      {bal === 0 ? <span className="faint">—</span> : <>{inr(Math.abs(bal))} <span className="tag">{crFav ? (bal < 0 ? 'Cr' : 'Dr') : (bal >= 0 ? 'Dr' : 'Cr')}</span></>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" onClick={() => { setEditing(a); setAdding(false); }}>Edit</button>{' '}
                      <button className="btn danger sm" onClick={() => del(a)}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================ ITEMS ============================ */
export function ItemForm({ onSaved, edit, onCancel }) {
  const { notify } = useApp();
  const [err, setErr] = useState('');
  const [f, setF] = useState({ name: '', unit: 'nos', hsn: '', gst_rate: '', is_service: false, ...(edit || {}) });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    setErr('');
    try {
      if (!f.name.trim()) return setErr('Name is required.');
      const body = { ...f, gst_rate: f.gst_rate === '' ? null : f.gst_rate };
      if (edit) await api('/items/' + edit.id, { method: 'PATCH', body });
      else await api('/items', { body });
      notify(edit ? 'Item updated ✓' : 'Item created ✓');
      onSaved();
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="card">
      <h3>{edit ? 'Edit item' : 'New stock item'}</h3>
      <Err e={err} />
      <div className="frow">
        <label className="f"><span>Item name *</span><input value={f.name} onChange={set('name')} placeholder="MS Angle 50x50 / Service" /></label>
        <label className="f"><span>Unit</span><input value={f.unit} onChange={set('unit')} placeholder="nos / kg / box" /></label>
        <label className="f"><span>HSN / SAC</span><input value={f.hsn} onChange={set('hsn')} placeholder="7216" /></label>
        <label className="f"><span>GST rate %</span><input value={f.gst_rate} onChange={set('gst_rate')} placeholder="18 (0 if exempt)" /></label>
      </div>
      <label className="chk"><input type="checkbox" checked={f.is_service} onChange={set('is_service')} /> It is a service (no stock tracking)</label>
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button className="btn" onClick={save}>{edit ? 'Update' : 'Create item'}</button>
        {onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

export function ItemsTab() {
  const { notify } = useApp();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const load = async (query = q) => {
    const j = await api('/items' + (query ? '?q=' + encodeURIComponent(query) : ''));
    setRows(j.rows);
  };
  useEffect(() => { load('').catch((e) => notify(e.message)); }, []);
  const del = async (it) => {
    if (!window.confirm(`Delete item "${it.name}"?`)) return;
    try { await api('/items/' + it.id, { method: 'DELETE' }); notify('Deleted'); load(); }
    catch (e) { notify(e.message); }
  };
  return (
    <div>
      <div className="pagetitle">
        <div><div className="crumb">Masters · Inventory</div><h1>Stock Items</h1></div>
        <button className="btn" onClick={() => { setAdding(!adding); setEditing(null); }}>{adding ? 'Close' : '+ New item'}</button>
      </div>
      {adding && !editing && <ItemForm onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
      {editing && <ItemForm edit={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}
      <ItemExcelPanel onImported={load} />
      <div className="card">
        <div className="frow" style={{ marginBottom: 10 }}>
          <input placeholder="Search item / HSN…" value={q} onChange={(e) => setQ(e.target.value)} onKeyUp={(e) => e.key === 'Enter' && load(q)} />
          <button className="btn ghost" onClick={() => load(q)}>Find</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid">
            <thead><tr><th>Item</th><th>Unit</th><th>HSN</th><th className="tright">GST</th><th className="tright">In stock</th><th className="tright">Stock value</th><th></th></tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} className="empty">Loading…</td></tr>}
              {rows && rows.length === 0 && <tr><td colSpan={7} className="empty">No items. Add your first stock item above.</td></tr>}
              {rows && rows.map((it) => (
                <tr key={it.id}>
                  <td><b>{it.name}</b>{it.is_service && <span className="badge">service</span>}</td>
                  <td>{it.unit}</td>
                  <td className="num">{it.hsn}</td>
                  <td className="tright num">{it.gst_rate == null ? '—' : it.gst_rate + '%'}</td>
                  <td className="tright num">{it.is_service ? '—' : (it.stock_qty || 0)}</td>
                  <td className="tright num">{it.is_service ? '—' : inr(it.stock_value || 0)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => { setEditing(it); setAdding(false); }}>Edit</button>{' '}
                    <button className="btn danger sm" onClick={() => del(it)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Masters({ tab }) {
  return tab === 'items' ? <ItemsTab /> : <LedgersTab />;
}
