import { useState } from 'react';
import { useApp } from '../state.jsx';

// Mapping shown on the page — must match server/dataio.js columns exactly.
const MAP = [
  ['name', 'Item name, exactly as it should appear in the app', '✔', 'Steel Rod 12mm', 'b'],
  ['unit', 'Unit of measure (nos, kg, bag, box, mtr, pcs…)', '', 'qty'],
  ['hsn', 'HSN code for goods / SAC for services', '', '7214'],
  ['gst_rate', 'GST rate as a number — 0, 5, 12, 18 or 28 (blank = exempt)', '', '18'],
  ['is_service', '0 = goods (stock qty tracked) · 1 = service (no stock)', '', '0'],
  ['sale_account', 'Sales ledger used when this item is sold (blank = default)', '', 'Sales'],
  ['purchase_account', 'Purchase ledger used when this item is bought (blank = default)', '', 'Purchases'],
  ['qty', 'Opening stock qty you bought — if filled, stock added with date (single format)', '', '1000'],
  ['rate', 'Rate per unit ₹ for opening stock (required if qty filled)', '', '80.5'],
  ['date', 'Date of buying YYYY-MM-DD — for buy vs sell age tracking', '', '2026-06-15'],
  ['narration', 'Batch / Supplier ref for this purchase', '', 'Batch Jun / Supplier A'],
];

export function ItemExcelPanel({ onImported }) {
  const { notify } = useApp();
  const [mode, setMode] = useState('add');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [file, setFile] = useState(null);

  const doUpload = async (f, asPreview) => {
    if (!f) return;
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('mode', mode);
      fd.append('preview', asPreview ? '1' : '0');
      const r = await fetch('/api/import/items', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error((j && j.error) || 'Import failed.');
      if (asPreview) { setPreview(j); setResult(null); }
      else {
        setResult(j);
        if (j.created || j.updated) {
          notify(`Excel ✓ ${j.created} added · ${j.updated} updated`);
          if (onImported) onImported();
        }
      }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h3>⇅ Excel — add / update many items at once (single format with stock + date)</h3>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
        <b>Single format</b> — one Excel does everything: item master + opening stock qty/rate + <b>date of buying</b> for buy vs sell tracking.
        Fill <code>name, unit, hsn, gst_rate, qty, rate, date, narration</code> in one row. If qty+rate filled, stock is auto-added with that date.
        No secondary system needed. Download the <b>sample file</b> to see exact format. Or export <b>my current items</b>, edit and upload back with <b>Update</b>.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <a className="btn" href="/api/export/items?mode=sample">⬇ Sample file (examples + mapping)</a>
        <a className="btn ghost" href="/api/export/items?mode=template">⬇ Empty template</a>
        <a className="btn ghost" href="/api/export/items">⬇ My current items</a>
      </div>

      <table className="grid" style={{ fontSize: 12.5, marginBottom: 12 }}>
        <thead><tr><th>Excel column (keep this header)</th><th>What goes in it</th><th className="tright">Needed?</th><th>Example</th></tr></thead>
        <tbody>
          {MAP.map(([col, what, need, ex]) => (
            <tr key={col}><td><span style={{ fontFamily: 'monospace', color: 'var(--gold-hi)' }}>{col}</span></td><td className="muted">{what}</td><td className="tright">{need === '✔' ? <b style={{ color: 'var(--ok)' }}>yes</b> : <span className="faint">no</span>}</td><td className="muted">{ex}</td></tr>
          ))}
          <tr><td><span className="faint" style={{ fontFamily: 'monospace' }}>stock_qty / stock_value</span></td><td className="faint">Only in “My current items” export — shows current stock for reference. To add opening stock, just fill qty/rate/date/narration in THIS same file — no second file needed.</td><td></td><td></td></tr>
        </tbody>
      </table>

      <div className="frow" style={{ marginBottom: 10 }}>
        <label className="f" style={{ maxWidth: 480 }}>
          <span>If a name in the file already exists in the app</span>
          <select value={mode} onChange={(e) => { setMode(e.target.value); setPreview(null); setResult(null); }}>
            <option value="add">Add only — skip it, keep the existing item</option>
            <option value="update">Update &amp; add — existing item is changed to this row’s details</option>
          </select>
        </label>
        <label className="btn" style={{ cursor: 'pointer', alignSelf: 'end', marginBottom: 10 }}>
          {busy ? 'Working…' : '📂 Choose .xlsx / .csv file'}
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) { setFile(f); setResult(null); doUpload(f, true); }
            e.target.value = '';
          }} />
        </label>
      </div>

      {err && <div className="errbox">{err}</div>}

      {preview && preview.total !== undefined && (
        <div style={{ border: '1px solid var(--gold-line-soft)', borderRadius: 6, padding: 10, marginTop: 4 }}>
          <b style={{ fontSize: 13 }}>Preview — {preview.total} row{preview.total === 1 ? '' : 's'} in the file</b>
          {preview.total === 0 && <div className="empty">No data rows found (only the header?). Add your items under row 1, save, and upload again.</div>}
          {preview.total > 0 && (
            <>
              <div style={{ overflow: 'auto', maxHeight: 220 }}>
                <table className="grid" style={{ fontSize: 12.5 }}>
                  <thead><tr>{preview.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                  <tbody>{preview.rows.map((r, i) => (
                    <tr key={i}>{preview.headers.map((h, j) => <td key={j}>{String(r[h] ?? '')}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn" disabled={busy || !file} onClick={() => doUpload(file, false)}>
                  {busy ? 'Importing…' : '✔ Import this file now'}
                </button>
                <span className="faint" style={{ fontSize: 12 }}>Shown above: first {preview.rows.length} of {preview.total} rows ({mode === 'update' ? 'Update & add' : 'Add only'} mode).</span>
              </div>
            </>
          )}
        </div>
      )}

      {result && (
        <div style={{ border: '1px solid var(--gold-line-soft)', borderRadius: 6, padding: 10, marginTop: 4 }}>
          <b style={{ fontSize: 13 }}>Import result</b>
          <div className="kpis" style={{ margin: '6px 0' }}>
            <div className="kpi"><div className="k">Added</div><div className="v" style={{ color: 'var(--ok)' }}>{result.created}</div></div>
            <div className="kpi"><div className="k">Updated</div><div className="v">{result.updated}</div></div>
            <div className="kpi"><div className="k">Skipped</div><div className="v">{result.skipped}</div></div>
            <div className="kpi"><div className="k">Problems</div><div className="v" style={{ color: result.errors && result.errors.length ? '#e0a06b' : 'var(--ok)' }}>{result.errors ? result.errors.length : 0}</div></div>
          </div>
          {result.created === 0 && result.updated === 0 && (!result.errors || !result.errors.length) && (
            <p className="muted" style={{ fontSize: 13 }}>Nothing was imported — every row was skipped. Rows whose name starts with “EXAMPLE-” are placeholders: rename them to your real item names (or delete them), then upload again.</p>
          )}
          {result.errors && result.errors.length > 0 && (
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {result.errors.slice(0, 40).map((e, i) => <div key={i} style={{ padding: '3px 6px', fontSize: 12.5, color: '#e0a06b' }}>⚠ {e}</div>)}
              {result.errors.length > 40 && <div className="faint" style={{ padding: 6, fontSize: 12 }}>…and {result.errors.length - 40} more (fix and re-upload).</div>}
            </div>
          )}
          {(result.created > 0 || result.updated > 0) && (
            <p className="muted" style={{ fontSize: 13 }}>Done ✓ — items + opening stock (with buying date) imported in one go. Stock appears in Home inventory KPIs and Day Book → Stock Journal grouped by date for buy vs sell age tracking.</p>
          )}
        </div>
      )}
    </div>
  );
}
