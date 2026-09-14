import { useState, useMemo, useEffect } from 'react';
import { api, useApp } from '../state.jsx';
import { inr, todayISO, ddMMyyyy, qty } from '../fmt.js';
import { StockDetailModal } from './StockDetail.jsx';

// v1.11.39: Total sales done + dynamic drill-down in Sales tab — BLACK GOLD

// Sales Excel — spreadsheet-like entry + Excel upload in Sales column
// v1.11.24: Multi-sheet Excel bills auto-import + stock dynamic matching + hover/click detail

function VoucherModalLazy({ voucherId, onClose, onDeleted }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => { import('./Voucher.jsx').then(m => setComp(() => m.VoucherModal)); }, []);
  if (!Comp) return <div className="portal"><div className="box">Loading voucher…</div></div>;
  return <Comp voucherId={voucherId} onClose={onClose} onDeleted={onDeleted} />;
}
function rs2p(s) { return Math.round((Number(s) || 0) * 100); }

export function SalesExcelPanel({ accounts, items, onSaved }) {
  const { company, notify, setView } = useApp();
  const [mode, setMode] = useState('grid'); // grid | upload
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hoverItem, setHoverItem] = useState(null); // item object for tooltip
  const [hoverPos, setHoverPos] = useState({ row: -1 });
  const [detailItem, setDetailItem] = useState(null); // item for full history modal
  const [viewVoucherId, setViewVoucherId] = useState(null);
  const [salesDash, setSalesDash] = useState(null);
  const [salesList, setSalesList] = useState([]);
  useEffect(() => {
    // Fetch dashboard for total sales done — dynamic
    fetch('/api/dashboard').then(r=>r.json()).then(j=>{ if(j&&j.ok) setSalesDash(j); }).catch(()=>{});
    // Fetch recent sales vouchers for drill-down
    fetch('/api/vouchers?class=sales').then(r=>r.json()).then(j=>{ if(j&&j.ok) setSalesList(j.rows||[]); }).catch(()=>{});
  }, []);

  // Grid state for manual Excel-like entry
  const partyOpts = accounts.filter(a => a.kind === 'SundryDebtor' || a.kind === 'Cash' || a.kind === 'Bank' || a.group_code === 'sundry_debtors');
  const itemOpts = items.filter(it => !it.is_service);
  const partyMap = useMemo(() => { const m = {}; partyOpts.forEach(a => m[a.name.toLowerCase()] = a); return m; }, [partyOpts]);
  const itemMap = useMemo(() => { const m = {}; itemOpts.forEach(it => m[it.name.toLowerCase()] = it); return m; }, [itemOpts]);
  const itemStockMap = useMemo(() => { const m = {}; items.forEach(it => m[it.id] = it); return m; }, [items]);

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
      const q = Number(r.qty || 0);
      const rate = Number(r.rate || 0);
      const amt = q * rate;
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
      // dynamic stock check
      if (it.stock_qty != null && it.stock_qty + 1e-9 < Number(r.qty)) {
        setErr(`Row ${i + 1}: insufficient stock for "${it.name}" — only ${qty(it.stock_qty)} ${it.unit} in hand. Add purchase/stock journal first or this will auto-create opening stock.`);
        // don't block, just warn — engine will auto stock-in if needed, but we warn
      }
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
      notify(`Sales ${j.voucher.number || '#' + j.voucher.voucher_no} saved ✓ Total ${inr(sum.total)} — stock matched dynamically`);
      onSaved && onSaved(j.voucher);
      setRows(Array.from({ length: 8 }, () => ({ name: '', hsn: '', qty: '', rate: '', gst: '' })));
      setHeader(h => ({ ...h, number: '', ref: '', narration: '' }));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // Excel upload logic — multi-sheet support v1.11.24 (same as InvoiceImport)
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
          notify(`${j.count} sales invoices booked from Excel (multi-sheet) ✓ — stock auto-matched`);
          onSaved && onSaved(j.vouchers[0]);
        } else if (j.voucher) {
          notify(`Sales ${j.voucher.number || '#' + j.voucher.voucher_no} booked from Excel ✓ — stock auto-matched`);
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
    <div className="card" style={{ borderColor: 'var(--gold)', background: 'linear-gradient(180deg, #1a170b, #000000)', borderLeft: '4px solid var(--gold)' }}>
      <h3 style={{ color: 'var(--gold-hi)' }}>📊 Sales — Excel View (multi-sheet + live stock) — TOTAL SALE + DRILL-DOWN BLACK GOLD</h3>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px', color: 'var(--ink-dim)' }}>
        <b style={{ color: 'var(--gold-hi)' }}>NEW v1.11.39 — Total Sale + Dynamic Drill-down:</b> <b style={{ color: 'var(--ink)' }}>Upload ONE Excel where each sheet = one bill</b> → all sheets auto-booked in DD/MM/YYYY chrono order, stock matched dynamically to in-hand qty. 
        <b style={{ color: 'var(--gold)' }}>Hover or click any stock item</b> to see full history: when bought, when sold, against which party. Same as Invoice Excel → Print tab. <b style={{ color: 'var(--gold-hi)' }}>All KPIs dynamic — click to drill down.</b>
      </p>

      {/* TOTAL SALE DONE — dynamic from dashboard + sales list */}
      <div className="kpis" style={{ marginBottom: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="kpi" style={{ borderColor: 'var(--gold)', background: 'linear-gradient(180deg, rgba(212,175,55,0.14), #000)', cursor: 'pointer' }} onClick={() => setView({ name: 'daybook' })} title="Total sales done — click to see Day Book">
          <div className="k" style={{ color: 'var(--gold)' }}>Total Sales Done (All Time)</div>
          <div className="v" style={{ color: 'var(--gold-hi)', fontSize: 18 }}>{salesDash ? inr(Math.round((salesDash.sales?.fy||0) + (salesDash.sales?.month||0))) : (salesList.length ? `${salesList.length} bills` : '—')}</div>
          <div className="s" style={{ color: 'var(--ink-dim)' }}>FY {salesDash ? inr(Math.round(salesDash.sales?.fy||0)) : '—'} · {salesList.length} invoices · Click ↓</div>
        </div>
        <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => setView({ name: 'daybook' })} title="Sales this month — drill down">
          <div className="k">Sales This Month</div>
          <div className="v" style={{ color: 'var(--gold-hi)' }}>{salesDash ? inr(Math.round(salesDash.sales?.month||0)) : '—'}</div>
          <div className="s">Month dynamic · Click ↓</div>
        </div>
        <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => setView({ name: 'daybook' })} title="Total invoices">
          <div className="k">Invoices Count</div>
          <div className="v">{salesList.length}</div>
          <div className="s">Click to view Day Book ↓</div>
        </div>
        <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => setView({ name: 'reports', which: 'stock' })} title="Stock value linked to sales">
          <div className="k">Stock Value</div>
          <div className="v">{salesDash ? inr(Math.round(salesDash.stock?.totalValue||0)) : '—'}</div>
          <div className="s">{salesDash?.stock?.count||0} items · Click ↓</div>
        </div>
      </div>

      {salesList.length > 0 && (
        <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 12, border: '1px solid var(--gold-line-soft)', borderRadius: 6, background: '#000' }}>
          <table className="grid" style={{ fontSize: 12, color: 'var(--ink)' }}>
            <thead><tr><th style={{ color: 'var(--gold)', background: '#000' }}>Date DD/MM/YYYY</th><th style={{ color: 'var(--gold)', background: '#000' }}>Invoice No</th><th style={{ color: 'var(--gold)', background: '#000' }}>Buyer</th><th style={{ color: 'var(--gold)', background: '#000' }} className="tright">Amount</th><th style={{ color: 'var(--gold)', background: '#000' }}></th></tr></thead>
            <tbody>{salesList.slice(0,10).map(v => <tr key={v.id} style={{ cursor: 'pointer', background: 'rgba(212,175,55,0.03)' }} onClick={() => setViewVoucherId(v.id)} title="Click to drill down — view voucher & print"><td style={{ color: 'var(--ink-dim)' }}>{ddMMyyyy(v.date)}</td><td style={{ color: 'var(--gold-hi)' }}>{v.number || '#'+v.voucher_no}</td><td style={{ color: 'var(--ink)' }}>{v.narration?.slice(0,30) || '—'}</td><td className="tright" style={{ color: 'var(--gold)' }}>{inr(Math.round(Math.max(v.debit||0, v.credit||0)))}</td><td><button className="btn ghost sm" onClick={(e)=>{e.stopPropagation(); setViewVoucherId(v.id);}}>👁 Drill</button></td></tr>)}</tbody>
          </table>
          <div style={{ fontSize: 11, color: 'var(--ink-dim)', padding: '6px 8px' }}>Recent 10 sales — click any row to drill down to voucher detail & print — dynamic, updates live after booking</div>
        </div>
      )}


      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className={`btn ${mode === 'grid' ? '' : 'ghost'}`} onClick={() => setMode('grid')}>📊 Excel Grid (type like Excel + stock live)</button>
        <button className={`btn ${mode === 'upload' ? '' : 'ghost'}`} onClick={() => setMode('upload')}>📂 Upload Excel (multi-sheet bills)</button>
        <a className="btn ghost" href="/api/export/invoice_excel_template">⬇ Sales Excel Template (multi-sheet)</a>
        <a className="btn ghost" href="/api/export/items?mode=template">⬇ Items Template</a>
      </div>

      {mode === 'grid' && (
        <>
          <div className="frow" style={{ marginBottom: 8 }}>
            <label className="f" style={{ maxWidth: 150 }}><span>Date (DD/MM/YYYY)</span><input type="date" value={header.date} onChange={e => setHeader({ ...header, date: e.target.value })} /></label>
            <label className="f" style={{ maxWidth: 150 }}><span>Invoice No.</span><input value={header.number} onChange={e => setHeader({ ...header, number: e.target.value })} placeholder="auto" /></label>
            <label className="f" style={{ minWidth: 220 }}><span>Party (debtor) *</span><input list="sales-party-list" value={header.party} onChange={e => setHeader({ ...header, party: e.target.value })} placeholder="Type party name…" /></label>
            <label className="f" style={{ maxWidth: 150 }}><span>GST Regime</span><select value={header.regime} onChange={e => setHeader({ ...header, regime: e.target.value })}><option value="intra">Intra (CGST+SGST)</option><option value="inter">Inter (IGST)</option></select></label>
            <label className="f" style={{ maxWidth: 150 }}><span>Ref</span><input value={header.ref} onChange={e => setHeader({ ...header, ref: e.target.value })} placeholder="PO / Ref" /></label>
          </div>
          <datalist id="sales-party-list">{partyOpts.map(a => <option key={a.id} value={a.name} />)}</datalist>
          <datalist id="sales-item-list">{itemOpts.map(it => <option key={it.id} value={`${it.name} — ${it.stock_qty ?? 0} ${it.unit} in hand`} />)}</datalist>

          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ fontSize: 13 }}>
              <thead><tr><th style={{ minWidth: 260 }}>Item name * (hover/click for history) — stock live</th><th>HSN</th><th className="tright">In Hand</th><th className="tright">Qty</th><th className="tright">Rate ₹</th><th className="tright">GST%</th><th className="tright">Amount</th><th></th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const it = itemMap[r.name.trim().toLowerCase()];
                  const q = Number(r.qty || 0);
                  const rate = Number(r.rate || 0);
                  const amt = q * rate;
                  const lowStock = it && it.stock_qty != null && it.stock_qty + 1e-9 < q;
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--gold-soft)', outline: lowStock ? '1px solid #e0a06b' : 'none' }}>
                      <td style={{ position: 'relative' }}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input list="sales-item-list" value={r.name} onChange={e => setCell(i, 'name', e.target.value)}
                            onFocus={() => { if (it) { setHoverItem(it); setHoverPos({ row: i }); } }}
                            onBlur={() => setTimeout(() => setHoverItem(null), 200)}
                            onMouseEnter={() => { if (it) { setHoverItem(it); setHoverPos({ row: i }); } }}
                            onMouseLeave={() => setHoverItem(null)}
                            placeholder="Item… click for history" style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer' }} />
                          {it && <button className="btn ghost sm" style={{ fontSize: 10, padding: '2px 4px' }} onClick={() => setDetailItem(it)} title="Click to see when bought/sold & against what">📜</button>}
                        </div>
                        {hoverItem && hoverPos.row === i && hoverItem.id === it?.id && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 60, minWidth: 300, background: '#000000', color: 'var(--ink)', border: '1px solid var(--gold)', borderRadius: 8, padding: '10px 12px', fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
                            <div style={{ fontWeight: 800, color: 'var(--gold-hi)' }}>📦 {it.name}</div>
                            <div>In hand: <b style={{ color: lowStock ? '#e0a06b' : '#8ec07c' }}>{qty(it.stock_qty)} {it.unit}</b> · {inr(it.stock_value)} {lowStock && <span style={{ color: '#e0a06b' }}>⚠ low vs {q}</span>}</div>
                            <div className="faint" style={{ color: '#aaa' }}>HSN {it.hsn || '—'} · GST {it.gst_rate ?? 0}%</div>
                            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                              <button className="btn sm" style={{ fontSize: 11 }} onClick={(e) => { e.stopPropagation(); setDetailItem(it); }}>📜 Full history (buy/sell vs party)</button>
                            </div>
                          </div>
                        )}
                      </td>
                      <td><input value={r.hsn} onChange={e => setCell(i, 'hsn', e.target.value)} placeholder={it ? it.hsn : ''} style={{ width: 90, border: 'none', background: 'transparent' }} /></td>
                      <td className="tright" style={{ fontSize: 11, color: it ? (it.stock_qty > 0 ? 'var(--ink-dim)' : '#e06b6b') : 'var(--ink-faint)' }}>
                        {it ? `${qty(it.stock_qty)} ${it.unit}` : '—'}
                      </td>
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
                <tr className="gtotal"><td colSpan={6} className="tright">Taxable</td><td className="tright num">{inr(sum.taxable)}</td><td></td></tr>
                <tr className="gtotal"><td colSpan={6} className="tright">Tax</td><td className="tright num">{inr(sum.tax)}</td><td></td></tr>
                <tr className="gtotal" style={{ background: 'var(--gold-soft)', fontWeight: 700 }}><td colSpan={6} className="tright">Total</td><td className="tright num">{inr(sum.total)}</td><td></td></tr>
              </tfoot>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn ghost sm" onClick={addRow}>+ Add row (like Excel)</button>
            <label className="f" style={{ minWidth: 240, margin: 0 }}><span>Narration</span><input value={header.narration} onChange={e => setHeader({ ...header, narration: e.target.value })} placeholder="Optional" /></label>
            <button className="btn" onClick={saveGrid} disabled={busy}>{busy ? 'Saving…' : '💾 Save Sales (stock matched live)'}</button>
            <span className="faint" style={{ fontSize: 11 }}>Tip: Hover item for in-hand qty · Click 📜 for full buy/sell history vs party · Stock checked dynamically</span>
          </div>
        </>
      )}

      {mode === 'upload' && (
        <>
          <div style={{ border: '1px dashed var(--gold)', borderRadius: 8, padding: 12, background: 'linear-gradient(180deg, rgba(212,175,55,0.12), rgba(0,0,0,0.8))', marginBottom: 10, color: 'var(--ink)' }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>📂 NEW v1.11.24 — Multi-sheet Excel bills (same as Invoice Excel → Print tab)</h4>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              <b>Single Excel file, each sheet = one bill</b> (Sheet1=Bill 001, Sheet2=Bill 002, ...). Upload once → all sheets auto-detected, parsed (formatted PI-200 or tabular), sorted chrono DD/MM/YYYY, stock matched dynamically, Sales vouchers auto-created with CGST/SGST or IGST.
              Also supports single-sheet bulk grouped by invoice_no and single formatted sheet.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <label className="btn" style={{ cursor: 'pointer', borderColor: 'var(--gold)' }}>
              {busy ? 'Working…' : '📂 Choose .xlsx — multi-sheet all bills'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => {
                const f = e.target.files && e.target.files[0];
                if (f) { setFile(f); setResult(null); doUpload(f, true); }
                e.target.value = '';
              }} />
            </label>
            <span className="faint" style={{ fontSize: 12 }}>Supports: <b>Multi-sheet workbook</b> (each sheet one bill) · Tabular (invoice_no, date DD/MM/YYYY, buyer_name, item_name, qty, rate) · Formatted PI-200</span>
          </div>

          {preview && preview.bulk && (
            <div style={{ border: '1px solid var(--gold)', borderRadius: 8, padding: 14, marginTop: 10, background: 'linear-gradient(180deg, #1a170b, #000000)', boxShadow: '0 0 20px rgba(212,175,55,0.15)' }}>
              <b style={{ fontSize: 13, color: 'var(--gold-hi)', letterSpacing: 0.5 }}>Preview — {preview.count} invoices found across all sheets (multi-sheet DD/MM/YYYY chrono)</b>
              <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 8, border: '1px solid var(--gold-line-soft)', borderRadius: 6 }}>
                <table className="grid" style={{ fontSize: 12, color: 'var(--ink)' }}><thead><tr><th style={{ color: 'var(--gold)', background: '#000' }}>Sheet → Invoice No</th><th style={{ color: 'var(--gold)', background: '#000' }}>Date (DD/MM/YYYY)</th><th style={{ color: 'var(--gold)', background: '#000' }}>Buyer</th><th style={{ color: 'var(--gold)', background: '#000' }}>GSTIN</th><th style={{ color: 'var(--gold)', background: '#000' }}>Items</th><th style={{ color: 'var(--gold)', background: '#000' }}>Regime</th></tr></thead>
                  <tbody>{preview.bulk.map((p, i) => <tr key={i} style={{ background: i%2===0 ? 'rgba(212,175,55,0.04)' : 'transparent' }}><td style={{ color: 'var(--ink)' }}>{p._sheet ? `${p._sheet} → ${p.invoice_no}` : p.invoice_no}</td><td style={{ color: 'var(--ink-dim)' }}>{ddMMyyyy(p.date)}</td><td style={{ color: 'var(--gold-hi)' }}>{p.buyer.name}</td><td style={{ color: 'var(--ink-dim)' }}>{p.buyer.gstin || '—'}</td><td style={{ color: 'var(--ink)' }}>{p.items.length}</td><td style={{ color: 'var(--gold)' }}>{p.regime}</td></tr>)}</tbody></table>
              </div>
              <div style={{ fontSize: 11, marginTop: 8, color: 'var(--ink-dim)' }}>Detected {preview.count} bills across sheets — sorted chrono DD/MM/YYYY. Stock will be matched dynamically on booking.</div>
              <div style={{ marginTop: 12 }}>
                <button className="btn" style={{ background: 'linear-gradient(180deg, var(--gold-hi), var(--gold))', color: '#000', fontWeight: 800, border: '1px solid var(--gold-hi)', boxShadow: '0 0 12px rgba(212,175,55,0.4)' }} disabled={busy || !file} onClick={() => doUpload(file, false)}>{busy ? 'Booking…' : `✔ Book all ${preview.count} invoices now (stock live)`}</button>
              </div>
            </div>
          )}

          {preview && preview.parsed && (
            <div style={{ border: '1px solid var(--gold)', borderRadius: 8, padding: 14, marginTop: 10, background: 'linear-gradient(180deg, #1a170b, #000000)', color: 'var(--ink)' }}>
              <b style={{ fontSize: 13 }}>Preview — {preview.parsed._source === 'tabular' ? 'Tabular sheet' : 'Formatted PI-200 sheet'} · {preview.parsed.items.length} item(s)</b>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12.5, marginTop: 6 }}>
                <div>
                  <div><b>Invoice:</b> {preview.parsed.invoice_no} · <b>Date:</b> {ddMMyyyy(preview.parsed.date)}</div>
                  <div><b>Buyer:</b> {preview.parsed.buyer.name} · GSTIN {preview.parsed.buyer.gstin || '—'}</div>
                  <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{preview.parsed.buyer.address}</div>
                  <div><b>Regime:</b> {preview.parsed.regime} {preview.parsed.regime === 'intra' ? '(CGST+SGST)' : '(IGST)'}</div>
                </div>
                <div>
                  <table className="grid" style={{ fontSize: 11.5 }}><thead><tr><th>Item (click 📜 for history)</th><th>Qty</th><th>Rate</th><th>GST%</th><th>In Hand</th></tr></thead><tbody>{preview.parsed.items.map((it, i) => {
                    const mapIt = itemMap[it.name.trim().toLowerCase()];
                    return <tr key={i}><td>{it.name} {mapIt && <button className="btn ghost sm" style={{ fontSize: 9, padding: '1px 3px' }} onClick={() => setDetailItem(mapIt)}>📜</button>}</td><td>{it.qty}</td><td>{it.rate}</td><td>{it.gst_rate}%</td><td>{mapIt ? `${qty(mapIt.stock_qty)}` : '—'}</td></tr>;
                  })}</tbody></table>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="btn" disabled={busy || !file} onClick={() => doUpload(file, false)}>{busy ? 'Booking…' : '✔ Book this invoice (stock live)'}</button>
              </div>
            </div>
          )}

          {result && result.voucher && (
            <div style={{ border: '1px solid var(--gold)', borderRadius: 8, padding: 14, marginTop: 10, background: 'linear-gradient(180deg, #1a170b, #000000)', color: 'var(--ink)' }}>
              <b>✅ Booked from Excel — {result.voucher.number || '#' + result.voucher.voucher_no} · Date {ddMMyyyy(result.voucher.date)}</b>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => printVoucher(result.voucher.id)}>🖨 Print PI-200</button>
                <button className="btn ghost" onClick={() => setViewVoucherId(result.voucher.id)}>View voucher</button>
              </div>
            </div>
          )}

          {result && result.vouchers && (
            <div style={{ border: '1px solid var(--gold)', borderRadius: 8, padding: 14, marginTop: 10, background: 'linear-gradient(180deg, #1a170b, #000000)', color: 'var(--ink)' }}>
              <b>✅ {result.count} invoices booked from Excel (multi-sheet DD/MM/YYYY chrono)</b>
              <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
                <table className="grid" style={{ fontSize: 11.5 }}><thead><tr><th>Invoice No</th><th>Date</th><th>Voucher ID</th><th></th></tr></thead><tbody>{result.vouchers.map((v, i) => <tr key={i}><td>{v.number || '#' + v.voucher_no}</td><td>{ddMMyyyy(v.date)}</td><td>{v.id}</td><td><button className="btn ghost sm" onClick={() => printVoucher(v.id)}>🖨 Print</button> <button className="btn ghost sm" onClick={() => setViewVoucherId(v.id)}>View</button></td></tr>)}</tbody></table>
              </div>
              {result.errors && result.errors.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="faint" style={{ fontSize: 11 }}>Some sheets had errors (skipped):</div>
                  {result.errors.slice(0,10).map((e,i)=><div key={i} className="errbox" style={{ fontSize: 11, marginTop: 4 }}>{e}</div>)}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {err && <div className="errbox" style={{ marginTop: 8 }}>{err}</div>}

      {detailItem && (
        <StockDetailModal itemId={detailItem.id} itemName={detailItem.name} onClose={() => setDetailItem(null)} onVoucher={(vid) => { setDetailItem(null); setViewVoucherId(vid); }} />
      )}
      {viewVoucherId && (
        <VoucherModalLazy voucherId={viewVoucherId} onClose={() => setViewVoucherId(null)} onDeleted={() => { setViewVoucherId(null); onSaved && onSaved({}); }} />
      )}
    </div>
  );
}
