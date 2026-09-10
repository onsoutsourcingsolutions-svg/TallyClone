import { useState } from 'react';
import { api, useApp } from '../state.jsx';
import { fyStartFromDate, STATE_CODES, todayISO } from '../fmt.js';

export function CompanyScreen({ onDone, onCancel }) {
  const { setBusy, notify, refreshBoot } = useApp();
  const [err, setErr] = useState('');
  const [f, setF] = useState({
    name: '', address: '', city: '', state: 'Maharashtra', pincode: '',
    gstin: '', pan: '', financial_year_from: fyStartFromDate(todayISO()),
    books_begin_from: '', gst_enabled: true, inventory_enabled: true,
  });
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setF({ ...f, [k]: v });
    if (k === 'financial_year_from') setF((p) => ({ ...p, financial_year_from: v, books_begin_from: p.books_begin_from || v }));
  };
  const save = async () => {
    setErr('');
    if (!f.name.trim()) return setErr('Company name is required.');
    try {
      setBusy(true);
      const body = { ...f, books_begin_from: f.books_begin_from || f.financial_year_from, state_code: STATE_CODES[f.state] || '' };
      await api('/companies', { body });
      await refreshBoot();
      notify('Company created ✓');
      onDone && onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '18px 14px 40px' }}>
      <div className="pagetitle"><h1>Create Company</h1></div>
      {err && <div className="errbox">{err}</div>}
      <div className="card">
        <h3>Company profile</h3>
        <label className="f"><span>Company name *</span><input value={f.name} onChange={set('name')} placeholder="e.g. Sharma Steel Traders Pvt Ltd" /></label>
        <label className="f"><span>Registered address</span><textarea rows={2} value={f.address} onChange={set('address')} /></label>
        <div className="frow">
          <label className="f"><span>City</span><input value={f.city} onChange={set('city')} /></label>
          <label className="f"><span>State</span>
            <select value={f.state} onChange={set('state')}>
              {Object.keys(STATE_CODES).map((s) => <option key={s} value={s}>{s} ({STATE_CODES[s]})</option>)}
            </select>
          </label>
          <label className="f"><span>PIN</span><input value={f.pincode} onChange={set('pincode')} /></label>
        </div>
        <div className="frow">
          <label className="f"><span>GSTIN</span><input value={f.gstin} onChange={set('gstin')} placeholder="27AAAAA0000A1Z5" /></label>
          <label className="f"><span>PAN</span><input value={f.pan} onChange={set('pan')} placeholder="AAAAA0000A" /></label>
        </div>
      </div>
      <div className="card">
        <h3>Books & configuration</h3>
        <div className="frow">
          <label className="f"><span>Financial year begins</span><input type="date" value={f.financial_year_from} onChange={set('financial_year_from')} /></label>
          <label className="f"><span>Books begin from</span><input type="date" value={f.books_begin_from || f.financial_year_from} onChange={set('books_begin_from')} /></label>
        </div>
        <div className="frow">
          <div><label className="chk"><input type="checkbox" checked={f.gst_enabled} onChange={set('gst_enabled')} /> GST (auto tax on invoices)</label></div>
          <div><label className="chk"><input type="checkbox" checked={f.inventory_enabled} onChange={set('inventory_enabled')} /> Inventory (stock items)</label></div>
        </div>
      </div>
      <div className="no-print" style={{ display: 'flex', gap: 10 }}>
        <button className="btn block" onClick={save}>Create company</button>
        {onCancel && <button className="btn ghost block" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
