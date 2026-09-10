import { useState, useMemo, useEffect } from 'react';
import { api, useApp } from '../state.jsx';
import { inr, todayISO } from '../fmt.js';

// Sales Excel — spreadsheet-like entry + Excel upload in Sales column
// User wanted: see Excel in sales column, not areas to fill details
// So we give: 1) Excel upload that books invoices (existing logic) + 2) Excel-like grid for manual entry

function rs2p(s) { return Math.round((Number(s) || 0) * 100); }

export function SalesExcelPanel({ accounts, items, onSaved }) {
  const { company, notify } = useApp();
  const [mode, setMode] = useState('grid'); // grid | upload
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Grid state for manual Excel-like entry
  const partyOpts = accounts.filter(a => a.kind === 'SundryDebtor' || a.kind === 'Cash' || a.kind === 'Bank');
  const itemOpts = items.filter(it => !it.is_service);
  const partyMap = useMemo(() => { const m = {}; partyOpts.forEach(a => m[a.name.toLowerCase()] = a); return m; }, [partyOpts]);
  const itemMap = useMemo(() => { const m = {}; itemOpts.forEach(it => m[it.name.toLowerCase()] = it); return m; }, [itemOpts]);

  const [header, setHeader] = useState({
    date: todayISO(),
    number: '',
    party: '',
    ref: '',
    regime: (company.extras && company.extras.tax_regime_default) || 'intra',
    narration: ''
  });
  const [rows, setRows] = useState(() => Array.from({ length: 8 }, () => ({ name: '', hsn: '', qty: '', rate: '', gst: '' })));

  const compute = () => {
    let taxable = 0;
    let tax = 0;
    rows.forEach(r => {
      const it = itemMap[r.name.trim().toLowerCase()];
      const qty = Number(r.qty || 0);
      const rate = Number(r.rate || 0);
      const amt = qty * rate;
      if (amt <= 0) return;
      taxable += amt;
      const g = r.gst !== '' ? Number(r.gst) : (it ? Number(it.gst_rate) : 0);
      if (g > 0) tax += Math.round(amt * g / 100);
    });
    return { taxable: Math.round(taxable * 100), tax: Math.round(tax * 100), total: Math.round((taxable + tax) * 100) };
  };
  const sum = compute();

  const addRow = () => setRows([...rows, { name: '', hsn: '', qty: '', rate: '', gst: '' }]);
  const setCell = (i, k, v) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const delRow = (i) => setRows(rows.filter((_, j) => j !== i));

  const saveGrid = async () => {
    setErr('');
    const partyAcc = partyMap[header.party.trim().toLowerCase()];
    if (!partyAcc) { setErr('Choose party (debtor) — type name from Masters → Ledgers'); return; }
    const items2 = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.name.trim() && !r.qty && !r.rate) continue;
      const it = itemMap[r.name.trim().toLowerCase()];
      if (!it) { setErr(`Row ${i + 1}: unknown item "${r.name}" — create it in Stock Items first or check spelling`); return; }
      if (!(Number(r.qty) > 0)) { setErr(`Row ${i + 1}: qty must be >0`); return; }
      if (!(Number(r.rate) > 0)) { setErr(`Row ${i + 1}: rate must be >0`); return; }
      items2.push({ item_id: it.id, qty: Number(r.qty), rate: Number(r.rate) });
    }
    if (!items2.length) { setErr('Add at least one item row'); return; }
    setBusy(true);
    try {
      const body = {
        class: 'sales',
        date: header.date,
        number: header.number,
        ref: header.ref,
        narration: header.narration,
        regime: header.regime,
        party_id: partyAcc.id,
        items: items2,
        auto_tax: true
      };
      const j = await api('/vouchers', { body });
      notify(`Sales ${j.voucher.number || '#' + j.voucher.voucher_no} saved ✓ Total ${inr(sum.total)}`);
      onSaved && onSaved(j.voucher);
      setRows(Array.from({ length: 8 }, () => ({ name: '', hsn: '', qty: '', rate: '', gst: '' })));
      setHeader(h => ({ ...h, number: '', ref: '', narration: '' }));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // Excel upload logic (reuse invoice_excel endpoint) — supports bulk
  const doUpload = async (f, asPreview) => {
    if (!f) return;
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('preview', asPreview ? '1' : '0');
      const r = await fetch('/api/import/invoice_excel', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error((j && j.error) || 'Import failed');
      if (asPreview) { setPreview(j); setResult(null); }
      else {
        setResult(j);
        if (j.vouchers) {
          notify(`${j.count} sales invoices booked from Excel ✓`);
          onSaved && onSaved(j.vouchers[0]);
        } else if (j.voucher) {
          notify(`Sales ${j.voucher.number || '#' + j.voucher.voucher_no} booked from Excel ✓`);
          onSaved && onSaved(j.voucher);
        }
      }
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const printVoucher = async (voucherId) => {
    try {
      const j = await api('/vouchers/' + voucherId);
      const mod = await import('../invprint.js');
      const doc = mod.docFromVoucher(j.voucher, company);
      mod.openInvoicePrint(`${doc.number} · Proforma Invoice`, mod.invoiceHtml(doc));
    } catch (e) { notify(e.message); }
  };

  return (
    <div className="card" style={{ borderColor: 'var(--gold)', background: 'var(--gold-soft)' }}>
      <h3>📊 Sales — Excel View (like your old Excel sheets)</h3>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
        <b>Two ways, same Sales column:</b> 1) <b>Excel Grid</b> — type directly in spreadsheet-like rows (Item, Qty, Rate) and save — feels like Excel, no form boxes. 2) <b>Upload Excel</b> — upload your existing PI-200 or tabular Excel (invoice_no, buyer_name, item_name, qty, rate, gst_rate) and it books + lets you print PI-200 exact.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={`btn ${mode === 'grid' ? '' : 'ghost'}`} onClick={() => setMode('grid')}>📊 Excel Grid (type like Excel)</button>
        <button className={`btn ${mode === 'upload' ? '' : 'ghost'}`} onClick={() => setMode('upload')}>📂 Upload your Excel file</button>
        <a className="btn ghost" href="/api/export/invoice_excel_template">⬇ Sales Excel Template</a>
      </div>

      {mode === 'grid' && (
        <>
          <div className="frow" style={{ marginBottom: 8 }}>
            <label className="f" style={{ maxWidth: 150 }}><span>Date</span><input type="date" value={header.date} onChange={e => setHeader({ ...header, date: e.target.value })} /></label>
            <label className="f" style={{ maxWidth: 150 }}><span>Invoice No.</span><input value={header.number} onChange={e => setHeader({ ...header, number: e.target.value })} placeholder="auto" /></label>
            <label className="f" style={{ minWidth: 220 }}><span>Party (debtor) *</span><input list="sales-party-list" value={header.party} onChange={e => setHeader({ ...header, party: e.target.value })} placeholder="Type party name…" /></label>
            <label className="f" style={{ maxWidth: 150 }}><span>GST Regime</span><select value={header.regime} onChange={e => setHeader({ ...header, regime: e.target.value })}><option value="intra">Intra (CGST+SGST)</option><option value="inter">Inter (IGST)</option></select></label>
            <label className="f" style={{ maxWidth: 150 }}><span>Ref</span><input value={header.ref} onChange={e => setHeader({ ...header, ref: e.target.value })} placeholder="PO / Ref" /></label>
          </div>
          <datalist id="sales-party-list">{partyOpts.map(a => <option key={a.id} value={a.name} />)}</datalist>
          <datalist id="sales-item-list">{itemOpts.map(it => <option key={it.id} value={it.name} />)}</datalist>

          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ fontSize: 13 }}>
              <thead><tr><th style={{ minWidth: 220 }}>Item name * (type like Excel)</th><th>HSN</th><th className="tright">Qty</th><th className="tright">Rate ₹</th><th className="tright">GST%</th><th className="tright">Amount</th><th></th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const it = itemMap[r.name.trim().toLowerCase()];
                  const qty = Number(r.qty || 0);
                  const rate = Number(r.rate || 0);
                  const amt = qty * rate;
                  const gstRate = r.gst !== '' ? Number(r.gst) : (it ? it.gst_rate : '');
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--gold-soft)' }}>
                      <td><input list="sales-item-list" value={r.name} onChange={e => setCell(i, 'name', e.target.value)} placeholder="Item…" style={{ width: '100%', border: 'none', background: 'transparent' }} /></td>
                      <td><input value={r.hsn} onChange={e => setCell(i, 'hsn', e.target.value)} placeholder={it ? it.hsn : ''} style={{ width: 90, border: 'none', background: 'transparent' }} /></td>
                      <td className="tright"><input className="num" value={r.qty} onChange={e => setCell(i, 'qty', e.target.value)} placeholder="0" inputMode="decimal" style={{ width: 70, textAlign: 'right', border: 'none', background: 'transparent' }} /></td>
                      <td className="tright"><input className="num" value={r.rate} onChange={e => setCell(i, 'rate', e.target.value)} placeholder="0.00" inputMode="decimal" style={{ width: 90, textAlign: 'right', border: 'none', background: 'transparent' }} /></td>
                      <td className="tright"><input className="num" value={r.gst} onChange={e => setCell(i, 'gst', e.target.value)} placeholder={it && it.gst_rate != null ? String(it.gst_rate) : '18'} inputMode="decimal" style={{ width: 60, textAlign: 'right', border: 'none', background: 'transparent' }} /></td>
                      <td className="tright num">{amt ? inr(Math.round(amt * 100)) : ''}</td>
                      <td><button className="btn ghost sm" onClick={() => delRow(i)} title="Delete row">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="gtotal"><td colSpan={5} className="tright">Taxable</td><td className="tright num">{inr(sum.taxable)}</td><td></td></tr>
                <tr className="gtotal"><td colSpan={5} className="tright">Tax</td><td className="tright num">{inr(sum.tax)}</td><td></td></tr>
                <tr className="gtotal" style={{ background: 'var(--gold-soft)', fontWeight: 700 }}><td colSpan={5} className="tright">Total</td><td className="tright num">{inr(sum.total)}</td><td></td></tr>
              </tfoot>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn ghost sm" onClick={addRow}>+ Add row (like Excel)</button>
            <label className="f" style={{ minWidth: 240, margin: 0 }}><span>Narration</span><input value={header.narration} onChange={e => setHeader({ ...header, narration: e.target.value })} placeholder="Optional" /></label>
            <button className="btn" onClick={saveGrid} disabled={busy}>{busy ? 'Saving…' : '💾 Save Sales (Excel grid)'}</button>
            <span className="faint" style={{ fontSize: 11 }}>Tip: Type item names as in Stock Items — auto GST% from master. Press Tab to move like Excel.</span>
          </div>
        </>
      )}

      {mode === 'upload' && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <label className="btn" style={{ cursor: 'pointer' }}>
              {busy ? 'Working…' : '📂 Choose .xlsx / .csv file'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => {
                const f = e.target.files && e.target.files[0];
                if (f) { setFile(f); setResult(null); doUpload(f, true); }
                e.target.value = '';
              }} />
            </label>
            <span className="faint" style={{ fontSize: 12 }}>Supports PI-200 formatted sheet OR tabular (invoice_no, date, buyer_name, buyer_gstin, item_name, qty, rate, gst_rate) — one file can have many invoices grouped by invoice_no.</span>
          </div>

          {preview && preview.bulk && (
            <div style={{ border: '1px solid var(--gold-line-soft)', borderRadius: 6, padding: 10, marginTop: 8 }}>
              <b style={{ fontSize: 13 }}>Preview — {preview.count} invoices in Excel (bulk)</b>
              <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6 }}>
                <table className="grid" style={{ fontSize: 11.5 }}><thead><tr><th>Invoice No</th><th>Date</th><th>Buyer</th><th>Items</th></tr></thead><tbody>{preview.bulk.map((p, i) => <tr key={i}><td>{p.invoice_no}</td><td>{p.date}</td><td>{p.buyer.name}</td><td>{p.items.length}</td></tr>)}</tbody></table>
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="btn" disabled={busy || !file} onClick={() => doUpload(file, false)}>{busy ? 'Booking…' : `✔ Book all ${preview.count} invoices from Excel`}</button>
              </div>
            </div>
          )}

          {preview && preview.parsed && (
            <div style={{ border: '1px solid var(--gold-line-soft)', borderRadius: 6, padding: 10, marginTop: 8 }}>
              <b style={{ fontSize: 13 }}>Preview — {preview.parsed._source === 'tabular' ? 'Tabular Excel' : 'PI-200 Formatted Excel'} · {preview.parsed.items.length} item(s)</b>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12.5, marginTop: 6 }}>
                <div>
                  <div><b>Invoice:</b> {preview.parsed.invoice_no} · <b>Date:</b> {preview.parsed.date}</div>
                  <div><b>Buyer:</b> {preview.parsed.buyer.name} · GSTIN {preview.parsed.buyer.gstin || '—'}</div>
                  <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{preview.parsed.buyer.address}</div>
                  <div><b>Regime:</b> {preview.parsed.regime} {preview.parsed.regime === 'intra' ? '(CGST+SGST)' : '(IGST)'}</div>
                </div>
                <div>
                  <table className="grid" style={{ fontSize: 11.5 }}><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>GST%</th></tr></thead><tbody>{preview.parsed.items.map((it, i) => <tr key={i}><td>{it.name}</td><td>{it.qty}</td><td>{it.rate}</td><td>{it.gst_rate}%</td></tr>)}</tbody></table>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="btn" disabled={busy || !file} onClick={() => doUpload(file, false)}>{busy ? 'Booking…' : '✔ Book this invoice from Excel'}</button>
              </div>
            </div>
          )}

          {result && result.voucher && (
            <div style={{ border: '1px solid var(--gold)', borderRadius: 6, padding: 10, marginTop: 8 }}>
              <b>✅ Booked from Excel — {result.voucher.number || '#' + result.voucher.voucher_no}</b>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => printVoucher(result.voucher.id)}>🖨 Print PI-200</button>
              </div>
            </div>
          )}

          {result && result.vouchers && (
            <div style={{ border: '1px solid var(--gold)', borderRadius: 6, padding: 10, marginTop: 8 }}>
              <b>✅ {result.count} invoices booked from Excel</b>
              <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6 }}>
                <table className="grid" style={{ fontSize: 11.5 }}><thead><tr><th>Invoice No</th><th>Voucher ID</th><th></th></tr></thead><tbody>{result.vouchers.map((v, i) => <tr key={i}><td>{v.number || '#' + v.voucher_no}</td><td>{v.id}</td><td><button className="btn ghost sm" onClick={() => printVoucher(v.id)}>🖨 Print</button></td></tr>)}</tbody></table>
              </div>
            </div>
          )}
        </>
      )}

      {err && <div className="errbox" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
