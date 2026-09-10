import { useEffect, useState } from 'react';
import { api, useApp } from '../state.jsx';
import { CLASSES, dshort, inr, todayISO } from '../fmt.js';
import { VoucherModal } from './Voucher.jsx';

export function DayBookScreen({ focusId }) {
  const { company, notify, setView } = useApp();
  const [from, setFrom] = useState(company ? company.books_begin_from : todayISO());
  const [to, setTo] = useState(todayISO());
  const [cls, setCls] = useState('');
  const [rows, setRows] = useState(null);
  const [viewId, setViewId] = useState(null);
  const load = async () => {
    const q = '/vouchers?from=' + from + '&to=' + to + (cls ? '&class=' + cls : '');
    const j = await api(q);
    setRows(j.rows);
  };
  useEffect(() => {
    if (focusId) { setViewId(focusId); setView && setView({ name: 'daybook' }); }
  }, [focusId]);
  useEffect(() => { load().catch((e) => notify(e.message)); }, [from, to, cls]);
  const total = (rows || []).reduce((s, r) => ({ dr: s.dr + r.debit, cr: s.cr + r.credit }), { dr: 0, cr: 0 });
  return (
    <div>
      <div className="pagetitle">
        <div><div className="crumb">Transactions · Day Book</div><h1>Day Book</h1></div>
      </div>
      <div className="card">
        <div className="frow" style={{ marginBottom: 10 }}>
          <label className="f"><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="f"><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="f"><span>Voucher type</span>
            <select value={cls} onChange={(e) => setCls(e.target.value)}>
              <option value="">All</option>
              {Object.keys(CLASSES).map((k) => <option key={k} value={k}>{CLASSES[k].label}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
            <button className="btn ghost" onClick={load}>Refresh</button>
          </div>
        </div>
        {rows !== null && rows.length === 0 && <div className="empty">No vouchers in this period.</div>}
        {rows && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Narration</th><th className="tright">Debit</th><th className="tright">Credit</th><th></th></tr></thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} onClick={() => setViewId(v.id)} style={{ cursor: 'pointer' }}>
                    <td className="num">{dshort(v.date)}</td>
                    <td><b>{(CLASSES[v.class] || {}).label || v.class}</b></td>
                    <td className="num">{v.number || ('#' + v.voucher_no)}</td>
                    <td className="muted">{v.narration}</td>
                    <td className="tright num">{inr(v.debit)}</td>
                    <td className="tright num">{inr(v.credit)}</td>
                    <td className="no-print"><button className="btn ghost sm">View</button></td>
                  </tr>
                ))}
                <tr className="gtotal">
                  <td colSpan={4}>Total ({rows.length} vouchers)</td>
                  <td className="tright num">{inr(total.dr)}</td>
                  <td className="tright num">{inr(total.cr)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      {viewId && <VoucherModal voucherId={viewId} onClose={() => setViewId(null)} onDeleted={load} />}
    </div>
  );
}

/* ============ Edit Log (audit trail of all voucher create/edit/delete) ============ */
export function EditLogScreen() {
  const { notify } = useApp();
  const [rows, setRows] = useState(null);
  const [viewId, setViewId] = useState(null);
  const load = async () => setRows((await api('/edit-log')).rows);
  useEffect(() => { load().catch((e) => notify(e.message)); }, []);
  return (
    <div>
      <div className="pagetitle">
        <div><div className="crumb">Audit</div><h1>Edit Log</h1></div>
        <button className="btn ghost" onClick={load}>Refresh</button>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        Every voucher creation, edit and deletion is recorded with the date — the old version stays archived after edits/deletes (helps audits & MCA-style compliance).
      </p>
      <div className="card">
        {rows === null && <div className="empty">Loading…</div>}
        {rows && rows.length === 0 && <div className="empty">No activity recorded yet.</div>}
        {rows && rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead><tr><th>Date</th><th>Action</th><th>Voucher</th><th>No.</th><th></th></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td className="num">{dshort(l.at)}</td>
                    <td>
                      <span className={`badge ${l.action === 'create' ? 'gold' : ''}`}
                        style={l.action === 'delete' ? { color: '#e0a06b', borderColor: 'rgba(224,138,75,.5)' } : {}}>
                        {l.action.toUpperCase()}
                      </span>
                    </td>
                    <td>{l.class ? <b>{CLASSES[l.class] ? CLASSES[l.class].label : l.class}</b> : <span className="faint">(deleted voucher)</span>}</td>
                    <td className="num">{l.vnumber || (l.voucher_id ? '#' + l.voucher_no : '—')}</td>
                    <td className="no-print">
                      {l.voucher_id && l.class && (
                        <button className="btn ghost sm" onClick={() => setViewId(l.voucher_id)}>Open</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {viewId && <VoucherModal voucherId={viewId} onClose={() => setViewId(null)} />}
    </div>
  );
}
