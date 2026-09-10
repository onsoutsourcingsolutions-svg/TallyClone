import { useEffect, useState } from 'react';
import { useApp } from '../state.jsx';
import { todayISO } from '../fmt.js';

const MAP = [
  ['item_name', 'Item name — must already exist in Stock Items master', '✔', 'CHEMIEBOR - 36 (GRANULAR)'],
  ['qty', 'Quantity you bought', '✔', '1000'],
  ['rate', 'Rate per unit ₹', '✔', '80.5'],
  ['date', 'Date of buying YYYY-MM-DD — for tracking when you bought vs when you sold', '✔', '2026-06-15'],
  ['narration', 'Batch / Supplier ref / Remarks (optional)', '', 'Batch Jun / Supplier A'],
];

export function StockExcelPanel({ onImported }) {
  const { notify } = useApp();
  const [accounts, setAccounts] = useState([]);
  const [date, setDate] = useState(todayISO());
  const [ctrId, setCtrId] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [file, setFile] = useState(null);

  useEffect(() => {
    fetch('/api/accounts').then(r => r.json()).then(j => setAccounts(j.rows || [])).catch(() => setAccounts([]));
  }, []);

  const doUpload = async (f, asPreview) => {
    if (!f) return;
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('mode', 'add');
      fd.append('date', date);
      if (ctrId) fd.append('counterpart_id', ctrId);
      fd.append('preview', asPreview ? '1' : '0');
      const r = await fetch('/api/import/stock', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error((j && j.error) || 'Import failed.');
      if (asPreview) { setPreview(j); setResult(null); }
      else {
        setResult(j);
        if (j.created) {
          notify(`Stock ✓ ${j.created} vouchers created`);
          if (onImported) onImported();
        }
      }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ borderColor: 'var(--gold-line)' }}>
      <h3>📦 Opening Stock — with date of buying (for buy vs sell tracking)</h3>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
        Add your current stock with <b>date of buying</b> per row — so Home dashboard can show <b>when you bought vs when you sold</b>, aging (days in stock), and last buy/sell dates.
        Each different date creates its own Stock Journal voucher.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <a className="btn" href="/api/export/stock?mode=template">⬇ Sample file with date (item_name, qty, rate, date, narration)</a>
        <a className="btn ghost" href="/api/export/stock">⬇ My current stock (qty/rate)</a>
      </div>

      <table className="grid" style={{ fontSize: 12.5, marginBottom: 12 }}>
        <thead><tr><th>Excel column</th><th>What goes in it</th><th className="tright">Needed?</th><th>Example</th></tr></thead>
        <tbody>
          {MAP.map(([col, what, need, ex]) => (
            <tr key={col}><td><span style={{ fontFamily: 'monospace', color: 'var(--gold-hi)' }}>{col}</span></td><td className="muted">{what}</td><td className="tright">{need === '✔' ? <b style={{ color: 'var(--ok)' }}>yes</b> : <span className="faint">no</span>}</td><td className="muted">{ex}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="frow" style={{ marginBottom: 10 }}>
        <label className="f"><span>Default date if row has no date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="f"><span>Balancing account * (for stock value)</span>
          <select value={ctrId} onChange={e => setCtrId(e.target.value)}>
            <option value="">— choose —</option>
            {accounts.filter(a => a.type === 'Liability' || a.group_code === 'reserves_surplus' || a.group_code === 'capital').map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.group_code.replace(/_/g,' ')})</option>
            ))}
            {accounts.filter(a => !(a.type === 'Liability' || a.group_code === 'reserves_surplus' || a.group_code === 'capital')).slice(0,20).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="btn" style={{ cursor: 'pointer', alignSelf: 'end', marginBottom: 10 }}>
          {busy ? 'Working…' : '📂 Choose .xlsx with date'}
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => {
            const f = e.target.files && e.target.files[0];
            if (f) { setFile(f); setResult(null); doUpload(f, true); }
            e.target.value = '';
          }} />
        </label>
      </div>

      {err && <div className="errbox">{err}</div>}

      {preview && preview.total !== undefined && (
        <div style={{ border: '1px solid var(--gold-line-soft)', borderRadius: 6, padding: 10, marginTop: 4 }}>
          <b style={{ fontSize: 13 }}>Preview — {preview.total} row{preview.total === 1 ? '' : 's'} in file</b>
          {preview.total === 0 && <div className="empty">No data rows found. Add rows under header, save, upload again.</div>}
          {preview.total > 0 && (
            <>
              <div style={{ overflow: 'auto', maxHeight: 220 }}>
                <table className="grid" style={{ fontSize: 12.5 }}>
                  <thead><tr>{preview.headers.map((h,i) => <th key={i}>{h}</th>)}</tr></thead>
                  <tbody>{preview.rows.map((r,i) => (
                    <tr key={i}>{preview.headers.map((h,j) => <td key={j}>{String(r[h] ?? '')}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn" disabled={busy || !file || !ctrId} onClick={() => doUpload(file, false)}>
                  {busy ? 'Importing…' : '✔ Import stock with dates now'}
                </button>
                <span className="faint" style={{ fontSize: 12 }}>Each different date in file → separate Stock Journal voucher. See Day Book & Home → Inventory aging.</span>
              </div>
            </>
          )}
        </div>
      )}

      {result && (
        <div style={{ border: '1px solid var(--gold-line-soft)', borderRadius: 6, padding: 10, marginTop: 4 }}>
          <b style={{ fontSize: 13 }}>Import result — {result.created} vouchers created</b>
          <div style={{ fontSize: 12, marginTop: 4 }}>{result.samples?.join(' · ')}</div>
          {result.errors && result.errors.length > 0 && (
            <div style={{ maxHeight: 160, overflowY: 'auto', marginTop: 6 }}>
              {result.errors.slice(0,30).map((e,i) => <div key={i} style={{ color: '#e0a06b', fontSize: 12 }}>⚠ {e}</div>)}
            </div>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Done ✓ — check Home → Inventory for buy/sell tracking and aging (days in stock).</p>
        </div>
      )}
    </div>
  );
}
