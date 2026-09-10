import { useEffect, useState } from 'react';
import { api, useApp } from '../state.jsx';

const KINDS = {
  ledgers: {
    label: 'Ledgers', icon: '☰', order: 1,
    hint: 'Parties, banks, expenses, income — with opening balances. One row = one ledger.',
    tips: 'Do this FIRST: it creates the ledgers your items and vouchers will refer to. Required: name + group (pick the exact group name from the template’s Info sheet).',
  },
  items: {
    label: 'Stock Items — SINGLE FORMAT', icon: '▤', order: 2,
    hint: 'ONE file does everything: item master + opening qty/rate + date of buying + narration for buy vs sell age tracking.',
    tips: 'SINGLE FORMAT — no second file needed: name (required), unit, hsn, gst_rate, is_service, qty, rate, date (YYYY-MM-DD when you bought it), narration/batch. If qty+rate filled, stock is auto-added grouped by date into Stock Journal vouchers. This is the ONLY place you need to add opening stock now. No secondary Opening Stock import.',
  },
  vouchers: {
    label: 'Vouchers', icon: '✎', order: 3,
    hint: 'Receipt / Payment / Contra / Journal entries — one row per voucher, debit & credit side in one row.',
    tips: 'Each row must balance (dr_amount = cr_amount). Account names must already exist. Dates must be inside the books period.',
  },
};

export function DataScreen() {
  const { notify } = useApp();
  const [kind, setKind] = useState('items');
  const [mode, setMode] = useState('add');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [file, setFile] = useState(null);

  useEffect(() => { setPreview(null); setResult(null); setErr(''); setFile(null); }, [kind]);

  const meta = KINDS[kind];

  const doUpload = async (f, asPreview) => {
    if (!f) return;
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('mode', mode);
      fd.append('preview', asPreview ? '1' : '0');
      const r = await fetch('/api/import/' + kind, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error((j && j.error) || 'Import failed.');
      if (asPreview) { setPreview(j); setResult(null); }
      else {
        setResult(j);
        if (j.created || j.updated) notify(`Imported ✓ ${j.created} created · ${j.updated} updated`);
      }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="pagetitle">
        <div><div className="crumb">Data · Import / Export</div><h1>Excel Import & Export</h1></div>
      </div>
      <p className="muted" style={{ marginTop: -6, fontSize: 13.5 }}>
        Download a template <b>once</b> — it always keeps the same format. Fill it in Excel (or export your
        current data, edit, and import back). Upload here and the rows are added to your books. Works with
        .xlsx, .xls and .csv. <b>Stock Items is now SINGLE FORMAT</b> — item master + qty/rate/date/narration in ONE file, no second file.
      </p>
      <div className="tiles" style={{ margin: '14px 0' }}>
        {Object.keys(KINDS).sort((a, b) => KINDS[a].order - KINDS[b].order).map((k) => (
          <button key={k} className={`tile${kind === k ? ' sel' : ''}`} style={kind === k ? { borderColor: 'var(--gold)', background: 'var(--gold-soft)' } : {}} onClick={() => setKind(k)}>
            <div className="t">{KINDS[k].icon} {KINDS[k].label}</div>
            <div className="s">{KINDS[k].hint.slice(0, 52)}…</div>
          </button>
        ))}
      </div>

      <div className="card">
        <h3>{meta.icon} {meta.label} — import</h3>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>{meta.hint}</p>
        <label className="f" style={{ maxWidth: 420 }}>
          <span>If an item/ledger name already exists</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="add">Skip it (keep existing)</option>
            <option value="update">Update it (change details)</option>
          </select>
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="btn" style={{ cursor: 'pointer' }}>
            {busy ? 'Working…' : '📂 Choose .xlsx / .csv file'}
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) { setFile(f); setResult(null); doUpload(f, true); }
              e.target.value = '';
            }} />
          </label>
          <a className="btn ghost" href={`/api/export/${kind}?mode=template`}>⬇ Template (empty)</a>
          <a className="btn ghost" href={`/api/export/${kind}`}>⬇ My current data</a>
          {kind === 'items' && <a className="btn" href={`/api/export/items?mode=sample`}>⬇ Sample with qty/rate/date</a>}
        </div>
        <p className="ledger-hint" style={{ marginTop: 10 }}>{meta.tips}</p>
      </div>

      {err && <div className="errbox">{err}</div>}

      {preview && preview.total !== undefined && (
        <div className="card">
          <h3>Preview — {preview.total} row{preview.total === 1 ? '' : 's'} found</h3>
          {preview.total === 0 && <div className="empty">The file has no data rows (only the header?). Add rows under the header, save, and upload again.</div>}
          {preview.total > 0 && (
            <>
              <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
                <table className="grid">
                  <thead><tr>{preview.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}>{preview.headers.map((h, j) => <td key={j}>{String(r[h] ?? '')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn" disabled={busy || !file} onClick={() => doUpload(file, false)}>
                  {busy ? 'Importing…' : '✔ Import this file now'}
                </button>
                <span className="faint" style={{ fontSize: 12 }}>Shown above is the first {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'} of {preview.total}. Rows are validated during import — problem rows are reported, good rows are imported.</span>
              </div>
            </>
          )}
        </div>
      )}

      {result && (
        <div className="card">
          <h3>Import result</h3>
          <div className="kpis" style={{ margin: '6px 0 12px' }}>
            <div className="kpi"><div className="k">Created</div><div className="v" style={{ color: 'var(--ok)' }}>{result.created}</div></div>
            <div className="kpi"><div className="k">Updated</div><div className="v">{result.updated}</div></div>
            <div className="kpi"><div className="k">Skipped</div><div className="v">{result.skipped}</div></div>
            <div className="kpi"><div className="k">Problems</div><div className="v" style={{ color: result.errors && result.errors.length ? '#e0a06b' : 'var(--ok)' }}>{result.errors ? result.errors.length : 0}</div></div>
          </div>
          {result.created > 0 && <p className="muted" style={{ fontSize: 13 }}>Done ✓ — rows imported. {kind === 'items' && 'Opening stock with buying date is now in the books (Home KPIs + Day Book → Stock Journal grouped by date). No secondary file needed.'}</p>}
          {result.errors && result.errors.length > 0 && (
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--gold-line-soft)', borderRadius: 6 }}>
              {result.errors.slice(0, 50).map((e, i) => <div key={i} style={{ padding: '4px 8px', fontSize: 12.5, color: '#e0a06b', borderBottom: '1px solid var(--gold-line-soft)' }}>⚠ {e}</div>)}
              {result.errors.length > 50 && <div className="faint" style={{ padding: 6, fontSize: 12 }}>…and {result.errors.length - 50} more (fix & re-upload).</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
